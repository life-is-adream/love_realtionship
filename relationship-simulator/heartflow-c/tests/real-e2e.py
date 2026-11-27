# -*- coding: utf-8 -*-
"""真实模型端到端验证（手动运行，不纳入 tests/run-all.sh）。

为什么单独放：run-all.sh 全部用假上游/假推理后端，可在任何机器、零费用、
零 GPU 地跑；本脚本必须有本地语音权重，可选的那一步还会产生 LLM 计费。

前置条件
--------
1. 启动真实语音 sidecar（双击项目根目录「启动语音服务.cmd」，或手动）：
     E:\\heartflow-voice\\venv-chattts\\Scripts\\python.exe voice\\tts_server.py
   等 /health 里 chattts.status == "ready"（首次约 25 秒、显存约 1.1 GB）。
2. 启动 C 服务：
     cd heartflow-c && ./hf.exe serve --port 3000 --root ..
3. 运行：
     python tests/real-e2e.py                    # 只跑本地 TTS，免费
     python tests/real-e2e.py --with-llm        # 额外发 1 次最小 LLM 请求（会计费）

--with-llm 只发一条 16 字以内的消息、max_completion_tokens=64、
thinking=disabled，用于确认 C 侧转发能拿到非空正文。

验证内容：/api/health、/api/tts/health、离线与在线音色真实合成、
WAV 结构与信号有效性、X-Tts-* 响应头透传；音频样本写入 --out 供人工试听。

在线引擎（edge）默认零注册、零联网。脚本会通过 /api/tts/online 运行时打开它
（等价于用户在设置面板点了「启用在线语音」），跑完再关回去，
验证「默认离线 → 显式同意 → 恢复离线」的完整链路，无需设环境变量或重启服务。
"""
import argparse
import io
import json
import math
import os
import struct
import sys
import time
import urllib.error
import urllib.request
import wave

DEFAULT_BASE = "http://127.0.0.1:3000"
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".e2e-out")

# 含全角括号、emoji、省略号、分号、半角问号：用来触发 C 侧文本清洗
TTS_TEXT = "（轻轻笑）其实我有点难过😔……你别多想；好吗?"
TTS_CASES = [
    ("chattts", "chat_qingche", "chattts-qingche"),   # 离线兜底（纯本地默认）
    ("kokoro", None, "kokoro"),                        # CPU 兜底
    ("edge", "edge_wenrou", "edge-wenrou"),            # 听感验收通过 · 温柔自然
    ("edge", "edge_yuanqi", "edge-yuanqi"),            # 听感验收通过 · 元气明亮
]


def hget(headers, name):
    for key, val in headers.items():
        if key.lower() == name.lower():
            return val
    return None


def http(url, payload=None, timeout=200):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        url, data=data, method="POST" if payload is not None else "GET",
        headers={"Content-Type": "application/json"} if data else {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read(), dict(r.headers)


def inspect_wav(data):
    """返回 WAV 结构与信号统计；不是合法 WAV 时抛异常。"""
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("不是 RIFF/WAVE：%r" % data[:16])
    with wave.open(io.BytesIO(data), "rb") as w:
        n = w.getnframes()
        ch, bits, rate = w.getnchannels(), w.getsampwidth() * 8, w.getframerate()
        raw = w.readframes(n)
    if bits != 16 or n == 0:
        raise ValueError("位深/帧数异常：%d bit, %d frames" % (bits, n))
    pcm = struct.unpack("<%dh" % n, raw)
    peak = max(abs(x) for x in pcm)
    rms = math.sqrt(sum(x * x for x in pcm) / n)
    return {
        "channels": ch, "bits": bits, "rate": rate, "frames": n,
        "seconds": n / float(rate), "peak": peak, "rms": rms,
        "clipped": peak >= 32767,
    }


def main():
    ap = argparse.ArgumentParser(description="真实模型端到端验证")
    ap.add_argument("--base", default=DEFAULT_BASE, help="C 服务地址")
    ap.add_argument("--out", default=DEFAULT_OUT, help="音频样本输出目录")
    ap.add_argument("--with-llm", action="store_true", help="额外发 1 次最小 LLM 请求（会计费）")
    ap.add_argument("--engine", default=None, help="只测指定引擎（chattts / kokoro / edge）")
    args = ap.parse_args()

    passed = failed = 0

    def ok(name, cond, detail=""):
        nonlocal passed, failed
        if cond:
            passed += 1
            print("  PASS  %-38s %s" % (name, detail))
        else:
            failed += 1
            print("  FAIL  %-38s %s" % (name, detail))

    os.makedirs(args.out, exist_ok=True)
    print("\n真实模型端到端验证  服务=%s  样本=%s" % (args.base, os.path.abspath(args.out)))
    print("=" * 72)

    # ---------- 1. 服务与引擎状态 ----------
    try:
        _, raw, _ = http(args.base + "/api/health", timeout=10)
        health = json.loads(raw)
        ok("C 服务 /api/health", health.get("ok") is True,
           "model=%s hasApiKey=%s" % (health.get("model"), health.get("hasApiKey")))
    except Exception as e:
        print("  C 服务不可用，请先启动 hf.exe serve：%s" % e)
        return 1

    try:
        s, raw, _ = http(args.base + "/api/tts/health", timeout=10)
        tts = json.loads(raw)
        engines = tts.get("engines", {})
        default_engine = tts.get("defaultEngine")
        ready = [k for k, v in engines.items() if v.get("status") == "ready"]
        ok("/api/tts/health 透传", s == 200 and tts.get("ok") is True,
           "default=%s ready=%s" % (default_engine, ",".join(ready) or "无"))
        dev = (engines.get("chattts") or {}).get("device")
        ok("ChatTTS 引擎就绪", "chattts" in ready,
           "device=%s loadSec=%s" % (dev, (engines.get("chattts") or {}).get("loadSec")))
        online = engines.get("edge")
        if online:
            ok("在线引擎显式标注 online", online.get("online") is True,
               "status=%s model=%s" % (online.get("status"), online.get("model")))
        else:
            print("  提示  edge 默认未注册（符合预期），下面将用运行时开关打开")
    except Exception as e:
        print("  语音 sidecar 不可用，请先运行「启动语音服务.cmd」：%s" % e)
        return 1

    # ---------- 1.5 一键开关：默认离线 → 显式同意 → 可合成 ----------
    opened_here = False
    if "edge" not in engines:
        try:
            _, raw, _ = http(args.base + "/api/tts/online", timeout=10)
            before = json.loads(raw)
            ok("在线开关默认关闭", before.get("enabled") is False, repr(before))
            s, raw, _ = http(args.base + "/api/tts/online", {"enabled": True}, timeout=10)
            after = json.loads(raw)
            ok("POST 开关启用在线", s == 200 and after.get("enabled") is True, repr(after))
            opened_here = True
            _, raw, _ = http(args.base + "/api/tts/health", timeout=10)
            engines = json.loads(raw).get("engines", {})
            ok("启用后 health 出现 edge", "edge" in engines, ",".join(engines))
        except Exception as e:
            ok("在线语音运行时开关", False, "%s: %s" % (type(e).__name__, e))

    # ---------- 2. 各引擎/音色真实合成 ----------
    for engine, voice, tag in TTS_CASES:
        if args.engine and engine != args.engine:
            continue
        if engine not in engines:
            print("  SKIP  %-38s 引擎未注册（在线引擎需 HEARTFLOW_TTS_ALLOW_ONLINE=1）" % tag)
            continue
        payload = {"text": TTS_TEXT, "engine": engine, "speed": 1.0}
        if voice:
            payload["voice"] = voice
        t0 = time.time()
        try:
            s, data, hdrs = http(args.base + "/api/tts", payload)
        except urllib.error.HTTPError as e:
            ok("%s 真实合成" % tag, False, "HTTP %d %s" % (e.code, e.read()[:200]))
            continue
        except Exception as e:
            ok("%s 真实合成" % tag, False, "%s: %s" % (type(e).__name__, e))
            continue
        elapsed = time.time() - t0
        ok("%s 真实合成 HTTP 200" % tag, s == 200, "%.2fs %d 字节" % (elapsed, len(data)))
        try:
            w = inspect_wav(data)
        except Exception as e:
            ok("%s 返回合法 WAV" % tag, False, str(e))
            continue
        ok("%s WAV 格式" % tag,
           w["channels"] == 1 and w["bits"] == 16 and w["rate"] == 24000,
           "%dch/%dbit/%dHz" % (w["channels"], w["bits"], w["rate"]))
        ok("%s 音频非空且未削波" % tag,
           0.3 <= w["seconds"] <= 60 and w["rms"] > 200 and not w["clipped"],
           "%.2fs rms=%.0f peak=%d" % (w["seconds"], w["rms"], w["peak"]))
        ok("%s 透传 X-Tts-Engine" % tag, hget(hdrs, "X-Tts-Engine") == engine,
           repr(hget(hdrs, "X-Tts-Engine")))
        ok("%s 透传 X-Tts-Latency-Ms" % tag,
           (hget(hdrs, "X-Tts-Latency-Ms") or "").isdigit(),
           repr(hget(hdrs, "X-Tts-Latency-Ms")))
        path = os.path.join(args.out, "%s.wav" % tag)
        with open(path, "wb") as f:
            f.write(data)
        print("         样本已保存：%s" % os.path.abspath(path))

    # ---------- 3. 可选：真实 LLM（唯一产生费用的步骤） ----------
    if args.with_llm:
        payload = {
            "messages": [{"role": "user", "content": "请只回复两个字：收到"}],
            "max_completion_tokens": 64,
            "thinking": {"type": "disabled"},
        }
        t0 = time.time()
        try:
            s, raw, _ = http(args.base + "/api/chat", payload, timeout=90)
            d = json.loads(raw)
            ch = (d.get("choices") or [{}])[0]
            content = (ch.get("message") or {}).get("content") or ""
            usage = d.get("usage") or {}
            ok("真实 LLM 返回非空正文", s == 200 and bool(content.strip()),
               "%.2fs content=%r finish=%s tokens=%s" %
               (time.time() - t0, content[:40], ch.get("finish_reason"), usage.get("total_tokens")))
        except urllib.error.HTTPError as e:
            ok("真实 LLM 返回非空正文", False, "HTTP %d %s" % (e.code, e.read()[:200]))
        except Exception as e:
            ok("真实 LLM 返回非空正文", False, "%s: %s" % (type(e).__name__, e))

    # ---------- 4. 复位：把开关关回去，验证默认纯离线能恢复 ----------
    if opened_here:
        try:
            s, raw, _ = http(args.base + "/api/tts/online", {"enabled": False}, timeout=10)
            _, hraw, _ = http(args.base + "/api/tts/health", timeout=10)
            names = json.loads(hraw).get("engines", {})
            ok("关闭后恢复纯离线", s == 200 and "edge" not in names, ",".join(names))
        except Exception as e:
            ok("关闭后恢复纯离线", False, "%s: %s" % (type(e).__name__, e))

    print("=" * 72)
    print("结果：%d 通过，%d 失败" % (passed, failed))
    if not args.with_llm:
        print("（本次未测 LLM；加 --with-llm 会发 1 次最小计费请求）")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
