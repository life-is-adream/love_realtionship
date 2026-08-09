/**
 * 出站隐私边界模块。
 *
 * 所有发往模型的内容在离开浏览器前，都应经过这里做最小必要脱敏
 * （邮箱 / 网址 / 电话 / 长数字编号）。这是全项目唯一的脱敏出口：
 * `callLLM` 在拼装 payload 前统一调用 `sanitizeOutboundMessages`，
 * 业务模块不需要各自关心脱敏细节。
 *
 * 本模块不读取 DOM、不写 localStorage、不调用网络。
 */

function asText(value) {
  return value == null ? "" : String(value);
}

function replaceAndCount(text, type, regex, replacement, counts) {
  return text.replace(regex, () => {
    counts[type] = (counts[type] || 0) + 1;
    return replacement;
  });
}

/**
 * 对可能进入模型请求的文本做最小必要脱敏。
 * 顺序为邮箱、网址、电话、长数字编号，避免同一片段被重复计数。
 *
 * @param {unknown} text
 * @returns {{text: string, hits: Array<{type: string, count: number}>}}
 */
export function redactSensitiveText(text) {
  let result = asText(text);
  const counts = {};

  result = replaceAndCount(
    result,
    "email",
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu,
    "[已隐藏邮箱]",
    counts
  );

  result = replaceAndCount(
    result,
    "url",
    /(?:https?:\/\/|www\.)[^\s<>"'，。！？；、）》】]+/giu,
    "[已隐藏网址]",
    counts
  );

  // 兼容常见的裸域名，同时不匹配已经替换掉的邮箱。
  result = replaceAndCount(
    result,
    "url",
    /(?<![@\w])(?:[a-z0-9-]+\.)+(?:com|cn|net|org|edu|gov|io|me|co|top|xyz)(?:\/[^\s<>"'，。！？；、）》】]*)?/giu,
    "[已隐藏网址]",
    counts
  );

  result = replaceAndCount(
    result,
    "phone",
    /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/gu,
    "[已隐藏手机号]",
    counts
  );

  result = replaceAndCount(
    result,
    "phone",
    /(?<!\d)0\d{2,3}[-\s]?\d{7,8}(?!\d)/gu,
    "[已隐藏电话]",
    counts
  );

  result = replaceAndCount(
    result,
    "id",
    /(?<!\d)\d{12,19}(?!\d)/gu,
    "[已隐藏编号]",
    counts
  );

  const order = ["phone", "email", "url", "id"];
  return {
    text: result,
    hits: order
      .filter((type) => counts[type])
      .map((type) => ({ type, count: counts[type] }))
  };
}

/**
 * 对一条或多条将出站的消息做脱敏。
 *
 * @param {Array<{role?: string, content?: unknown}>} messages 出站消息数组
 * @returns {{messages: Array<object>, hits: Array<{type: string, count: number}>}}
 */
export function sanitizeOutboundMessages(messages) {
  if (!Array.isArray(messages)) return { messages: Array.isArray(messages) ? messages : [], hits: [] };
  const hits = [];
  const sanitized = messages.map((message) => {
    if (!message || typeof message.content !== "string") return message;
    const { text, hits: messageHits } = redactSensitiveText(message.content);
    if (messageHits.length) hits.push(...messageHits);
    return message.content === text ? message : { ...message, content: text };
  });
  return { messages: sanitized, hits };
}

const HIT_LABELS = {
  phone: "手机号",
  email: "邮箱",
  url: "网址",
  id: "编号"
};

/**
 * 把脱敏命中结果格式化为给用户看的信任提示文案。
 * 无命中时返回空字符串（调用方隐藏提示即可）。
 * @param {Array<{type: string, count: number}>} hits
 * @returns {string}
 */
export function formatRedactionNotice(hits) {
  if (!Array.isArray(hits) || hits.length === 0) return "";
  const parts = hits.map((hit) => {
    const label = HIT_LABELS[hit.type] || hit.type;
    return `${label} ${hit.count} 处`;
  });
  return `已脱敏 ${parts.join("、")}，未发送原始信息`;
}
