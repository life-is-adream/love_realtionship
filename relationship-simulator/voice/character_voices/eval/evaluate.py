#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""蝴蝶忍角色音色可重复评测台（本机离线，Qwen3-TTS-12Hz-1.7B-Base）。

三个子命令：

  probe    P0 延迟专项：文本长度 × non_streaming_mode 矩阵 + 分句首段延迟
  run      P1 相似度专项：参考音频 × 固定 20 句测试集，输出客观指标
  report   汇总 results.json / latency.json -> 盲听试听页 + 主观评分表

运行必须用 E:\\heartflow-voice\\venv-qwen\\Scripts\\python.exe（Python 3.10，
装有 qwen_tts / torch cu121 / soundfile）。不要用系统 Python 或 venv-chattts。

重要事实（2026-11-07 源码核查）：qwen_tts 的 generate_voice_clone 返回
Tuple[List[np.ndarray], int]，一次性给完整波形；docstring 明确写
non_streaming_mode=False 只是「模拟流式文本输入」，不启用真正的流式生成。
因此在当前接口下「首音频延迟」与「完整生成时间」是同一个数，报告中记为
ttfaSec 并标注 ttfaEqualsSynth=true。想让首段更早播放只能靠工程分段。

指标口径与 voice/voice_lab.py 对齐（SR=24000、FFT 自相关 F0、20ms 分帧静音），
额外加入说话人嵌入余弦相似度与停顿/语速指标，用来量化「说话方式」而不只是音色。

配置漂移提示（2026-11-08）：char_shinobu 的参考音频已由 shinobu_ref.wav(8s/24kHz)
换成 shinobu_sleep_ref.wav(4.32s/48kHz)，language 由 Japanese 改为 Chinese。
`role` 标签模式刻意保留 Japanese 以复现 BASELINE/LANGTAG/PROSODY 的历史数据；
评测当前生产须显式 `--refs R5_sleep --lang-tag current`（`current` 从
characters.json 实时读取）。历史结论不得当作当前生产配置的评测结果。

非商用声明：参考音频与生成音频均为本机个人评测素材，角色语音版权归原版权方，
禁止商用与再分发，生成内容须标注为 AI 合成。
"""
import argparse
import csv
import json
import os
import sys
import time
import traceback
import wave
from datetime import datetime

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
WAV_DIR = os.path.join(OUT, "wav")
RESULTS = os.path.join(OUT, "results.json")
LATENCY = os.path.join(OUT, "latency.json")
CASES_JSON = os.path.join(HERE, "cases.json")
REFS_JSON = os.path.join(HERE, "refs.json")
CHARACTERS_JSON = os.path.abspath(os.path.join(HERE, "..", "characters.json"))

MODEL_ROOT = os.environ.get("HEARTFLOW_QWEN_MODEL_DIR", r"E:\heartflow-voice\models\qwen")
MODEL_NAME = "Qwen3-TTS-12Hz-1.7B-Base"
SR = 24000

MODEL = None


def log(msg):
    print("[voice-eval] %s %s" % (time.strftime("%H:%M:%S"), msg), flush=True)


# ------------------------------------------------------------------ IO / 音频

def read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def resolve(path):
    return path if os.path.isabs(path) else os.path.normpath(os.path.join(HERE, path))


def resample(audio, src_rate, dst_rate=SR):
    if src_rate == dst_rate or audio.size == 0:
        return audio.astype(np.float32)
    n = max(1, int(round(len(audio) * dst_rate / float(src_rate))))
    return np.interp(np.linspace(0, len(audio) - 1, n),
                     np.arange(len(audio)), audio).astype(np.float32)


def read_wav_float(path):
    import soundfile as sf
    data, sr = sf.read(path, dtype="float32", always_2d=True)
    mono = data.mean(axis=1) if data.shape[1] > 1 else data[:, 0]
    return resample(np.asarray(mono, dtype=np.float32), sr), sr


TARGET_RMS = 0.09  # 与 voice/qwen_lab.py 同一量级，消除「音量大显得好听」的盲听偏差


def normalize_loudness(audio):
    """统一响度；峰值会触顶时改为限幅，避免削波。"""
    rms = float(np.sqrt((audio ** 2).mean())) if audio.size else 0.0
    if rms < 1e-6:
        return audio
    gain = TARGET_RMS / rms
    peak = float(np.abs(audio).max())
    if peak * gain > 0.95:
        gain = 0.95 / peak
    return np.clip(audio * gain, -1.0, 1.0).astype(np.float32)


def write_wav(path, audio, sample_rate=SR):
    pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())


# ------------------------------------------------------------------ 客观指标

def f0_median(audio, sr=SR):
    """FFT 自相关法；口径与 voice/voice_lab.py::_f0_median 一致，用于相对排序。"""
    n_frame, hop = int(0.045 * sr), int(0.015 * sr)
    tau_min, tau_max = max(2, sr // 500), min(n_frame // 2, sr // 70)
    vals = []
    size = 1 << (2 * n_frame - 1).bit_length()
    for start in range(0, max(1, len(audio) - n_frame), hop):
        frame = audio[start:start + n_frame].astype(np.float64)
        if np.sqrt((frame ** 2).mean()) < 0.006:
            continue
        frame = (frame - frame.mean()) * np.hanning(n_frame)
        spec = np.fft.rfft(frame, size)
        ac = np.fft.irfft(spec * np.conj(spec))[:size // 2]
        window = ac[tau_min:tau_max + 1]
        if window.size < 3 or ac[0] <= 0:
            continue
        k = int(np.argmax(window)) + tau_min
        if tau_min < k < tau_max:
            a0, a1, a2 = ac[k - 1], ac[k], ac[k + 1]
            denom = a0 - 2 * a1 + a2
            if abs(denom) > 1e-12:
                k += 0.5 * (a0 - a2) / denom
        vals.append(sr / k)
    if not vals:
        return 0.0, 0.0
    arr = np.asarray(vals)
    return float(np.median(arr)), float(np.std(arr))


def acoustic(audio, char_count):
    """声学画像：音色 + 韵律 + 停顿 + 语速。音频统一 24kHz 单声道 float32。"""
    sec = len(audio) / SR
    spec = np.abs(np.fft.rfft(audio * np.hanning(len(audio)) + 1e-12)) if audio.size else np.zeros(1)
    freqs = np.fft.rfftfreq(len(audio), 1 / SR) if audio.size else np.zeros(1)
    centroid = float((spec * freqs).sum() / max(spec.sum(), 1e-9))
    positive = spec[spec > 1e-10]
    flatness = float(np.exp(np.log(positive).mean()) / positive.mean()) if positive.size > 8 else 1.0
    f0, f0_std = f0_median(audio)

    size, hop = int(0.02 * SR), int(0.02 * SR)
    quiet = []
    for start in range(0, max(0, len(audio) - size + 1), hop):
        frame = audio[start:start + size]
        quiet.append(float(np.sqrt((frame ** 2).mean())) < 0.006)
    silence_pct = round(sum(quiet) / max(len(quiet), 1) * 100, 1)

    # 连续静音 >= 0.15s 视为一次自然停顿（首/尾静音不计入）
    pauses, run = [], 0
    for i, q in enumerate(quiet):
        if q:
            run += 1
        else:
            if run * 0.02 >= 0.15:
                pauses.append(run * 0.02)
            run = 0
    inner = [q for q in quiet]
    first_voiced = next((i for i, q in enumerate(inner) if not q), None)
    last_voiced = next((i for i in range(len(inner) - 1, -1, -1) if not inner[i]), None)
    if first_voiced is not None and last_voiced is not None:
        pauses = []
        run = 0
        for q in inner[first_voiced:last_voiced + 1]:
            if q:
                run += 1
            else:
                if run * 0.02 >= 0.15:
                    pauses.append(round(run * 0.02, 2))
                run = 0

    speech_sec = max(0.1, sec * (1 - silence_pct / 100.0))
    return {
        "audioSec": round(sec, 2),
        "speechSec": round(speech_sec, 2),
        "f0": round(f0),
        "f0Std": round(f0_std),
        "brightness": round(centroid),
        "flatness": round(flatness, 3),
        "rms": round(float(np.sqrt((audio ** 2).mean())), 4) if audio.size else 0.0,
        "silencePct": silence_pct,
        "pauseCount": len(pauses),
        "longestPauseSec": round(max(pauses), 2) if pauses else 0.0,
        "charsPerSec": round(char_count / speech_sec, 2),
    }


def speaker_vec(audio24k):
    """用模型自带 speaker_encoder 提说话人嵌入，做客观音色相似度。"""
    import torch
    with torch.inference_mode():
        emb = MODEL.model.extract_speaker_embedding(audio=np.asarray(audio24k, dtype=np.float32), sr=24000)
    v = np.asarray(emb.float().cpu().numpy(), dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(v))
    return v / norm if norm > 1e-9 else v


def cosine(a, b):
    denom = float(np.linalg.norm(a)) * float(np.linalg.norm(b))
    return round(float(np.dot(a, b) / denom), 4) if denom > 1e-9 else 0.0


# ------------------------------------------------------------------ 模型

def load_model():
    global MODEL
    if MODEL is not None:
        return MODEL
    import torch
    from qwen_tts import Qwen3TTSModel
    model_dir = os.path.join(MODEL_ROOT, MODEL_NAME)
    if not os.path.isfile(os.path.join(model_dir, "model.safetensors")):
        raise SystemExit("找不到 Qwen3-TTS Base 权重：%s" % model_dir)
    log("加载 %s（bf16 + sdpa / cuda:0）..." % MODEL_NAME)
    torch.cuda.empty_cache()
    t0 = time.time()
    MODEL = Qwen3TTSModel.from_pretrained(
        model_dir, device_map="cuda:0", dtype=torch.bfloat16, attn_implementation="sdpa")
    log("模型就绪，耗时 %.1fs" % (time.time() - t0))
    return MODEL


def make_prompt(ref_path):
    return MODEL.create_voice_clone_prompt(
        ref_audio=ref_path, ref_text=None, x_vector_only_mode=True)[0]


def synth(text, language, prompt, non_streaming_mode):
    t0 = time.time()
    wavs, sr = MODEL.generate_voice_clone(
        text=text, language=language, voice_clone_prompt=[prompt],
        non_streaming_mode=non_streaming_mode)
    elapsed = time.time() - t0
    audio = resample(np.asarray(wavs[0], dtype=np.float32).reshape(-1), int(sr))
    return audio, elapsed, int(sr)


def production_language():
    """从 characters.json 读取当前生产 language 标签，避免评测与生产配置漂移。

    2026-11-08 起 char_shinobu.language 由 Japanese 改为 Chinese；旧的 `role`
    模式保留 Japanese 以复现历史基线，新配置评测一律用 `current`。
    """
    try:
        with open(CHARACTERS_JSON, "r", encoding="utf-8") as f:
            chars = json.load(f)["characters"]
        hit = [c for c in chars if c.get("id") == "char_shinobu"]
        if not hit:
            raise KeyError("char_shinobu")
        lang = hit[0].get("language")
        if lang not in ("Chinese", "Japanese"):
            raise ValueError("language=%r" % lang)
        return lang
    except Exception as exc:
        raise SystemExit("读取当前生产 language 失败（%s）：%s" % (CHARACTERS_JSON, exc))


def language_for(case, tag_mode):
    if tag_mode == "auto":
        return "Chinese" if case["lang"] == "zh" else "Japanese"
    if tag_mode == "current":
        return production_language()
    if tag_mode == "role":
        # 历史基线标签（2026-11-08 之前的生产配置），刻意固定不改，
        # 保证 BASELINE / LANGTAG / PROSODY 的旧数据可复现。
        return "Japanese"
    return tag_mode             # 显式 Chinese / Japanese


def active_refs(only):
    refs = [r for r in read_json(REFS_JSON)["refs"] if r.get("enabled")]
    if only:
        wanted = {s.strip() for s in only.split(",") if s.strip()}
        refs = [r for r in refs if r["id"] in wanted or r.get("label") in wanted]
    for r in refs:
        r["abs"] = resolve(r["path"])
        if not os.path.isfile(r["abs"]):
            raise SystemExit("参考音频缺失：%s -> %s" % (r["id"], r["abs"]))
    return refs


def active_cases(only, limit, lang):
    cases = read_json(CASES_JSON)["cases"]
    if only:
        wanted = {s.strip() for s in only.split(",") if s.strip()}
        cases = [c for c in cases if c["id"] in wanted]
    if lang:
        cases = [c for c in cases if c["lang"] in lang.split(",")]
    if limit:
        cases = cases[:limit]
    return cases


# ------------------------------------------------------------------ P0 probe

PROBE_TEXTS = [
    ("zh_04", "你好呀。", "Chinese"),
    ("zh_07", "别太勉强自己。", "Chinese"),
    ("zh_17", "稍微休息一下也没关系的，我会陪着你。", "Chinese"),
    ("zh_43", "今天蝶屋的风很舒服，我把药重新整理了一遍，还泡了你喜欢的茶，要不要坐下来慢慢说给我听？", "Chinese"),
    ("ja_06", "こんにちは。", "Japanese"),
    ("ja_13", "無理はしないでくださいね。", "Japanese"),
]

SEGMENT_TEXT = "今天蝶屋的风很舒服，我把药重新整理了一遍，还泡了你喜欢的茶。要不要坐下来，慢慢说给我听？"
SEGMENTS = ["今天蝶屋的风很舒服，", "我把药重新整理了一遍，还泡了你喜欢的茶。", "要不要坐下来，慢慢说给我听？"]


def cmd_probe(args):
    os.makedirs(WAV_DIR, exist_ok=True)
    refs = active_refs(args.refs)
    ref = refs[0]
    model = load_model()
    prompt = make_prompt(ref["abs"])
    log("probe 参考音频：%s" % ref["id"])

    rows = []
    for mode in ([False, True] if args.both_modes else [args.non_streaming]):
        for ident, text, language in PROBE_TEXTS:
            for rep in range(args.repeat):
                try:
                    audio, elapsed, _ = synth(text, language, prompt, mode)
                    rows.append({
                        "nonStreamingMode": mode, "id": ident, "language": language,
                        "chars": len(text), "repeat": rep + 1,
                        "synthSec": round(elapsed, 2), "audioSec": round(len(audio) / SR, 2),
                        "rtf": round(elapsed / max(len(audio) / SR, 0.01), 2),
                    })
                    log("  mode=%-5s %-7s %2d字  %5.2fs -> %4.2fs 音频  RTF %.2f"
                        % (mode, ident, len(text), elapsed, len(audio) / SR, rows[-1]["rtf"]))
                except Exception as e:  # noqa: BLE001
                    log("  FAIL %s %s: %s" % (ident, mode, e))
                    rows.append({"nonStreamingMode": mode, "id": ident, "chars": len(text),
                                 "error": "%s: %s" % (type(e).__name__, str(e)[:160])})
    write_json(LATENCY, {"modeMatrix": rows})

    # 分句实验：整句 vs 三段串行，量化「首段延迟」能压到多少
    log("分句实验：整句 %d 字 vs 三段" % len(SEGMENT_TEXT))
    whole_audio, whole_sec, _ = synth(SEGMENT_TEXT, "Chinese", prompt, args.non_streaming)
    seg_rows, cumulative = [], 0.0
    for i, seg in enumerate(SEGMENTS, 1):
        audio, elapsed, _ = synth(seg, "Chinese", prompt, args.non_streaming)
        cumulative += elapsed
        seg_rows.append({"index": i, "chars": len(seg), "synthSec": round(elapsed, 2),
                         "audioSec": round(len(audio) / SR, 2)})
    segment = {
        "wholeChars": len(SEGMENT_TEXT), "wholeSynthSec": round(whole_sec, 2),
        "wholeAudioSec": round(len(whole_audio) / SR, 2),
        "segments": seg_rows, "firstSegmentSec": seg_rows[0]["synthSec"],
        "cumulativeSec": round(cumulative, 2),
        "note": "首段延迟 = 第一短段完整生成时间；后续段可在播放首段时后台生成",
    }
    data = read_json(LATENCY)
    data["segment"] = segment
    data["generatedAt"] = datetime.now().astimezone().isoformat(timespec="seconds")
    write_json(LATENCY, data)
    log("分句结果：整句 %.2fs；首段 %.2fs；三段累计 %.2fs"
        % (whole_sec, segment["firstSegmentSec"], cumulative))
    log("已写入 %s" % LATENCY)


# ------------------------------------------------------------------ P1 run

def cmd_run(args):
    os.makedirs(WAV_DIR, exist_ok=True)
    refs = active_refs(args.refs)
    cases = active_cases(args.cases, args.limit, args.lang)
    if not cases:
        raise SystemExit("没有匹配的测试句")
    model = load_model()

    existing = {}
    if os.path.isfile(RESULTS) and not args.force:
        for row in read_json(RESULTS).get("rows", []):
            existing[row["key"]] = row

    rows = list(existing.values())
    total = len(refs) * len(cases)
    done = 0
    log("评测矩阵：%d 参考音频 × %d 句 = %d 次合成（已存在 %d 条，skip-existing=%s）"
        % (len(refs), len(cases), total, len(existing), not args.force))
    if args.lang_tag == "current":
        cur = production_language()
        hist = {r.get("languageTag") for r in existing.values()} - {cur, None}
        log("当前生产 language=%s（读自 characters.json）" % cur)
        if hist:
            log("⚠ 结果文件含旧标签数据 %s；run 的 WAV 文件名不含标签，"
                "同 refId+caseId 会覆盖旧基线音频。要保留历史基线请先备份 out/wav/ 与 out/results.json"
                % sorted(hist))

    for ref in refs:
        prompt = make_prompt(ref["abs"])
        ref_audio, _ = read_wav_float(ref["abs"])
        ref_vec = speaker_vec(ref_audio)
        for case in cases:
            done += 1
            tag = language_for(case, args.lang_tag)
            key = "%s|%s|%s|%s" % (ref["id"], case["id"], tag, args.non_streaming)
            if key in existing:
                log("  [%d/%d] skip %s %s" % (done, total, ref["id"], case["id"]))
                continue
            filename = "%s__%s.wav" % (ref["id"], case["id"])
            path = os.path.join(WAV_DIR, filename)
            try:
                audio, elapsed, _ = synth(case["text"], tag, prompt, args.non_streaming)
                audio = normalize_loudness(audio)
                write_wav(path, audio)
                metrics = acoustic(audio, len(case["text"]))
                gen_vec = speaker_vec(audio)
                row = {
                    "key": key, "refId": ref["id"], "refLabel": ref.get("label", ""),
                    "caseId": case["id"], "lang": case["lang"], "tier": case["tier"],
                    "tone": case.get("tone", []), "text": case["text"], "chars": len(case["text"]),
                    "languageTag": tag, "nonStreamingMode": args.non_streaming,
                    "file": "wav/" + filename,
                    "ttfaSec": round(elapsed, 2), "synthSec": round(elapsed, 2),
                    "ttfaEqualsSynth": True,
                    "rtf": round(elapsed / max(metrics["audioSec"], 0.01), 2),
                    "speakerCos": cosine(ref_vec, gen_vec),
                    "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
                    **metrics,
                }
                rows.append(row)
                write_json(RESULTS, {"rows": rows})
                log("  [%d/%d] %-10s %-8s %2d字 %5.2fs  cos=%.3f  f0=%dHz  停顿=%d  语速=%.1f字/s"
                    % (done, total, ref["id"], case["id"], len(case["text"]), elapsed,
                       row["speakerCos"], row["f0"], row["pauseCount"], row["charsPerSec"]))
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                rows.append({"key": key, "refId": ref["id"], "caseId": case["id"],
                             "error": "%s: %s" % (type(e).__name__, str(e)[:200])})
                write_json(RESULTS, {"rows": rows})
    write_json(RESULTS, {"rows": rows})
    log("完成，共 %d 条记录 -> %s" % (len(rows), RESULTS))


# ------------------------------------------------------------------ report

HTML_HEAD = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>蝴蝶忍音色评测 · 盲听台</title>
<style>
:root{--bg:#f6f7fb;--card:#fff;--line:#e4e8f1;--ink:#1b2231;--sub:#5d6780;--accent:#2b5aed}
@media(prefers-color-scheme:dark){:root{--bg:#141821;--card:#1c2230;--line:#2c3444;--ink:#e8ecf5;--sub:#9aa5bb;--accent:#7fa2ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
 font:14px/1.65 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
header{padding:26px 30px 18px;background:var(--card);border-bottom:1px solid var(--line)}
h1{margin:0 0 6px;font-size:21px}h1 small{font-size:12px;color:var(--sub);font-weight:400}
.sub{color:var(--sub);font-size:13px;max-width:980px}
main{max-width:1180px;margin:0 auto;padding:10px 24px 70px}
h2{font-size:16px;margin:28px 0 4px}.case{color:var(--sub);font-size:13px;margin:0 0 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:11px;padding:13px 15px}
.anon{font-size:15px;font-weight:600;color:var(--accent)}
audio{width:100%;height:34px;margin-top:8px}
.stats{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
.stat{font-size:11px;background:var(--bg);color:var(--sub);padding:2px 7px;border-radius:5px}
.note{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:13px 17px;
 margin-top:24px;font-size:13px;color:var(--sub)}
.warn{border-color:#e5c88b}code{background:var(--bg);padding:1px 5px;border-radius:4px;font-size:11px}
table{border-collapse:collapse;width:100%;font-size:12px;color:var(--sub)}
td,th{border:1px solid var(--line);padding:5px 8px;text-align:left}
</style></head><body>
<header><h1>蝴蝶忍音色评测 · 盲听台 <small>Qwen3-TTS 零样本克隆 · 本机离线</small></h1>
<div class="sub">同一句台词下 A / B / C 为<b>匿名参考音频</b>，请先听再对照 <code>answer_key.csv</code>。
评分填 <code>评分表.csv</code>：音色相似度、自然度、语气贴合、日语发音各 1–5 分。
客观数值只作参考，<b>最终以听感为准</b>。</div></header><main>
"""


def cmd_normalize(args):
    """对已生成的 WAV 统一响度，并同步重算声学指标（不重跑推理、不加载模型）。

    speakerCos / ttfaSec / synthSec 保持不变：余弦相似度对全局增益近似不变，
    且这两个时间是推理时的事实记录，不应被后处理改写。
    """
    if not os.path.isfile(RESULTS):
        raise SystemExit("缺少 %s" % RESULTS)
    data = read_json(RESULTS)
    chars = {c["id"]: len(c["text"]) for c in read_json(CASES_JSON)["cases"]}
    updated = 0
    for row in data.get("rows", []):
        if row.get("error") or not row.get("file"):
            continue
        path = os.path.join(OUT, row["file"])
        if not os.path.isfile(path):
            continue
        audio, _ = read_wav_float(path)
        norm = normalize_loudness(audio)
        write_wav(path, norm)
        row.update(acoustic(norm, chars.get(row["caseId"], row.get("chars", 0))))
        row["normalized"] = True
        updated += 1
    write_json(RESULTS, data)
    log("响度归一化完成：%d 个 WAV，声学指标已同步重算" % updated)
    log("注意：speakerCos 仍为归一化前波形上的计算值（余弦相似度对全局增益近似不变）")


def cmd_report(args):
    if not os.path.isfile(RESULTS):
        raise SystemExit("缺少 %s，请先运行 run" % RESULTS)
    rows = [r for r in read_json(RESULTS)["rows"] if not r.get("error")]
    if not rows:
        raise SystemExit("results.json 中没有有效记录")

    by_case = {}
    for r in rows:
        by_case.setdefault(r["caseId"], []).append(r)
    case_meta = {c["id"]: c for c in read_json(CASES_JSON)["cases"]}

    parts = [HTML_HEAD]
    for case_id in sorted(by_case):
        meta = case_meta.get(case_id, {})
        parts.append("<h2>%s <span style='font-weight:400;color:var(--sub);font-size:13px'>%s / %s / %s</span></h2>"
                     % (case_id, meta.get("lang", ""), meta.get("tier", ""),
                        ", ".join(meta.get("tone", []))))
        parts.append("<p class='case'>%s</p><div class='grid'>" % meta.get("text", ""))
        for r in sorted(by_case[case_id], key=lambda x: x.get("refLabel", "")):
            stats = "".join("<span class='stat'>%s %s</span>" % (k, r[k]) for k in
                            ("ttfaSec", "audioSec", "speakerCos", "f0", "f0Std",
                             "pauseCount", "charsPerSec", "silencePct") if k in r)
            parts.append("<div class='card'><div class='anon'>参考 %s</div>"
                         "<audio controls preload='none' src='%s'></audio>"
                         "<div class='stats'>%s</div></div>"
                         % (r.get("refLabel", "?"), r["file"], stats))
        parts.append("</div>")

    latency = read_json(LATENCY) if os.path.isfile(LATENCY) else None
    if latency and latency.get("segment"):
        s = latency["segment"]
        parts.append("<div class='note warn'><b>P0 延迟实测：</b>整句 %d 字一次性合成 %.2fs；"
                     "切成 3 段后首段 %.2fs、三段累计 %.2fs。当前接口<b>不支持流式生成</b>，"
                     "ttfaSec 与 synthSec 相同；想更早出声只能靠分段 + 首段优先播放。</div>"
                     % (s["wholeChars"], s["wholeSynthSec"], s["firstSegmentSec"], s["cumulativeSec"]))
    parts.append(
        "<div class='note'><b>指标口径：</b>speakerCos = 参考音频与生成音频在模型自带 speaker_encoder "
        "上的嵌入余弦相似度（越高越像，仅作相对排序，不等同于人耳相似度）；f0/f0Std = 基频中位数与起伏；"
        "pauseCount = ≥0.15s 的句内停顿次数；charsPerSec = 字符数 / 有声时长（语速代理）；"
        "silencePct = 20ms 分帧静音占比；ttfaSec = 首音频延迟（本接口下等于完整生成时间）。"
        "<br>全部样本已统一响度（RMS≈0.09，峰值留余量），避免「音量大显得好听」污染盲听评分。"
        "<br>「说话方式」重点看 f0Std（克制 = 起伏小）、pauseCount / longestPauseSec（换气与留白）、"
        "charsPerSec（不急不拖），以及主观评分里的「语气贴合」与「日语发音」。</div>"
        "<div class='note warn'><b>素材与边界：</b>参考音频为第三方公开 AI 推理试听片段，非动画原声，"
        "无开源授权声明；角色与语音版权归 Aniplex / ufotable / 集英社，声优早见沙织。"
        "全部音频仅本机个人非商业评测使用，禁止分发；对外展示须标注 AI 合成。</div>"
        "</main></body></html>")
    html_path = os.path.join(OUT, "试听.html")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write("\n".join(parts))

    score_path = os.path.join(OUT, "评分表.csv")
    with open(score_path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["sample_id", "参考(匿名)", "case_id", "语言", "长度层", "语气维度", "台词",
                    "音色相似度(1-5)", "自然度(1-5)", "语气贴合(1-5)", "日语发音(1-5)", "备注"])
        for r in sorted(rows, key=lambda x: (x["caseId"], x.get("refLabel", ""))):
            w.writerow(["%s_%s" % (r["caseId"], r.get("refLabel", "?")), r.get("refLabel", "?"),
                        r["caseId"], r["lang"], r["tier"], "/".join(r.get("tone", [])),
                        r["text"], "", "", "", "", ""])

    key_path = os.path.join(OUT, "answer_key.csv")
    refs = {r["id"]: r for r in read_json(REFS_JSON)["refs"]}
    with open(key_path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["参考(匿名)", "ref_id", "时长(秒)", "来源", "假设"])
        for r in sorted(refs.values(), key=lambda x: x.get("label", "")):
            if r["id"] in {x["refId"] for x in rows}:
                w.writerow([r.get("label", ""), r["id"], r.get("seconds", ""),
                            r.get("origin", ""), r.get("hypothesis", "")])
    log("已生成：%s / %s / %s（%d 条有效样本）" % (html_path, score_path, key_path, len(rows)))

    # 控制台按参考音频汇总，便于快速判断哪个候选值得继续
    log("--- 按参考音频汇总（均值）---")
    for ref_id in sorted({r["refId"] for r in rows}):
        group = [r for r in rows if r["refId"] == ref_id]
        avg = lambda k: round(sum(r[k] for r in group if k in r) / max(1, len(group)), 3)
        log("  %-12s n=%2d  cos=%.3f  ttfa=%.2fs  f0=%dHz  f0Std=%.1f  停顿=%.1f  语速=%.2f字/s"
            % (ref_id, len(group), avg("speakerCos"), avg("ttfaSec"), avg("f0"),
               avg("f0Std"), avg("pauseCount"), avg("charsPerSec")))


# ------------------------------------------------- 语言标签 2x2 对照实验

LANGTAG_DIR = os.path.join(OUT, "langtag")
LANGTAG_WAV = os.path.join(LANGTAG_DIR, "wav")
LANGTAG_RESULTS = os.path.join(LANGTAG_DIR, "results.json")
TAG_CODES = {"j": "Japanese", "c": "Chinese", "a": "auto"}


def cmd_langtag(args):
    """同一参考音频 + 同一文本，只改 language 标签的严格对照实验。

    输出目录与 P1 盲听基线物理隔离，避免 --lang-tag 覆盖同名 WAV。
    每组重复多次用于估计采样噪声：只有超出噪声的差值才算标签效应。
    """
    os.makedirs(LANGTAG_WAV, exist_ok=True)
    refs = active_refs(args.refs)
    cases = active_cases(args.cases, 0, "")
    if not cases:
        raise SystemExit("没有匹配的测试句")
    tag_codes = [s.strip().lower() for s in args.tags.split(",") if s.strip()]
    for code in tag_codes:
        if code not in TAG_CODES:
            raise SystemExit("未知标签简写 %s（可用 j=Japanese / c=Chinese / a=auto）" % code)
    load_model()

    existing = {}
    if os.path.isfile(LANGTAG_RESULTS) and not args.force:
        for row in read_json(LANGTAG_RESULTS).get("rows", []):
            existing[row["key"]] = row
    rows = list(existing.values())

    total = len(refs) * len(cases) * len(tag_codes) * args.repeat
    log("语言标签矩阵：%d 参考 × %d 句 × %d 标签 × %d 重复 = %d 次合成（已有 %d 条）"
        % (len(refs), len(cases), len(tag_codes), args.repeat, total, len(existing)))

    def resolve_tag(code, case):
        name = TAG_CODES[code]
        if name == "auto":
            return "Chinese" if case["lang"] == "zh" else "Japanese"
        return name

    done = 0
    for ref in refs:
        prompt = make_prompt(ref["abs"])
        ref_audio, _ = read_wav_float(ref["abs"])
        ref_vec = speaker_vec(ref_audio)
        for case in cases:
            for code in tag_codes:
                tag = resolve_tag(code, case)
                for rep in range(1, args.repeat + 1):
                    done += 1
                    key = "%s|%s|%s|r%d" % (case["id"], ref["id"], tag, rep)
                    if key in existing:
                        log("  [%d/%d] skip %s %s r%d" % (done, total, case["id"], tag, rep))
                        continue
                    filename = "%s__%s__%s__r%d.wav" % (case["id"], ref["id"], tag, rep)
                    path = os.path.join(LANGTAG_WAV, filename)
                    try:
                        audio, elapsed, _ = synth(case["text"], tag, prompt, args.non_streaming)
                        audio = normalize_loudness(audio)
                        write_wav(path, audio)
                        metrics = acoustic(audio, len(case["text"]))
                        row = {
                            "key": key, "caseId": case["id"], "lang": case["lang"],
                            "text": case["text"], "chars": len(case["text"]),
                            "refId": ref["id"], "languageTag": tag, "tagCode": code,
                            "repeat": rep, "file": "wav/" + filename,
                            "ttfaSec": round(elapsed, 2),
                            "rtf": round(elapsed / max(metrics["audioSec"], 0.01), 2),
                            "speakerCos": cosine(ref_vec, speaker_vec(audio)),
                            "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
                            **metrics,
                        }
                        rows.append(row)
                        write_json(LANGTAG_RESULTS, {"rows": rows})
                        log("  [%d/%d] %-8s %-9s r%d %5.2fs cos=%.3f f0=%dHz 语速=%.1f"
                            % (done, total, case["id"], tag, rep, elapsed,
                               row["speakerCos"], row["f0"], row["charsPerSec"]))
                    except Exception:  # noqa: BLE001
                        traceback.print_exc()
                        rows.append({"key": key, "caseId": case["id"], "languageTag": tag,
                                     "repeat": rep, "error": "synth_failed"})
                        write_json(LANGTAG_RESULTS, {"rows": rows})

    good = [r for r in rows if "error" not in r]
    write_json(LANGTAG_RESULTS, {"rows": rows})
    langtag_write_html(good)
    log("--- 按 句子 × 标签 汇总（均值 ± 重复间极差）---")
    for case in cases:
        for code in tag_codes:
            tag = resolve_tag(code, case)
            group = [r for r in good if r["caseId"] == case["id"] and r["languageTag"] == tag]
            if not group:
                continue
            avg = lambda k: round(sum(r[k] for r in group) / len(group), 3)
            spread = lambda k: round(max(r[k] for r in group) - min(r[k] for r in group), 3)
            log("  %-8s %-9s n=%d  cos=%.3f(±%.3f)  f0=%dHz(±%d)  f0Std=%.1f  停顿=%.1f  语速=%.2f(±%.2f)字/s  ttfa=%.2fs"
                % (case["id"], tag, len(group), avg("speakerCos"), spread("speakerCos"),
                   avg("f0"), spread("f0"), avg("f0Std"), avg("pauseCount"),
                   avg("charsPerSec"), spread("charsPerSec"), avg("ttfaSec")))
    log("已生成 %s / %s" % (LANGTAG_RESULTS, os.path.join(LANGTAG_DIR, "index.html")))


def langtag_write_html(rows):
    """生成标签对照试听页，按句子分组、同组并列，音频已统一响度。"""
    cases = {}
    for r in rows:
        cases.setdefault((r["caseId"], r["lang"], r["text"]), {}).setdefault(
            r["languageTag"], []).append(r)
    css = """
    :root{color-scheme:light dark}
    body{font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:1100px;margin:0 auto;padding:28px 20px 60px}
    h1{font-size:22px;margin:0 0 6px} .sub{opacity:.72;font-size:13px;margin-bottom:22px}
    .note{background:rgba(127,127,127,.10);border-left:3px solid #888;padding:12px 16px;border-radius:6px;font-size:13px;margin-bottom:24px}
    section{border:1px solid rgba(127,127,127,.32);border-radius:10px;padding:16px 18px;margin-bottom:18px}
    section>h2{font-size:16px;margin:0 0 4px} .txt{opacity:.8;font-size:13px;margin-bottom:14px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
    .card{border:1px solid rgba(127,127,127,.28);border-radius:8px;padding:12px}
    .card h3{font-size:14px;margin:0 0 8px} .tag{font-size:11px;opacity:.65;font-weight:400}
    audio{width:100%;height:34px;display:block;margin:6px 0}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
    td{padding:2px 4px;border-bottom:1px solid rgba(127,127,127,.16)} td:last-child{text-align:right;font-variant-numeric:tabular-nums}
    .r{opacity:.6;font-size:11px;margin-top:4px}
    footer{font-size:12px;opacity:.65;margin-top:26px;border-top:1px solid rgba(127,127,127,.25);padding-top:14px}
    code{font-size:12px}
    """
    parts = ["<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">",
             "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
             "<title>语言标签对照试听 · 蝴蝶忍</title><style>%s</style></head><body>" % css,
             "<h1>语言标签对照试听</h1>",
             "<div class=\"sub\">同一参考音频 · 同一文本 · 只改 <code>language</code> 标签 · 音频已统一响度 RMS 0.0900</div>",
             "<div class=\"note\"><strong>目的</strong>：对照 <code>Japanese</code> 与 <code>Chinese</code> 标签对发音/韵律的影响。"
             "历史轮次（2026-11-07）的生产配置固定 <code>Japanese</code>，中文句子也用日语标签念；"
             "<strong>2026-11-08 起生产已改为 <code>Chinese</code> 并换了参考音频，本页结论仅适用于旧配置</strong>。"
             "每组重复 2 次，重复之间的差异就是采样噪声基线；"
             "<strong>只有明显大于重复间差异的组间差异才算标签效应</strong>。请重点听中文句的发音清晰度与日语假名是否自然。</div>"]
    metric_keys = [("ttfaSec", "首音频/耗时 s", 2), ("audioSec", "音频时长 s", 2),
                   ("f0", "基频 Hz", 0), ("f0Std", "基频起伏", 0),
                   ("pauseCount", "停顿数", 0), ("charsPerSec", "语速 字/s", 2),
                   ("speakerCos", "说话人余弦", 3)]
    for (cid, lang, text), by_tag in sorted(cases.items()):
        parts.append("<section><h2>%s <span class=\"tag\">%s</span></h2><div class=\"txt\">%s</div><div class=\"grid\">"
                     % (cid, "日语" if lang == "ja" else "中文", text))
        for tag in sorted(by_tag):
            parts.append("<div class=\"card\"><h3>%s</h3>" % tag)
            for r in sorted(by_tag[tag], key=lambda x: x["repeat"]):
                parts.append("<div class=\"r\">重复 r%d</div><audio controls preload=\"none\" src=\"%s\"></audio>"
                             % (r["repeat"], r["file"]))
                parts.append("<table>")
                for k, label, nd in metric_keys:
                    parts.append("<tr><td>%s</td><td>%.*f</td></tr>" % (label, nd, r.get(k, 0)))
                parts.append("</table>")
            parts.append("</div>")
        parts.append("</div></section>")
    parts.append("<footer>参考音频与生成音频均为第三方公开 AI 推理片段的衍生物，非动画原声、无开源授权声明。"
                 "版权归 Aniplex / ufotable / 集英社，声优早见沙织。仅限本机个人非商业评测，禁止分发，"
                 "对外展示须标注 AI 合成。<br>生成物目录：<code>voice/character_voices/eval/out/langtag/</code>，"
                 "已加入 .gitignore，与 P1 盲听基线物理隔离。</footer></body></html>")
    with open(os.path.join(LANGTAG_DIR, "index.html"), "w", encoding="utf-8") as f:
        f.write("\n".join(parts))


# ------------------------------------------------- 说话方式（韵律）零成本改进对照

PROSODY_DIR = os.path.join(OUT, "prosody")
PROSODY_WAV = os.path.join(PROSODY_DIR, "wav")
PROSODY_RESULTS = os.path.join(PROSODY_DIR, "results.json")
PUNCT_CHARS = set("，。、！？；：,.;!?…")
VARIANTS = ["base", "punct", "seg", "seg_slow", "stretch"]
VARIANT_LABELS = {
    "base": "原文整句（生产基线）",
    "punct": "文本停顿标记（句内标点→…）",
    "seg": "分段合成 + 段间留白",
    "seg_slow": "分段留白 + 段内放慢",
    "stretch": "整句后处理放慢",
}


def split_segments(text):
    """按标点切段，标点留在段尾；连续标点（……！？）并入同一段。"""
    segs, buf, i = [], "", 0
    while i < len(text):
        ch = text[i]
        if ch in PUNCT_CHARS:
            buf += ch
            j = i + 1
            while j < len(text) and text[j] in PUNCT_CHARS:
                buf += text[j]
                j += 1
            if buf.strip():
                segs.append(buf.strip())
            buf, i = "", j
        else:
            buf += ch
            i += 1
    if buf.strip():
        segs.append(buf.strip())
    return segs


def punct_variant(text):
    """把句内标点换成省略号，制造模型可感知的更长停顿；末标点保留。"""
    pos = [i for i, ch in enumerate(text) if ch in PUNCT_CHARS]
    if len(pos) <= 1:
        return text
    out = list(text)
    for i in pos[:-1]:
        out[i] = "…"
    return "".join(out)


def stretch_audio(audio, rate):
    """librosa phase vocoder，保音高变速。rate<1 放慢（时长 × 1/rate）。"""
    import librosa
    y = np.asarray(audio, dtype=np.float32).reshape(-1)
    out = librosa.effects.time_stretch(y, rate=rate)
    return np.clip(np.asarray(out, dtype=np.float32), -1.0, 1.0)


def join_with_gap(pieces, gap_ms):
    gap = np.zeros(int(SR * gap_ms / 1000.0), dtype=np.float32)
    merged = pieces[0]
    for piece in pieces[1:]:
        merged = np.concatenate([merged, gap, piece])
    return merged


def cmd_prosody(args):
    """只改文本/拼接/后处理，检验「说话方式」可否零成本改善。

    默认 `role`（Japanese）复现 2026-11-07 历史结论；`current` 跟随
    characters.json 的当前生产标签（2026-11-08 起为 Chinese）。
    """
    os.makedirs(PROSODY_WAV, exist_ok=True)
    refs = active_refs(args.refs)
    cases = active_cases(args.cases, 0, "")
    if not cases:
        raise SystemExit("没有匹配的测试句")
    if not 0.5 <= args.slow < 1.0:
        raise SystemExit("--slow 应在 [0.5, 1.0) 区间（<1 表示放慢）")
    load_model()

    existing = {}
    if os.path.isfile(PROSODY_RESULTS) and not args.force:
        for row in read_json(PROSODY_RESULTS).get("rows", []):
            existing[row["key"]] = row
    rows = list(existing.values())

    def key_of(cid, rid, variant, rep):
        return "%s|%s|%s|r%d" % (cid, rid, variant, rep)

    log("说话方式矩阵：%d 参考 × %d 句 × %d 变体 × %d 重复（已存在 %d 条）"
        % (len(refs), len(cases), len(VARIANTS), args.repeat, len(existing)))
    log("语言标签模式=%s%s" % (args.lang_tag,
        "（= %s）" % production_language() if args.lang_tag == "current" else "（历史基线 Japanese）"))
    if args.lang_tag == "current" or any(r.get("refId") == "R5_sleep" for r in refs):
        log("⚠ prosody 的 WAV 文件名只含 caseId+variant+repeat，换参考/换标签重跑会覆盖旧音频；"
            "请加 --force 并先备份 out/prosody/，或改 PROSODY_DIR 输出目录")

    for ref in refs:
        prompt = make_prompt(ref["abs"])
        ref_audio, _ = read_wav_float(ref["abs"])
        ref_vec = speaker_vec(ref_audio)
        for case in cases:
            text, segs, ptext = case["text"], split_segments(case["text"]), punct_variant(case["text"])
            tag = language_for(case, args.lang_tag)   # 同一轮内固定，不随变体变化
            log("  %s: %d 段 / punct=%s" % (case["id"], len(segs), "变体" if ptext != text else "同原文"))
            for rep in range(1, args.repeat + 1):
                if all(key_of(case["id"], ref["id"], v, rep) in existing for v in VARIANTS):
                    log("    r%d 已存在，跳过" % rep)
                    continue
                base_audio, base_sec, _ = synth(text, tag, prompt, False)
                punct_audio, punct_sec, _ = synth(ptext, tag, prompt, False)
                seg_audios, seg_secs = [], []
                for seg in segs:
                    a, t, _ = synth(seg, tag, prompt, False)
                    seg_audios.append(normalize_loudness(a))
                    seg_secs.append(t)

                t0 = time.time()
                seg_slow = [stretch_audio(a, args.slow) for a in seg_audios]
                whole_slow = stretch_audio(normalize_loudness(base_audio), args.slow)
                post_sec = time.time() - t0

                built = {
                    "base": (base_audio, base_sec, base_sec, False, 1),
                    "punct": (punct_audio, punct_sec, punct_sec, False, 1),
                    "seg": (join_with_gap(seg_audios, args.gap_ms), seg_secs[0],
                            sum(seg_secs), True, len(segs)),
                    "seg_slow": (join_with_gap(seg_slow, args.gap_ms), seg_secs[0],
                                 sum(seg_secs), True, len(segs)),
                    "stretch": (whole_slow, base_sec, base_sec, False, 1),
                }
                for variant, (audio, ttfa, total, first_seg, nseg) in built.items():
                    key = key_of(case["id"], ref["id"], variant, rep)
                    if key in existing:
                        continue
                    audio = normalize_loudness(audio)
                    filename = "%s__%s__r%d.wav" % (case["id"], variant, rep)
                    write_wav(os.path.join(PROSODY_WAV, filename), audio)
                    metrics = acoustic(audio, len(text))
                    row = {
                        "key": key, "caseId": case["id"], "lang": case["lang"],
                        "text": text, "punctText": ptext, "chars": len(text),
                        "segments": segs, "refId": ref["id"], "variant": variant,
                        "languageTag": tag, "repeat": rep, "file": "wav/" + filename,
                        "ttfaSec": round(ttfa, 2), "totalSynthSec": round(total, 2),
                        "postSec": round(post_sec, 3), "gapMs": args.gap_ms,
                        "slowRate": args.slow, "ttfaIsFirstSegment": first_seg,
                        "segmentCount": nseg, "speakerCos": cosine(ref_vec, speaker_vec(audio)),
                        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
                        **metrics,
                    }
                    rows.append(row)
                    write_json(PROSODY_RESULTS, {"rows": rows})
                    log("    %-9s r%d  ttfa=%5.2fs  语速=%.2f  停顿=%d  最长=%.2fs  cos=%.3f"
                        % (variant, rep, row["ttfaSec"], row["charsPerSec"],
                           row["pauseCount"], row["longestPauseSec"], row["speakerCos"]))

    good = [r for r in rows if "error" not in r]
    write_json(PROSODY_RESULTS, {"rows": rows})
    prosody_write_html(good, args)
    log("--- 按变体汇总（均值）---")
    for variant in VARIANTS:
        group = [r for r in good if r["variant"] == variant]
        if not group:
            continue
        avg = lambda k: round(sum(r[k] for r in group) / len(group), 3)
        log("  %-9s n=%2d  语速=%.2f字/s  停顿=%.1f  最长停顿=%.2fs  静音=%.1f%%  f0Std=%.1f  cos=%.3f  ttfa=%.2fs  总耗时=%.2fs"
            % (variant, len(group), avg("charsPerSec"), avg("pauseCount"),
               avg("longestPauseSec"), avg("silencePct"), avg("f0Std"),
               avg("speakerCos"), avg("ttfaSec"), avg("totalSynthSec")))
    log("已生成 %s / %s" % (PROSODY_RESULTS, os.path.join(PROSODY_DIR, "index.html")))


def prosody_write_html(rows, args):
    cases = {}
    for r in rows:
        k = (r["caseId"], r["lang"], r["text"], tuple(r.get("segments", [])))
        cases.setdefault(k, {}).setdefault(r["variant"], []).append(r)
    tags = sorted({r.get("languageTag") or "?" for r in rows}) or ["未记录"]
    tag_label = " / ".join(tags)
    css = """
    :root{color-scheme:light dark}
    body{font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:1180px;margin:0 auto;padding:28px 20px 60px}
    h1{font-size:22px;margin:0 0 6px} .sub{opacity:.72;font-size:13px;margin-bottom:22px}
    .note{background:rgba(127,127,127,.10);border-left:3px solid #888;padding:12px 16px;border-radius:6px;font-size:13px;margin-bottom:24px}
    section{border:1px solid rgba(127,127,127,.32);border-radius:10px;padding:16px 18px;margin-bottom:18px}
    section>h2{font-size:16px;margin:0 0 4px} .txt{opacity:.8;font-size:13px;margin-bottom:6px}
    .segs{font-size:12px;opacity:.6;margin-bottom:14px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}
    .card{border:1px solid rgba(127,127,127,.28);border-radius:8px;padding:12px}
    .card h3{font-size:14px;margin:0 0 2px} .desc{font-size:11px;opacity:.65;margin-bottom:8px}
    audio{width:100%;height:34px;display:block;margin:6px 0}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px}
    td{padding:2px 4px;border-bottom:1px solid rgba(127,127,127,.16)} td:last-child{text-align:right;font-variant-numeric:tabular-nums}
    .r{opacity:.6;font-size:11px;margin-top:4px}
    footer{font-size:12px;opacity:.65;margin-top:26px;border-top:1px solid rgba(127,127,127,.25);padding-top:14px}
    code{font-size:12px}
    """
    parts = ["<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">",
             "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
             "<title>说话方式改进对照 · 蝴蝶忍</title><style>%s</style></head><body>" % css,
             "<h1>说话方式改进对照</h1>",
             "<div class=\"sub\">本轮语言标签：<code>%s</code>．不改模型参数、不换参考音频．所有音频统一响度 RMS 0.0900</div>" % tag_label,
             "<div class=\"note\"><strong>目的</strong>：上一轮数据显示主要差距在语速偏快、留白不足，而非音色。"
             "本页对比 5 种零成本手段。<code>ttfa</code> 对分段变体指<strong>第一段可播放</strong>的延迟（兼顾 P0 首响）。"
             "重点听：是否更轻柔克制、停顿是否自然、变速有无金属声、省略号有没有被念出来。</div>"]
    metric_keys = [("ttfaSec", "首音频延迟 s", 2), ("totalSynthSec", "累计生成 s", 2),
                   ("audioSec", "音频时长 s", 2), ("charsPerSec", "语速 字/s", 2),
                   ("pauseCount", "停顿数", 0), ("longestPauseSec", "最长停顿 s", 2),
                   ("silencePct", "静音占比 %", 1), ("f0Std", "基频起伏", 0),
                   ("speakerCos", "说话人余弦", 3)]
    for (cid, lang, text, segs), by_variant in sorted(cases.items()):
        parts.append("<section><h2>%s <span class=\"desc\">%s</span></h2><div class=\"txt\">%s</div>"
                     % (cid, "日语" if lang == "ja" else "中文", text))
        parts.append("<div class=\"segs\">分段：%s</div><div class=\"grid\">"
                     % " ／ ".join(s for s in segs))
        for variant in VARIANTS:
            group = by_variant.get(variant, [])
            if not group:
                continue
            parts.append("<div class=\"card\"><h3>%s</h3><div class=\"desc\">%s</div>"
                         % (variant, VARIANT_LABELS.get(variant, "")))
            for r in sorted(group, key=lambda x: x["repeat"]):
                parts.append("<div class=\"r\">重复 r%d · 段数 %d · gap %dms · slow %s</div>"
                             % (r["repeat"], r.get("segmentCount", 1), r.get("gapMs", 0),
                                r.get("slowRate", 1.0)))
                parts.append("<audio controls preload=\"none\" src=\"%s\"></audio>" % r["file"])
                parts.append("<table>")
                for k, label, nd in metric_keys:
                    parts.append("<tr><td>%s</td><td>%.*f</td></tr>" % (label, nd, r.get(k, 0)))
                parts.append("</table>")
            parts.append("</div>")
        parts.append("</div></section>")
    parts.append("<footer>参考音频与生成音频均为第三方公开 AI 推理片段的衍生物，非动画原声、无开源授权声明。"
                 "版权归 Aniplex / ufotable / 集英社，声优早见沙织。仅限本机个人非商业评测，禁止分发，"
                 "对外展示须标注 AI 合成。<br>生成物：<code>voice/character_voices/eval/out/prosody/</code>（已加入 .gitignore）。"
                 "本轮为评测实验，未改动生产推理代码。</footer></body></html>")
    with open(os.path.join(PROSODY_DIR, "index.html"), "w", encoding="utf-8") as f:
        f.write("\n".join(parts))


# ------------------------------------------------------------------ CLI

def main():
    ap = argparse.ArgumentParser(description="蝴蝶忍角色音色可重复评测台")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p):
        p.add_argument("--refs", default="", help="只跑指定参考音频 id 或匿名标签，逗号分隔")
        p.add_argument("--non-streaming", type=lambda s: s.lower() in ("1", "true", "yes"),
                       default=False, help="generate_voice_clone 的 non_streaming_mode（默认 False）")

    p = sub.add_parser("probe", help="P0 延迟矩阵 + 分句实验")
    common(p)
    p.add_argument("--both-modes", action="store_true", help="同时测 True / False 两种模式")
    p.add_argument("--repeat", type=int, default=1, help="每组重复次数")
    p.set_defaults(func=cmd_probe)

    p = sub.add_parser("run", help="P1 参考音频 × 20 句评测")
    common(p)
    p.add_argument("--cases", default="", help="只跑指定 case id，逗号分隔")
    p.add_argument("--lang", default="", help="只跑 zh / ja（逗号分隔）")
    p.add_argument("--limit", type=int, default=0, help="只跑前 N 句（冒烟用）")
    p.add_argument("--lang-tag", default="role",
                   choices=["role", "current", "auto", "Chinese", "Japanese"],
                   help="role=历史基线 Japanese；current=读 characters.json 的当前生产标签(现为 Chinese)；auto=按句语言自动切；也可强制指定")
    p.add_argument("--force", action="store_true", help="忽略已有结果，全部重跑")
    p.set_defaults(func=cmd_run)

    p = sub.add_parser("normalize", help="统一已生成 WAV 的响度并重算声学指标（不重跑推理）")
    p.set_defaults(func=cmd_normalize)

    p = sub.add_parser("report", help="生成盲听页与主观评分表")
    p.set_defaults(func=cmd_report)

    p = sub.add_parser("langtag", help="语言标签 2x2 严格对照（独立目录，不覆盖盲听基线）")
    common(p)
    p.add_argument("--cases", default="ja_s01,zh_s01", help="测试句 id，逗号分隔")
    p.add_argument("--tags", default="j,c", help="j=Japanese / c=Chinese / a=auto（按句语言）")
    p.add_argument("--repeat", type=int, default=2, help="每组重复次数，用于估计采样噪声")
    p.add_argument("--force", action="store_true", help="忽略已有结果，全部重跑")
    p.set_defaults(func=cmd_langtag)

    p = sub.add_parser("prosody", help="说话方式零成本改进对照（不改模型参数）")
    common(p)
    p.add_argument("--cases", default="zh_m01,ja_m01", help="测试句 id，逗号分隔")
    p.add_argument("--lang-tag", default="role",
                   choices=["role", "current", "auto", "Chinese", "Japanese"],
                   help="role=历史基线 Japanese（默认，复现 PROSODY.md）；current=读 characters.json 的当前生产标签")
    p.add_argument("--repeat", type=int, default=1, help="重复次数")
    p.add_argument("--gap-ms", type=int, default=400, help="分段变体的段间静音毫秒数")
    p.add_argument("--slow", type=float, default=0.87, help="变速 rate，<1 放慢（0.87 ≈ 放慢 15%%）")
    p.add_argument("--force", action="store_true", help="忽略已有结果，全部重跑")
    p.set_defaults(func=cmd_prosody)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
