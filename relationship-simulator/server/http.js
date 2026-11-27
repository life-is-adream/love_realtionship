import { PORT } from "./config.js";

/**
 * 解析允许的跨域来源。
 * 放行本机回环（localhost / 127.0.0.1 / [::1]）、RFC1918 私有网段（10/8、172.16/12、192.168/16）
 * 与 *.local 的任意端口；其它来源一律回落到本地默认源（等同拒绝）。
 * 本应用是本地工具，私有网段对应局域网自用场景；公网来源始终不在白名单。
 * @param {string} [origin] 请求的 Origin 头
 * @returns {string}
 */
const PRIVATE_HOSTNAME = /^(localhost|127\.0\.0\.1|\[::1\]|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|[\w-]+\.local)$/;

export function resolveCorsOrigin(origin = "", port = PORT) {
  if (typeof origin !== "string" || !origin) return `http://localhost:${port}`;
  try {
    const url = new URL(origin);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.origin === origin && PRIVATE_HOSTNAME.test(url.hostname)) return origin;
  } catch {
    // 非 URL 的 Origin 直接回落默认源。
  }
  return `http://localhost:${port}`;
}

/** 请求来源是否允许访问本机 API：默认只接受本机回环页面。 */
const LOOPBACK_HOSTNAME = new Set(["localhost", "127.0.0.1", "[::1]"]);
export function isAllowedOrigin(origin, bindHost = "127.0.0.1") {
  if (!origin) return true; // 命令行客户端通常不带 Origin。
  try {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.origin !== origin) return false;
    if (LOOPBACK_HOSTNAME.has(url.hostname)) return true;
    if (LOOPBACK_HOSTNAME.has(bindHost)) return false; // 默认只服务本机页面。
    return PRIVATE_HOSTNAME.test(url.hostname);
  } catch {
    return false;
  }
}

/** Host 校验：防止 DNS rebinding 用外部域名借本机服务读数据。 */
export function isAllowedHost(hostHeader, bindHost = "127.0.0.1") {
  if (!hostHeader) return true; // 非浏览器客户端通常不带 Host；Rebinding 攻击一定带。
  let name;
  try { name = new URL(`http://${hostHeader}`).hostname; } catch { return false; }
  if (LOOPBACK_HOSTNAME.has(name)) return true;
  if (LOOPBACK_HOSTNAME.has(bindHost)) return false;
  return PRIVATE_HOSTNAME.test(name);
}

/** 请求体超过 2MB 限制时抛出，携带可区分的错误码。 */
export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
    this.name = "RequestBodyTooLargeError";
    this.code = "BODY_TOO_LARGE";
  }
}

export const MAX_REQUEST_BYTES = 2_000_000;

export function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let bytes = 0;
    let settled = false;
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk, "utf8");
      if (bytes > MAX_REQUEST_BYTES) {
        settled = true;
        chunks = [];
        reject(new RequestBodyTooLargeError());
        return; // Drain remaining input so the handler can send an actual 413 response.
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        const raw = chunks.join("");
        chunks = [];
        const value = raw ? JSON.parse(raw) : {};
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid JSON object");
        resolve(value);
      } catch { reject(new Error("Invalid JSON object")); }
    });
    const fail = (error) => {
      if (settled) return;
      settled = true;
      chunks = [];
      reject(error);
    };
    req.on("error", fail);
    req.on("aborted", () => fail(new Error("Request aborted")));
  });
}

export function sendJson(res, status, payload, extraHeaders = {}) {
  // 统一为 /api 响应注入 CORS 头（此前仅 /api/chat 携带，其余路由缺失导致跨源被浏览器拦截）。
  // Node 的 ServerResponse.req 指回原始请求；拿不到请求（如单测 mock）时不注入。
  // 外部/非法 Origin 由 resolveCorsOrigin 回落默认源（等同拒绝），extraHeaders 可覆盖。
  const origin = res?.req?.headers?.origin;
  const corsHeaders = origin === undefined ? {} : { "Access-Control-Allow-Origin": resolveCorsOrigin(origin) };
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...corsHeaders,
    ...extraHeaders
  });
  res.end(JSON.stringify(payload, null, 2));
}

export function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}
