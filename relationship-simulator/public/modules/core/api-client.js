import { buildHerSystemPrompt, buildHerTaskPrompt, buildCoachSystemPrompt } from "../coach/prompts.js";
import { DEFAULT_MODEL, API_ENDPOINTS, DEFAULT_TEMPERATURE } from "./config.js";
import { sanitizeOutboundMessages } from "./privacy.js";

/** 把会话消息映射为消息角色：她=assistant、我=user；无文本的条目跳过。 */
function toHistoryMessages(messages, personaName) {
  const history = [];
  for (const message of (Array.isArray(messages) ? messages : [])) {
    if (!message || !message.text) continue;
    if (message.type === "her") {
      history.push({ role: "assistant", content: `${message.who || personaName}：${message.text}` });
    } else {
      history.push({ role: "user", content: `我：${message.text}` });
    }
  }
  return history;
}

/**
 * 构建「她」的消息列表：只产出微信文本回复，不含教练技能契约与 JSON 要求。
 * @param {Object} persona - 角色对象
 * @param {Object} memory - 角色记忆（含 _enhancedInjection / _tierInjection）
 * @param {Array<Object>} messages - 对话消息列表
 * @param {Object} [uiValues] - UI 参数（用到 mode）
 * @returns {Array<{role: string, content: string}>}
 */
export function buildHerMessages(persona, memory, messages, uiValues = {}) {
  return [
    { role: "system", content: buildHerSystemPrompt(persona, memory, { mode: uiValues.mode }) },
    ...toHistoryMessages(messages, persona.name),
    { role: "user", content: buildHerTaskPrompt() }
  ];
}

/**
 * 构建「教练」的消息列表：她的回复作为已知输入，教练只产出分析 JSON。
 * @param {Object} params
 * @param {Object} params.persona - 角色对象
 * @param {Object} params.memory - 角色记忆
 * @param {Array<Object>} params.messages - 对话消息列表
 * @param {string} params.herReply - 已确定的女方回复
 * @param {Object} [params.uiValues] - UI 参数（stage/styleBias/goal/tone/mode/textbookContext）
 * @returns {Array<{role: string, content: string}>}
 */
export function buildCoachMessages({ persona, memory, messages, herReply, uiValues = {} }) {
  const result = [{ role: "system", content: buildCoachSystemPrompt(persona, memory, { tone: uiValues.tone, mode: uiValues.mode }) }];
  result.push(...toHistoryMessages(messages, persona.name));
  const userPrompt = [
    `她本轮的回复（已确定，不要改写、不要替她说话）：${String(herReply || "").trim()}`,
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
 * @param {{type: "disabled"|"enabled"}} [options.thinking] - 思维链开关；角色回复通道关闭以换取延迟
 * @param {number} [options.maxCompletionTokens] - 输出上限；不传则用服务端默认
 * @returns {Promise<{raw: Object, content: string}>}
 */
export async function callLLM({ endpoint = API_ENDPOINTS.chat, apiKey = "", model = DEFAULT_MODEL, messages, temperature = DEFAULT_TEMPERATURE, thinking, maxCompletionTokens, responseFormat, signal }) {
  // 唯一出站边界：所有消息在离开浏览器前统一脱敏（邮箱/网址/电话/长数字）。
  const { messages: safeMessages, hits: redactionHits } = sanitizeOutboundMessages(messages);
  const payload = { model, messages: safeMessages, temperature };
  if (apiKey) payload.apiKey = apiKey;
  if (thinking?.type === "disabled" || thinking?.type === "enabled") payload.thinking = { type: thinking.type };
  if (Number.isFinite(maxCompletionTokens)) payload.max_completion_tokens = maxCompletionTokens;
  // 只放行 json_object：教练通道要求模型输出合法 JSON，实测会偶发解析失败而落到本地模板。
  if (responseFormat?.type === "json_object") payload.response_format = { type: "json_object" };
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
 * 联网搜索（双引擎：默认 MiMo 模型联网搜索，配置 SEARCH_ENDPOINT 后走外部搜索 API）。
 * 只发送查询词，绝不发送对话内容；服务端验证引用 URL 并按域名白名单过滤。
 * @param {string} query 查询词（最长 120 字符）
 * @returns {Promise<{results: Array<{title: string, url: string, snippet: string}>, filtered: number, sourcePolicy?: "allowlist", engine?: string, model?: string, note?: string}>}
 */
export async function searchWeb(query, { signal } = {}) {
  const res = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
  return json;
}
