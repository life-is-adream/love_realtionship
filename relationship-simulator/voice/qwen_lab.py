#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""HeartFlow Qwen3-TTS 音色实验室：本地 GPU 真实合成 + 客观指标 + A/B 试听页。

  python voice/qwen_lab.py design                       # 全量重跑 1.7B-VoiceDesign 用例
  python voice/qwen_lab.py design --only id1,id2        # 只增量合成指定用例
  python voice/qwen_lab.py html                         # 汇总成 voice/lab-qwen/试听.html
  python voice/qwen_lab.py all                          # 全量重跑 + 汇总

与 voice_lab.py 的关系：那个是「ChatTTS 随机种子 + Edge 在线变调」，这一轮是
「本地端到端 TTS」。两轮用同一句测试文本、同一套声学指标，因此可以直接横向比。

2026-11-07 听感验收收敛：0.6B-CustomVoice 的 9 个官方预置音色整组下线（中文女声
只有 2 个，其余是男声 / 其它语种对照，不是产品候选）；「知性 · 沉静」下线；
「甜美 · 萝莉」声音不对，换成 4 个「可莉向」童声候选。被淘汰的样本由 prune()
归档到 lab-qwen/_retired/（不物理删除，随时可回滚），不再出现在试听页。

第四轮：boss 判定 4 个「可莉向」候选全不对。网上找到 AI-Hobbyist 的中文可莉
GPT-SoVITS 角色包，自带花玲真实原声（3.36s，F0 299Hz）；实测我们之前造的
324–375Hz / 亮度 2641–2970 全都太尖太亮。改用「真声参考音频 + 1.7B-Base 零样本
克隆」（voice/qwen_klee.py），试听页新增「真声参照」与「真声克隆」两组。

增量合成很重要：VoiceDesign 每次都是即兴构造说话人，重跑整组会让已经听过的
样本悄悄变声。新增候选一律用 --only，只跑新用例、保留旧 WAV。

运行需要独立环境 E:\\heartflow-voice\\venv-qwen（复用旧环境的 CUDA torch），
权重在 E:\\heartflow-voice\\models\\qwen（由 qwen_fetch.py 从 ModelScope 下载）。
默认 bf16 + sdpa：Windows 没有官方 flash-attn；实测 fp16 会在 code_predictor
采样阶段触发 CUDA device-side assert（索引越界），必须用官方默认的 bf16。
"""
import argparse
import gc
import json
import os
import shutil
import sys
import time
import traceback

import numpy as np

from voice_lab import measure  # 复用上一轮同一套 F0 / 亮度 / 平坦度指标

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "lab-qwen")
ARCHIVE = os.path.join(OUT, "_retired")
META = os.path.join(OUT, "meta.json")
MODEL_ROOT = os.environ.get("HEARTFLOW_QWEN_MODEL_DIR", r"E:\heartflow-voice\models\qwen")
MODEL_NAME = "Qwen3-TTS-12Hz-1.7B-VoiceDesign"
SAMPLE_TEXT = "你今天怎么才来呀，我等了你好久。不过没关系，见到你就好了。"

# 角色化台词只给最后一个候选：验证「这个声线说活泼台词像不像」，不参与横向 A/B。
KLEE_TEXT = "哇——你来啦！我刚刚发现一个超厉害的地方，要不要一起去看看？走嘛走嘛！"

# ---------------------------------------------------------------- 用例定义

# 1.7B-VoiceDesign：用自然语言描述直接「设计」一个说话人。
# 上一版「甜美 · 萝莉」写的是「黏人、做作又刻意卖萌」，听感判废；可莉向候选
# 改走「天然小孩、精力过剩」：去掉发嗲，强调脆亮不刺耳、蹦跳感与奶气。
# 描述里不写角色名——模型不认识游戏角色，写进去只会引入噪声；用声学特征逼近。
DESIGN_CASES = [
    ("design_yujie", "清冷 · 御姐",
     "成熟女性，音色清冷偏低、略带磁性，语速偏慢，语调平稳自信，尾音克制，不带笑意，给人疏离又从容的感觉。",
     None),
    ("design_wenrou", "温柔 · 自然",
     "年轻女性，音色温润自然，语速适中，语调柔和亲切，像日常轻声说话，不加任何表演感。",
     None),
    ("design_yuanqi", "元气 · 明亮",
     "年轻女性，音色清亮明快，语速略快，语调上扬有活力，吐字干脆，情绪愉悦。",
     None),
    ("design_lengyan", "冷艳 · 低缓",
     "成熟女性，音色低沉有颗粒感，语速慢，语调起伏小，气声略多，情绪克制疏离。",
     None),
    ("design_ruannuo", "软甜 · 少女",
     "年轻女性，音色软糯偏甜，音调略高，语速偏慢，尾音轻，带一点腼腆。",
     None),
    ("design_klee_a", "可莉向 A · 天然童声",
     "七八岁小女孩的天然童声，音色清脆偏亮、带一点奶气，音调高但圆润不刺耳，"
     "没有刻意卖萌或撒娇，语速稍快，咬字带稚气，情绪开心自然。",
     None),
    ("design_klee_b", "可莉向 B · 蹦跳元气",
     "精力旺盛的小女孩，语速明显偏快、停顿短，语调大幅上扬又跳回来，尾音有弹性，"
     "像一边蹦跳一边说话，笑声感与兴奋感强，不带做作的嗲气。",
     None),
    ("design_klee_c", "可莉向 C · 奶气软糯",
     "年龄很小的女孩，声音软糯带轻微鼻音和奶气，咬字略含糊有稚气，音调偏高但圆润柔和，"
     "尾音轻轻上扬，天真、亲昵，不尖锐。",
     None),
    ("design_klee_d", "可莉向 D · 角色台词",
     "精力旺盛的小女孩，语速明显偏快、停顿短，语调大幅上扬又跳回来，尾音有弹性，"
     "像一边蹦跳一边说话，笑声感与兴奋感强，不带做作的嗲气。",
     KLEE_TEXT),
]

# 听感验收淘汰：整组 / 单个 id。只下线，不删除 WAV。
RETIRED_GROUPS = {"custom"}
RETIRED_IDS = {"design_zhixing", "design_luoli"}

GROUPS = [
    ("reference", "目标参照 · 真实可莉中文原声（花玲）",
     "来自 AI-Hobbyist「原神/中文/可莉_ZH.zip」角色包自带参考音频，是游戏原声、不是合成。"
     "实测 F0 299Hz / 亮度 2414 / 3.36s —— 比上一轮造的 324–375Hz 更低、更暗。"
     "先听这条锁定目标，再往下 A/B。仅本机个人听感研究用，不得分发或商用。"),
    ("clone", "真声克隆 · 1.7B-Base + 参考音频（本轮重点）",
     "不再用形容词描述声线，直接把上面那段真实原声喂给 Base 模型做零样本音色克隆。"
     "同一段参考音频可以念任意文本，声纹由参考音频锁定，不受 VoiceDesign 即兴构造的随机性影响。"),
    ("design", "反例对照 · 一句话设计音色（1.7B VoiceDesign，听感判废）",
     "不依赖预置音色库，直接把声线写成描述交给模型生成说话人。"
     "官方 9 个预置音色与「知性 · 沉静」已下线；「甜美 · 萝莉」因声音不对换成 4 个"
     "「可莉向」童声候选，但 boss 第四轮判定这 4 个也全不对 —— 保留作反例："
     "描述只能调风格维度，锁不定具体某个人的声纹。"),
    ("legacy", "对照 · 上一轮基线（在线入选 2 个 + 离线旧音色 2 个）",
     "boss 上轮只认可在线的「温柔 · 自然」与「元气 · 明亮」，其余全部否掉。"
     "同时挂上被否的旧 ChatTTS 女声，用来直接 A/B：本地新模型是否真的跨过了那一档。"
     "对照组未做响度归一化，请勿用音量判断音质。"),
]


# ---------------------------------------------------------------- 合成

def _load(model_dir, dtype_name, device_map="cuda:0", max_memory=None):
    import torch
    from qwen_tts import Qwen3TTSModel

    dtype = torch.float16 if dtype_name == "fp16" else torch.bfloat16
    kw = {"device_map": device_map, "dtype": dtype,
          "attn_implementation": "sdpa"}  # Windows 无 flash-attn，用 PyTorch 原生 SDPA
    if max_memory:
        kw["max_memory"] = max_memory
    t0 = time.time()
    model = Qwen3TTSModel.from_pretrained(model_dir, **kw)
    return model, torch, time.time() - t0


TARGET_RMS = 0.09  # 与 sidecar /api/tts 的响度归一化同一量级，便于跨引擎公平 A/B


def _normalize(audio):
    """统一响度；峰值可能触顶时改为按峰值限幅，避免削波。"""
    rms = float(np.sqrt((audio ** 2).mean())) if audio.size else 0.0
    if rms < 1e-6:
        return audio
    gain = TARGET_RMS / rms
    peak = float(np.abs(audio).max())
    if peak * gain > 0.95:
        gain = 0.95 / peak
    return np.clip(audio * gain, -1.0, 1.0)


def _write_wav(wavs, sr, path):
    import soundfile as sf

    audio = np.asarray(wavs[0], dtype=np.float32).reshape(-1)
    sf.write(path, _normalize(audio), sr, subtype="PCM_16")


def voiced_flatness(path):
    """只统计有声帧的频谱平坦度中位数 + 静音占比。

    voice_lab.measure 的全局 FFT 平坦度会被长音频里的静音段与频率分辨率拉高，
    跨模型比较时不够稳；这个分帧口径更贴近人耳听到的「沙沙声 / 气声」。
    """
    import wave

    with wave.open(path, "rb") as w:
        sr = w.getframerate()
        audio = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768
    size = int(0.02 * sr)
    if audio.size < size:
        return 1.0, 0.0
    flat, quiet, total = [], 0, 0
    for start in range(0, audio.size - size, size):
        frame = audio[start:start + size]
        total += 1
        if np.sqrt((frame ** 2).mean()) < 0.006:
            quiet += 1
            continue
        spec = np.abs(np.fft.rfft(frame * np.hanning(size) + 1e-12))
        spec = spec[spec > 1e-9]
        if spec.size > 8:
            flat.append(float(np.exp(np.log(spec).mean()) / spec.mean()))
    return (round(float(np.median(flat)), 3) if flat else 1.0,
            round(quiet / max(total, 1) * 100))


def align_wavs(entries):
    """重建试听页前统一响度、补齐分帧指标（幂等，可反复执行）。

    指标回写由 build_html 统一负责，避免只在「响度恰好变动」时才落盘 —— 否则
    新合成样本的 flatnessVoiced / silencePct 会出现在页面上、却不在 meta.json 里。
    """
    import soundfile as sf

    for e in entries:
        if e.get("group") not in ("design", "clone") or e.get("error"):
            continue
        path = os.path.join(OUT, e["file"])
        if not os.path.isfile(path):
            continue
        audio, sr = sf.read(path, dtype="float32")
        rms = float(np.sqrt((audio ** 2).mean()))
        peak = float(np.abs(audio).max()) if audio.size else 0.0
        # 峰值触顶时 _normalize 会改为限幅，实际可达响度低于 TARGET_RMS；
        # 拿「限幅后的目标」比较，才不会每次重建都反复改写同一文件。
        want = min(TARGET_RMS, 0.95 / peak * rms) if peak > 0 else TARGET_RMS
        if abs(rms - want) > 0.004:
            sf.write(path, _normalize(audio), sr, subtype="PCM_16")
            print("  响度对齐 %-22s %.4f -> %.4f" % (e["id"], rms, want), flush=True)
        e.update(measure(path))
        e["flatnessVoiced"], e["silencePct"] = voiced_flatness(path)
    return entries


def run_group(dtype_name, limit=0, only=None):
    import torch

    model_dir = os.path.join(MODEL_ROOT, MODEL_NAME)
    if not os.path.isdir(model_dir):
        raise SystemExit("找不到权重：%s（先跑 qwen_fetch.py）" % model_dir)

    os.makedirs(OUT, exist_ok=True)
    entries = prune()
    if only:
        # 增量：只替换指定 id 的旧条目，其余已验收样本保持原 WAV 不动。
        entries = [e for e in entries if not (e.get("group") == "design" and e["id"] in only)]
        cases = [c for c in DESIGN_CASES if c[0] in only]
    else:
        entries = [e for e in entries if e.get("group") != "design"]
        cases = DESIGN_CASES[:limit] if limit else DESIGN_CASES
    if not cases:
        raise SystemExit("--only 没有匹配到任何用例")

    print("=== 加载 %s (%s) ===" % (MODEL_NAME, dtype_name), flush=True)
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()
    device_note = "本地离线"
    try:
        model, torch, load_sec = _load(model_dir, dtype_name)
    except Exception as e:
        if "out of memory" not in str(e).lower():
            raise
        # 1.7B 在 6GB 卡上可能装不下：让 accelerate 把放不下的层 offload 到内存。
        print("  整卡加载 OOM，改用 CPU offload 重试：%s" % str(e)[:100], flush=True)
        gc.collect()
        torch.cuda.empty_cache()
        model, torch, load_sec = _load(
            model_dir, dtype_name, device_map="auto",
            max_memory={0: "3.9GiB", "cpu": "12GiB"})
        device_note = "本地离线 · CPU offload"
    print("  加载 %.1fs  显存峰值 %.2f GB  %s" %
          (load_sec, torch.cuda.max_memory_allocated() / 1e9, device_note), flush=True)

    for index, (ident, label, instruct, text_override) in enumerate(cases, 1):
        text = text_override or SAMPLE_TEXT
        detail = instruct
        if text_override:
            detail += "<br>测试文本：「" + text_override + "」"
        path = os.path.join(OUT, ident + ".wav")
        print("  [%d/%d] %s" % (index, len(cases), label), end=" ", flush=True)
        try:
            torch.cuda.reset_peak_memory_stats()
            t0 = time.time()
            wavs, sr = model.generate_voice_design(
                text=text, language="Chinese", instruct=instruct)
            elapsed = time.time() - t0
            _write_wav(wavs, sr, path)
            metrics = measure(path)
            entry = {
                "id": ident, "group": "design", "label": label, "detail": detail,
                "file": ident + ".wav", "model": MODEL_NAME,
                "sampleRate": sr, "loadSec": round(load_sec, 1),
                "synthSec": round(elapsed, 1),
                "vramGb": round(torch.cuda.max_memory_allocated() / 1e9, 2),
                "note": device_note,
            }
            entry.update(metrics)
            entries.append(entry)
            write_meta(entries)
            print("F0=%3dHz 亮度=%4d 平坦度=%.3f %.1fs %.1fGB" %
                  (metrics["f0"], metrics["brightness"], metrics["flatness"],
                   elapsed, entry["vramGb"]), flush=True)
        except Exception as e:
            print("FAIL %s: %s" % (type(e).__name__, str(e)[:120]), flush=True)
            entries.append({"id": ident, "group": "design", "label": label,
                            "detail": detail, "error": "%s: %s" % (type(e).__name__, e),
                            "note": "合成失败"})
            write_meta(entries)
            if "out of memory" in str(e).lower():
                torch.cuda.empty_cache()
                print("  OOM，后续用例继续尝试", flush=True)
            else:
                traceback.print_exc()
        gc.collect()

    del model
    gc.collect()
    torch.cuda.empty_cache()
    return entries


# ---------------------------------------------------------------- meta / HTML

def read_meta():
    if not os.path.isfile(META):
        return []
    try:
        with open(META, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def write_meta(entries):
    os.makedirs(OUT, exist_ok=True)
    with open(META, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)


def prune():
    """把听感验收淘汰的样本从 meta 下线，WAV 归档而非删除（幂等、可回滚）。"""
    entries = read_meta()
    keep, drop = [], []
    for e in entries:
        (drop if (e.get("group") in RETIRED_GROUPS or e.get("id") in RETIRED_IDS)
         else keep).append(e)
    if not drop:
        return entries
    os.makedirs(ARCHIVE, exist_ok=True)
    for e in drop:
        name = e.get("file") or ""
        src = os.path.join(OUT, name)
        if name and os.path.isfile(src):
            dst = os.path.join(ARCHIVE, name)
            if not os.path.isfile(dst):
                shutil.move(src, dst)
    write_meta(keep)
    print("归档淘汰样本 %d 个 -> %s" % (len(drop), ARCHIVE), flush=True)
    return keep


def klee_reference():
    """真实可莉中文原声：只测指标，不做响度归一化（保留原声本来面貌）。"""
    path = os.path.join(OUT, "klee_ref.wav")
    if not os.path.isfile(path):
        return []
    return [{
        "id": "klee_ref", "group": "reference",
        "label": "真实可莉 · 中文原声（花玲）",
        "detail": "角色包自带参考音频：「玩得太开心，忘、忘在脑后了…」。游戏原声，未做任何处理。",
        "file": "klee_ref.wav", "note": "真声 · 仅本地试听", **measure(path),
    }]


def legacy_entries():
    """把上一轮基线样本复制到本目录，让试听页自包含。

    用 `../lab-out/x.wav` 相对路径本地双击能放，但预览面板的静态服务通常不允许
    跳出根目录，对照组会变成「点开没声音」。复制一份（约 400KB）最稳，也不改原文件。
    """
    base = os.path.join(HERE, "lab-out")
    out = []
    cases = [
        ("edge_wenrou", "温柔 · 自然（上轮通过）",
         "XiaoxiaoNeural +0Hz / +0%，F0 235Hz", "在线 · 文本出网", ".mp3"),
        ("edge_yuanqi", "元气 · 明亮（上轮通过）",
         "XiaoyiNeural +10Hz / +10%，F0 289Hz", "在线 · 文本出网", ".mp3"),
        ("chat_s666", "chat_qingche · 清澈自然（旧离线默认）",
         "ChatTTS seed 666，32 种子海选后的默认", "离线 · 旧基线", ".wav"),
        ("chat_s777", "chat_wenrou · 温柔低缓（更旧默认）",
         "ChatTTS seed 777，boss 反馈「难听」的那一档", "离线 · 旧基线", ".wav"),
    ]
    for ident, label, detail, note, ext in cases:
        name = ident + ext
        src = os.path.join(base, name)
        if not os.path.isfile(src):
            continue
        dst = os.path.join(OUT, name)
        if not os.path.isfile(dst):
            shutil.copyfile(src, dst)
        m = measure(dst)
        out.append({"id": ident, "group": "legacy", "label": label, "detail": detail,
                    "file": name, "note": note, **m})
    return out


HTML = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HeartFlow · Qwen3-TTS 本地音色实验室</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f6f7fb;color:#1c2230;
 font:14px/1.6 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
header{padding:28px 32px 18px;background:#fff;border-bottom:1px solid #e6e9f2}
h1{margin:0 0 6px;font-size:22px}h1 small{font-size:13px;color:#7a849b;font-weight:400}
.sub{color:#5b6478;font-size:13px}
main{max-width:1180px;margin:0 auto;padding:8px 24px 60px}
h2{font-size:17px;margin:30px 0 4px}.desc{color:#66708a;font-size:13px;margin:0 0 14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}
.card{background:#fff;border:1px solid #e6e9f2;border-radius:12px;padding:14px 16px}
.card.pick{border-color:#2b5aed;box-shadow:0 0 0 2px #e5ecff}
.card.fail{border-color:#d9534f;background:#fff6f6}
.name{font-size:15px;font-weight:600;display:flex;justify-content:space-between;align-items:center;gap:8px}
.tag{font-size:11px;font-weight:400;padding:1px 8px;border-radius:10px;background:#eef3ff;color:#2b5aed;white-space:nowrap}
.tag.online{background:#fff2e6;color:#b35c00}
.meta{color:#5b6478;font-size:12px;min-height:52px;margin:6px 0 8px}
.meta code{background:#f1f3f9;padding:1px 5px;border-radius:4px;font-size:11px}
audio{width:100%;height:34px}
.stats{margin-top:8px;display:flex;flex-wrap:wrap;gap:6px}
.stat{font-size:11px;background:#f3f5fb;color:#4a5470;padding:2px 7px;border-radius:5px}
.note{background:#fff;border:1px solid #e6e9f2;border-radius:10px;padding:14px 18px;margin-top:26px;font-size:13px;color:#4a5470}
.warn{border-color:#f0d6a8;background:#fffaf0;color:#7a5a1e}
</style></head><body>
<header><h1>Qwen3-TTS 本地音色实验室 <small>RTX 3060 Laptop 6GB · 全程离线</small></h1>
<div class="sub">统一测试文本：「__TEXT__」（角色台词 / 真声参照除外）。合成样本全部由本机 GPU 真实生成，未调用任何在线服务。<b>本轮重点：置顶「真实可莉原声」与「真声克隆」，蓝框标出；下面 4 个描述候选是上一轮判废的反例。</b>点播放即可 A/B。</div>
</header><main>
"""


def build_html():
    raw = prune()
    errors = [e for e in raw if e.get("error")]
    entries = align_wavs([e for e in raw if not e.get("error")])
    write_meta(entries + errors)  # 重算的声学指标与页面保持一致
    for extra in (klee_reference(), legacy_entries()):
        entries += [e for e in extra if all(x["id"] != e["id"] for x in entries)]
    parts = [HTML.replace("__TEXT__", SAMPLE_TEXT)]
    for key, title, desc in GROUPS:
        rows = [e for e in entries if e["group"] == key]
        if not rows:
            continue
        if key == "design":
            rows.sort(key=lambda x: x.get("f0", 0))
        parts.append("<h2>%s</h2><p class='desc'>%s</p><div class='grid'>" % (title, desc))
        for e in rows:
            stats = "".join("<span class='stat'>%s %s</span>" % (k, e[k])
                            for k in ("f0", "f0Std", "brightness", "flatnessVoiced",
                                      "silencePct", "seconds", "synthSec", "vramGb")
                            if k in e)
            online = "在线" in e.get("note", "")
            picked = " pick" if (e["id"] == "klee_ref" or e["id"].startswith("clone_")) else ""
            parts.append(
                "<div class='card%s'><div class='name'>%s<span class='tag%s'>%s</span></div>"
                "<div class='meta'>%s<br><code>%s</code></div>"
                "<audio controls preload='none' src='%s'></audio>"
                "<div class='stats'>%s</div></div>" %
                (picked, e["label"], " online" if online else "", e.get("note", ""),
                 e.get("detail", ""), e["id"], e["file"], stats))
        parts.append("</div>")
    for e in errors:
        parts.append("<div class='card fail' style='margin-top:10px'><b>%s</b> 合成失败：%s</div>" %
                     (e["label"], e.get("error", "")[:200]))
    parts.append(
        "<div class='note warn'><b>为什么前四个都不对：</b>实测真实可莉中文原声 F0 <b>299Hz</b> / "
        "亮度 2414 / f0Std 103；而 VoiceDesign 造出来的 4 个候选是 324–375Hz / 亮度 2641–2970 / "
        "f0Std 73–93 —— 全都更尖、更亮、语调起伏更小。更根本的原因是：描述只能调「风格维度」，"
        "锁不定花玲这个人的<b>声纹</b>（共振峰结构、咬字习惯、节奏）。这一轮改用参考音频做零样本克隆，"
        "声纹由那段真声直接给定，不再靠形容词猜。</div>"
        "<div class='note warn'><b>素材来源与边界：</b>参考音频来自 ModelScope "
        "<code>aihobbyist/GPT-SoVITS_Model_Collection</code> 的 <code>原神/中文/可莉_ZH.zip</code> "
        "角色包自带样本（CC-BY-NC）。角色形象与声音权利归米哈游，许可明确<b>禁止商业使用与再分发</b>；"
        "本页仅在本机做个人听感研究，不进 git、不接入产品、不外发。</div>"
        "<div class='note warn'><b>隐私与边界：</b>本页「本地」分组全部由本机 RTX 3060 Laptop 合成，"
        "文本与音频都不出机；「对照」分组里标注「在线」的是上一轮微软神经语音（合成时文本出网），"
        "标注「离线 · 旧基线」的是旧 ChatTTS。听感验收淘汰的样本已归档到 <code>_retired/</code>，"
        "不出现在试听页但文件仍在，随时可回滚。</div>"
        "<div class='note'><b>指标怎么看：</b>f0 = 基频中位数（Hz），低偏成熟、高偏稚嫩；"
        "brightness = 频谱质心（Hz），越高越清亮；flatnessVoiced = 只算有声帧的频谱平坦度中位数，"
        "越接近 1 越像噪声 / 气声越重（旧 ChatTTS 约 0.025）；silencePct = 静音帧占比；"
        "f0Std 越大语调起伏越夸张；synthSec = 单句合成耗时，vramGb = 显存峰值。"
        "本地 WAV 已统一响度（rms≈0.09）并保留峰值余量，避免「音量大显得好听」；"
        "mp3 对照组未做归一化，请勿用响度做比较。"
        "<br>重建试听页：<code>python voice/qwen_lab.py html</code>；"
        "增量加样本：<code>python voice/qwen_lab.py design --only id1,id2</code>。</div>"
        "</main></body></html>")
    path = os.path.join(OUT, "试听.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(parts))
    print("试听页：%s（%d 个样本，%d 个失败）" % (path, len(entries), len(errors)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["design", "html", "all"])
    ap.add_argument("--dtype", default="bf16", choices=["fp16", "bf16"],
                    help="fp16 在本机 3060 会触发 CUDA assert，仅保留作对照")
    ap.add_argument("--limit", type=int, default=0, help="全量模式下只跑前 N 个用例（冒烟用）")
    ap.add_argument("--only", default="",
                    help="增量模式：只合成指定 id（逗号分隔），不重跑已验收样本")
    args = ap.parse_args()
    only = {s.strip() for s in args.only.split(",") if s.strip()} or None
    if args.cmd in ("design", "all"):
        run_group(args.dtype, args.limit, only)
        build_html()
    else:
        build_html()


if __name__ == "__main__":
    main()
