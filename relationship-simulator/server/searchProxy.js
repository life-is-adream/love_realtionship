import {
  LLM_API_KEY,
  LLM_API_MODE,
  LLM_ENDPOINT,
  SEARCH_ALLOWED_DOMAINS,
  SEARCH_API_KEY,
  SEARCH_ENABLED,
  SEARCH_ENDPOINT,
  SEARCH_MODEL
} from "./config.js";
import { readRequestJson, RequestBodyTooLargeError, sendJson } from "./http.js";
import { withUpstreamRequest } from "./upstream-request.js";

const MAX_QUERY_LENGTH = 120;
const MAX_RESULTS = 5;
// 模型联网搜索：一轮搜索（多关键词并发）+ 摘要生成实测 20-60s，放宽到 90s。
const MODEL_SEARCH_TIMEOUT_MS = 90_000;

/** Only unambiguous absolute HTTP(S) links without embedded credentials. */
function safeSourceUrl(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!/^https?:\/\//i.test(text) || /[\s\\\u0000-\u001f\u007f]/.test(text)) return "";
  const authority = text.slice(text.indexOf("//") + 2).split(/[/?#]/, 1)[0];
  if (!authority || authority.includes("@")) return ""; // Includes empty userinfo such as https://@host.
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) return "";
    return url.href;
  } catch {
    return "";
  }
}

/**
 * 判断安全 URL 是否属于配置的来源域名白名单；不验证页面观点或证据。
 * @param {string} url
 * @returns {boolean}
 */
export function isAllowedSearchSource(url) {
  if (!SEARCH_ALLOWED_DOMAINS.length) return false;
  const safeUrl = safeSourceUrl(url);
  if (!safeUrl) return false;
  try {
    const hostname = new URL(safeUrl).hostname.toLowerCase();
    return SEARCH_ALLOWED_DOMAINS.some((domain) => {
      const clean = domain.replace(/^\./, "");
      return hostname === clean || hostname.endsWith(`.${clean}`);
    });
  } catch {
    return false;
  }
}

/**
 * 归一化外部搜索 API 的返回值为统一结构。
 * @param {object} json 搜索 API 返回值
 * @returns {Array<{title: string, url: string, snippet: string, source: string}>}
 */
export function normalizeSearchResults(json) {
  const results = [];
  if (!json || typeof json !== "object") return results;
  const items = Array.isArray(json.results) ? json.results
    : Array.isArray(json.items) ? json.items
      : Array.isArray(json.data) ? json.data : [];
  for (const item of items.slice(0, MAX_RESULTS)) {
    if (!item || typeof item !== "object") continue;
    const title = String(item.title || item.name || "").trim().slice(0, 200);
    const url = safeSourceUrl(item.url || item.link || item.href || "");
    const snippet = String(item.snippet || item.description || item.text || "").trim();
    if (!url) continue;
    results.push({ title, url, snippet: snippet.slice(0, 300), source: url });
  }
  return results;
}

/**
 * 解析 MiMo web_search 工具返回的 url_citation 引用为统一结果结构。
 * @param {object} message choices[0].message
 * @returns {Array<{title: string, url: string, snippet: string, source: string}>}
 */
export function normalizeCitations(message) {
  const results = [];
  const seen = new Set();
  const annotations = Array.isArray(message?.annotations) ? message.annotations : [];
  for (const item of annotations) {
    if (!item || item.type !== "url_citation") continue;
    const citation = item.url_citation && typeof item.url_citation === "object" ? item.url_citation : item;
    const url = safeSourceUrl(citation.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    results.push({
      title: String(citation.title || "").trim().slice(0, 200),
      url,
      snippet: String(citation.summary || "").trim().slice(0, 300),
      source: url
    });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

/**
 * 服务端当前日期（Asia/Shanghai），注入 system 帮模型锚定「今天」。
 * @returns {string}
 */
function todayStamp() {
  return new Date().toLocaleDateString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long"
  });
}

/**
 * 模型联网搜索：用 SEARCH_MODEL（默认 mimo-v2.6-flash）+ MiMo web_search 插件。
 * 只发送查询词，不发送对话内容；force_search 确保真的联网而不是模型自答。
 * @param {string} query
 * @param {AbortSignal} signal
 * @returns {Promise<Response>}
 */
async function modelWebSearch(query, signal) {
  return fetch(LLM_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${LLM_API_KEY}`
    },
    body: JSON.stringify({
      model: SEARCH_MODEL,
      messages: [
        {
          role: "system",
          content: `你是证据检索助手。今天是${todayStamp()}。只输出与查询相关的客观事实与公开来源，不要输出对话建议，不要编造。`
        },
        { role: "user", content: query }
      ],
      max_tokens: 1024,
      tools: [{ type: "web_search", max_keyword: 2, force_search: true }],
      tool_choice: "auto"
    }),
    signal
  });
}

/**
 * 外部搜索 API 路径，应用与模型检索相同的来源政策。
 * @param {import("node:http").ServerResponse} res
 * @param {string} query
 */
async function endpointSearch(res, query) {
  let upstream;
  let text;
  try {
    ({ upstream, text } = await withUpstreamRequest(res, 15_000, async (signal) => {
      const upstream = await fetch(SEARCH_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SEARCH_API_KEY}`
        },
        body: JSON.stringify({ query, count: MAX_RESULTS }),
        signal
      });
      return { upstream, text: await upstream.text() };
    }));
  } catch {
    if (res.destroyed || res.writableEnded) return;
    return sendJson(res, 502, { error: "search_unreachable", message: "无法连接搜索服务。" });
  }
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = null; }
  if (!upstream.ok || !json) {
    return sendJson(res, 502, { error: "search_upstream_error", upstreamStatus: upstream.status, message: `搜索服务返回 ${upstream.status}。` });
  }
  if (!Array.isArray(json.results) && !Array.isArray(json.items) && !Array.isArray(json.data)) {
    return sendJson(res, 502, {
      error: "search_response_unsupported",
      message: "搜索服务返回了不支持的响应结构；应包含 results、items 或 data 数组。"
    });
  }
  const raw = normalizeSearchResults(json);
  const allowed = raw.filter((item) => isAllowedSearchSource(item.url));
  const filtered = raw.length - allowed.length;
  if (filtered > 0) console.log(`[search] 过滤 ${filtered} 条非白名单来源`);
  return sendJson(res, 200, {
    results: allowed, filtered, engine: "external-endpoint", sourcePolicy: "allowlist",
    note: allowed.length ? "" : "没有找到符合来源白名单的公开链接。"
  });
}

/**
 * 模型联网搜索路径：SEARCH_MODEL + MiMo web_search 插件。
 * @param {import("node:http").ServerResponse} res
 * @param {string} query
 */
async function modelSearch(res, query) {
  let upstream;
  let text;
  try {
    ({ upstream, text } = await withUpstreamRequest(res, MODEL_SEARCH_TIMEOUT_MS, async (signal) => {
      const upstream = await modelWebSearch(query, signal);
      return { upstream, text: await upstream.text() };
    }));
  } catch {
    if (res.destroyed || res.writableEnded) return;
    return sendJson(res, 502, { error: "search_unreachable", message: "无法连接模型联网搜索服务。" });
  }
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = null; }
  if (!upstream.ok || !json) {
    const upstreamMessage = `${json?.error?.message || ""} ${json?.error?.param || ""}`;
    // 插件未开通时 MiMo 返回 400：message="Param Incorrect"、param 含 "webSearchEnabled is false"。
    if (upstream.status === 400 && upstreamMessage.includes("webSearchEnabled")) {
      return sendJson(res, 503, {
        error: "search_plugin_disabled",
        message: "MiMo 联网服务插件未开通：请到 MiMo 控制台 → 插件管理，开通「联网服务插件」后重试。"
      });
    }
    return sendJson(res, 502, { error: "search_upstream_error", upstreamStatus: upstream.status, message: `模型联网搜索返回 ${upstream.status}。` });
  }
  const message = json?.choices?.[0]?.message;
  // A successful HTTP response does not imply a compatible API response. In
  // particular, Responses output must never be silently treated as no results.
  if (!message || typeof message !== "object" || Array.isArray(message)
    || !(typeof message.content === "string" || Array.isArray(message.annotations))) {
    return sendJson(res, 502, {
      error: "search_response_unsupported",
      message: "模型搜索返回了不支持的响应结构；当前仅支持 MiMo Chat Completions 搜索响应。"
    });
  }
  const raw = normalizeCitations(message);
  const allowed = raw.filter((item) => isAllowedSearchSource(item.url));
  const filtered = raw.length - allowed.length;
  if (filtered > 0) console.log(`[search] 过滤 ${filtered} 条非白名单来源`);
  // No cited allowlisted source means no model summary may be passed through.
  // Domain policy alone is not a claim that a page's statements are verified.
  const note = allowed.length ? "" : "没有找到符合来源白名单的公开链接。";
  return sendJson(res, 200, {
    results: allowed, filtered, engine: "mimo-web-search", model: SEARCH_MODEL,
    sourcePolicy: "allowlist", note
  });
}

/**
 * 处理 POST /api/search。仅接受查询词，不接收对话内容。
 * 引擎优先级：配置 SEARCH_ENDPOINT+SEARCH_API_KEY → 外部搜索 API；否则 → MiMo 模型联网搜索（默认 mimo-v2.6-flash）。
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
export async function handleSearch(req, res) {
  let body;
  try {
    body = await readRequestJson(req);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return sendJson(res, 413, { error: "payload_too_large", message: "请求体超过 2MB 限制。" });
    }
    return sendJson(res, 400, { error: "invalid_json", message: "请求体不是合法 JSON。" });
  }
  const query = String(body.query || "").trim().slice(0, MAX_QUERY_LENGTH);
  if (!query) return sendJson(res, 400, { error: "bad_request", message: "`query` 不能为空。" });

  // 审计日志：只记录查询词与来源，绝不记录对话上下文。
  console.log(`[search] query="${query}" at ${new Date().toISOString()}`);

  if (SEARCH_ENABLED) return endpointSearch(res, query);
  if (!LLM_API_KEY) {
    return sendJson(res, 503, {
      error: "search_disabled",
      message: "联网搜索未启用：请在 .env 配置 LLM_API_KEY（模型联网搜索），或配置 SEARCH_ENDPOINT 与 SEARCH_API_KEY（外部搜索服务）。"
    });
  }
  let responseEndpoint = false;
  try { responseEndpoint = /(?:^|\/)responses(?:\/|$)/i.test(new URL(LLM_ENDPOINT).pathname); } catch { /* Fetch reports invalid endpoints. */ }
  if (LLM_API_MODE !== "chat_completions" || responseEndpoint) {
    return sendJson(res, 503, {
      error: "search_api_mode_unsupported",
      message: "模型联网搜索仅支持 MiMo Chat Completions：请配置对应 LLM_ENDPOINT 和 LLM_API_MODE=chat_completions，或配置独立 SEARCH_ENDPOINT 与 SEARCH_API_KEY。Responses 模式尚不支持联网搜索。"
    });
  }
  return modelSearch(res, query);
}
