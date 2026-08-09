import { SEARCH_ALLOWED_DOMAINS, SEARCH_API_KEY, SEARCH_ENABLED, SEARCH_ENDPOINT } from "./config.js";
import { readRequestJson, sendJson } from "./staticServer.js";

const MAX_QUERY_LENGTH = 120;
const MAX_RESULTS = 5;

/**
 * 判断一个 URL 是否属于白名单权威域名。
 * @param {string} url
 * @returns {boolean}
 */
export function isAllowedSearchSource(url) {
  if (!SEARCH_ALLOWED_DOMAINS.length) return false;
  try {
    const hostname = new URL(String(url || "")).hostname.toLowerCase();
    return SEARCH_ALLOWED_DOMAINS.some((domain) => {
      const clean = domain.replace(/^\./, "");
      return hostname === clean || hostname.endsWith(`.${clean}`);
    });
  } catch {
    return false;
  }
}

/**
 * 归一化搜索结果为统一结构。
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
    const title = String(item.title || item.name || "").trim();
    const url = String(item.url || item.link || item.href || "").trim();
    const snippet = String(item.snippet || item.description || item.text || "").trim();
    if (!url) continue;
    results.push({ title, url, snippet: snippet.slice(0, 300), source: url });
  }
  return results;
}

/**
 * 处理 POST /api/search。默认关闭；仅接受查询词，不接收对话内容。
 */
export async function handleSearch(req, res) {
  if (!SEARCH_ENABLED) {
    return sendJson(res, 503, { error: "search_disabled", message: "联网搜索未启用：请在 .env 配置 SEARCH_ENDPOINT 与 SEARCH_API_KEY。" });
  }
  let body;
  try {
    body = await readRequestJson(req);
  } catch {
    return sendJson(res, 400, { error: "invalid_json", message: "请求体不是合法 JSON。" });
  }
  const query = String(body.query || "").trim().slice(0, MAX_QUERY_LENGTH);
  if (!query) return sendJson(res, 400, { error: "bad_request", message: "`query` 不能为空。" });

  // 审计日志：只记录查询词与来源，绝不记录对话上下文。
  console.log(`[search] query="${query}" at ${new Date().toISOString()}`);

  let upstream;
  try {
    upstream = await fetch(SEARCH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SEARCH_API_KEY}`
      },
      body: JSON.stringify({ query, count: MAX_RESULTS }),
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    return sendJson(res, 502, { error: "search_unreachable", message: "无法连接搜索服务。" });
  }
  const text = await upstream.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = null; }
  if (!upstream.ok || !json) {
    return sendJson(res, 502, { error: "search_upstream_error", upstreamStatus: upstream.status, message: `搜索服务返回 ${upstream.status}。` });
  }
  const raw = normalizeSearchResults(json);
  const allowed = raw.filter((item) => isAllowedSearchSource(item.url));
  const filtered = raw.length - allowed.length;
  if (filtered > 0) console.log(`[search] 过滤 ${filtered} 条非白名单来源`);
  return sendJson(res, 200, { results: allowed, filtered });
}
