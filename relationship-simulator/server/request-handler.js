import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAllowedHost, isAllowedOrigin } from "./http.js";
import { HOST } from "./config.js";

/** Match the actual entry file, including relative paths and symlink aliases. */
export function isDirectEntry(moduleUrl, entryPath = process.argv[1]) {
  if (!entryPath) return false;
  try {
    const modulePath = realpathSync(fileURLToPath(moduleUrl));
    const resolvedEntry = realpathSync(path.resolve(entryPath));
    const moduleInfo = statSync(modulePath, { bigint: true });
    const entryInfo = statSync(resolvedEntry, { bigint: true });
    if (!moduleInfo.isFile() || !entryInfo.isFile()) return false;
    if (moduleInfo.ino && entryInfo.ino) return moduleInfo.dev === entryInfo.dev && moduleInfo.ino === entryInfo.ino;
    return process.platform === "win32"
      ? modulePath.toLowerCase() === resolvedEntry.toLowerCase()
      : modulePath === resolvedEntry;
  } catch {
    return false;
  }
}

/** Keep both synchronous and asynchronous route failures inside one boundary. */
export function createRequestHandler({
  resolveCorsOrigin, sendJson, sendText, handleHealth, handleChat, handleSearch,
  handleRelationshipIntelligence, handleLongContent, handleTts, handleTtsHealth, handleV2, serveStatic
}) {
  return async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": resolveCorsOrigin(req.headers.origin),
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400"
        });
        return res.end();
      }
      if (!isAllowedHost(req.headers.host, HOST)) {
        return sendJson(res, 403, { error: "host_forbidden", message: "此本机服务只接受本机地址的请求。" });
      }
      if (url.pathname.startsWith("/api/v2/") && typeof handleV2 === "function") return await handleV2(req, res, url.pathname);
      // 旧接口同样校验页面来源：避免任意网页借本机服务代理模型请求。
      if (url.pathname.startsWith("/api/") && !isAllowedOrigin(req.headers.origin, HOST)) {
        return sendJson(res, 403, { error: "origin_forbidden", message: "此本机服务只接受本机页面的请求。" });
      }
      if (req.method === "GET" && url.pathname === "/api/health") return await handleHealth(res);
      if (req.method === "POST" && url.pathname === "/api/chat") return await handleChat(req, res);
      if (req.method === "POST" && url.pathname === "/api/search") return await handleSearch(req, res);
      if (req.method === "POST" && url.pathname === "/api/relationship-intelligence") return await handleRelationshipIntelligence(req, res);
      if (req.method === "GET" && url.pathname === "/api/tts/health") return await handleTtsHealth(res);
      if (req.method === "POST" && url.pathname === "/api/tts") return await handleTts(req, res);
      if (req.method === "GET" && url.pathname.startsWith("/api/long-content/")) return await handleLongContent(url.pathname, res);
      if (req.method !== "GET" && req.method !== "HEAD") return sendText(res, 405, "Method Not Allowed");
      return await serveStatic(url.pathname, res);
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      if (res.headersSent) return res.destroy();
      return sendJson(res, 500, { error: "server_error", message: String(error?.message || error) });
    }
  };
}
