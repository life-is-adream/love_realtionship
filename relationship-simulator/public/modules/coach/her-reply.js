/**
 * 她的回复归一化：把模型输出拆成微信气泡。
 *
 * 分隔符按演出规则的约定是反斜杠，另外兼容换行。围栏、包裹引号、说话人前缀
 * 都要剥掉——否则教练腔或 JSON 碎片会直接出现在聊天窗口里。
 *
 * 纯函数：不读 DOM、不读 store、不调模型。
 *
 * @module her-reply
 */

/** 单轮最多几条气泡（真人微信连发的经验上限） */
export const MAX_HER_BUBBLES = 3;

/** 单条气泡最长字符数，超出截断（防她把教练提示原文吐回来） */
export const MAX_HER_BUBBLE_LENGTH = 120;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 剥掉单条气泡的引号、说话人前缀与空白，返回可用文本；不可用返回空串 */
function cleanBubble(value, speakerNames) {
  let text = String(value || "").replace(/\s+/g, " ").trim();
  text = text.replace(/^["“」』']+/, "").replace(/["”「』']+$/, "").trim();
  for (const name of speakerNames) {
    const prefix = new RegExp(`^${escapeRegExp(name)}[：:]\\s*`);
    const stripped = text.replace(prefix, "").trim();
    if (stripped !== text) { text = stripped; break; }
  }
  if (!text) return "";
  // 以括号/花括号开头是模型在吐结构，不是她说的话。
  if (/^[{[]/.test(text)) return "";
  return text.length > MAX_HER_BUBBLE_LENGTH ? `${text.slice(0, MAX_HER_BUBBLE_LENGTH)}…` : text;
}

/**
 * @param {string} raw - 模型返回的原文
 * @param {string} [personaName=""] - 角色名，用于剥掉「角色名：」前缀
 * @returns {string[]} 气泡文本数组（可能为空，表示本轮没有可用回复）
 */
export function parseHerBubbles(raw, personaName = "") {
  const text = String(raw || "")
    .replace(/^```(?:text|txt|json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  if (!text) return [];
  const speakerNames = ["她", personaName].filter(Boolean);
  const bubbles = [];
  for (const chunk of text.split(/\\|\r?\n/)) {
    const bubble = cleanBubble(chunk, speakerNames);
    if (bubble) bubbles.push(bubble);
    if (bubbles.length >= MAX_HER_BUBBLES) break;
  }
  return bubbles;
}

/**
 * 合成给教练、训练日志与朗读用的单条文本。
 * @param {string[]} bubbles
 * @returns {string}
 */
export function joinHerReply(bubbles) {
  return (Array.isArray(bubbles) ? bubbles : []).filter(Boolean).join(" ");
}
