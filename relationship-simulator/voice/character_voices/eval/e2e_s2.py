#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""S2 前端分段播放队列的端到端对照（整句 vs 分段），走真实三层链路。

    :3000 /api/tts -> :5001 character 代理 -> :5002 Qwen3-TTS 零样本克隆

设计要点：

* 分段口径**不在此处重写**，直接通过 node 调用生产模块
  public/modules/voice/speech-segments.js，保证测到的就是浏览器会切出的段。
* 每次请求前先从 :5002/health 读出当前 char_shinobu 的 ref / language，
  写进结果文件，避免「换了音色却拿旧配置跑对照」。
* 首次请求会触发 4.3GB 权重加载，因此先做一次预热请求，不计入对照。
* 命令行没有播放器，故 B 的「首响」= 第一段请求返回的时刻（真正可播放的时间点），
  「端到端」按各段请求串行累计 + 400ms 段间留白估计；真实浏览器里后续段
  在首段播放期间并行预取，实际端到端会落在 [首响+播放时长, 串行累计] 区间。

用法（需先启动 :5002 / :5001 / :3000）：

    E:\\heartflow-voice\\venv-qwen\\Scripts\\python.exe ^
      voice\\character_voices\\eval\\e2e_s2.py --text "稍微休息一下也没关系的，我会在这里陪着你。"

产物落在 eval/out/s2_e2e/（已 gitignore），不入库。
"""
import argparse
import array
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
import wave
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SEG_MODULE = os.path.join(ROOT, "public", "modules", "voice", "speech-segments.js")
OUT = os.path.join(HERE, "out", "s2_e2e")

API = os.environ.get("HEARTFLOW_TTS_URL", "http://127.0.0.1:3000/api/tts")
HEALTH_5002 = "http://127.0.0.1:5002/health"
DEFAULT_TEXT = "稍微休息一下也没关系的，我会在这里陪着你。"
WARMUP_TEXT = "你好。"


def log(msg):
    print("[s2-e2e] %s %s" % (time.strftime("%H:%M:%S"), msg), flush=True)


def health():
    with urllib.request.urlopen(HEALTH_5002, timeout=10) as r:
        data = json.load(r)
    hit = [c for c in data.get("characters", []) if c.get("id") == "char_shinobu"]
    if not hit:
        raise SystemExit(":5002/health 未返回 char_shinobu")
    return {"modelReady": data.get("modelReady"), "loaded": data.get("loaded"),
            "ref": hit[0].get("ref"), "language": hit[0].get("language"),
            "refReady": hit[0].get("refReady")}


def split_by_production_module(text):
    """调用生产 JS 模块拿分段结果，避免 Python 侧口径漂移。"""
    # 用 pathToFileURL 把绝对路径转成 file:// URL，再动态 import 生产模块
    js = (
        "import('node:url').then(u => import(u.pathToFileURL(process.env.S2_MODULE).href))"
        ".then(m => console.log(JSON.stringify({"
        "segments: m.splitSpeechSegments(process.env.S2_TEXT), "
        "enabled: m.shouldUseSegmentedSpeech(process.env.S2_TEXT, 'character')"
        "})))"
    )
    env = dict(os.environ, S2_MODULE=SEG_MODULE, S2_TEXT=text)
    proc = subprocess.run(["node", "--input-type=module", "-e", js],
                          capture_output=True, text=True, env=env, timeout=20)
    if proc.returncode != 0:
        raise SystemExit("调用 speech-segments.js 失败：%s" % proc.stderr.strip())
    return json.loads(proc.stdout.strip())


def wav_info(data):
    """校验 WAV 并给出时长 / RMS，纯标准库实现。"""
    import io
    with wave.open(io.BytesIO(data), "rb") as w:
        nch, width, sr, nframes = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(nframes)
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("不是 RIFF/WAVE")
    if width != 2:
        raise ValueError("采样位深非 16bit: %d" % width)
    samples = array.array("h")
    samples.frombytes(raw)
    if len(samples) == 0:
        raise ValueError("空音频")
    rms = (sum(s * s for s in samples) / len(samples)) ** 0.5 / 32768.0
    return {"sampleRate": sr, "channels": nch, "audioSec": round(nframes / sr, 2),
            "bytes": len(data), "rms": round(rms, 4)}


def request_tts(text, voice, engine="character", timeout=240):
    payload = json.dumps({"text": text, "engine": engine, "voice": voice, "speed": 1}).encode("utf-8")
    req = urllib.request.Request(API, data=payload, method="POST",
                                 headers={"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
        headers = dict(r.headers.items())
    elapsed = time.time() - t0
    if not body:
        raise RuntimeError("响应为空")
    info = wav_info(body)
    return {"elapsedSec": round(elapsed, 2), "httpStatus": 200,
            "xTtsEngine": headers.get("X-Tts-Engine"),
            "xTtsLatencyMs": headers.get("X-Tts-Latency-Ms"),
            "contentLength": headers.get("Content-Length"),
            **info, "wav": body}


def main():
    ap = argparse.ArgumentParser(description="S2 整句 vs 分段端到端对照")
    ap.add_argument("--text", default=DEFAULT_TEXT, help="对照用中文长句")
    ap.add_argument("--voice", default="char_shinobu", help="角色音色 id")
    ap.add_argument("--no-warmup", action="store_true", help="跳过模型预热（首次加载会计入 A）")
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    cfg = health()
    log("当前生产配置（:5002/health）：ref=%s / language=%s / refReady=%s / loaded=%s"
        % (cfg["ref"], cfg["language"], cfg["refReady"], cfg["loaded"]))
    if cfg["language"] != "Chinese" or "shinobu_sleep_ref.wav" not in (cfg["ref"] or ""):
        log("⚠ 当前服务不是最新蝴蝶忍音色，结果仅作链路验证，不代表新音色")

    seg = split_by_production_module(args.text)
    log("生产模块分段：enabled=%s / %d 段 %s"
        % (seg["enabled"], len(seg["segments"]), seg["segments"]))
    if not seg["enabled"]:
        raise SystemExit("该文本不触发 S2 分段，换一句更长的中文")

    if not args.no_warmup:
        log("预热（加载 4.3GB 权重，不计入对照）...")
        w = request_tts(WARMUP_TEXT, args.voice)
        log("预热完成 %.2fs / 音频 %.2fs / engine=%s" % (w["elapsedSec"], w["audioSec"], w["xTtsEngine"]))

    log("A · 整句一次请求 ...")
    a = request_tts(args.text, args.voice)
    with open(os.path.join(OUT, "A_full.wav"), "wb") as f:
        f.write(a.pop("wav"))
    log("A 完成 %.2fs / 音频 %.2fs / engine=%s" % (a["elapsedSec"], a["audioSec"], a["xTtsEngine"]))

    log("B · S2 分段队列（%d 段，段间 400ms）..." % len(seg["segments"]))
    b_segments = []
    for idx, seg_text in enumerate(seg["segments"], 1):
        r = request_tts(seg_text, args.voice)
        with open(os.path.join(OUT, "B_seg%d.wav" % idx), "wb") as f:
            f.write(r.pop("wav"))
        r["index"], r["text"] = idx, seg_text
        b_segments.append(r)
        log("  段%d %.2fs / 音频 %.2fs / %s" % (idx, r["elapsedSec"], r["audioSec"], seg_text))

    gap_sec = 0.4 * (len(b_segments) - 1)
    first = b_segments[0]["elapsedSec"]
    req_total = round(sum(r["elapsedSec"] for r in b_segments), 2)
    play_total = round(sum(r["audioSec"] for r in b_segments) + gap_sec, 2)
    b = {"firstAudioSec": first, "allRequestsSec": req_total,
         "audioPlaybackSec": play_total,
         "e2eEstimateSec": round(max(first + play_total - b_segments[0]["audioSec"], req_total + gap_sec), 2),
         "gapMs": 400, "segments": b_segments}
    delta = round((a["elapsedSec"] - first) / a["elapsedSec"] * 100, 1)

    result = {"generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
              "text": args.text, "voice": args.voice, "engine": "character",
              "production": cfg, "segmentSpec": {"source": "public/modules/voice/speech-segments.js",
                                                  "enabled": seg["enabled"], "count": len(seg["segments"])},
              "A": a, "B": b, "firstAudioImprovementPct": delta}
    with open(os.path.join(OUT, "results.json"), "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print("\n=== S2 端到端对照（%s / %s）===" % (args.voice, cfg["language"]))
    print("  A 整句：首响 = 播完 = %.2fs，音频 %.2fs，1 次请求" % (a["elapsedSec"], a["audioSec"]))
    print("  B 分段：首响 %.2fs，%d 次请求累计 %.2fs，音频播放 %.2fs（含 400ms×%d 留白）"
          % (first, len(b_segments), req_total, play_total, len(b_segments) - 1))
    print("  首响改善：%.2fs → %.2fs（−%.1f%%）；端到端估计 %.2fs（A %.2fs）"
          % (a["elapsedSec"], first, delta, b["e2eEstimateSec"], a["elapsedSec"]))
    print("  WAV 校验：A sr=%d rms=%.4f；B 各段 sr=%s rms=%s；X-Tts-Engine=%s"
          % (a["sampleRate"], a["rms"],
             sorted({r["sampleRate"] for r in b_segments}),
             [r["rms"] for r in b_segments], a["xTtsEngine"]))
    print("  产物：%s" % OUT)


if __name__ == "__main__":
    main()
