import { createServer } from "node:http";
import { handleHealth } from "./healthRoute.js";
import { handleChat } from "./llmProxy.js";
import { PORT, LLM_API_KEY, LLM_ENDPOINT, LLM_MODEL, maskEndpoint } from "./config.js";
import { handleLongContent } from "./routes-longContent.js";
import { handleSearch } from "./searchProxy.js";
import { handleRelationshipIntelligence } from "./relationshipIntelligence.js";
import { sendJson, sendText, serveStatic } from "./staticServer.js";

export const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/api/health") return handleHealth(res);
    if (req.method === "POST" && url.pathname === "/api/chat") return handleChat(req, res);
    if (req.method === "POST" && url.pathname === "/api/search") return handleSearch(req, res);
    if (req.method === "POST" && url.pathname === "/api/relationship-intelligence") return handleRelationshipIntelligence(req, res);
    if (req.method === "GET" && url.pathname.startsWith("/api/long-content/")) return handleLongContent(url.pathname, res);
    if (req.method !== "GET" && req.method !== "HEAD") return sendText(res, 405, "Method Not Allowed");
    return serveStatic(url.pathname, res);
  } catch (error) {
    return sendJson(res, 500, { error: "server_error", message: String(error?.message || error) });
  }
});

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname.endsWith("/server/index.js")) {
  server.listen(PORT, () => {
    console.log(`恋爱模拟器已启动: http://localhost:${PORT}`);
    console.log(`API 代理: POST http://localhost:${PORT}/api/chat`);
    console.log(`模型: ${LLM_MODEL}`);
    console.log(`Endpoint: ${maskEndpoint(LLM_ENDPOINT)}`);
    console.log(`API Key: ${LLM_API_KEY ? "已配置" : "未配置，调用真实模型会失败"}`);
  });
}
