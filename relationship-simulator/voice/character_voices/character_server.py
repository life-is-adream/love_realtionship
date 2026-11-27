#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""角色音色 sidecar（127.0.0.1:5002）。

用 Qwen3-TTS-12Hz-1.7B-Base 的零样本音色克隆，把一段 3–10 秒的角色原声
变成可念任意文本的音色。与 voice/tts_server.py 分工：

  C 服务 :3000  ->  voice/tts_server.py :5001（引擎 character）
                ->  character_server.py :5002（本进程，独占 GPU 的 Qwen 权重）

为什么独立进程：qwen_tts 只装在 E:\\heartflow-voice\\venv-qwen（Python 3.10），
主 sidecar 跑在 venv-chattts，不能 import；且 1.7B bf16 占约 4.3GB 显存，
与 ChatTTS 同驻会挤爆 6GB 的 RTX 3060 Laptop。

模型按需懒加载，启动不占显存；每个角色的 voice_clone_prompt 只编码一次并缓存。
仅绑定 127.0.0.1，不联网、不上传任何文本或音频。

非商用声明：角色语音版权归原版权方；本服务仅供本机个人学习与研究使用。
"""
import argparse
import io
import json
import os
import threading
import time
import traceback
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "characters.json")
HOST = "127.0.0.1"
PORT = int(os.environ.get("HEARTFLOW_CHAR_TTS_PORT", "5002"))
MAX_TEXT = 300

with open(CONFIG_PATH, "r", encoding="utf-8") as _f:
    CFG = json.load(_f)

CHARS = {item["id"]: item for item in CFG["characters"]}
MODEL_ROOT = os.environ.get("HEARTFLOW_QWEN_MODEL_DIR", CFG.get("modelRoot", r"E:\heartflow-voice\models\qwen"))
MODEL_NAME = CFG.get("model", "Qwen3-TTS-12Hz-1.7B-Base")

_model = None
_prompts = {}
_lock = threading.Lock()
started_at = time.time()


def log(message):
    print("[character-tts] %s %s" % (time.strftime("%Y-%m-%d %H:%M:%S"), message), flush=True)


def ref_path(item):
    path = item.get("ref", "")
    return path if os.path.isabs(path) else os.path.join(HERE, path)


def model_dir():
    return os.path.join(MODEL_ROOT, MODEL_NAME)


def model_ready():
    return os.path.isfile(os.path.join(model_dir(), "model.safetensors"))


def load_model():
    """懒加载 1.7B Base（bf16 + sdpa）。fp16 在本机会触发 CUDA device-side assert。"""
    global _model
    if _model is None:
        if not model_ready():
            raise FileNotFoundError("找不到 Qwen3-TTS Base 权重：%s" % model_dir())
        import torch
        from qwen_tts import Qwen3TTSModel

        log("加载 %s（bf16 + sdpa / cuda:0）..." % MODEL_NAME)
        torch.cuda.empty_cache()
        started = time.time()
        _model = Qwen3TTSModel.from_pretrained(
            model_dir(), device_map="cuda:0", dtype=torch.bfloat16,
            attn_implementation="sdpa")
        log("模型就绪，耗时 %.1fs" % (time.time() - started))
    return _model


def get_prompt(char_id, item):
    """一次编码参考音频，之后复用；ICL 模式需要真实转写，x-vector 模式不需要。"""
    if char_id not in _prompts:
        path = ref_path(item)
        if not os.path.isfile(path):
            raise FileNotFoundError(
                "角色 %s 缺少参考音频：%s。请用 prepare_ref.py 生成，或查看 voice/character_voices/README.md。"
                % (char_id, path))
        model = load_model()
        xvec_only = bool(item.get("xVectorOnly"))
        log("编码音色 prompt：%s（x_vector_only=%s）" % (char_id, xvec_only))
        _prompts[char_id] = model.create_voice_clone_prompt(
            ref_audio=path,
            ref_text=None if xvec_only else (item.get("refText") or None),
            x_vector_only_mode=xvec_only)
    return _prompts[char_id]


def synthesize(char_id, text):
    model = load_model()
    item = CHARS[char_id]
    prompt = get_prompt(char_id, item)
    wavs, sr = model.generate_voice_clone(
        text=text, language=item.get("language", "Chinese"),
        voice_clone_prompt=prompt)
    import numpy as np

    audio = np.asarray(wavs[0], dtype=np.float32).reshape(-1)
    return audio, int(sr)


def to_wav(audio, sample_rate):
    import numpy as np

    pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm.tobytes())
    return buffer.getvalue()


def health_payload():
    chars = []
    for char_id, item in CHARS.items():
        chars.append({
            "id": char_id,
            "label": item.get("label", char_id),
            "language": item.get("language"),
            "refReady": os.path.isfile(ref_path(item)),
            "ref": item.get("ref"),
            "source": item.get("source"),
            "license": item.get("license"),
        })
    return {
        "ok": True,
        "model": MODEL_NAME,
        "modelReady": model_ready(),
        "loaded": _model is not None,
        "characters": chars,
        "port": PORT,
        "uptimeSec": round(time.time() - started_at, 1),
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        log("%s %s" % (self.address_string(), fmt % args))

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/health", "/health/"):
            return self._json(200, health_payload())
        return self._json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path not in ("/tts", "/tts/"):
            return self._json(404, {"error": "not_found"})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 64 * 1024:
            return self._json(413, {"error": "payload_invalid", "message": "请求体为空或过大。"})
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            return self._json(400, {"error": "invalid_json"})
        text = str(payload.get("text") or "").strip()
        if not text:
            return self._json(400, {"error": "bad_request", "message": "`text` 不能为空。"})
        if len(text) > MAX_TEXT:
            return self._json(400, {"error": "text_too_long", "message": "单次最多 %d 字。" % MAX_TEXT})
        char_id = str(payload.get("voice") or "")
        if char_id not in CHARS:
            return self._json(400, {"error": "unknown_voice", "message": "未知角色音色：%s" % char_id})
        if not model_ready():
            return self._json(503, {"error": "model_unavailable",
                                    "message": "Qwen3-TTS Base 权重缺失：%s" % model_dir()})
        if not os.path.isfile(ref_path(CHARS[char_id])):
            return self._json(409, {"error": "reference_missing",
                                    "message": "角色 %s 缺少参考音频 %s，请用 voice/character_voices/prepare_ref.py 生成。"
                                               % (char_id, CHARS[char_id].get("ref"))})
        try:
            with _lock:
                started = time.time()
                audio, sample_rate = synthesize(char_id, text)
            want_pcm = payload.get("format") == "pcm"
            if want_pcm:
                body = audio.astype("<f4").tobytes()
                content_type = "application/octet-stream"
            else:
                body = to_wav(audio, sample_rate)
                content_type = "audio/wav"
            log("合成 %s / %d 字 / %.1fs -> %.1fs 音频 @ %dHz"
                % (char_id, len(text), time.time() - started,
                   len(audio) / max(sample_rate, 1), sample_rate))
        except Exception as error:  # noqa: BLE001 - 任何推理失败都回报给调用方
            traceback.print_exc()
            return self._json(500, {"error": "synthesis_failed",
                                    "message": "%s: %s" % (type(error).__name__, str(error)[:200])})
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Tts-Sample-Rate", str(sample_rate))
        self.send_header("X-Tts-Engine", "character")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=PORT)
    args = parser.parse_args()
    log("角色音色服务启动：http://%s:%d（仅本机）" % (HOST, args.port))
    log("Qwen3-TTS Base 权重：%s（%s）" % (model_dir(), "已就绪" if model_ready() else "缺失"))
    for char_id, item in CHARS.items():
        log("  %-16s %s  参考音频：%s"
            % (char_id, item.get("label", ""),
               "就绪" if os.path.isfile(ref_path(item)) else "缺失（音色不可选）"))
    log("非商用：角色语音版权归原版权方，仅限本机个人学习与研究。")
    server = ThreadingHTTPServer((HOST, args.port), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
