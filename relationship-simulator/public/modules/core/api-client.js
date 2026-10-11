import { buildSystemPrompt } from "../coach/prompts.js";
import { DEFAULT_MODEL, API_ENDPOINTS, DEFAULT_TEMPERATURE } from "./config.js";
import { sanitizeOutboundMessages } from "./privacy.js";

/**
 * 构建 LLM 调用消息列表
 * @param {Object} persona - 角色对象
 * @param {Object} memory - 角色记忆
 * @param {Array<Object>} messages - 对话消息列表
 * @param {Object} [uiValues] - UI 参数
 * @param {string} [uiValues.stage] - 当前阶段
 * @param {string} [uiValues.styleBias] - 风格偏好
 * @param {string} [uiValues.goal] - 当前目标
 * @param {Object} [uiValues.tone] - 真诚度/语气强度调节 {sincerity, toneIntensity}
 * @param {string} [uiValues.mode] - 训练模式："anti"（反PUA 训练）｜"pua"（PUA 识别训练）
 * @param {Object} [uiValues.textbookContext] - 教材上下文
 * @returns {Array<{role: string, content: string}>}
 */
export function buildMessages(persona, memory, messages, uiValues = {}) {
  const conversation = (Array.isArray(messages) ? messages : []).filter((item) => item && item.text);
  const result = [{ role: "system", content: buildSystemPrompt(persona, memory, { tone: uiValues.tone, mode: uiValues.mode }) }];
  for (const message of conversation) {
    if (message.type === "her") {
      result.push({ role: "assistant", content: `${message.who || persona.name}：${message.text}` });
    } else {
      result.push({ role: "user", content: `我：${message.text}` });
    }
  }
  const userPrompt = [
    "请继续生成下一轮内容。",
    "本轮锚点：只根据完整对话中最后一条我的消息生成女方下一句；然后让 A/B/C 直接回应你刚生成的 herReply。",
    `当前阶段：${uiValues.stage || ""}`,
    `风格偏好：${uiValues.styleBias || ""}`,
    `当前目标：${uiValues.goal || ""}`,
    "请只输出 JSON。"
  ];
  if (uiValues.textbookContext?.excerpts?.length) {
    userPrompt.push(`教材参考（只用于解释，不得编造）：${JSON.stringify(uiValues.textbookContext.excerpts)}`);
  }
  result.push({ role: "user", content: userPrompt.join("\n") });
  return result;
}

/**
 * 调用 LLM API
 * @param {Object} options - 调用参数
 * @param {string} [options.endpoint] - API 端点
 * @param {string} [options.apiKey] - API 密钥
 * @param {string} [options.model] - 模型名称
 * @param {Array<{role: string, content: string}>} options.messages - 消息列表
 * @param {number} [options.temperature] - 温度参数
 * @returns {Promise<{raw: Object, content: string}>}
 */
export async function callLLM({ endpoint = API_ENDPOINTS.chat, apiKey = "", model = DEFAULT_MODEL, messages, temperature = DEFAULT_TEMPERATURE, signal }) {
  // 唯一出站边界：所有消息在离开浏览器前统一脱敏（邮箱/网址/电话/长数字）。
  const { messages: safeMessages, hits: redactionHits } = sanitizeOutboundMessages(messages);
  const payload = { model, messages: safeMessages, temperature };
  if (apiKey) payload.apiKey = apiKey;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = null; }
  if (!res.ok) {
    const message = json?.message || json?.error || text;
    throw new Error(`HTTP ${res.status}: ${String(message).slice(0, 500)}`);
  }
  const rawContent = json?.choices?.[0]?.message?.content || json?.choices?.[0]?.text || json?.output_text || "";
  const content = Array.isArray(rawContent)
    ? rawContent.map((part) => typeof part === "string" ? part : (part?.text || part?.content || "")).join("")
    : String(rawContent || "");
  if (!content.trim()) throw new Error("模型返回为空，未生成女方对话。");
  return { raw: json, content, redactionHits };
}

/**
 * 检查服务健康状态
 * @returns {Promise<Object>}
 */
export async function checkHealth() {
  const res = await fetch("/api/health");
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.message || `HTTP ${res.status}`);
  return json;
}

/**
 * 联网搜索（可选增强，默认关闭）。
 * 只发送查询词，绝不发送对话内容；服务端按白名单过滤并审计。
 * @param {string} query 查询词（最长 120 字符）
 * @returns {Promise<{results: Array<{title: string, url: string, snippet: string}>, filtered: number}>}
 */
export async function searchWeb(query) {
  const res = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
  return json;
}
