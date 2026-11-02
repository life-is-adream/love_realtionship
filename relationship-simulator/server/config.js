import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.join(__dirname, "..");
export const publicDir = path.join(ROOT_DIR, "public");
export const longSimulationDir = path.join(ROOT_DIR, "long-simulation");
export const envPath = path.join(ROOT_DIR, ".env");

loadDotEnv(envPath);

export const PORT = Number(process.env.PORT || 3000);
export const LLM_ENDPOINT = process.env.LLM_ENDPOINT || "https://api.openai.com/v1/responses";
// 模型名从 .env 读取（LLM_MODEL），缺省用 mimo-v2.5-pro。
// 说明：mimo-v2.5 为推理型（reasoning_tokens 高、实时聊天偏慢），
// mimo-v2.5-pro 为直出型（0 推理 tokens、更快更省，适合本项目的教练 JSON 输出场景）。
export const LLM_MODEL = process.env.LLM_MODEL || "mimo-v2.5-pro";
export const LLM_API_MODE = normalizeApiMode(process.env.LLM_API_MODE || inferApiMode(LLM_ENDPOINT));
export const LLM_API_KEY = process.env.LLM_API_KEY || "";
export const LLM_MAX_COMPLETION_TOKENS = Number(process.env.LLM_MAX_OUTPUT_TOKENS || process.env.LLM_MAX_COMPLETION_TOKENS || 2048);
export const LLM_TEMPERATURE = Number(process.env.LLM_TEMPERATURE || 1.0);
export const LLM_TOP_P = Number(process.env.LLM_TOP_P || 0.95);
export const LLM_REASONING_EFFORT = process.env.LLM_REASONING_EFFORT || "medium";

// 联网搜索（双引擎，默认用模型联网搜索）：
// 引擎一（默认）：SEARCH_MODEL + MiMo web_search 插件，复用 LLM_ENDPOINT/LLM_API_KEY。
// 仅支持 LLM_API_MODE=chat_completions；Responses 配置在 dispatch 前受控拒绝。
// 引擎二（可选）：配置 SEARCH_ENDPOINT+SEARCH_API_KEY 后优先使用外部搜索 API。
// 仅用于检索公开通用知识（如心理学/沟通研究），绝不发送对话原文。
export const SEARCH_ENDPOINT = process.env.SEARCH_ENDPOINT || "";
export const SEARCH_API_KEY = process.env.SEARCH_API_KEY || "";
export const SEARCH_ENABLED = Boolean(SEARCH_ENDPOINT && SEARCH_API_KEY);
export const SEARCH_MODEL = process.env.SEARCH_MODEL || "mimo-v2.6-flash";
/** 所有检索引擎始终执行来源域名白名单；匹配域名不等于验证页面观点或证据。 */
export const SEARCH_ALLOWED_DOMAINS = (process.env.SEARCH_ALLOWED_DOMAINS || "edu.cn,gov.cn,who.int,apa.org,psychologytoday.com,healthychildren.org,nhs.uk")
  .split(",").map((domain) => domain.trim().toLowerCase()).filter(Boolean);
// 保留显式配置标记用于兼容现有调用方；它不会关闭默认白名单过滤。
export const SEARCH_ALLOWED_DOMAINS_EXPLICIT = Boolean(process.env.SEARCH_ALLOWED_DOMAINS);

export function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

export function maskEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return `${url.origin}${url.pathname}`;
  } catch {
    return endpoint;
  }
}

export function inferApiMode(endpoint) {
  try {
    const url = new URL(endpoint);
    if (url.pathname.includes("/v1/responses")) return "responses";
    if (url.pathname.includes("/v1/chat/completions")) return "chat_completions";
    if (url.hostname.includes("openai.com")) return "responses";
  } catch {
    // Fall back to the more common chat-completions compatibility mode.
  }
  return "chat_completions";
}

export function normalizeApiMode(value) {
  const mode = String(value || "").trim().toLowerCase().replace(/[-\s]/g, "_");
  if (mode === "responses") return "responses";
  if (mode === "chat" || mode === "chat_completions" || mode === "chat_completions_api") return "chat_completions";
  return "chat_completions";
}
