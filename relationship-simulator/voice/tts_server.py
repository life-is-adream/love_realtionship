#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""HeartFlow 本地 TTS sidecar（双引擎，完全离线，仅绑定 127.0.0.1）。

引擎：
  chattts  ChatTTS 0.2.5（约 2GB，PyTorch/CUDA）——拟真度高，能带语气词与停顿
  kokoro   Kokoro-82M（ONNX，约 325MB，CPU）——轻量兜底，速度快

为什么是「一个进程两个引擎」：前端只需一个地址、一套协议；默认引擎预热加载，
另一个引擎在首次被请求时才加载，避免白占内存/显存。

端点：
  GET  /health   -> 每个引擎的状态、音色、设备、加载耗时
  GET  /voices   -> 默认引擎音色（兼容旧前端）
  POST /tts      -> body {text, engine?, voice?, speed?}，返回 audio/wav
                    响应头带 X-Tts-Engine / X-Tts-Latency-Ms

约束：单次文本 <= 300 字；引擎内串行推理（两者都不是线程安全的）。
"""

import io
import json
import os
import re
import sys
import threading
import time
import traceback
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))

# 模型与 espeak 数据放在纯 ASCII 路径：espeak-ng.dll 在 Windows 上无法处理含中文的路径，
# 否则会回退到编译期路径并报 "Error processing file ... phontab"。
VOICE_ROOT = os.environ.get("HEARTFLOW_VOICE_ROOT", r"E:\heartflow-voice")
HOST = "127.0.0.1"
PORT = int(os.environ.get("HEARTFLOW_TTS_PORT", "5001"))
MAX_TEXT = 300
SAMPLE_RATE = 24000
# 响度归一化：目标 RMS 0.09 ≈ -21 dBFS，峰值上限 0.95 防削波。
TARGET_RMS = float(os.environ.get("HEARTFLOW_TTS_RMS", "0.09"))
PEAK_LIMIT = 0.95
# 自定义音色（录音克隆）存放目录：每个 *.json 描述一个音色。
VOICES_DIR = os.environ.get("HEARTFLOW_VOICES_DIR", os.path.join(VOICE_ROOT, "voices"))

# ---------------- Kokoro 配置 ----------------
KOKORO_MODEL = os.path.join(VOICE_ROOT, "models", "kokoro-v1.0.onnx")
KOKORO_VOICES = os.path.join(VOICE_ROOT, "models", "voices-zh.bin")
ESPEAK_DATA = os.path.join(VOICE_ROOT, "espeak-ng-data")
ESPEAK_LIB = os.path.join(VOICE_ROOT, "espeak-ng.dll")
# espeak-ng 的普通话语言代码是 cmn（不是 zh/zh-cn）。
ESPEAK_LANG = "cmn"
KOKORO_DEFAULT_VOICE = "zf_xiaobei"

# ---------------- ChatTTS 配置 ----------------
CHATTTS_ROOT = os.environ.get("HEARTFLOW_CHATTTS_ROOT", os.path.join(VOICE_ROOT, "chattts"))
CHATTTS_DEVICE = os.environ.get("HEARTFLOW_CHATTTS_DEVICE", "cuda")
# 语气/停顿提示词：[oral_N] 口语化程度，[laugh_N] 笑声，[break_N] 停顿密度
CHATTTS_REFINE_PROMPT = os.environ.get("HEARTFLOW_CHATTTS_REFINE", "[oral_2][laugh_0][break_4]")
CHATTTS_USE_REFINE = os.environ.get("HEARTFLOW_CHATTTS_SKIP_REFINE", "0") != "1"
# 录音克隆的最小生成长度，单位是「每字多少个音频码」。这不是锦上添花的调参：
# 用参考音频做 prompt 时模型会在 prompt 结束处直接给 EOS，不设下限只念半句就停
# （实测 19 字的句子只出 0.84s）。按每字 9.4 码折算约每秒 5 字，接近自然语速。
CHATTTS_MIN_TOK_PER_CHAR = float(os.environ.get("HEARTFLOW_CHATTTS_MIN_TOK_PER_CHAR", "9.4"))
# 克隆音色的质检重试：生成后算一次 RMS 与频谱平坦度，不达标就换种子重来。
# 平坦度接近 1 表示噪声，浊音语音通常在 0.05–0.12；实测坏样本在 0.15–0.45。
CLONE_SEED_POOL = [8888, 512, 1, 34, 55, 89, 13, 0, 100, 2024]
CLONE_MAX_TRIES = int(os.environ.get("HEARTFLOW_CLONE_MAX_TRIES", "4"))
CLONE_MIN_RMS = float(os.environ.get("HEARTFLOW_CLONE_MIN_RMS", "0.004"))
CLONE_MAX_FLATNESS = float(os.environ.get("HEARTFLOW_CLONE_MAX_FLATNESS", "0.15"))

# 音色 = 固定随机种子采样出的说话人向量（可复现，换机器只要 seed 不变就一致）。
# 种子按实测基频（F0 中位）由低到高排列，标签与实测听感一致。
CHATTTS_VOICES = [
    ("chat_wenrou", 777),      # F0 中位 148 Hz — 温柔低缓
    ("chat_qingliang", 2024),  # F0 中位 247 Hz — 清亮偏高
    ("chat_chenwen", 31415),   # F0 中位 173 Hz — 沉稳中音
    ("chat_yuanqi", 8888),     # F0 中位 214 Hz — 元气明亮
]
CHATTTS_DEFAULT_VOICE = "chat_wenrou"
# 自回归解码的单 token 开销主要是 CPU 侧调度，GPU 利用率只有 12%；
# 但把多句放进同一个 batch 几乎不增加耗时（实测 4 句比 1 句只慢 18%）。
# 所以按句切分后批量合成，是这台机器上最有效的加速手段。
CHATTTS_BATCH = int(os.environ.get("HEARTFLOW_CHATTTS_BATCH", "4"))

ENGINE_LABELS = {
    "chattts": "ChatTTS · 拟真（GPU）",
    "kokoro": "Kokoro · 轻量（CPU）",
}

DEFAULT_ENGINE = os.environ.get("HEARTFLOW_TTS_ENGINE", "chattts")

VERSION = "2.0.0"
started_at = time.time()

_engines = {}
_engines_lock = threading.Lock()
_load_lock = threading.Lock()


def log(message):
    print(f"[tts] {time.strftime('%Y-%m-%d %H:%M:%S')} {message}", flush=True)


class EngineState:
    """一个 TTS 引擎的运行状态。"""

    def __init__(self, name):
        self.name = name
        self.label = ENGINE_LABELS.get(name, name)
        self.status = "idle"  # idle | loading | ready | error
        self.error = None
        self.model = None
        self.sample_rate = SAMPLE_RATE
        self.device = None
        self.voices = []
        self.default_voice = None
        self.load_sec = None
        self.synth_count = 0
        self.last_latency_ms = None
        self.infer_lock = threading.Lock()  # 引擎推理非线程安全，串行化
        self.speakers = {}  # ChatTTS: voice_id -> spk_emb 字符串（随机种子采样）
        self.profiles = {}  # ChatTTS: voice_id -> 录音克隆的音频提示（spk_smp）

    def public(self):
        payload = {
            "status": self.status,
            "label": self.label,
            "voices": [{"id": vid, "label": label} for vid, label in self.voices],
            "defaultVoice": self.default_voice,
            "sampleRate": self.sample_rate,
            "device": self.device,
            "loadSec": round(self.load_sec, 2) if self.load_sec else None,
            "synthCount": self.synth_count,
            "lastLatencyMs": self.last_latency_ms,
        }
        if self.error:
            payload["error"] = self.error
        if self.name == "chattts":
            payload["model"] = "ChatTTS-0.2.5"
            payload["sizeMb"] = _dir_size_mb(CHATTTS_ROOT)
        else:
            payload["model"] = "Kokoro-82M-ONNX"
            payload["sizeMb"] = _file_size_mb(KOKORO_MODEL)
        if self.status == "ready" and self.name == "chattts":
            payload["vramMb"] = _vram_mb()
        return payload


def _file_size_mb(path):
    try:
        return round(os.path.getsize(path) / 1024 / 1024)
    except OSError:
        return None


def _dir_size_mb(path):
    total = 0
    for base, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(base, name))
            except OSError:
                pass
    return round(total / 1024 / 1024) if total else None


def _vram_mb():
    try:
        import torch

        if torch.cuda.is_available():
            return round(torch.cuda.memory_allocated() / 1024 / 1024)
    except Exception:  # noqa: BLE001
        pass
    return None


# ---------------------------------------------------------------- ChatTTS


def _patch_encode_prompt():
    """修 ChatTTS 0.2.5 的 encode/decode preset 不一致。

    官方 `Speaker.encode_prompt` 用 `preset=9` 压缩，而 `decode_prompt` 用
    `9 | PRESET_EXTREME` 解压，导致 `sample_audio_speaker()` 产出的音频提示串
    无法回读（LZMAError: Corrupt input data）。两种 preset 的字典参数不同，
    必须统一。这里在运行时打补丁，不改 site-packages。
    """
    import lzma  # noqa: PLC0415

    import torch  # noqa: PLC0415
    from ChatTTS.model.speaker import Speaker  # noqa: PLC0415

    @staticmethod
    @torch.no_grad()
    def encode_prompt(prompt):
        import numpy as np  # noqa: PLC0415
        import pybase16384 as b14  # noqa: PLC0415

        array = prompt.cpu().numpy().astype(np.uint16)
        shape = array.shape
        assert len(shape) == 2, "prompt must be a 2D tensor"
        return b14.encode_to_string(
            np.array(shape, dtype="<u2").tobytes()
            + lzma.compress(
                array.astype("<u2").tobytes(),
                format=lzma.FORMAT_RAW,
                filters=[{"id": lzma.FILTER_LZMA2, "preset": 9 | lzma.PRESET_EXTREME}],
            )
        )

    Speaker.encode_prompt = encode_prompt


def load_voice_profiles():
    """读取 voices/*.json（录音克隆的音色），返回 [{id,label,spkSmp,txtSmp}]。

    同一 id 出现多个文件时，只认 `{id}.json` 这个规范名，其余忽略并告警。
    否则备份文件（如 _backup_xxx.json）按文件名排序会先被读到，把正式音色静默顶掉。
    """
    profiles = {}
    if not os.path.isdir(VOICES_DIR):
        return []
    for name in sorted(os.listdir(VOICES_DIR)):
        if not name.endswith(".json"):
            continue
        path = os.path.join(VOICES_DIR, name)
        try:
            with open(path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
            voice_id = str(data.get("id") or os.path.splitext(name)[0])
            prompt = data.get("spkSmp") or data.get("spk_smp")
            if not prompt:
                log(f"音色文件缺少 spkSmp，跳过: {name}")
                continue
            canonical = name == f"{voice_id}.json"
            if voice_id in profiles and not canonical:
                log(f"音色 id「{voice_id}」重复，忽略 {name}（只认 {voice_id}.json）")
                continue
            if voice_id in profiles:
                log(f"音色 id「{voice_id}」重复，{name} 覆盖先前定义")
            profiles[voice_id] = {
                "id": voice_id,
                "label": str(data.get("label") or voice_id),
                "spkSmp": prompt,
                "txtSmp": data.get("txtSmp") or data.get("txt_smp"),
                "minTokPerChar": data.get("minTokPerChar"),
                "seed": data.get("seed"),
                "source": data.get("source"),
                "seconds": data.get("refSeconds"),
            }
        except Exception as error:  # noqa: BLE001
            log(f"音色文件读取失败 {name}: {type(error).__name__}: {error}")
    return list(profiles.values())


def load_chattts(state):
    if not os.path.isdir(CHATTTS_ROOT):
        raise FileNotFoundError(f"ChatTTS 目录不存在: {CHATTTS_ROOT}")
    import ChatTTS  # noqa: PLC0415
    import torch  # noqa: PLC0415

    _patch_encode_prompt()

    device = torch.device(CHATTTS_DEVICE if torch.cuda.is_available() else "cpu")
    chat = ChatTTS.Chat()
    ok = chat.load(source="custom", custom_path=CHATTTS_ROOT, compile=False, device=device)
    if not ok:
        raise RuntimeError("ChatTTS 权重加载失败（check_all_assets 未通过，可能是文件缺失或 sha256 不符）")

    state.model = chat
    state.device = str(device)
    state.sample_rate = SAMPLE_RATE

    # 用固定种子采样音色，保证重启/换机后同一个音色听感一致。
    speakers = {}
    for voice_id, seed in CHATTTS_VOICES:
        torch.manual_seed(seed)
        if device.type == "cuda":
            torch.cuda.manual_seed_all(seed)
        speakers[voice_id] = chat.sample_random_speaker()
    state.speakers = speakers

    voices = [(vid, _chattts_voice_label(i)) for i, (vid, _s) in enumerate(CHATTTS_VOICES)]
    for profile in load_voice_profiles():
        if profile["id"] in dict(voices):
            continue
        state.profiles[profile["id"]] = profile
        voices.append((profile["id"], profile["label"]))
        log(f"载入克隆音色: {profile['label']}（参考 {profile.get('seconds')}s）")
    state.voices = voices
    state.default_voice = CHATTTS_DEFAULT_VOICE


def _chattts_voice_label(index):
    return ["温柔 · 低缓", "清亮 · 偏高", "沉稳 · 中音", "元气 · 明亮"][index] if index < 4 else f"音色{index + 1}"


_SENTENCE_RE = re.compile(r"[^。！？!?；;\n]+[。！？!?；;]?")
# ChatTTS 的 tokenizer 不认识全角括号与问号（会打印 "found invalid characters" 并丢弃），
# 括号里的舞台提示（如「（微笑）」）本来也不该念出来，直接清掉。
_STAGE_DIRECTION_RE = re.compile(r"[（(【\[][^）)】\]]{0,20}[）)】\]]|[（(【\[][^）)】\]]{0,20}$")
_PUNCT_MAP = str.maketrans({"？": "。", "?": "。", "；": "。", ";": "。", "：": "，", ":": "，", "、": "，"})
_EMOJI_RE = re.compile("[\U0001F300-\U0001FAFF\U00002600-\U000027BF\uFE0F]")


def normalize_for_tts(text):
    """把聊天文本清洗成适合朗读的写法：去舞台提示/emoji，统一标点。"""
    cleaned = _STAGE_DIRECTION_RE.sub("", text)
    cleaned = _EMOJI_RE.sub("", cleaned)
    cleaned = cleaned.translate(_PUNCT_MAP)
    cleaned = re.sub(r"\.{2,}", "。", cleaned)
    cleaned = re.sub(r"(。)\1+", "。", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or text


def split_sentences(text, min_len=6, max_len=80):
    """按标点切成短句：批量合成靠它，切得太碎会失去语调连贯性。"""
    raw = [piece.strip() for piece in _SENTENCE_RE.findall(text) if piece.strip()]
    if not raw:
        return [text]
    merged = []
    buffer = ""
    for piece in raw:
        if len(buffer) + len(piece) <= max_len and (not buffer or len(buffer) < min_len):
            buffer += piece
        else:
            if buffer:
                merged.append(buffer)
            buffer = piece
    if buffer:
        merged.append(buffer)
    return merged or [text]


def _audio_quality(audio):
    """返回 (rms, 频谱平坦度)。噪声的平坦度接近 1，浊音语音通常在 0.05–0.12。"""
    import numpy as np  # noqa: PLC0415

    array = np.nan_to_num(np.asarray(audio, dtype=np.float64).reshape(-1))
    if array.size < 512:
        return 0.0, 1.0
    rms = float(np.sqrt((array ** 2).mean()))
    spectrum = np.abs(np.fft.rfft(array * np.hanning(array.size))) + 1e-12
    flatness = float(np.exp(np.log(spectrum).mean()) / spectrum.mean())
    return rms, flatness


def _infer_batch(state, sentences, voice, speed_code, refine):
    from ChatTTS import Chat  # noqa: PLC0415
    import torch  # noqa: PLC0415

    profile = state.profiles.get(voice)
    if profile:
        # 录音克隆：用参考音频的码本作为 prompt，模型顺着同一个音色往下说。
        # min_new_token 必须给：不设下限时模型在 prompt 收尾处就 EOS，只念半句。
        per_char = float(profile.get("minTokPerChar") or CHATTTS_MIN_TOK_PER_CHAR)
        # 克隆音色逐句合成，因此这里就是本句字数。
        chars = max(1, max(len(item) for item in sentences))
        floor = max(32, int(per_char * chars))
        # 同一份音频提示，换个采样种子就会在「清晰语音」和「噪声」之间跳变，
        # 且每一句抽到的结果互相独立。所以不能只固定一个种子，必须生成后自检：
        # 不达标就换下一个种子重试，取第一个通过质检的结果。
        seeds = []
        for candidate in [profile.get("seed"), *CLONE_SEED_POOL]:
            if candidate is None:
                continue
            candidate = int(candidate)
            if candidate not in seeds:
                seeds.append(candidate)
        if not seeds:
            seeds = [0]

        params_refine = Chat.RefineTextParams(
            prompt=CHATTTS_REFINE_PROMPT, top_P=0.7, top_K=20, temperature=0.7,
        )
        best = None
        for attempt, seed in enumerate(seeds[:CLONE_MAX_TRIES], start=1):
            torch.manual_seed(seed)
            if torch.cuda.is_available():
                torch.cuda.manual_seed_all(seed)
            params_infer = Chat.InferCodeParams(
                spk_smp=profile["spkSmp"],
                txt_smp=profile.get("txtSmp"),
                prompt=f"[speed_{speed_code}]",
                temperature=0.3,
                top_P=0.7,
                top_K=20,
                min_new_token=floor,
                max_new_token=max(768, floor * 2),
                manual_seed=seed,
            )
            with torch.inference_mode():
                result = state.model.infer(
                    sentences,
                    # 克隆音色必须关掉口令改写：refine 会重写文本、字数变化，
                    # min_new_token 下限随之失真，模型会多吐一大段。
                    skip_refine_text=True,
                    params_refine_text=params_refine,
                    params_infer_code=params_infer,
                    split_text=False,
                )
            items = result if isinstance(result, (list, tuple)) else [result]
            import numpy as np  # noqa: PLC0415

            wav = np.concatenate([np.asarray(item).reshape(-1) for item in items]) if items else np.zeros(0, np.float32)
            rms, flatness = _audio_quality(wav)
            if rms >= CLONE_MIN_RMS and flatness <= CLONE_MAX_FLATNESS:
                if attempt > 1:
                    log(f"克隆音色换种子重试成功（第 {attempt} 次，种子 {seed}）")
                return [wav]
            if best is None or rms > best[0]:
                best = (rms, wav)
            log(f"克隆音色第 {attempt} 次质检不达标 rms={rms:.4f} 平坦度={flatness:.3f}，换种子重试")
        log("克隆音色全部重试均未达标，返回能量最高的一次")
        return [best[1] if best else np.zeros(0, np.float32)]

    params_infer = Chat.InferCodeParams(
        spk_emb=state.speakers.get(voice) or state.speakers[state.default_voice],
        prompt=f"[speed_{speed_code}]",
        temperature=0.3,
        top_P=0.7,
        top_K=20,
    )
    params_refine = Chat.RefineTextParams(
        prompt=CHATTTS_REFINE_PROMPT,
        top_P=0.7,
        top_K=20,
        temperature=0.7,
    )
    kwargs = dict(
        # 走到这里说明是内置音色：保留口令改写以获得更自然的口语停顿。
        skip_refine_text=not refine,
        params_refine_text=params_refine,
        params_infer_code=params_infer,
        split_text=False,
    )
    try:
        with torch.inference_mode():
            return state.model.infer(sentences, **kwargs)
    except torch.cuda.OutOfMemoryError:
        log("显存不足，清理缓存后逐句重试")
        torch.cuda.empty_cache()
        results = []
        with torch.inference_mode():
            for sentence in sentences:
                results.extend(state.model.infer([sentence], **kwargs))
        return results


def synth_chattts(state, text, voice, speed):
    import numpy as np  # noqa: PLC0415

    speed_code = max(1, min(9, int(round(speed * 5))))
    sentences = split_sentences(normalize_for_tts(text))

    if voice in state.profiles:
        # 克隆音色必须逐句合成。实测把两句放进同一批，输出会变成
        # 「第一句 + 第一句的重复 + 噪声」，第二句直接丢失。
        groups = [[sentence] for sentence in sentences]
    else:
        groups = [sentences[i:i + CHATTTS_BATCH] for i in range(0, len(sentences), CHATTTS_BATCH)]

    pieces = []
    for group in groups:
        wavs = _infer_batch(state, group, voice, speed_code, CHATTTS_USE_REFINE)
        if not isinstance(wavs, (list, tuple)):
            wavs = [wavs]
        for item in wavs:
            if item is None or len(item) == 0:
                continue
            pieces.append(np.asarray(item, dtype=np.float32).reshape(-1))
    if not pieces:
        raise RuntimeError("模型返回空音频")
    gap = np.zeros(int(SAMPLE_RATE * 0.10), dtype=np.float32)
    merged = pieces[0]
    for piece in pieces[1:]:
        merged = np.concatenate([merged, gap, piece])
    return merged


# ---------------------------------------------------------------- Kokoro


def load_kokoro(state):
    if not os.path.isfile(KOKORO_MODEL):
        raise FileNotFoundError(f"模型文件不存在: {KOKORO_MODEL}（请确认 HEARTFLOW_VOICE_ROOT 指向模型目录）")
    if not os.path.isfile(KOKORO_VOICES):
        raise FileNotFoundError(f"音色文件不存在: {KOKORO_VOICES}")
    if not os.path.isdir(ESPEAK_DATA):
        raise FileNotFoundError(f"espeak 数据目录不存在: {ESPEAK_DATA}")
    from kokoro_onnx import Kokoro  # noqa: PLC0415
    from kokoro_onnx.config import EspeakConfig  # noqa: PLC0415

    # 必须显式传 EspeakConfig：kokoro_onnx 默认会用 espeakng_loader 的安装路径
    # （位于含中文的项目目录下），Windows 上会导致 espeak 初始化失败。
    espeak_config = EspeakConfig(data_path=ESPEAK_DATA, lib_path=ESPEAK_LIB)
    kokoro = Kokoro(KOKORO_MODEL, KOKORO_VOICES, espeak_config=espeak_config)
    state.model = kokoro
    state.device = "cpu"
    state.sample_rate = SAMPLE_RATE
    names = list(kokoro.get_voices())
    labels = {
        "zf_xiaobei": "小北 · 温柔",
        "zf_xiaoni": "小妮 · 明亮",
        "zf_xiaoxiao": "小晓 · 自然",
        "zf_xiaoyi": "小艺 · 轻快",
    }
    state.voices = [(name, labels.get(name, name)) for name in names]
    state.default_voice = KOKORO_DEFAULT_VOICE if KOKORO_DEFAULT_VOICE in names else names[0]


def synth_kokoro(state, text, voice, speed):
    audio, sample_rate = state.model.create(text, voice=voice, speed=speed, lang=ESPEAK_LANG)
    if sample_rate and sample_rate != state.sample_rate:
        log(f"警告: 采样率 {sample_rate} != {state.sample_rate}，按实际写入")
        state.sample_rate = sample_rate
    return audio


LOADERS = {"chattts": load_chattts, "kokoro": load_kokoro}
SYNTHS = {"chattts": synth_chattts, "kokoro": synth_kokoro}


def get_engine(name):
    with _engines_lock:
        state = _engines.get(name)
    if state is None:
        return None
    return state


def ensure_loaded(name, wait=False):
    """按需加载引擎；wait=True 时同步等待（请求路径用）。"""
    state = get_engine(name)
    if state is None:
        raise KeyError(name)
    if state.status == "ready":
        return state
    if state.status == "loading":
        if not wait:
            return state
        while state.status == "loading":
            time.sleep(0.1)
        return state
    with _load_lock:
        if state.status == "ready":
            return state
        state.status = "loading"
        started = time.time()
        log(f"开始加载引擎 {name} ...")
        try:
            LOADERS[name](state)
            state.load_sec = time.time() - started
            state.status = "ready"
            state.error = None
            log(f"引擎 {name} 就绪，耗时 {state.load_sec:.1f}s，设备 {state.device}，音色 {len(state.voices)} 个")
        except Exception as error:  # noqa: BLE001 - 任何加载失败都记录并暴露
            state.status = "error"
            state.error = f"{type(error).__name__}: {error}"
            log(f"引擎 {name} 加载失败: {state.error}")
            traceback.print_exc()
    return state


def warmup(state):
    """预热一次推理：触发 CUDA kernel 编译/显存分配，避免首句等 20 秒。"""
    try:
        started = time.time()
        audio = SYNTHS[state.name](state, "你好，我是你的恋爱教练。", state.default_voice, 1.0)
        log(f"热身完成 {state.name} {time.time() - started:.2f}s，样本数 {len(audio)}")
    except Exception as error:  # noqa: BLE001
        log(f"热身失败（不影响服务）: {type(error).__name__}: {error}")


def float_to_wav(audio, sample_rate=SAMPLE_RATE) -> bytes:
    """float32 -> 16-bit PCM wav（单声道），并做响度归一化。

    ChatTTS 不同音色/不同批次的输出峰值在 0.06–0.92 之间大范围波动，
    不归一化会出现「这条要开大音量、下一条爆音」。这里统一到目标 RMS 并限幅。
    """
    import numpy as np  # noqa: PLC0415

    array = np.asarray(audio, dtype=np.float32).reshape(-1)
    rms = float(np.sqrt((array ** 2).mean())) if array.size else 0.0
    if rms > 1e-5:
        gain = TARGET_RMS / rms
        peak = float(np.abs(array).max())
        if peak * gain > PEAK_LIMIT:
            gain = PEAK_LIMIT / max(peak, 1e-6)
        array = array * gain
    clipped = np.clip(array, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype(np.int16)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm.tobytes())
    return buffer.getvalue()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # 精简访问日志
        log(f"{self.address_string()} {fmt % args}")

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/health", "/health/"):
            engines = {}
            for name in ("chattts", "kokoro"):
                state = get_engine(name)
                if state:
                    engines[name] = state.public()
            default = get_engine(DEFAULT_ENGINE) or get_engine("kokoro")
            return self._send_json(200, {
                "ok": any(item["status"] == "ready" for item in engines.values()),
                "version": VERSION,
                "defaultEngine": default.name if default else None,
                "engines": engines,
                # 兼容旧前端/旧代理：顶层暴露默认引擎信息
                "model": engines.get(default.name, {}).get("model") if default else None,
                "voices": [vid for vid, _label in (default.voices if default else [])],
                "sampleRate": SAMPLE_RATE,
                "loadError": default.error if default else None,
                "uptimeSec": round(time.time() - started_at, 1),
            })
        if self.path in ("/voices", "/voices/"):
            default = get_engine(DEFAULT_ENGINE) or get_engine("kokoro")
            return self._send_json(200, {"voices": [vid for vid, _label in (default.voices if default else [])]})
        return self._send_json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/tts":
            return self._send_json(404, {"error": "not_found"})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 64 * 1024:
            return self._send_json(413, {"error": "payload_invalid", "message": "请求体为空或过大。"})
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            return self._send_json(400, {"error": "invalid_json"})
        text = str(payload.get("text") or "").strip()
        if not text:
            return self._send_json(400, {"error": "bad_request", "message": "`text` 不能为空。"})
        if len(text) > MAX_TEXT:
            return self._send_json(400, {"error": "text_too_long", "message": f"单次最多 {MAX_TEXT} 字。"})

        engine_name = str(payload.get("engine") or DEFAULT_ENGINE)
        if engine_name not in LOADERS:
            return self._send_json(400, {"error": "unknown_engine", "message": f"未知引擎: {engine_name}"})
        state = get_engine(engine_name)
        if state is None:
            return self._send_json(400, {"error": "unknown_engine", "message": f"引擎未注册: {engine_name}"})

        try:
            state = ensure_loaded(engine_name, wait=True)
        except Exception as error:  # noqa: BLE001
            return self._send_json(503, {"error": "engine_load_failed", "message": str(error)[:200]})
        if state.status == "error":
            return self._send_json(503, {"error": "model_unavailable", "message": state.error or "模型加载失败"})
        if state.status != "ready":
            return self._send_json(503, {"error": "engine_loading", "message": "模型正在加载，请稍后重试。"})

        voice_ids = [vid for vid, _label in state.voices]
        voice = str(payload.get("voice") or state.default_voice or (voice_ids[0] if voice_ids else ""))
        if voice not in voice_ids:
            return self._send_json(400, {"error": "unknown_voice", "message": f"未知音色: {voice}"})
        try:
            speed = float(payload.get("speed") or 1.0)
        except (TypeError, ValueError):
            speed = 1.0
        speed = min(1.2, max(0.8, speed))

        started = time.time()
        try:
            with state.infer_lock:
                audio = SYNTHS[engine_name](state, text, voice, speed)
            wav_bytes = float_to_wav(audio, state.sample_rate)
        except Exception as error:  # noqa: BLE001
            log(f"合成失败 {engine_name}: {type(error).__name__}: {error}")
            traceback.print_exc()
            return self._send_json(500, {"error": "synthesis_failed", "message": f"{type(error).__name__}: {str(error)[:180]}"})
        elapsed = time.time() - started
        state.synth_count += 1
        state.last_latency_ms = int(elapsed * 1000)
        audio_sec = len(wav_bytes) / 2 / state.sample_rate
        log(f"合成 {engine_name} {len(text)} 字 / {voice} / {elapsed:.2f}s -> 音频 {audio_sec:.1f}s")

        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(wav_bytes)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Tts-Engine", engine_name)
        self.send_header("X-Tts-Latency-Ms", str(int(elapsed * 1000)))
        self.end_headers()
        self.wfile.write(wav_bytes)


def boot():
    for name in LOADERS:
        with _engines_lock:
            _engines[name] = EngineState(name)
    state = ensure_loaded(DEFAULT_ENGINE, wait=True)
    if state.status == "ready":
        warmup(state)


def main():
    log(f"启动 HeartFlow TTS sidecar v{VERSION}: http://{HOST}:{PORT}（默认引擎 {DEFAULT_ENGINE}）")
    # 先起 HTTP 服务，再在后台加载模型：这样 /health 能明确报告 loading 状态，
    # 前端也不会在模型加载期间收到连接被拒。
    threading.Thread(target=boot, name="model-boot", daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("收到退出信号")
    finally:
        server.server_close()


if __name__ == "__main__":
    sys.exit(main())
