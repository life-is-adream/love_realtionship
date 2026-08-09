/**
 * Character Card 规范（简化版 CCC）
 *
 * 定义角色卡数据结构，支持 JSON 导入/导出。
 * 兼容现有 builtInPersonas 格式，并提供双向转换。
 *
 * @module character-card
 */

// ── Schema 定义 ───────────────────────────────────────────────────────────────

/**
 * CCC 版本号
 * @type {string}
 */
export const CCC_VERSION = "1.0";

/**
 * 角色卡 JSON Schema 的字段定义
 *
 * 顶层字段：
 * - ccc_version: string - 规范版本号
 * - id: string - 唯一标识
 * - name: string - 显示名称
 * - meta: string - 简短介绍（年龄/职业/类型）
 * - tags: string[] - 标签列表
 * - description: string - 角色描述（对应 logic + systemRole 的合并文本）
 * - language_style: string - 语言风格描述
 * - boundaries: string[] - 边界/禁忌列表
 * - starter_messages: { who: string, text: string }[] - 初始对话
 * - default_goal: string - 默认目标
 * - local_her_reply: string - 本地离线回复
 */

/**
 * 验证角色卡数据是否符合 CCC 规范
 * @param {Object} card - 待验证的角色卡
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateCharacterCard(card) {
  const errors = [];
  if (!card || typeof card !== "object") return { valid: false, errors: ["card 必须是对象"] };

  if (!card.ccc_version) errors.push("缺少 ccc_version");
  if (!card.id || typeof card.id !== "string") errors.push("id 必须是非空字符串");
  if (!card.name || typeof card.name !== "string") errors.push("name 必须是非空字符串");
  if (!card.description || typeof card.description !== "string") errors.push("description 必须是非空字符串");
  if (card.tags && !Array.isArray(card.tags)) errors.push("tags 必须是数组");
  if (card.starter_messages && !Array.isArray(card.starter_messages)) errors.push("starter_messages 必须是数组");
  if (card.starter_messages) {
    card.starter_messages.forEach((m, i) => {
      if (!m.who || !m.text) errors.push(`starter_messages[${i}] 缺少 who 或 text`);
    });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 将内置角色对象转换为 CCC 角色卡
 * @param {string} id - 角色 ID
 * @param {Object} persona - 内置角色对象
 * @returns {Object} CCC 角色卡
 */
export function personaToCharacterCard(id, persona) {
  const description = [persona.logic, persona.systemRole].filter(Boolean).join("\n\n");
  const boundaries = (persona.tags || [])
    .filter((t) => /讨厌|边界|不吃/.test(t))
    .map((t) => t.replace(/^讨厌/, "").trim() || t);

  return {
    ccc_version: CCC_VERSION,
    id: persona.id || id,
    name: persona.name,
    avatar: persona.avatar || "",
    avatarImage: persona.avatarImage || "",
    meta: persona.meta || "",
    tags: persona.tags || [],
    description,
    language_style: extractLanguageStyle(persona.systemRole || ""),
    boundaries,
    starter_messages: (persona.starterMessages || []).map((m) => ({
      who: m.who || "",
      text: m.text || ""
    })),
    default_goal: persona.defaultGoal || "",
    local_her_reply: persona.localHerReply || ""
  };
}

/**
 * 将 CCC 角色卡转换为内置角色对象格式
 * @param {Object} card - CCC 角色卡
 * @returns {Object} 内置角色对象（builtInPersonas 格式）
 */
export function characterCardToPersona(card) {
  const systemRole = buildSystemRoleFromCard(card);
  return {
    id: card.id,
    name: card.name,
    avatar: card.avatar || card.name?.[0] || "?",
    avatarImage: card.avatarImage || "",
    meta: card.meta || "",
    tags: card.tags || [],
    logic: card.description?.split("\n\n")[0] || "",
    systemRole,
    starterMessages: (card.starter_messages || []).map((m) => ({
      who: m.who,
      type: m.who === card.name ? "her" : "me",
      text: m.text
    })),
    defaultGoal: card.default_goal || "",
    localHerReply: card.local_her_reply || ""
  };
}

/**
 * 从 CCC 角色卡构建 systemRole 文本
 * @param {Object} card - CCC 角色卡
 * @returns {string}
 */
function buildSystemRoleFromCard(card) {
  const parts = [];
  if (card.name && card.meta) {
    parts.push(`[身份] ${card.name}，${card.meta}。`);
  }
  parts.push("[行为规则]");
  if (card.language_style) {
    parts.push(`- 语言风格：${card.language_style}`);
  }
  if (card.boundaries?.length) {
    parts.push("[禁止行为]");
    card.boundaries.forEach((b) => parts.push(`- ${b}`));
  }
  if (card.description) {
    const descLines = card.description.split("\n").filter((l) => !l.startsWith("["));
    if (descLines.length) {
      parts.push("---");
      descLines.forEach((l) => parts.push(l));
    }
  }
  return parts.join("\n");
}

/**
 * 从 systemRole 中提取语言风格描述
 * @param {string} systemRole
 * @returns {string}
 */
function extractLanguageStyle(systemRole) {
  const match = systemRole.match(/\[语言风格\]\s*(.+?)(?:\n|$)/);
  return match ? match[1].trim() : "";
}

/**
 * 将角色卡导出为 JSON 字符串
 * @param {Object} card - CCC 角色卡
 * @returns {string}
 */
export function exportCharacterCard(card) {
  const { valid, errors } = validateCharacterCard(card);
  if (!valid) throw new Error(`角色卡校验失败：${errors.join("；")}`);
  return JSON.stringify(card, null, 2);
}

/**
 * 从 JSON 字符串导入角色卡
 * @param {string} json - JSON 字符串
 * @returns {{ ok: boolean, card?: Object, error?: string }}
 */
export function importCharacterCard(json) {
  try {
    const parsed = JSON.parse(json);
    const { valid, errors } = validateCharacterCard(parsed);
    if (!valid) return { ok: false, error: `角色卡校验失败：${errors.join("；")}` };
    return { ok: true, card: parsed };
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${e.message}` };
  }
}

/**
 * 将当前所有内置角色导出为 CCC 角色卡数组
 * @param {Object<string, Object>} builtInPersonas - 内置角色对象
 * @returns {Object[]} CCC 角色卡数组
 */
export function exportAllPersonas(builtInPersonas) {
  return Object.entries(builtInPersonas).map(([id, persona]) =>
    personaToCharacterCard(id, persona)
  );
}