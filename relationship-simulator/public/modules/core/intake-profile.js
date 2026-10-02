/**
 * F3 入学测试画像：normalizeIntakeProfile / buildIntakeSummary / readIntakeProfile。
 * 纯函数模块，不触碰 DOM。
 *
 * 数据来源：public/intake-quiz.html（15 题入学测试）结果页把 profile JSON
 * 直接写入 localStorage 的 'heartflow-intake-profile'（独立键，主 state 之外，
 * quiz 页走 localStorage.setItem 合法；主应用只读 + 清坏键，不参与主 mutate 写路径）。
 *
 * quiz 原始字段 → 存储结构（storage 存 quiz profile JSON 原文，无二次包装）：
 *   version                 -> version        string（如 "1.0"）
 *   testDate                -> testDate       "YYYY-MM-DD" 字符串
 *   questions               -> questions      正整数（15）
 *   attachment.primary      -> attachment.primary        "anxious" | "secure" | "avoidant"
 *   attachment.distribution -> attachment.distribution  { anxious, secure, avoidant } 各 0-100 数字
 *   communicationStyle      -> communicationStyle        string[]（中文短标签，≤3）
 *   emotionHandling         -> emotionHandling           string[]（中文短标签，≤3）
 *   actionPattern           -> actionPattern             string[]（中文短标签，≤2）
 *   weaknessPatterns        -> weaknessPatterns          string[]（英文键，见 INTAKE_WEAKNESS_LABELS）
 *   trainingFocus           -> trainingFocus             string[]（中文训练建议，≤4）
 *
 * normalizeIntakeProfile 校验必填字段 / 类型 / 计分范围，
 * 产出渲染友好结构（补 primaryLabel）；任何一项非法 → 返回 null（视为无画像）。
 */

import { STORAGE_KEYS } from "./config.js";

export const INTAKE_ATTACHMENT_VALUES = ["anxious", "secure", "avoidant"];

export const INTAKE_ATTACHMENT_LABELS = {
  anxious: "焦虑型",
  secure: "安全型",
  avoidant: "回避型"
};

/** quiz 结果页弱点模式英文键 → 中文标签（与 intake-quiz.html 的 wLabels 保持一致） */
export const INTAKE_WEAKNESS_LABELS = {
  interrogation: "查户口式追问",
  overthinking: "过度分析/犹豫",
  "rationalize-emotion": "理性回应情绪",
  "avoidant-withdrawal": "回避式撤退",
  "action-paralysis": "行动瘫痪",
  "impulsive-escalation": "冲动推进"
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidDateString(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

/** 数组字段：必须是数组；过滤掉非字符串/空白项。非数组返回 null（整体拒绝）。 */
function toStringArray(value) {
  if (!Array.isArray(value)) return null;
  return value
    .filter((item) => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

/**
 * 校验并规范化 quiz profile。
 * @param {unknown} json - JSON.parse 后的画像对象（或任意输入）
 * @returns {object|null} 渲染友好结构；非法输入返回 null
 */
export function normalizeIntakeProfile(json) {
  if (!isPlainObject(json)) return null;
  if (!isValidDateString(json.testDate)) return null;
  if (typeof json.questions !== "number" || !Number.isInteger(json.questions) || json.questions < 1) return null;

  const attachment = json.attachment;
  if (!isPlainObject(attachment)) return null;
  if (!INTAKE_ATTACHMENT_VALUES.includes(attachment.primary)) return null;
  const distribution = attachment.distribution;
  if (!isPlainObject(distribution)) return null;
  const normalizedDistribution = {};
  for (const key of INTAKE_ATTACHMENT_VALUES) {
    const value = distribution[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) return null;
    normalizedDistribution[key] = Math.round(value);
  }

  const communicationStyle = toStringArray(json.communicationStyle);
  const emotionHandling = toStringArray(json.emotionHandling);
  const actionPattern = toStringArray(json.actionPattern);
  if (!communicationStyle || !emotionHandling || !actionPattern) return null;

  return {
    version: typeof json.version === "string" ? json.version : "",
    testDate: json.testDate,
    questions: json.questions,
    attachment: {
      primary: attachment.primary,
      primaryLabel: INTAKE_ATTACHMENT_LABELS[attachment.primary] || attachment.primary,
      distribution: normalizedDistribution
    },
    communicationStyle,
    emotionHandling,
    actionPattern,
    weaknessPatterns: toStringArray(json.weaknessPatterns) ?? [],
    trainingFocus: toStringArray(json.trainingFocus) ?? []
  };
}

/**
 * 确定性中文摘要句（无随机、无时间依赖，可直接断言）。
 * @param {object|null} profile - normalizeIntakeProfile 的产出（或兼容形状）
 * @returns {string} 非法/缺失时返回空串
 */
export function buildIntakeSummary(profile) {
  if (!isPlainObject(profile) || !isPlainObject(profile.attachment)) return "";
  const distribution = profile.attachment.distribution;
  if (!isPlainObject(distribution)) return "";
  const primaryLabel = profile.attachment.primaryLabel
    || INTAKE_ATTACHMENT_LABELS[profile.attachment.primary]
    || profile.attachment.primary;
  if (!primaryLabel) return "";
  const style = (profile.communicationStyle || []).slice(0, 3).join("、") || "未标注";
  const action = (profile.actionPattern || []).slice(0, 2).join("、") || "未标注";
  const weaknesses = (profile.weaknessPatterns || [])
    .map((key) => INTAKE_WEAKNESS_LABELS[key] || key)
    .slice(0, 2)
    .join("、");
  const focusPart = weaknesses ? `，弱点模式重点关注${weaknesses}` : "";
  return `依恋倾向以${primaryLabel}为主（焦虑 ${distribution.anxious ?? "—"}% · 安全 ${distribution.secure ?? "—"}% · 回避 ${distribution.avoidant ?? "—"}%），沟通风格偏${style}，行动模式偏${action}${focusPart}`;
}

/**
 * 从持久化接口读取并规范化画像；坏 JSON / 字段缺失 / 计分越界 → 清键并返回 null。
 * 只清该独立键，不触碰主 state。
 * @param {Storage|null} [storage] - 默认 globalThis.localStorage；测试可注入内存实现
 * @returns {object|null}
 */
export function readIntakeProfile(storage = globalThis.localStorage) {
  if (!storage || typeof storage.getItem !== "function") return null;
  let raw = null;
  try {
    raw = storage.getItem(STORAGE_KEYS.intakeProfile);
  } catch {
    return null;
  }
  if (typeof raw !== "string" || raw.length === 0) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const profile = normalizeIntakeProfile(parsed);
  if (!profile) {
    try {
      if (typeof storage.removeItem === "function") storage.removeItem(STORAGE_KEYS.intakeProfile);
    } catch {
      // 清键失败不阻断：调用方按无画像处理
    }
    return null;
  }
  return profile;
}
