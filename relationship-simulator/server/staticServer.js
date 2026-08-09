import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { publicDir, PORT } from "./config.js";

/**
 * 解析允许的跨域来源。
 * 只放行 localhost / 127.0.0.1 的任意端口；其它来源一律回落到本地默认源。
 * @param {string} [origin] 请求的 Origin 头
 * @returns {string}
 */
export function resolveCorsOrigin(origin = "", port = PORT) {
  if (typeof origin !== "string" || !origin) return `http://localhost:${port}`;
  try {
    const url = new URL(origin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return origin;
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
  if (!filePath.startsWith(publicDir)) return sendText(res, 403, "Forbidden");

  const target = existsSync(filePath) ? filePath : path.join(publicDir, "index.html");
  const ext = path.extname(target).toLowerCase();
  const data = await readFile(target);
  res.writeHead(200, {
    "Content-Type": mime[ext] || "application/octet-stream",
    "Cache-Control": "no-store"
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
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(JSON.stringify(payload, null, 2));
}

export function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}
