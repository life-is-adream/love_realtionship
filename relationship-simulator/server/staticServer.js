import { sendText } from "./http.js";
export { readRequestJson, RequestBodyTooLargeError, resolveCorsOrigin, sendJson, sendText } from "./http.js";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { publicDir } from "./config.js";
import { staticCacheControl, versionModuleImports } from "./asset-versioning.js";

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
  let safePath;
  try { safePath = decodeURIComponent(urlPath); } catch { return sendText(res, 400, "Bad Request"); }
  if (safePath.includes("\0")) return sendText(res, 400, "Bad Request");
  if (safePath === "/") safePath = "/index.html";
  safePath = safePath.replace(/^\/+/, "");

  const filePath = path.normalize(path.join(publicDir, safePath));
  // 用 path.sep 收尾比对，防止 publicDir 为前缀的兄弟目录（如 publicX）绕过遍历检查。
  if (!filePath.startsWith(publicDir + path.sep)) return sendText(res, 403, "Forbidden");

  // 用"请求路径"的扩展名判断是否资源类请求：文件不存在时直接 404，
  // 避免把 index.html（text/html）当 js/css 返回造成难排查的 MIME/语法错误。
  const requestExt = path.extname(safePath).toLowerCase();
  const info = await stat(filePath).catch((error) => {
    if (["ENOENT", "ENOTDIR"].includes(error.code)) return null;
    throw error;
  });
  if (info && !info.isFile()) return sendText(res, 404, "Not Found");
  const exists = Boolean(info);
  if (!exists && requestExt) return sendText(res, 404, "Not Found");

  // 无扩展名路径保持 SPA 回退 index.html（兼容现状）。
  const target = exists ? filePath : path.join(publicDir, "index.html");
  const ext = path.extname(target).toLowerCase();
  const cacheControl = staticCacheControl(ext);
  const raw = await readFile(target);
  const data = ext === ".js" ? versionModuleImports(raw.toString("utf8")) : raw;
  res.writeHead(200, {
    "Content-Type": mime[ext] || "application/octet-stream",
    "Cache-Control": cacheControl
  });
  res.end(data);
}
