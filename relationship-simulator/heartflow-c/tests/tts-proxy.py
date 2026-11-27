# -*- coding: utf-8 -*-
"""/api/tts 的 C 侧接线回归：本地假推理后端，不加载任何模型。

覆盖：参数校验、文本清洗、语速钳制、engine 白名单、PCM→WAV 封装、
旧版 WAV 后端透传、health 代理。
算法本身的逐字节正确性由 tests/tts-parity.py 保证，这里只验证接线。

用法：python tests/tts-proxy.py [hf 端口] [假后端端口]
"""
import io
import json
import os
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
HF = os.path.abspath(os.path.join(HERE, "..", "hf.exe"))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3120
UP = int(sys.argv[2]) if len(sys.argv) > 2 else 3320

# 固定 float32 波形，作为「模型推理输出」
PCM = [0.2 if i % 2 else -0.2 for i in range(1024)]
LAST = {}
MODE = {"wav": False}   # True 时假后端模拟「旧版返回 WAV」
ONLINE = {"enabled": False}  # 模拟 sidecar 的运行时在线开关


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _send(self, status, data, ctype, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        for key, val in (extra or {}).items():
            self.send_header(key, val)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/setmode/wav"):
            MODE["wav"] = True
            self._send(200, b"{}", "application/json")
        elif self.path.startswith("/setmode/pcm"):
            MODE["wav"] = False
            self._send(200, b"{}", "application/json")
        elif self.path.startswith("/health"):
            self._send(200, json.dumps({"ok": True, "engine": "fake"}).encode(),
                       "application/json")
        elif self.path.startswith("/online"):
            self._send(200, json.dumps({"enabled": ONLINE["enabled"]}).encode(),
                       "application/json")
        elif self.path.startswith("/last"):
            self._send(200, json.dumps(LAST, ensure_ascii=False).encode("utf-8"),
                       "application/json")
        else:
            self._send(404, b"{}", "application/json")

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            body = {}
        # /online 是开关查询/切换，不是合成请求，不要污染 LAST
        if self.path.startswith("/online"):
            if not isinstance(body.get("enabled"), bool):
                self._send(400, b'{"error":"bad_request"}', "application/json")
                return
            ONLINE["enabled"] = body["enabled"]
            self._send(200, json.dumps({"ok": True, "enabled": ONLINE["enabled"]}).encode(),
                       "application/json")
            return

        LAST.clear()
        LAST.update(body)

        # 真实 sidecar 会带这两个头；C 侧应原样透传给调用方
        meta = {"X-Tts-Engine": "fake-kokoro", "X-Tts-Latency-Ms": "7"}
        if MODE["wav"]:
            # 模拟旧版后端：直接返回一个现成 WAV
            buf = io.BytesIO()
            with wave.open(buf, "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(24000)
                w.writeframes(b"\x11\x22" * 64)
            self._send(200, buf.getvalue(), "audio/wav", meta)
            return
        # 新版：返回 raw float32
        data = struct.pack("<%df" % len(PCM), *PCM)
        self._send(200, data, "application/octet-stream", meta)


class QuietServer(ThreadingHTTPServer):
    """WinHTTP 关闭 keep-alive 时 http.server 会打 ConnectionReset，属正常断连。"""
    daemon_threads = True

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


def hget(headers, name):
    """HTTP 头大小写不敏感查找。"""
    for key, val in headers.items():
        if key.lower() == name.lower():
            return val
    return None


def request(url, payload=None, method="GET"):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


def main():
    global PCM
    if not os.path.isfile(HF):
        print("找不到 %s，请先 sh build.sh" % HF)
        return 1

    server = QuietServer(("127.0.0.1", UP), Handler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()

    passed = failed = 0

    def ok(name, cond, detail=""):
        nonlocal passed, failed
        if cond:
            passed += 1
            print("  PASS  %s" % name)
        else:
            failed += 1
            print("  FAIL  %s  %s" % (name, detail))

    with tempfile.TemporaryDirectory(prefix="hf-tts-proxy-") as td:
        env = dict(os.environ)
        env["TTS_SERVICE_URL"] = "http://127.0.0.1:%d" % UP
        env.pop("LLM_API_KEY", None)
        proc = subprocess.Popen(
            [HF, "serve", "--port", str(PORT), "--root", td],
            stdout=open(os.path.join(td, "hf.log"), "wb"),
            stderr=subprocess.STDOUT, env=env)
        base = "http://127.0.0.1:%d" % PORT
        try:
            for _ in range(80):
                try:
                    request(base + "/api/health")
                    break
                except Exception:
                    time.sleep(0.1)

            print("\n/api/tts 接线回归  hf:%d  假后端:%d" % (PORT, UP))
            print("------------------------------------------")

            s, b, _ = request(base + "/api/tts", {"text": ""}, "POST")
            ok("空文本 400", s == 400 and b"bad_request" in b, "status=%d" % s)

            s, b, _ = request(base + "/api/tts", {"text": "啊" * 301}, "POST")
            ok("301 字 400", s == 400 and b"text_too_long" in b, "status=%d" % s)

            s, b, _ = request(base + "/api/tts/health")
            ok("health 代理 200", s == 200 and b'"ok": true' in b, "status=%d" % s)

            body = {"text": "（微笑）你好？还有一点点累；", "speed": 9.0, "engine": "evil"}
            s, wav, hdrs = request(base + "/api/tts", body, "POST")
            ok("PCM 模式 200", s == 200, "status=%d" % s)
            ok("返回 audio/wav", hdrs.get("Content-Type", "").startswith("audio/wav"),
               str(hdrs.get("Content-Type")))
            ok("WAV 魔数", wav[:4] == b"RIFF" and wav[8:12] == b"WAVE", repr(wav[:12]))
            ok("WAV 数据长度", len(wav) == 44 + len(PCM) * 2, "len=%d" % len(wav))
            ok("透传 X-Tts-Engine", hget(hdrs, "X-Tts-Engine") == "fake-kokoro",
               repr(hget(hdrs, "X-Tts-Engine")))
            ok("透传 X-Tts-Latency-Ms", hget(hdrs, "X-Tts-Latency-Ms") == "7",
               repr(hget(hdrs, "X-Tts-Latency-Ms")))

            _, last_raw, _ = request("http://127.0.0.1:%d/last" % UP)
            last = json.loads(last_raw.decode("utf-8"))
            ok("文本已在 C 侧清洗", last.get("text") == "你好。还有一点点累。",
               repr(last.get("text")))
            ok("请求 format=pcm", last.get("format") == "pcm", repr(last.get("format")))
            ok("语速钳制到 1.2", abs(last.get("speed", 0) - 1.2) < 1e-9,
               repr(last.get("speed")))
            ok("未知 engine 被丢弃", "engine" not in last, repr(last.get("engine")))

            # 在线引擎是 opt-in，但 C 侧白名单必须放行，否则前端选了会被静默丢弃
            s, _, _ = request(base + "/api/tts", {"text": "在线音色", "engine": "edge"}, "POST")
            _, last_raw, _ = request("http://127.0.0.1:%d/last" % UP)
            last = json.loads(last_raw.decode("utf-8"))
            ok("在线引擎白名单放行", s == 200 and last.get("engine") == "edge",
               "status=%d engine=%r" % (s, last.get("engine")))

            # /api/tts/online：只把「显式同意」这一个布尔转发给上游
            s, b, _ = request(base + "/api/tts/online")
            ok("在线开关 GET 默认关闭", s == 200 and json.loads(b).get("enabled") is False,
               "status=%d body=%r" % (s, b[:80]))
            s, b, _ = request(base + "/api/tts/online", {"enabled": True}, "POST")
            ok("在线开关 POST 启用", s == 200 and json.loads(b).get("enabled") is True,
               "status=%d body=%r" % (s, b[:80]))
            s, b, _ = request(base + "/api/tts/online", {"enabled": "yes"}, "POST")
            ok("在线开关拒绝非布尔", s == 400, "status=%d" % s)
            s, b, _ = request(base + "/api/tts/online", {"enabled": False}, "POST")
            ok("在线开关 POST 关闭", s == 200 and json.loads(b).get("enabled") is False,
               "status=%d body=%r" % (s, b[:80]))

            # 与 hf tts wav 对同一 PCM 的产物逐字节一致（封装接线正确）
            f32 = os.path.join(td, "p.f32")
            golden = os.path.join(td, "g.wav")
            with open(f32, "wb") as f:
                f.write(struct.pack("<%df" % len(PCM), *PCM))
            subprocess.run([HF, "tts", "wav", "--in", f32, "--out", golden],
                           capture_output=True, check=True)
            with open(golden, "rb") as f:
                want = f.read()
            ok("WAV 与 C 封装逐字节一致", wav == want,
               "got=%d want=%d" % (len(wav), len(want)))

            # 旧版后端（返回 WAV）应原样透传
            request("http://127.0.0.1:%d/setmode/wav" % UP)
            s, wav2, hdrs2 = request(base + "/api/tts", {"text": "旧后端"}, "POST")
            ok("旧 WAV 后端 200", s == 200, "status=%d" % s)
            ok("旧 WAV 透传不重写", wav2[:4] == b"RIFF" and wav2[44:48] == b"\x11\x22" * 2,
               repr(wav2[:48]))
            ok("旧 WAV 路径也透传引擎头", hget(hdrs2, "X-Tts-Engine") == "fake-kokoro",
               repr(hget(hdrs2, "X-Tts-Engine")))
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
            server.shutdown()

    print("\n结果：%d 通过，%d 失败\n" % (passed, failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
