import { createServer } from "node:http";
import { handleHealth } from "./healthRoute.js";
import { handleChat } from "./llmProxy.js";
import { PORT, HOST, LLM_API_KEY, LLM_ENDPOINT, LLM_MODEL, maskEndpoint } from "./config.js";
import { handleLongContent } from "./routes-longContent.js";
import { handleSearch } from "./searchProxy.js";
import { handleRelationshipIntelligence } from "./relationshipIntelligence.js";
import { handleTts, handleTtsHealth } from "./voiceProxy.js";
import { handleV2 } from "./v2.js";
import { resolveCorsOrigin, sendJson, sendText } from "./http.js";
import { serveStatic } from "./staticServer.js";
import { createRequestHandler, isDirectEntry } from "./request-handler.js";

export const server = createServer(createRequestHandler({
  resolveCorsOrigin, sendJson, sendText, handleHealth, handleChat, handleSearch,
  handleRelationshipIntelligence, handleLongContent, handleTts, handleTtsHealth, handleV2, serveStatic
}));

if (isDirectEntry(import.meta.url)) {
  server.listen(PORT, HOST, () => {
    console.log(`恋爱模拟器已启动: http://localhost:${PORT}`);
    console.log(`监听地址: ${HOST}`);
    if (!["127.0.0.1", "localhost", "::1"].includes(HOST)) console.log("警告: 当前监听非回环地址，同网段设备可能访问；仅在确需局域网共享时使用。");
    console.log(`API 代理: POST http://localhost:${PORT}/api/chat`);
    console.log(`模型: ${LLM_MODEL}`);
    console.log(`Endpoint: ${maskEndpoint(LLM_ENDPOINT)}`);
    console.log(`API Key: ${LLM_API_KEY ? "已配置" : "未配置，调用真实模型会失败"}`);
  });
}
