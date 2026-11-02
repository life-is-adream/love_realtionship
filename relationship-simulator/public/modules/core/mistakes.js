/**
 * F2 错题本数据层：纯函数，无 DOM / 无 localStorage 依赖。
 *
 * 持久化在主状态 `state.mistakes`（不新增 STORAGE key），写路径一律经
 * mutate(fn)（见 core/state.js）。本模块只提供数组的纯变换与收集判定，
 * 由 app.js / render 层在 mutate 回调内调用。
 *
 * 条目契约：{ id, ts, source, stage, mode, text, dims, issues, resolved,
 * resolvedAt, rewriteText, rewriteDims }。dims 键沿用规格命名
 * naturalness/empathy/boundary/drive（drive 对应教练引擎的 momentum/推进力）。
 */

import { clampScoreOrNull } from "./number.js";

export const MISTAKES_LIMIT = 200; // 对齐项目 200 条上限惯例（learning.events / messages 同规格）

export const MISTAKE_SOURCES = Object.freeze(["preflight", "coach", "manual"]);

export const MISTAKE_DIM_KEYS = Object.freeze(["naturalness", "empathy", "boundary", "drive"]);

/** 收集阈值：教练总分 < 65 或任一维度 < 55（依据见 docs/coach-calibration-baseline.md 负向样本阈值 ≤65） */
export const MISTAKE_COLLECT_RULES = Object.freeze({
  overallBelow: 65,
  dimBelow: 55
});

/** 教练引擎（buildCoachScore）的维度键，与 MISTAKE_DIM_KEYS 的 drive 对应 momentum */
const COACH_DIM_KEYS = Object.freeze(["naturalness", "empathy", "boundary", "momentum"]);

/**
 * 收集判定一：教练评分后是否自动收集错题。
 * 总分 < overallBelow 或任一维度 < dimBelow 即收集（严格小于）。
 * @param {Object|null|undefined} score - buildCoachScore 的返回值
 * @returns {boolean}
 */
export function shouldCollectFromScore(score) {
  if (!isRecord(score)) return false;
  const total = Number(score.total);
  if (Number.isFinite(total) && total < MISTAKE_COLLECT_RULES.overallBelow) return true;
  return COACH_DIM_KEYS.some((key) => {
    const value = Number(score[key]);
    return Number.isFinite(value) && value < MISTAKE_COLLECT_RULES.dimBelow;
  });
}

/**
 * 收集判定二：发送前测验是否自动收集错题。
 * 保守收集防噪音：仅最高档（high，越界/施压词命中）收集，medium/low 不收集。
 * @param {Object|null|undefined} flags - detectReplyFlags 的返回值
 * @returns {boolean}
 */
export function shouldCollectFromPreflight(flags) {
  return Boolean(isRecord(flags) && flags.level === "high");
}

const BOUNDARY_RISK_WORDS = Object.freeze(["性感", "身材", "酒店", "睡"]);
const PRESSURE_RISK_WORDS = Object.freeze(["必须", "一定", "马上", "宝贝", "亲", "出来", "约吗"]);

/**
 * 把 preflight 命中的风险词归类为雷达可聚合的语义标签（"越界词"/"施压词"）。
 * @param {string[]} [words] - detectReplyFlags 返回的命中词列表
 * @returns {string[]}
 */
export function classifyPreflightIssues(words = []) {
  const list = Array.isArray(words) ? words : [];
  const issues = [];
  if (list.some((word) => BOUNDARY_RISK_WORDS.includes(word))) issues.push("越界词");
  if (list.some((word) => PRESSURE_RISK_WORDS.includes(word))) issues.push("施压词");
  return issues;
}

/**
 * 标准化单条错题（非法输入回退默认值，不抛错）。
 * @param {Object|null|undefined} input
 * @returns {Object}
 */
export function createMistake(input = {}) {
  const value = isRecord(input) ? input : {};
  return {
    id: normalizeId(value.id),
    ts: normalizeTs(value.ts),
    source: MISTAKE_SOURCES.includes(value.source) ? value.source : "manual",
    stage: typeof value.stage === "string" ? value.stage : "",
    mode: value.mode === "pua" ? "pua" : "anti",
    text: typeof value.text === "string" ? value.text.trim() : "",
    dims: normalizeDims(value.dims),
    issues: Array.isArray(value.issues)
      ? value.issues.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [],
    resolved: value.resolved === true,
    resolvedAt: typeof value.resolvedAt === "string" && value.resolvedAt ? value.resolvedAt : null,
    rewriteText: typeof value.rewriteText === "string" && value.rewriteText.trim() ? value.rewriteText : null,
    rewriteDims: isRecord(value.rewriteDims) ? normalizeDims(value.rewriteDims) : null
  };
}

/**
 * 去重：最近一条相同 text 的错题若仍未解决则视为重复（防同一句连续刷屏）。
 * 从最新往旧找第一条同 text 条目；已解决的同 text 不算重复。
 * @param {Object[]} mistakes
 * @param {string} text
 * @returns {Object|null} 命中的未解决重复条目，无重复返回 null
 */
export function findDuplicateMistake(mistakes, text) {
  const needle = String(text || "").trim();
  if (!needle || !Array.isArray(mistakes)) return null;
  for (let i = mistakes.length - 1; i >= 0; i -= 1) {
    const mistake = mistakes[i];
    if (!mistake || mistake.text !== needle) continue;
    return mistake.resolved === true ? null : mistake;
  }
  return null;
}

/**
 * 收集一条错题：去重 + 追加 + 上限裁剪（超限丢最旧）。
 * 纯函数，返回 { mistakes, collected }。
 * @param {Object[]} mistakes - 现有列表（旧→新）
 * @param {Object} entry - 待收集条目（内部经 createMistake 标准化）
 * @returns {{ mistakes: Object[], collected: boolean }}
 */
export function collectMistake(mistakes, entry) {
  const list = Array.isArray(mistakes) ? mistakes : [];
  const normalized = createMistake(entry);
  if (!normalized.text) return { mistakes: list, collected: false };
  if (findDuplicateMistake(list, normalized.text)) return { mistakes: list, collected: false };
  return { mistakes: appendMistake(list, normalized), collected: true };
}

/**
 * 追加一条已标准化的错题并裁剪到上限（丢弃最旧）。
 * @param {Object[]} mistakes
 * @param {Object} mistake
 * @returns {Object[]}
 */
export function appendMistake(mistakes, mistake) {
  return [...(Array.isArray(mistakes) ? mistakes : []), mistake].slice(-MISTAKES_LIMIT);
}

/**
 * 标记解决：写 resolved/resolvedAt，可选写入重写文本与重写后维度。
 * id 不存在时原样返回（浅拷贝）。
 * @param {Object[]} mistakes
 * @param {string} id
 * @param {{ rewriteText?: string|null, rewriteDims?: Object|null }} [patch]
 * @returns {Object[]}
 */
export function resolveMistake(mistakes, id, patch = {}) {
  const list = Array.isArray(mistakes) ? mistakes : [];
  let found = false;
  const next = list.map((mistake) => {
    if (!mistake || mistake.id !== id) return mistake;
    found = true;
    return {
      ...mistake,
      resolved: true,
      resolvedAt: new Date().toISOString(),
      rewriteText: typeof patch.rewriteText === "string" && patch.rewriteText.trim()
        ? patch.rewriteText
        : mistake.rewriteText,
      rewriteDims: isRecord(patch.rewriteDims) ? normalizeDims(patch.rewriteDims) : mistake.rewriteDims
    };
  });
  return found ? next : list;
}

/**
 * 删除指定 id 的错题。
 * @param {Object[]} mistakes
 * @param {string} id
 * @returns {Object[]}
 */
export function deleteMistake(mistakes, id) {
  const list = Array.isArray(mistakes) ? mistakes : [];
  return list.filter((mistake) => mistake && mistake.id !== id);
}

/**
 * 标准化持久化的 mistakes 数组（state.normalizeState / 载入时调用）。
 * @param {Object[]|null|undefined} value
 * @returns {Object[]}
 */
export function normalizeMistakes(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .filter((item) => isRecord(item))
    .map((item) => createMistake(item))
    .slice(-MISTAKES_LIMIT);
}

// ── 内部工具 ─────────────────────────────────────────────────────────────────

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  // id 生成沿用项目惯例（learning-state.normalizeId 同款式）
  return id || `mistake-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && value.trim() && !Number.isNaN(Date.parse(value))) return value;
  return new Date().toISOString();
}

function normalizeDims(value) {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(
    MISTAKE_DIM_KEYS.map((key) => {
      // clampScoreOrNull 已排除 Number(null)/Number("") 均为 0 的陷阱：
      // 「未评分」哨兵值保持 null，不会被悄悄变成 0 分。
      return [key, clampScoreOrNull(source[key])];
    })
  );
}
