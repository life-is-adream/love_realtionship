/**
 * F4 会话级复盘报告：纯函数聚合，零 DOM / 零 localStorage / 零 LLM。
 *
 * 数据来源（从实态取数，不虚构）：
 * - messages：state.messages（type "me" 为用户消息，messageCount 只统计有效用户消息）；
 * - analyses：state.trainingLog 的评分条目经 buildAnalysesFromTrainingLog 标准化。
 *   trainingLog 只保留最近 12 条教练评分（含 mine 文本 + coachScore），learning.events
 *   的 coach-score 事件虽有维度 metadata 但无消息文本，故报告以 trainingLog 为主源；
 *   历史消息无分析数据时如实跳过，并在 coverage 中反映，不猜测、不补造分数；
 * - textbookRefs：由调用方注入 options.searchTextbook（内部必须走既有懒加载 gate
 *   enableTextbookIndexLoad，报告按钮点击属真实触发），索引未加载或无命中时空数组；
 * - 与上一份报告对比：options.lastReport（取自 learning.events 中最近一条
 *   type "session-report" 事件的 metadata）。
 *
 * 写路径约束：本模块只读、只做纯变换；训练事件落账由 render 层经 mutate(fn) +
 * recordTrainingEvent（同 id 幂等）完成，id 用 generatedAt 时间戳。
 */

import { MISTAKE_COLLECT_RULES } from "../core/mistakes.js";
import { findWeakestDim, MISTAKE_DIM_LABELS } from "./mistake-patterns.js";

/** 报告四维键（沿用错题本命名，drive 对应教练引擎的 momentum/推进力） */
export const REPORT_DIM_KEYS = Object.freeze(["naturalness", "empathy", "boundary", "drive"]);

/** 教材引用上限（对齐 TEXTBOOK_SEARCH_LIMIT） */
export const REPORT_TEXTBOOK_REF_LIMIT = 3;

/** 报告文本摘录上限（markdown 与 UI 共用） */
export const REPORT_EXCERPT_LIMIT = 160;

/** ② 对方视角回放：最多回放的消息条数（按时间正序） */
export const HER_REPLAY_LIMIT = 6;

/** 洞察规则阈值（确定性，可在测试中覆盖传参比对） */
export const SESSION_REPORT_RULES = Object.freeze({
  /** 覆盖率低于该值提示样本不足 */
  coverageLowBelow: 0.5,
  /** 覆盖率达到该值视为可信样本 */
  coverageHighAbove: 0.8,
  /** 维度均分低于该值点名最弱维度 */
  weakDimBelow: 60,
  /** 维度均分达到该值点名为最强维度 */
  strongDimAbove: 80,
  /** 与上一份报告对比的均值变化阈值（绝对值） */
  trendDelta: 3,
  /** 最佳消息达到该分提示范本（对齐错题收集线语义取高段） */
  bestOverallAtLeast: 80,
  /** 最差消息低于该分提示重点复盘（对齐 MISTAKE_COLLECT_RULES.overallBelow） */
  worstOverallBelow: 65
});

const MODE_LABELS = Object.freeze({ anti: "反操控", pua: "PUA 觉察" });

/**
 * 把 state.trainingLog 的评分条目标准化为报告输入。
 * trainingLog 为新→旧 unshift，映射后保持输入顺序；无有效总分或无文本的条目跳过。
 * @param {Array<Object>|null|undefined} trainingLog
 * @returns {Array<{text: string, ts: string|null, stage: string, source: string, overall: number, dims: Object}>}
 */
export function buildAnalysesFromTrainingLog(trainingLog) {
  const list = Array.isArray(trainingLog) ? trainingLog : [];
  const analyses = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const score = item.score && typeof item.score === "object" ? item.score : null;
    const text = String(item.mine ?? item.text ?? "").trim();
    if (!text || !score) continue;
    const overall = normalizeScore(score.total);
    if (overall === null) continue;
    analyses.push({
      text,
      ts: typeof item.time === "string" && item.time ? item.time : null,
      stage: typeof item.stage === "string" ? item.stage : "",
      source: typeof item.source === "string" ? item.source : "",
      overall,
      dims: {
        naturalness: normalizeScore(score.naturalness),
        empathy: normalizeScore(score.empathy),
        boundary: normalizeScore(score.boundary),
        drive: normalizeScore(score.momentum) // momentum → drive（错题本命名）
      }
    });
  }
  return analyses;
}

/**
 * 构建会话复盘报告（异步：textbookRefs 依赖注入的检索函数）。
 *
 * @param {Array<Object>|null|undefined} messages - state.messages
 * @param {Array<Object>|null|undefined} analyses - buildAnalysesFromTrainingLog 的输出
 * @param {Object} [options]
 * @param {string} [options.stage] - 当前阶段
 * @param {string} [options.mode] - "anti" | "pua"
 * @param {number|string|Date} [options.now] - 报告生成时间（测试可注入）
 * @param {Object|null} [options.lastReport] - 上一份报告摘要 { generatedAt, dimAverages }
 * @param {Function|null} [options.searchTextbook] - async (query, limit) => results[]，
 *   走既有教材检索链；未提供、抛错或返回空时 textbookRefs 为 []
 * @returns {Promise<Object>} 报告对象（结构见模块头注释）
 */
export async function buildSessionReport(messages, analyses, options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const rules = SESSION_REPORT_RULES;

  // 有效用户消息（与 normalizeMessages 同口径：有 text 字段；再限定 type "me" 且非空白）
  const userMessages = (Array.isArray(messages) ? messages : [])
    .filter((message) => message && typeof message.text === "string" && message.text.trim() && message.type === "me");
  const messageCount = userMessages.length;
  const messageTexts = new Set(userMessages.map((message) => message.text.trim()));

  // 标准化分析条目：同文本去重（保留 ts 更新的一条，防重发重复计分）
  const normalized = dedupeByText(normalizeAnalyses(analyses));
  // coverage 口径：分析文本必须能对上当前会话的用户消息（撤回/重置后的残留评分不算覆盖）
  const matched = normalized.filter((analysis) => messageTexts.has(analysis.text));
  const analyzedCount = matched.length;
  const coverage = messageCount > 0 ? analyzedCount / messageCount : 0;

  const dimAverages = buildDimAverages(matched);
  const best = pickExtreme(matched, "best");
  const worst = pickExtreme(matched, "worst");
  if (worst) worst.issues = buildIssueLabels(worst.dims, worst.overall);

  const textbookRefs = await collectTextbookRefs(opts.searchTextbook, best, worst);
  const generatedAt = toIso(opts.now ?? null) || new Date().toISOString();
  const insights = buildInsights({ messageCount, analyzedCount, coverage, dimAverages, best, worst, lastReport: opts.lastReport || null });
  const herReplay = buildHerReplay(matched);

  return {
    generatedAt,
    messageCount,
    analyzedCount,
    coverage,
    stage: typeof opts.stage === "string" ? opts.stage : "",
    mode: opts.mode === "pua" ? "pua" : "anti",
    dimAverages,
    best,
    worst,
    textbookRefs,
    insights,
    herReplay
  };
}

/**
 * ② 对方视角回放：把已评分的用户消息按时间正序换到「对方的阅读位置」，
 * 每条附本地启发式的视角标注（来自该条评分的维度，不是语义理解）。
 * 目的与《拣爱》一致：让学习者体验「同一句话在对方那里是什么」；
 * 标签是规则启发式，不代表对方真实感受。
 * @param {Array<{text: string, ts: string|null, overall: number, dims: Object}>} matched
 * @returns {{ lines: Array<{text: string, overall: number, tags: string[]}>, note: string }}
 */
function buildHerReplay(matched) {
  const lines = [...matched]
    .sort((a, b) => toTime(a.ts) - toTime(b.ts))
    .slice(0, HER_REPLAY_LIMIT)
    .map((analysis) => ({ text: analysis.text, overall: analysis.overall, tags: buildReplayTags(analysis.dims) }));
  return {
    lines,
    note: "回放只是把你的消息换到对方的阅读位置；标签来自维度评分的本地规则，不等于对方的真实感受，也不是读心。"
  };
}

/** 视角标注：每维最多一条、确定性；只在越过阈值时标注，不评价人格 */
function buildReplayTags(dims) {
  const tags = [];
  if (dims.empathy !== null && dims.empathy < 60) tags.push("这条更多在说你自己，先接住对方再表达");
  if (dims.boundary !== null && dims.boundary < 60) tags.push("这条留给对方的拒绝空间很小");
  if (dims.drive !== null && dims.drive >= 75) tags.push("这条在明显推进节奏");
  if (dims.naturalness !== null && dims.naturalness >= 80) tags.push("这条读起来自然");
  return tags;
}

/**
 * 把报告渲染为纯文本 Markdown（复制到剪贴板用）。
 * @param {Object|null|undefined} report - buildSessionReport 的输出
 * @returns {string}
 */
export function buildReportMarkdown(report) {
  if (!report || typeof report !== "object") return "";
  const lines = [];
  lines.push("# 会话复盘报告");
  lines.push("");
  lines.push(`- 生成时间：${report.generatedAt || "—"}`);
  lines.push(`- 阶段：${report.stage || "—"}`);
  lines.push(`- 模式：${MODE_LABELS[report.mode] || "—"}`);
  const pct = formatPercent(report.coverage);
  lines.push(`- 消息：共 ${report.messageCount ?? 0} 条 · 已评分 ${report.analyzedCount ?? 0} 条 · 覆盖率 ${pct}`);
  lines.push("");
  lines.push("## 四维均值");
  for (const key of REPORT_DIM_KEYS) {
    const value = report.dimAverages?.[key];
    lines.push(`- ${MISTAKE_DIM_LABELS[key]}：${value == null ? "—" : String(value)}`);
  }
  lines.push("");
  lines.push(renderMessageSection("最佳消息", report.best));
  lines.push("");
  lines.push(renderMessageSection("最差消息", report.worst, true));
  lines.push("");
  lines.push("## 教材复盘");
  const refs = Array.isArray(report.textbookRefs) ? report.textbookRefs : [];
  if (!refs.length) {
    lines.push("- 未命中教材复盘");
  } else {
    for (const ref of refs) {
      lines.push(`- 第${ref.chapter ?? "?"}章 · ${ref.title || "复盘片段"}：${truncateText(ref.excerpt, REPORT_EXCERPT_LIMIT)}`);
    }
  }
  lines.push("");
  lines.push("## 洞察");
  const insights = Array.isArray(report.insights) ? report.insights : [];
  if (!insights.length) {
    lines.push("- 暂无可生成的洞察。");
  } else {
    for (const insight of insights) lines.push(`- ${insight}`);
  }
  lines.push("");
  lines.push("## 对方视角回放");
  const replay = report.herReplay;
  if (replay && Array.isArray(replay.lines) && replay.lines.length) {
    lines.push(`> ${replay.note}`);
    for (const line of replay.lines) {
      lines.push(`- （${line.overall} 分）${truncateText(line.text, REPORT_EXCERPT_LIMIT)}${line.tags.length ? `\n  - 视角标注：${line.tags.join("；")}` : ""}`);
    }
  } else {
    lines.push("- 暂无已评分消息，无法回放对方视角。");
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("游戏可以重来，现实没有存档。");
  return lines.join("\n");
}

// ── 内部实现 ─────────────────────────────────────────────────────────────────

function normalizeAnalyses(analyses) {
  const list = Array.isArray(analyses) ? analyses : [];
  const normalized = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    // 兼容直接传 trainingLog 条目（含 score）或已标准化条目
    const score = item.score && typeof item.score === "object" ? item.score : null;
    const text = String(item.text ?? item.mine ?? "").trim();
    if (!text) continue;
    const overall = normalizeScore(item.overall ?? score?.total);
    if (overall === null) continue;
    const rawDims = item.dims && typeof item.dims === "object" ? item.dims : score || {};
    normalized.push({
      text,
      ts: item.ts ?? item.time ?? null,
      stage: typeof item.stage === "string" ? item.stage : "",
      overall,
      dims: {
        naturalness: normalizeScore(rawDims.naturalness),
        empathy: normalizeScore(rawDims.empathy),
        boundary: normalizeScore(rawDims.boundary),
        drive: normalizeScore(rawDims.drive ?? rawDims.momentum)
      }
    });
  }
  return normalized;
}

/** 同文本去重：保留时间更新的那条（无时间的视为最旧） */
function dedupeByText(analyses) {
  const byText = new Map();
  for (const analysis of analyses) {
    const existing = byText.get(analysis.text);
    if (!existing || toTime(analysis.ts) > toTime(existing.ts)) byText.set(analysis.text, analysis);
  }
  return [...byText.values()];
}

/**
 * 维度均值：仅对「有评分」的消息逐维求均值。
 * 陷阱防御：Number(null)/Number("") === 0，必须先显式排除 null/undefined/""。
 * 某一维没有任何评分时该维均值为 null（不虚构 0 分）。
 */
function buildDimAverages(matched) {
  const averages = {};
  for (const key of REPORT_DIM_KEYS) {
    const values = matched
      .map((analysis) => analysis.dims[key])
      .filter((value) => value !== null && value !== undefined && value !== "");
    averages[key] = values.length
      ? Math.round(values.reduce((sum, value) => sum + Number(value), 0) / values.length)
      : null;
  }
  return averages;
}

/** best：overall 最高，并列取最新；worst：overall 最低，并列取最新 */
function pickExtreme(matched, kind) {
  if (!matched.length) return null;
  let picked = matched[0];
  for (const analysis of matched.slice(1)) {
    const better = kind === "best"
      ? analysis.overall > picked.overall ||
        (analysis.overall === picked.overall && toTime(analysis.ts) >= toTime(picked.ts))
      : analysis.overall < picked.overall ||
        (analysis.overall === picked.overall && toTime(analysis.ts) >= toTime(picked.ts));
    if (better) picked = analysis;
  }
  return { text: picked.text, ts: picked.ts, dims: { ...picked.dims }, overall: picked.overall, issues: kind === "worst" ? [] : undefined };
}

/** 最差消息的短板标签：维度 < 55 逐维点名；仅总分 < 65 时点名最弱维度 */
function buildIssueLabels(dims, overall) {
  const issues = [];
  for (const key of REPORT_DIM_KEYS) {
    const value = dims[key];
    // 显式排除未评分哨兵值（Number(null) === 0 陷阱）
    if (value === null || value === undefined || value === "") continue;
    if (Number(value) < MISTAKE_COLLECT_RULES.dimBelow) issues.push(`${MISTAKE_DIM_LABELS[key]}短板`);
  }
  if (!issues.length && Number(overall) < MISTAKE_COLLECT_RULES.overallBelow) {
    const weakest = findWeakestDim(dims);
    if (weakest) issues.push(`${MISTAKE_DIM_LABELS[weakest.key] || weakest.key}短板`);
  }
  return issues;
}

/** 教材复盘引用：worst 优先、best 补足，合计 ≤3，按 chapter:reviewPointId 去重 */
async function collectTextbookRefs(searchTextbook, best, worst) {
  if (typeof searchTextbook !== "function") return [];
  const refs = [];
  const seen = new Set();
  for (const source of [worst, best]) {
    if (refs.length >= REPORT_TEXTBOOK_REF_LIMIT) break;
    const text = String(source?.text || "").trim();
    if (!text) continue;
    let results = [];
    try {
      // 检索函数由 render 层提供（内部已过懒加载 gate）；任何失败降级为空，不报错
      results = (await searchTextbook(text.slice(0, 400), REPORT_TEXTBOOK_REF_LIMIT - refs.length)) || [];
    } catch {
      results = [];
    }
    for (const result of results) {
      if (!result || typeof result !== "object") continue;
      const key = `${result.chapterId ?? ""}:${result.reviewPointId ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({
        chapter: result.chapterId,
        chapterTitle: typeof result.chapterTitle === "string" ? result.chapterTitle : "",
        reviewPointId: result.reviewPointId,
        title: typeof result.title === "string" ? result.title : "",
        excerpt: truncateText(String(result.searchExcerpt || result.title || ""), REPORT_EXCERPT_LIMIT)
      });
      if (refs.length >= REPORT_TEXTBOOK_REF_LIMIT) break;
    }
  }
  return refs;
}

/** 洞察句：确定性规则，顺序固定（覆盖 → 最弱/最强维度 → 最佳/最差 → 环比） */
function buildInsights({ messageCount, analyzedCount, coverage, dimAverages, best, worst, lastReport }) {
  const rules = SESSION_REPORT_RULES;
  const insights = [];

  if (messageCount === 0) {
    insights.push("本会话还没有有效的用户消息，先聊几轮再来生成复盘。");
    return insights;
  }
  if (analyzedCount === 0) {
    insights.push("暂无已评分消息：完成至少一轮教练分析后，这里会给出可复盘的四维结论。");
    return insights;
  }

  const pct = formatPercent(coverage);
  if (coverage < rules.coverageLowBelow) {
    insights.push(`已评分消息 ${analyzedCount}/${messageCount} 条（覆盖率 ${pct}），样本不足，本报告结论仅供参考。`);
  } else if (coverage >= rules.coverageHighAbove) {
    insights.push(`已评分消息 ${analyzedCount}/${messageCount} 条（覆盖率 ${pct}），四维均值具备参考价值。`);
  }

  const scored = REPORT_DIM_KEYS
    .map((key) => ({ key, label: MISTAKE_DIM_LABELS[key], average: dimAverages[key] }))
    .filter((item) => item.average !== null);
  // 最弱维度点名（确定性：并列取 REPORT_DIM_KEYS 靠前者）
  const weakest = scored.length ? scored.reduce((min, item) => (item.average < min.average ? item : min)) : null;
  if (weakest && weakest.average < rules.weakDimBelow) {
    insights.push(`「${weakest.label}」均分 ${weakest.average}，是本场最弱维度，建议针对性练习。`);
  }
  const strongest = scored.length ? scored.reduce((max, item) => (item.average > max.average ? item : max)) : null;
  if (strongest && strongest.average > rules.strongDimAbove) {
    insights.push(`「${strongest.label}」均分 ${strongest.average}，是本场最强维度，保持现有表达习惯。`);
  }

  if (best && best.overall >= rules.bestOverallAtLeast) {
    insights.push(`最佳一条消息拿到 ${best.overall} 分，可在同类场景中回看复用。`);
  }
  if (worst && worst.overall < rules.worstOverallBelow) {
    const tag = Array.isArray(worst.issues) && worst.issues.length ? `（${worst.issues.join("、")}）` : "";
    insights.push(`最差一条仅 ${worst.overall} 分${tag}，建议对照教材复盘后到错题本重写练习。`);
  }

  // 与上一份报告对比：仅统计两侧均有均值的维度，变化 ≥ 阈值才点名
  if (lastReport && typeof lastReport === "object") {
    const ups = [];
    const downs = [];
    for (const key of REPORT_DIM_KEYS) {
      const current = dimAverages[key];
      const previous = lastReport.dimAverages?.[key];
      if (current === null || current === undefined || previous === null || previous === undefined) continue;
      const delta = current - Number(previous);
      if (delta >= rules.trendDelta) ups.push(`${MISTAKE_DIM_LABELS[key]} +${delta}`);
      else if (delta <= -rules.trendDelta) downs.push(`${MISTAKE_DIM_LABELS[key]} ${delta}`);
    }
    if (ups.length || downs.length) {
      insights.push(`与上一份报告相比：${[...ups, ...downs].join("、")}；关注退步维度的针对性练习。`);
    }
  }

  return insights;
}

function renderMessageSection(title, message, withIssues = false) {
  if (!message) return `## ${title}\n\n（无可评分消息）`;
  const lines = [];
  lines.push(`## ${title}（${message.overall} 分）`);
  lines.push("");
  lines.push(`> ${truncateText(message.text, 200)}`);
  lines.push("");
  lines.push(dimLine(message.dims));
  if (withIssues) {
    const issues = Array.isArray(message.issues) ? message.issues : [];
    lines.push(`短板：${issues.length ? issues.join("、") : "无"}`);
  }
  return lines.join("\n");
}

function dimLine(dims) {
  const source = dims && typeof dims === "object" ? dims : {};
  return REPORT_DIM_KEYS
    .map((key) => `${MISTAKE_DIM_LABELS[key]} ${source[key] == null ? "—" : String(source[key])}`)
    .join(" · ");
}

function formatPercent(coverage) {
  const ratio = Number(coverage);
  if (!Number.isFinite(ratio)) return "0%";
  return `${Math.round(ratio * 100)}%`;
}

/** 显式排除 null/undefined/"" 的分数标准化（Number(null) === 0 陷阱，F2 已踩过） */
function normalizeScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.min(100, Math.round(num))) : null;
}

function toIso(value) {
  const time = toTime(value);
  return time === null ? null : new Date(time).toISOString();
}

function toTime(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function truncateText(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
