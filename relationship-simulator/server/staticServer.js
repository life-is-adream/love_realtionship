import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { publicDir, PORT } from "./config.js";

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
    if (PRIVATE_HOSTNAME.test(url.hostname)) return origin;
  } catch {
    // 非 URL 的 Origin 直接回落默认源。
  }
  return `http://localhost:${port}`;
}

/** 请求体超过 2MB 限制时抛出，携带可区分的错误码。 */
export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
    this.name = "RequestBodyTooLargeError";
    this.code = "BODY_TOO_LARGE";
  }
}

export const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8"
};

export async function serveStatic(urlPath, res) {
  let safePath = decodeURIComponent(urlPath);
  if (safePath === "/") safePath = "/index.html";
  safePath = safePath.replace(/^\/+/, "");

  const filePath = path.normalize(path.join(publicDir, safePath));
  // 用 path.sep 收尾比对，防止 publicDir 为前缀的兄弟目录（如 publicX）绕过遍历检查。
  if (!filePath.startsWith(publicDir + path.sep)) return sendText(res, 403, "Forbidden");

  // 用"请求路径"的扩展名判断是否资源类请求：文件不存在时直接 404，
  // 避免把 index.html（text/html）当 js/css 返回造成难排查的 MIME/语法错误。
  const requestExt = path.extname(safePath).toLowerCase();
  const exists = existsSync(filePath);
  if (!exists && requestExt) return sendText(res, 404, "Not Found");

  // 无扩展名路径保持 SPA 回退 index.html（兼容现状）。
  const target = exists ? filePath : path.join(publicDir, "index.html");
  const ext = path.extname(target).toLowerCase();
  // 缓存分级：入口 HTML 每次协商校验（发布即生效）；js/css 1 小时；其它静态资源（图片/svg）1 天。
  const cacheControl = ext === ".html"
    ? "no-cache"
    : requestExt === ".js" || requestExt === ".css"
      ? "public, max-age=3600"
      : "public, max-age=86400";
  const data = await readFile(target);
  res.writeHead(200, {
    "Content-Type": mime[ext] || "application/octet-stream",
    "Cache-Control": cacheControl
  });
  res.end(data);
}

export function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let tooLarge = false;
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000 && !tooLarge) {
        tooLarge = true;
        reject(new RequestBodyTooLargeError());
        req.destroy();
      }
    });
    req.on("end", () => {
      if (tooLarge) return;
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
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
