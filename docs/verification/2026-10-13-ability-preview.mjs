// Isolated read-only UI preview: synthetic health, no .env, model or user profile.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { versionModuleImports } from "../../relationship-simulator/server/asset-versioning.js";
const root = fileURLToPath(new URL("../../relationship-simulator/public/", import.meta.url));
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, service: "heartflow", mode: "offline", model: "离线验收", hasApiKey: false }));
    }
    if (url.pathname.startsWith("/api/")) { res.writeHead(404); return res.end("offline preview"); }
    const pathname = decodeURIComponent(url.pathname);
    const file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(root) || !(await stat(file)).isFile()) { res.writeHead(404); return res.end(); }
    const extension = path.extname(file), bytes = await readFile(file);
    res.writeHead(200, { "Content-Type": mime[extension] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(extension === ".js" ? versionModuleImports(bytes.toString("utf8")) : bytes);
  } catch { res.writeHead(404); res.end(); }
});
server.listen(0, "127.0.0.1", () => console.log(`UI_PREVIEW_URL=http://127.0.0.1:${server.address().port}/#abilities`));
