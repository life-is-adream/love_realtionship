import { RequestBodyTooLargeError, readRequestJson, sendJson } from "./http.js";

/** 本地 TTS sidecar（voice/tts_server.py，仅绑定 127.0.0.1）。 */
const TTS_BASE = process.env.TTS_SERVICE_URL || "http://127.0.0.1:5001";
// ChatTTS 首次请求可能要现场加载权重（GPU 约 20s）+ 合成，故给足 150s。
const TTS_TIMEOUT_MS = Number(process.env.TTS_TIMEOUT_MS) || 150_000;
const MAX_TEXT_LENGTH = 300;
const ENGINES = new Set(["chattts", "kokoro", "character"]);

const UNAVAILABLE_MESSAGE = "本地语音服务未启动：请双击项目根目录的「启动语音服务.cmd」（ChatTTS 用 E:\\heartflow-voice\\venv-chattts，Kokoro 用 voice/venv）。";

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException("TTS timed out", "TimeoutError")), TTS_TIMEOUT_MS);
  timeout.unref?.();
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * GET /api/tts/health：透传 sidecar 健康状态。
 * @param {import("node:http").ServerResponse} res
 */
export async function handleTtsHealth(res) {
  try {
    const upstream = await fetchWithTimeout(`${TTS_BASE}/health`, { method: "GET" });
    const json = await upstream.json().catch(() => ({}));
    return sendJson(res, upstream.ok ? 200 : 503, json);
  } catch {
    return sendJson(res, 503, { ok: false, error: "tts_unavailable", message: UNAVAILABLE_MESSAGE });
  }
}

/**
 * POST /api/tts：body {text, voice?, speed?}，返回 audio/wav。
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
export async function handleTts(req, res) {
  let body;
  try {
    body = await readRequestJson(req);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return sendJson(res, 413, { error: "payload_too_large", message: "请求体超过 2MB 限制。" });
    }
    return sendJson(res, 400, { error: "invalid_json", message: "请求体不是合法 JSON。" });
  }
  const text = String(body.text || "").trim();
  if (!text) return sendJson(res, 400, { error: "bad_request", message: "`text` 不能为空。" });
  if (text.length > MAX_TEXT_LENGTH) {
    return sendJson(res, 400, { error: "text_too_long", message: `单次最多 ${MAX_TEXT_LENGTH} 字。` });
  }
  const voice = typeof body.voice === "string" && body.voice.trim() ? body.voice.trim() : undefined;
  const speed = Number(body.speed);
  const engine = typeof body.engine === "string" && ENGINES.has(body.engine) ? body.engine : undefined;

  let upstream;
  try {
    upstream = await fetchWithTimeout(`${TTS_BASE}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        engine,
        voice,
        speed: Number.isFinite(speed) ? speed : undefined
      })
    });
  } catch {
    return sendJson(res, 503, { error: "tts_unavailable", message: UNAVAILABLE_MESSAGE });
  }
  if (!upstream.ok) {
    const detail = await upstream.json().catch(() => ({}));
    return sendJson(res, upstream.status === 503 ? 503 : 502, {
      error: detail.error || "tts_upstream_error",
      message: detail.message || `语音服务返回 ${upstream.status}。`
    });
  }
  const buffer = Buffer.from(await upstream.arrayBuffer());
  const headers = {
    "Content-Type": "audio/wav",
    "Content-Length": buffer.length,
    "Cache-Control": "no-store"
  };
  const usedEngine = upstream.headers.get("X-Tts-Engine");
  if (usedEngine) headers["X-Tts-Engine"] = usedEngine;
  res.writeHead(200, headers);
  return res.end(buffer);
}
