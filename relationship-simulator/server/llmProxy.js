import {
  LLM_API_KEY,
  LLM_API_MODE,
  LLM_ENDPOINT,
  LLM_MAX_COMPLETION_TOKENS,
  LLM_MODEL,
  LLM_REASONING_EFFORT,
  LLM_TEMPERATURE,
  LLM_TOP_P
} from "./config.js";
import { checkRateLimit } from "./rateLimit.js";
import { readRequestJson, resolveCorsOrigin, RequestBodyTooLargeError, sendJson } from "./staticServer.js";

const UPSTREAM_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 400;
const MAX_ATTEMPTS = 2; // 首次 + 1 次重试

/** 对瞬时故障（网络错误或 5xx）重试一次，4xx/超时不重试。 */
export async function fetchWithRetry(endpoint, options, { attempts = MAX_ATTEMPTS, delayMs = RETRY_DELAY_MS, fetchImpl = fetch } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetchImpl(endpoint, options);
      if (res.status >= 500) {
        lastError = new Error(`upstream ${res.status}`);
        if (attempt >= attempts) break;
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
        continue;
      }
      return res;
    } catch (err) {
      const aborted = err?.name === "AbortError" || err?.name === "TimeoutError";
      if (aborted || attempt >= attempts) throw err;
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastError || new Error("upstream request failed");
}

/**
 * 处理 POST /api/chat。
 * @param {object} options.serverApiKey 服务端 .env 密钥；默认取 config 的 LLM_API_KEY。
 *   测试可通过该参数模拟"服务端未配置密钥"分支（.env 存在时 import 期即固化，无法从环境改）。
 */
export async function handleChat(req, res, { serverApiKey = LLM_API_KEY } = {}) {
  const clientIp = req.socket?.remoteAddress || "unknown";
  if (!checkRateLimit(clientIp)) return sendJson(res, 429, { error: "rate_limited", message: "请求过于频繁，请稍后再试。" });

  let body;
  try {
    body = await readRequestJson(req);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError || err?.code === "BODY_TOO_LARGE") {
      return sendJson(res, 413, { error: "payload_too_large", message: "请求体超过 2MB 限制。" });
    }
    return sendJson(res, 400, { error: "invalid_json", message: "请求体不是合法 JSON。" });
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) return sendJson(res, 400, { error: "bad_request", message: "`messages` 必须是非空数组。" });
  if (messages.length > 200) return sendJson(res, 400, { error: "bad_request", message: "`messages` 最多 200 条。" });
  if (!serverApiKey && !body.apiKey) {
    return sendJson(res, 400, { error: "missing_api_key", message: "请在 .env 中配置 LLM_API_KEY，或在请求体中传 apiKey。建议使用 .env。" });
  }

  const apiKey = body.apiKey || serverApiKey;
  const clampNum = (value, min, max, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  const maxOutputTokens = clampNum(body.max_output_tokens ?? body.max_completion_tokens, 1, 4096, LLM_MAX_COMPLETION_TOKENS);
  const temperature = clampNum(body.temperature, 0, 2, LLM_TEMPERATURE);
  const topP = clampNum(body.top_p, 0, 1, LLM_TOP_P);
  const reasoningEffort = ["low", "medium", "high"].includes(body.reasoning_effort) ? body.reasoning_effort : LLM_REASONING_EFFORT;

  const upstreamPayload = { model: LLM_MODEL, temperature, top_p: topP, stream: false };
  if (LLM_API_MODE === "responses") {
    upstreamPayload.input = messages;
    upstreamPayload.max_output_tokens = maxOutputTokens;
    upstreamPayload.reasoning = { effort: reasoningEffort };
    upstreamPayload.store = false;
  } else {
    upstreamPayload.messages = messages;
    upstreamPayload.max_completion_tokens = maxOutputTokens;
  }
  if (body.response_format && typeof body.response_format === "object") {
    if (LLM_API_MODE === "responses") upstreamPayload.text = { format: body.response_format };
    else upstreamPayload.response_format = body.response_format;
  }
  if (Array.isArray(body.stop) && body.stop.every((s) => typeof s === "string")) upstreamPayload.stop = body.stop.slice(0, 4);
  if (Number.isFinite(body.frequency_penalty)) upstreamPayload.frequency_penalty = clampNum(body.frequency_penalty, -2, 2, 0);
  if (Number.isFinite(body.presence_penalty)) upstreamPayload.presence_penalty = clampNum(body.presence_penalty, -2, 2, 0);

  let upstream;
  try {
    upstream = await fetchWithRetry(LLM_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify(upstreamPayload),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });
  } catch (err) {
    const aborted = err?.name === "AbortError" || err?.name === "TimeoutError";
    return sendJson(res, aborted ? 504 : 502, {
      error: aborted ? "upstream_timeout" : "upstream_unreachable",
      message: aborted ? `上游模型响应超时（${UPSTREAM_TIMEOUT_MS / 1000}s）。` : "无法连接上游模型服务。"
    });
  }

  const text = await upstream.text();
  const contentType = upstream.headers.get("content-type") || "";
  const corsOrigin = resolveCorsOrigin(req.headers?.origin);

  if (upstream.status >= 400) {
    let upstreamMessage = text;
    try {
      const parsed = JSON.parse(text);
      upstreamMessage = parsed?.error?.message || parsed?.message || text;
    } catch {
      // 非 JSON 错误体按原文透出。
    }
    const upstreamStatus = upstream.status;
    return sendJson(res, 502, {
      error: "upstream_error",
      upstreamStatus,
      message: `上游模型服务返回 ${upstreamStatus}：${String(upstreamMessage).slice(0, 300)}`
    }, { "Access-Control-Allow-Origin": corsOrigin });
  }

  const payload = normalizeProxyResponse(text, contentType);
  res.writeHead(upstream.status, {
    "Content-Type": contentType || "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": corsOrigin
  });
  res.end(payload);
}

export function normalizeProxyResponse(text, contentType) {
  if (!/application\/json/i.test(contentType)) return text;
  try {
    const parsed = JSON.parse(text);
    if (LLM_API_MODE !== "responses") return text;
    const content = extractModelContent(parsed);
    if (!content) return text;
    return JSON.stringify({
      ...parsed,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      output_text: content
    }, null, 2);
  } catch {
    return text;
  }
}

export function extractModelContent(json) {
  if (!json || typeof json !== "object") return "";
  if (typeof json.output_text === "string" && json.output_text.trim()) return json.output_text.trim();
  const output = Array.isArray(json.output) ? json.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    for (const content of item.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string" && content.text.trim()) return content.text.trim();
    }
  }
  const choice = json?.choices?.[0];
  const choiceContent = choice?.message?.content || choice?.text || "";
  return typeof choiceContent === "string" ? choiceContent.trim() : "";
}
