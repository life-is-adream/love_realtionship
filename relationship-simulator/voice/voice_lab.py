#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""HeartFlow 音色实验室：生成可试听的女声候选 + 声学指标 + 试听页。

  python voice/voice_lab.py edge      # 在线神经语音（微软 Edge）风格预设
  python voice/voice_lab.py chattts   # 离线 ChatTTS 说话人海选 + 韵律对照
  python voice/voice_lab.py html      # 汇总为 voice/lab-out/试听.html

产物全部落在 voice/lab-out/（已在 .gitignore 中）。试听页不依赖服务器，
直接双击打开即可；浏览器只读取同目录下的音频文件，不上传任何内容。

为什么要这个工具：ChatTTS 的音色是「固定种子随机采样」出来的说话人向量，
没有任何音质筛选，也没有风格设计。靠猜 seed 起名字是碰运气，必须批量合成 +
客观指标 + 人耳试听三轮才能定。Edge 分支则提供一条音质上限更高的对照线。
"""

import argparse
import asyncio
import io
import json
import os
import sys
import time
import wave

import numpy as np

from voice_presets import EDGE_VOICES

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "lab-out")
META = os.path.join(OUT, "meta.json")
SAMPLE_TEXT = "你今天怎么才来呀，我等了你好久。不过没关系，见到你就好了。"
SR = 24000

# ---------------------------------------------------------------- 声学指标


def _f0_median(audio, sr=SR):
    """FFT 自相关法估计基频中位数。用于相对排序，不追求绝对精度。"""
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


def measure(path):
    """统一从音频文件读指标；Edge 的 mp3 用 PyAV 解码，WAV 用 wave 模块。"""
    if path.lower().endswith(".mp3"):
        import av  # noqa: PLC0415

        chunks = []
        with av.open(path) as container:
            resampler = av.AudioResampler(format="flt", layout="mono", rate=SR)
            for frame in container.decode(audio=0):
                for out in resampler.resample(frame):
                    chunks.append(out.to_ndarray().reshape(-1))
        audio = np.concatenate(chunks).astype(np.float32) if chunks else np.zeros(0, np.float32)
    else:
        with wave.open(path, "rb") as handle:
            rate = handle.getframerate()
            raw = handle.readframes(handle.getnframes())
        audio = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
        if rate != SR:
            audio = np.interp(
                np.linspace(0, len(audio), int(len(audio) * SR / rate)),
                np.arange(len(audio)), audio,
            ).astype(np.float32)

    audio = np.nan_to_num(audio)
    rms = float(np.sqrt((audio ** 2).mean())) if audio.size else 0.0
    spectrum = np.abs(np.fft.rfft(audio * np.hanning(len(audio)) + 1e-12)) if audio.size else np.zeros(1)
    freqs = np.fft.rfftfreq(len(audio), 1 / SR) if audio.size else np.zeros(1)
    centroid = float((spectrum * freqs).sum() / max(spectrum.sum(), 1e-9))
    positive = spectrum[spectrum > 1e-10]
    flatness = float(np.exp(np.log(positive).mean()) / positive.mean()) if positive.size > 8 else 1.0
    f0, f0_std = _f0_median(audio)
    return {
        "seconds": round(len(audio) / SR, 2),
        "f0": round(f0),
        "f0Std": round(f0_std),
        "brightness": round(centroid),
        "flatness": round(flatness, 3),
        "rms": round(rms, 4),
    }


def write_meta(entries):
    os.makedirs(OUT, exist_ok=True)
    old = {}
    if os.path.isfile(META):
        try:
            with open(META, "r", encoding="utf-8") as handle:
                old = {item["id"]: item for item in json.load(handle)}
        except (OSError, ValueError):
            pass
    old.update({item["id"]: item for item in entries})
    with open(META, "w", encoding="utf-8") as handle:
        json.dump([old[key] for key in sorted(old)], handle, ensure_ascii=False, indent=2)
    return len(old)


# ---------------------------------------------------------------- Edge 分支

# 与 voice_presets.py（sidecar 运行时）共用同一份定义，避免试听页与产品音色漂移。
EDGE_PRESETS = [
    (item["id"], item["label"], item["voice"], item["pitch"], item["rate"])
    for item in EDGE_VOICES
]


async def _edge_one(preset, text):
    import edge_tts  # noqa: PLC0415

    ident, label, voice, pitch, rate = preset
    path = os.path.join(OUT, f"{ident}.mp3")
    comm = edge_tts.Communicate(text, voice, pitch=pitch, rate=rate)
    await comm.save(path)
    return path


def run_edge(text, only=None):
    os.makedirs(OUT, exist_ok=True)
    presets = [item for item in EDGE_PRESETS if not only or item[0] in only]
    print(f"[edge] 待合成 {len(presets)} 个风格音色，文本 {len(text)} 字", flush=True)

    async def main():
        entries = []
        for preset in presets:
            ident, label, voice, pitch, rate = preset
            started = time.time()
            try:
                path = await _edge_one(preset, text)
                metrics = measure(path)
                entries.append({
                    "id": ident, "group": "edge", "label": label,
                    "file": os.path.basename(path), "detail": f"{voice} · pitch {pitch} · rate {rate}",
                    "note": "在线 · 微软神经语音", **metrics,
                })
                print(f"  {label:12s} {ident:16s} F0≈{metrics['f0']:3d}Hz "
                      f"{metrics['seconds']:4.1f}s {time.time() - started:4.1f}s", flush=True)
            except Exception as error:  # noqa: BLE001
                print(f"  {label} 失败: {type(error).__name__}: {error}", flush=True)
        return entries

    entries = asyncio.run(main())
    print(f"[edge] 完成 {len(entries)}/{len(presets)}，meta 共 {write_meta(entries)} 条", flush=True)


# ------------------------------------------------------------ ChatTTS 分支

CHATTTS_SEEDS = [
    777, 2024, 31415, 8888,         # 现网 4 个音色，作为基准
    2, 3, 5, 7, 11, 13, 17, 23, 31, 42, 66, 99,
    111, 222, 333, 512, 666, 999, 1024, 2048, 4096, 8192,
    12345, 54321, 65535, 10007, 20024, 31416,
]


def _load_chat():
    import torch  # noqa: PLC0415
    import ChatTTS  # noqa: PLC0415
    import tts_server  # noqa: PLC0415 - 同目录，复用加载补丁与 WAV 封装

    tts_server._patch_encode_prompt()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    chat = ChatTTS.Chat()
    ok = chat.load(source="custom", custom_path=tts_server.CHATTTS_ROOT, compile=False, device=device)
    if not ok:
        raise RuntimeError("ChatTTS 权重加载失败")
    print(f"[chattts] 模型就绪 device={device}", flush=True)
    return chat, torch, tts_server, device


def _synth(chat, torch, server, device, seed, text, refine_prompt=None, speed_code=5):
    from ChatTTS import Chat  # noqa: PLC0415

    torch.manual_seed(seed)
    if device.type == "cuda":
        torch.cuda.manual_seed_all(seed)
    spk = chat.sample_random_speaker()
    infer = Chat.InferCodeParams(
        spk_emb=spk, prompt=f"[speed_{speed_code}]",
        temperature=0.3, top_P=0.7, top_K=20,
    )
    kwargs = dict(
        skip_refine_text=refine_prompt is None,
        params_infer_code=infer,
        split_text=False,
    )
    if refine_prompt is not None:
        kwargs["params_refine_text"] = Chat.RefineTextParams(
            prompt=refine_prompt, top_P=0.7, top_K=20, temperature=0.7,
        )
    with torch.inference_mode():
        result = chat.infer([text], **kwargs)
    items = result if isinstance(result, (list, tuple)) else [result]
    waves = [np.asarray(item, dtype=np.float32).reshape(-1) for item in items if item is not None and len(item)]
    if not waves:
        raise RuntimeError("模型返回空音频")
    return np.concatenate(waves)


def run_chattts(text, seeds=None, prosody=False):
    os.makedirs(OUT, exist_ok=True)
    chat, torch, server, device = _load_chat()
    entries = []
    todo = seeds if seeds else CHATTTS_SEEDS

    # 海选：关掉 refine，避免口头禅/停顿污染音色本身的评价。
    for index, seed in enumerate(todo, start=1):
        started = time.time()
        try:
            audio = _synth(chat, torch, server, device, seed, text)
            ident = f"chat_s{seed}"
            path = os.path.join(OUT, f"{ident}.wav")
            with open(path, "wb") as handle:
                handle.write(server.float_to_wav(audio, SR))
            metrics = measure(path)
            entries.append({
                "id": ident, "group": "chattts", "label": f"种子 {seed}",
                "file": os.path.basename(path), "detail": f"seed={seed} · 无口令改写",
                "note": "离线 · ChatTTS", "seed": seed, **metrics,
            })
            print(f"  [{index:2d}/{len(todo)}] seed {seed:6d}  F0≈{metrics['f0']:3d}Hz "
                  f"亮度 {metrics['brightness']:4d} 平坦度 {metrics['flatness']:.3f} "
                  f"{metrics['seconds']:4.1f}s / 耗时 {time.time() - started:4.1f}s", flush=True)
        except Exception as error:  # noqa: BLE001
            print(f"  seed {seed} 失败: {type(error).__name__}: {error}", flush=True)

    if prosody:
        # 韵律对照：同一个说话人，只改口令/语速，定位「难听」是不是出在口头禅上。
        variants = [
            ("p_current", "现网配置 oral_2/break_4", "[oral_2][laugh_0][break_4]", 5),
            ("p_clean", "干净口令 oral_0/break_0", "[oral_0][laugh_0][break_0]", 5),
            ("p_none", "完全跳过文本改写", None, 5),
            ("p_slow", "跳过改写 + 慢速", None, 3),
            ("p_fast", "跳过改写 + 稍快", None, 7),
        ]
        for ident, label, prompt, speed_code in variants:
            try:
                audio = _synth(chat, torch, server, device, 777, text, prompt, speed_code)
                path = os.path.join(OUT, f"{ident}.wav")
                with open(path, "wb") as handle:
                    handle.write(server.float_to_wav(audio, SR))
                metrics = measure(path)
                entries.append({
                    "id": ident, "group": "prosody", "label": label,
                    "file": os.path.basename(path),
                    "detail": f"seed=777 · {prompt or 'skip_refine'} · speed_{speed_code}",
                    "note": "离线 · 韵律对照", **metrics,
                })
                print(f"  韵律 {label:20s} {metrics['seconds']:4.1f}s", flush=True)
            except Exception as error:  # noqa: BLE001
                print(f"  韵律 {label} 失败: {type(error).__name__}: {error}", flush=True)

    print(f"[chattts] 完成 {len(entries)} 条，meta 共 {write_meta(entries)} 条", flush=True)


# ---------------------------------------------------------------- 试听页

HTML_HEAD = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HeartFlow 女声试听台</title>
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;padding:34px 18px 64px;background:#f6f7f9;color:#1f2329;
 font:15px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.wrap{max-width:880px;margin:0 auto}
h1{font-size:23px;margin:0 0 6px}
.sub{color:#6b7280;font-size:13px;margin-bottom:22px}
h2{font-size:17px;margin:30px 0 6px}
.desc{color:#6b7280;font-size:13px;margin:0 0 14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(268px,1fr));gap:12px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:15px 16px 13px}
.card.pick{border-color:#16794a;box-shadow:0 0 0 2px #d9f2e4}
.name{font-size:15px;font-weight:600;display:flex;justify-content:space-between;align-items:center}
.tag{font-size:11px;font-weight:400;padding:1px 8px;border-radius:10px;background:#eef3ff;color:#2b5aed;white-space:nowrap}
.tag.ok{background:#e8f7ee;color:#16794a}
.tag.dead{background:#f3f4f6;color:#8a9099}
.tag.fallback{background:#fff4e5;color:#a15c00}
.meta{color:#8a9099;font-size:12px;margin:5px 0 9px;min-height:34px}
audio{width:100%;height:36px}
.stats{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}
.stat{font-size:11px;color:#4b5563;background:#f3f4f6;border-radius:5px;padding:2px 7px}
.note{background:#fff;border-left:3px solid #2b5aed;border-radius:0 8px 8px 0;
 padding:14px 18px;font-size:13px;color:#41464d;margin-top:26px}
code{background:#f2f3f5;padding:1px 5px;border-radius:4px;font-size:12px}
.warn{border-left-color:#d97706}
</style></head><body><div class="wrap">
<h1>HeartFlow 女声试听台</h1>
<div class="sub">点击播放对比 · 指标为客观声学测量，最终以耳朵为准 · 全部为本机真实合成</div>
"""

HTML_GROUPS = [
    ("edge", "在线 · 微软神经语音（真人听感验收：只有 2 个通过）",
     "微软免费端点只给 2 个普通话原生女声：Xiaoxiao（Warm, F0≈235）与 Xiaoyi（Lively, F0≈289）。"
     "其余 7 张是用 SSML pitch 硬变调造出的反例——基频平移会连共振峰一起搬，听感变成电音/卡通，全部淘汰；"
     "mstts:express-as 情感风格也被端点直接拒绝。此组为 mp3，平坦度受压缩影响，不与下方 WAV 直接比较。"),
    ("prosody", "韵律对照 · 同一个说话人，只改停顿与口头禅",
     "定位「难听」出在音色还是口令改写。实测现网 oral_2/break_4 平坦度 0.110，"
     "干净口令 oral_0/break_0 降到 0.054——产品默认口令已据此改掉。"),
    ("chattts", "离线 · ChatTTS 说话人海选（32 个种子，验收后仅 2 个作兜底）",
     "完全本地。客观指标（F0 / 亮度 / 平坦度）只能筛「干净」，筛不出「好听」：这一组在真人听感验收中"
     "整体未通过，只留 2 个相对能听的作「无网络兜底」，不再作为主推。F0 上限只有 243Hz，做不出童声。"),
]

# 2026-11-07 真人听感验收结果。这是最终选型，客观指标只是排噪用的辅助。
ACCEPTED = {
    "edge_wenrou": "产品主推 · 默认",
    "edge_yuanqi": "产品主推 · 活泼备选",
}
OFFLINE_FALLBACK = {
    "chat_s666": "chat_qingche · 清澈自然",
    "chat_s31": "chat_lengjing · 沉静平稳",
}
LEGACY_VOICES = {
    "chat_s777": "旧默认", "chat_s2024": "旧版",
    "chat_s31415": "旧版", "chat_s8888": "旧版",
}

HTML_TAIL = """</div></body></html>
"""


def build_html():
    if not os.path.isfile(META):
        raise SystemExit("没有 meta.json，请先跑 edge / chattts 子命令")
    with open(META, "r", encoding="utf-8") as handle:
        items = json.load(handle)

    parts = [HTML_HEAD]
    for group, title, desc in HTML_GROUPS:
        rows = [item for item in items if item["group"] == group]
        if not rows:
            continue
        if group in ("edge", "chattts"):
            # 通过的排最前，其次离线兜底，其余按噪声升序——结论一眼可见，反例留在后面。
            rows.sort(key=lambda item: (
                0 if item["id"] in ACCEPTED else
                1 if item["id"] in OFFLINE_FALLBACK else 2,
                item.get("flatness", 1),
            ))
        parts.append(f"<h2>{title}</h2><p class='desc'>{desc}</p><div class='grid'>")
        for item in rows:
            stats = "".join(
                f"<span class='stat'>{key} {item[key]}</span>"
                for key in ("f0", "f0Std", "brightness", "flatness", "seconds")
                if key in item
            )
            ident = item["id"]
            if ident in ACCEPTED:
                cls, verdict, pick = "ok", "✓ " + ACCEPTED[ident], " pick"
                chosen = "<br><b style='color:#16794a'>真人听感验收通过</b>"
            elif ident in OFFLINE_FALLBACK:
                cls, verdict, pick = "fallback", "离线兜底", ""
                chosen = f"<br>仅无网络时兜底：<b>{OFFLINE_FALLBACK[ident]}</b>"
            elif group == "prosody":
                cls, verdict, pick, chosen = "dead", "对照样本", "", ""
            else:
                cls, verdict, pick, chosen = "dead", "已淘汰", "", ""
            legacy = LEGACY_VOICES.get(ident)
            label = item["label"] + (f" · {legacy}" if legacy else "")
            parts.append(
                f"<div class='card{pick}'><div class='name'>{label}"
                f"<span class='tag {cls}'>{verdict}</span></div>"
                f"<div class='meta'>{item['detail']}{chosen}<br>{item['note']} · <code>{ident}</code></div>"
                f"<audio controls preload='none' src='{item['file']}'></audio>"
                f"<div class='stats'>{stats}</div></div>"
            )
        parts.append("</div>")

    parts.append(
        "<div class='note warn'><b>验收结论：</b>真人试听只认可「温柔 · 自然」与「元气 · 明亮」两个"
        "零 / 近零变调的原生女声，其余全部淘汰（标灰）。用 pitch 变调造出来的御姐 / 萝莉会把共振峰一起搬走，"
        "听感变成电音 / 卡通；mstts:express-as 情感风格又被免费端点直接拒绝。当前没有可用的"
        "「清冷御姐 / 甜美萝莉」声线，这是引擎能力边界，不是调参能补的。</div>"
        "<div class='note warn'><b>隐私提示：</b>「在线」分组是微软神经语音，合成时文本会离开本机。"
        "产品默认零注册、零联网；要在产品里听到上面两个通过的音色，在设置面板勾选「启用在线语音」并确认即可，"
        "无需改环境变量或重启服务。关掉开关立刻恢复纯离线。「离线」分组由本机 RTX 3060 上的 ChatTTS 合成，不联网。</div>"
        "<div class='note'><b>指标怎么看：</b>f0 = 基频中位数（Hz），数值低偏成熟、高偏稚嫩；"
        "brightness = 频谱质心（Hz），越高越清亮；flatness = 频谱平坦度，越接近 1 越像噪声，"
        "干净人声通常在 0.15 以下；f0Std 越大语调起伏越夸张。"
        "<b>这些指标只能排除明显噪声，判不了「好听」</b>——本轮它们筛出的音色在真人验收里几乎全军覆没。"
        "重新生成：<code>python voice/voice_lab.py edge|chattts|html</code>。</div>"
    )
    parts.append(HTML_TAIL)
    path = os.path.join(OUT, "试听.html")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("".join(parts))
    print(f"[html] 已生成 {path}（{len(items)} 个样本）", flush=True)


def main():
    parser = argparse.ArgumentParser(description="HeartFlow 音色实验室")
    parser.add_argument("action", choices=["edge", "chattts", "html"])
    parser.add_argument("--text", default=SAMPLE_TEXT, help="用于合成的统一测试句")
    parser.add_argument("--seeds", default="", help="逗号分隔的种子列表，仅 chattts 有效")
    parser.add_argument("--prosody", action="store_true", help="chattts 额外生成韵律对照")
    parser.add_argument("--only", default="", help="逗号分隔的 edge 预设 id")
    args = parser.parse_args()

    if args.action == "edge":
        run_edge(args.text, set(filter(None, args.only.split(","))) or None)
    elif args.action == "chattts":
        seeds = [int(item) for item in filter(None, args.seeds.split(","))] or None
        run_chattts(args.text, seeds, args.prosody)
    else:
        build_html()


if __name__ == "__main__":
    sys.exit(main())
