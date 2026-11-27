# -*- coding: utf-8 -*-
"""本地假上游：用于验证 /api/chat 转发逻辑，不消耗任何真实额度。

用法：python tests/fake_upstream.py [端口]

路由：
  POST .../chat/completions  回显最后一条消息、Authorization 与 model
  POST .../responses         返回 Responses 结构的 output_text
  POST .../fail              恒返回 500
另外：最后一条消息内容为 ``__FAKE_FAIL__`` 时也返回 500，
便于在同一个实例上验证「上游 5xx → 502」分支。
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3300


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _send(self, status, payload, ctype="application/json"):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            body = {}

        if self.path.endswith("/responses"):
            self._send(
                200,
                {
                    "id": "resp_fake",
                    "object": "response",
                    "output": [
                        {
                            "type": "message",
                            "content": [
                                {"type": "output_text", "text": "responses 模式回复"}
                            ],
                        }
                    ],
                },
            )
            return

        if self.path.endswith("/fail"):
            self._send(500, {"error": {"message": "fake upstream failure"}})
            return

        # 回显请求里最后一条消息，便于确认转发内容正确
        last = ""
        msgs = body.get("messages") or []
        if msgs:
            last = msgs[-1].get("content", "")

        if last == "__FAKE_FAIL__":
            self._send(500, {"error": {"message": "fake upstream failure"}})
            return

        self._send(
            200,
            {
                "id": "chatcmpl_fake",
                "object": "chat.completion",
                # 回显鉴权头，用于验证 C 服务把密钥转发给了上游
                "auth": self.headers.get("Authorization", ""),
                "model": body.get("model", ""),
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "本地假上游回复：%s" % last},
                        "finish_reason": "stop",
                    }
                ],
            },
        )

    def do_GET(self):
        self._send(200, {"ok": True})


if __name__ == "__main__":
    print("fake upstream on :%d" % PORT)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
