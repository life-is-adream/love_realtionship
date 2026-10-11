import { createServer } from "node:http";
import { handleHealth } from "./healthRoute.js";
import { handleChat } from "./llmProxy.js";
import { PORT, LLM_API_KEY, LLM_ENDPOINT, LLM_MODEL, maskEndpoint } from "./config.js";
import { handleLongContent } from "./routes-longContent.js";
import { handleSearch } from "./searchProxy.js";
import { handleRelationshipIntelligence } from "./relationshipIntelligence.js";
import { resolveCorsOrigin, sendJson, sendText } from "./http.js";
import { serveStatic } from "./staticServer.js";
import { createRequestHandler, isDirectEntry } from "./request-handler.js";

export const server = createServer(createRequestHandler({
  resolveCorsOrigin, sendJson, sendText, handleHealth, handleChat, handleSearch,
  handleRelationshipIntelligence, handleLongContent, serveStatic
}));

if (isDirectEntry(import.meta.url)) {
  server.listen(PORT, () => {
    console.log(`恋爱模拟器已启动: http://localhost:${PORT}`);
    console.log(`API 代理: POST http://localhost:${PORT}/api/chat`);
    console.log(`模型: ${LLM_MODEL}`);
    console.log(`Endpoint: ${maskEndpoint(LLM_ENDPOINT)}`);
    console.log(`API Key: ${LLM_API_KEY ? "已配置" : "未配置，调用真实模型会失败"}`);
  });
}
