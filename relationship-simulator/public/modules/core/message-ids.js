/**
 * 稳定消息 ID（P1 引入，供证据台账与后续 Memory 2.0 引用）。
 *
 * 关键设计：ID **由消息内容推导**，不是随机生成后依赖持久化。
 * 因此同一份会话无论加载多少次、是否被保存过，ID 都完全一致 —— 这直接满足
 * 「迁移幂等、重复读取不变」的验收条件，也避免把 loadState 变成写操作。
 *
 * 已知局限：ID 不落盘、每次现算，所以删掉一条重复消息会让其后同文消息的序号前移、ID 变化。
 * 真正的安全边界由身份键决定：ID 只与「说话人 + 正文」绑定，因此残留引用要么查不到，
 * 要么命中另一条**正文与说话人完全相同**的消息 —— 台账不会因此把事实安到别的内容上。
 * 该不变量由 test/message-ids.test.mjs 的「删除消息后，残留引用只可能指向同内容消息或查不到」钉住。
 */

const HASH_BASE = 0xcbf29ce484222325n;
const HASH_PRIME = 0x100000001b3n;
const HASH_MODULUS = 2n ** 64n;

/** FNV-1a 64 位（BigInt，零依赖），输出 base36 短哈希。 */
function hashString(text) {
  let hash = HASH_BASE;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * HASH_PRIME) % HASH_MODULUS;
  }
  return hash.toString(36);
}

const speakerKey = (message) =>
  (message?.type === "me" ? "me" : message?.type === "her" ? "her" : "other");

/** 消息的身份键：说话人 + 正文（内容相同、说话人不同 => 不同身份）。 */
export function messageIdentity(message) {
  return `${speakerKey(message)}::${String(message?.text ?? "").trim()}`;
}

/** 纯函数：给定消息与同身份出现次序，算出它的 ID。 */
export function computeMessageId(message, occurrence = 0) {
  const digest = hashString(messageIdentity(message));
  return occurrence > 0 ? `m-${digest}-${occurrence}` : `m-${digest}`;
}

/**
 * 为整段会话补齐 mid。幂等：已有且未重复的 mid 原样保留。
 * @param {Array<Object>} messages
 * @returns {Array<Object>}
 */
export function assignMessageIds(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const occurrences = new Map();
  const used = new Set();
  return list.map((message) => {
    if (!message || typeof message !== "object") return message;
    // 先计数再判断是否沿用旧 ID：否则重复消息的次序会算错，导致 ID 冲突。
    const identity = messageIdentity(message);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    if (typeof message.mid === "string" && message.mid && !used.has(message.mid)) {
      used.add(message.mid);
      return message;
    }
    let mid = computeMessageId(message, occurrence);
    for (let bump = 1; used.has(mid); bump += 1) mid = `${computeMessageId(message, occurrence)}-${bump}`;
    used.add(mid);
    return { ...message, mid };
  });
}

/** 按 mid 查消息；查不到返回 null（调用方据此判定「来源已失效」）。 */
export function findMessageById(messages, mid) {
  const list = Array.isArray(messages) ? messages : [];
  return list.find((message) => message?.mid === mid) || null;
}

/**
 * 计算「把 message 追加到 messages 之后」会得到的 ID。
 * 供写入点直接取用，避免每次 push 都重算整段会话。
 */
export function nextMessageIdFor(messages, message) {
  const identity = messageIdentity(message);
  const occurrence = (Array.isArray(messages) ? messages : [])
    .reduce((count, item) => (messageIdentity(item) === identity ? count + 1 : count), 0);
  return computeMessageId(message, occurrence);
}
