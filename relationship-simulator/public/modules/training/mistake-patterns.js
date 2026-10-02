/**
 * F2 失误模式雷达：纯函数聚合 + 重写练习对比，零 DOM / 零 LLM。
 *
 * 输入为 state.mistakes（core/mistakes.js 的条目契约），输出确定性、
 * 本地生成的聚合结果与中文诊断句，供 render-mistakes.js 渲染摘要条。
 */

import { MISTAKE_DIM_KEYS } from "../core/mistakes.js";

/** 维度中文标签（drive 对应教练引擎的 momentum/推进力） */
export const MISTAKE_DIM_LABELS = Object.freeze({
  naturalness: "自然度",
  empathy: "共情",
  boundary: "边界感",
  drive: "推进力"
});

/** 洞察规则阈值（确定性，可在测试中覆盖） */
export const MISTAKE_PATTERN_RULES = Object.freeze({
  /** 单一未解决维度占比阈值 */
  dimShare: 0.4,
  /** 单一未解决维度最少条数 */
  dimMinCount: 3,
  /** 同一 preflight 标签点名阈值 */
  issueMinCount: 3,
  /** topIssues 返回上限 */
  topIssuesLimit: 5
});

/** 错题维度键 → 教练评分键（drive ↔ momentum） */
const COACH_KEY_BY_DIM = Object.freeze({ naturalness: "naturalness", empathy: "empathy", boundary: "boundary", drive: "momentum" });

/**
 * 从 dims 对象找最弱维度（只统计有分数的维度）。
 * @param {Object|null|undefined} dims - { naturalness, empathy, boundary, drive }
 * @returns {{ key: string, value: number }|null}
 */
export function findWeakestDim(dims) {
  if (!dims || typeof dims !== "object") return null;
  let weakest = null;
  for (const key of MISTAKE_DIM_KEYS) {
    const raw = dims[key];
    // Number(null)/Number("") 均为 0，未评分哨兵值必须先排除
    if (raw === null || raw === undefined || raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    if (!weakest || value < weakest.value) weakest = { key, value };
  }
  return weakest;
}

/**
 * 聚合失误模式。
 * dimCounts / weakestDim 只统计「未解决」错题的最弱维度（雷达关注待修复项）；
 * sourceCounts / topIssues / resolvedRatio 统计全量。
 * @param {Object[]|null|undefined} mistakes
 * @param {Object} [rules] - 阈值（默认 MISTAKE_PATTERN_RULES）
 * @returns {{
 *   total: number, unresolvedCount: number, weakestDim: string|null,
 *   dimCounts: Record<string, number>, sourceCounts: Record<string, number>,
 *   topIssues: Array<{label: string, count: number}>,
 *   resolvedRatio: number|null, insights: string[]
 * }}
 */
export function aggregateMistakePatterns(mistakes, rules = MISTAKE_PATTERN_RULES) {
  const list = Array.isArray(mistakes) ? mistakes.filter((item) => item && typeof item === "object") : [];
  const unresolved = list.filter((item) => item.resolved !== true);

  const dimCounts = Object.fromEntries(MISTAKE_DIM_KEYS.map((key) => [key, 0]));
  for (const mistake of unresolved) {
    const weakest = findWeakestDim(mistake.dims);
    if (weakest && dimCounts[weakest.key] !== undefined) dimCounts[weakest.key] += 1;
  }
  const dimEntries = Object.entries(dimCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const weakestDim = dimEntries[0] && dimEntries[0][1] > 0 ? dimEntries[0][0] : null;

  const sourceCounts = { preflight: 0, coach: 0, manual: 0 };
  for (const mistake of list) {
    if (sourceCounts[mistake.source] !== undefined) sourceCounts[mistake.source] += 1;
  }

  const issueCounts = new Map();
  for (const mistake of list) {
    const issues = Array.isArray(mistake.issues) ? mistake.issues : [];
    for (const raw of issues) {
      const label = String(raw ?? "").trim();
      if (!label) continue;
      issueCounts.set(label, (issueCounts.get(label) || 0) + 1);
    }
  }
  const topIssues = [...issueCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, rules.topIssuesLimit)
    .map(([label, count]) => ({ label, count }));

  const resolvedCount = list.filter((item) => item.resolved === true).length;
  const resolvedRatio = list.length ? resolvedCount / list.length : null;

  return {
    total: list.length,
    unresolvedCount: unresolved.length,
    weakestDim,
    dimCounts,
    sourceCounts,
    topIssues,
    resolvedRatio,
    insights: buildInsights({ unresolvedCount: unresolved.length, dimCounts, topIssues, list, rules })
  };
}

/**
 * 确定性生成中文诊断句：
 * ① 某一未解决维度占比 ≥40% 且 ≥3 条 → 针对性练习建议；
 * ② 同一 preflight 标签 ≥3 次 → 点名该模式。
 * @param {Object} input
 * @returns {string[]}
 */
function buildInsights({ unresolvedCount, dimCounts, topIssues, list, rules }) {
  const insights = [];

  if (unresolvedCount > 0) {
    for (const [key, count] of Object.entries(dimCounts)) {
      if (count < rules.dimMinCount) continue;
      if (count / unresolvedCount < rules.dimShare) continue;
      const label = MISTAKE_DIM_LABELS[key] || key;
      const percent = Math.round((count / unresolvedCount) * 100);
      insights.push(`未解决错题中「${label}」短板占 ${percent}%（${count}/${unresolvedCount} 条），建议针对性练习${label}表达。`);
    }
  }

  // 点名规则只统计 preflight 来源的标签（规格口径），coach 短板标签不参与点名。
  const preflightIssueCounts = new Map();
  for (const mistake of list) {
    if (mistake.source !== "preflight") continue;
    const issues = Array.isArray(mistake.issues) ? mistake.issues : [];
    for (const raw of issues) {
      const label = String(raw ?? "").trim();
      if (!label) continue;
      preflightIssueCounts.set(label, (preflightIssueCounts.get(label) || 0) + 1);
    }
  }
  const named = [...preflightIssueCounts.entries()]
    .filter(([, count]) => count >= rules.issueMinCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [label, count] of named) {
    insights.push(`「${label}」类高危风险已出现 ${count} 次，注意识别同一模式的触发场景并提前改写。`);
  }

  return insights;
}

/**
 * 重写练习对比：原文四维 vs 本地重写评分四维 + 风险差异 + 可否标记解决。
 * 可解决判定：各维均不低于原值（null 维度不参与比较）且重写无高危警告。
 * @param {Object|null|undefined} originalDims - 错题条目的 dims
 * @param {Object|null|undefined} rewriteScore - buildCoachScore(重写文本) 的返回值
 * @param {Object|null|undefined} flags - detectReplyFlags(重写文本) 的返回值
 * @returns {{
 *   dims: Array<{key: string, label: string, before: number|null, after: number|null, delta: number|null}>,
 *   hasHighRisk: boolean, riskLevel: string|null, riskWarning: string,
 *   allDimsImproved: boolean, canResolve: boolean
 * }}
 */
export function buildRewriteComparison(originalDims, rewriteScore, flags = null) {
  const before = originalDims && typeof originalDims === "object" ? originalDims : {};
  const dims = MISTAKE_DIM_KEYS.map((key) => {
    const beforeValue = normalizeScore(before[key]);
    const afterValue = normalizeScore(rewriteScore?.[COACH_KEY_BY_DIM[key]]);
    return {
      key,
      label: MISTAKE_DIM_LABELS[key],
      before: beforeValue,
      after: afterValue,
      delta: beforeValue !== null && afterValue !== null ? afterValue - beforeValue : null
    };
  });
  const allDimsImproved = dims.every((dim) => dim.before === null || dim.after === null || dim.after >= dim.before);
  const hasHighRisk = Boolean(flags && flags.level === "high");
  const canResolve = allDimsImproved && !hasHighRisk && dims.some((dim) => dim.after !== null);
  return {
    dims,
    hasHighRisk,
    riskLevel: flags && typeof flags.level === "string" ? flags.level : null,
    riskWarning: typeof flags?.warning === "string" ? flags.warning : "",
    allDimsImproved,
    canResolve
  };
}

function normalizeScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.min(100, Math.round(num))) : null;
}
