/**
 * F2 错题本 UI：可折叠「错题本」section（失误雷达摘要条 + 列表）与重写练习模态。
 *
 * 惯例对齐：
 * - render-* 模块由 app.js renderAll 链挂载；全部插值过 escapeHtml；
 * - 状态写入一律 mutate(fn)；确认类操作复用 RESET_CONFIRMATION 的 globalThis.confirm 模式；
 * - 解决错题时按 learning-state 机制补记训练事件（type: "mistake-rewrite"）。
 */

import { $, escapeHtml } from "../core/dom.js";
import { getState, mutate } from "../core/state.js";
import { createCoachLearningEvent } from "../core/training-scores.js";
import { getPersonaMemory, getCurrentPersona } from "../core/state.js";
import { resolveMistake, deleteMistake } from "../core/mistakes.js";
import { findWeakestDim, buildRewriteComparison, aggregateMistakePatterns, MISTAKE_DIM_LABELS } from "../training/mistake-patterns.js";
import { buildTrapProgress, TRAP_LIBRARY_NOTE } from "../training/trap-library.js";
import { buildCoachScore, detectReplyFlags } from "../coach/coach.js";
import { recordTrainingEvent } from "../core/learning-state.js";
import { readIntakeProfile, buildIntakeSummary } from "../core/intake-profile.js";

const SOURCE_LABELS = { preflight: "发送前测验", coach: "教练评分", manual: "手动" };
/** 错题维度 → 学习档案维度（与 app.js addTrainingLog 的映射一致，drive 同 momentum） */

let practiceContext = null; // { mistake }
let lastRewriteResult = null; // { rewriteText, comparison }

export function renderMistakes() {
  const panel = $("mistakesPanel");
  if (!panel) return;
  const mistakes = Array.isArray(getState().mistakes) ? getState().mistakes : [];
  const unresolvedCount = mistakes.filter((item) => item?.resolved !== true).length;
  const rows = [...mistakes].reverse().map((mistake) => renderMistakeRow(mistake)).join("");
  panel.innerHTML = `<details class="mistakes-box" open>
    <summary>错题本<span class="mistake-count">未解决 ${escapeHtml(String(unresolvedCount))} / 共 ${escapeHtml(String(mistakes.length))}</span></summary>
    ${renderRadarSummary(mistakes)}
    ${renderIntakeBaselineLine()}
    ${renderTrapLibrary(mistakes)}
    <div class="mistake-list">${rows || '<p class="mistake-empty">暂无错题记录。发送前测验命中的高危表达、教练评分过低的回复，或点「加入错题本」，都会收集到这里。</p>'}</div>
  </details>`;
  panel.querySelectorAll("button[data-mistake-action]").forEach((button) => {
    button.addEventListener("click", () => handleMistakeAction(button.dataset.mistakeAction, button.dataset.id));
  });
}

function renderRadarSummary(mistakes) {
  const patterns = aggregateMistakePatterns(mistakes);
  if (!patterns.total) return "";
  const weakest = patterns.weakestDim ? MISTAKE_DIM_LABELS[patterns.weakestDim] || patterns.weakestDim : "—";
  const resolvedPercent = patterns.resolvedRatio === null ? null : Math.round(patterns.resolvedRatio * 100);
  const issueChips = patterns.topIssues
    .map((item) => `<span class="mistake-issue-chip">${escapeHtml(item.label)} × ${escapeHtml(String(item.count))}</span>`)
    .join("");
  return `<div class="radar-summary">
    <div class="radar-stats">
      <span>⚡ 失误雷达</span>
      <span>最弱维度：<b>${escapeHtml(weakest)}</b></span>
      <span>未解决 ${escapeHtml(String(patterns.unresolvedCount))} 条</span>
      ${resolvedPercent !== null ? `<span>已解决 ${escapeHtml(String(resolvedPercent))}%</span>` : ""}
    </div>
    ${issueChips ? `<div class="radar-issues">${issueChips}</div>` : ""}
    ${patterns.insights.length ? `<div class="radar-insights">${patterns.insights.map((line) => `<p>· ${escapeHtml(line)}</p>`).join("")}</div>` : ""}
  </div>`;
}

/** F3 基线画像对照行：仅当入学测试画像存在时，显示在失误雷达摘要条下方（只展示，不改雷达算法）。 */
function renderIntakeBaselineLine() {
  const profile = readIntakeProfile();
  if (!profile) return "";
  return `<div class="radar-baseline">基线画像：${escapeHtml(buildIntakeSummary(profile))}（${escapeHtml(profile.testDate)}）</div>`;
}

/**
 * ④ 常见陷阱图鉴：命中即点亮（收集语义，不是待办）；已重写解决的计数显示为「走出」。
 * 未点亮的陷阱保持灰态（仍显示名字与信号，提前认识也是练习的一部分）。
 */
function renderTrapLibrary(mistakes) {
  const { traps, litCount } = buildTrapProgress(mistakes);
  const cards = traps.map((trap) => {
    const lit = trap.count > 0;
    const walked = trap.resolvedCount > 0;
    return `<div class="trap-card ${lit ? "is-lit" : "is-dim"}">
      <div class="trap-head"><b>${escapeHtml(trap.name)}</b>
        ${lit ? `<span class="mistake-status ${walked ? "ok" : "open"}">${walked ? `走出 ${escapeHtml(String(trap.resolvedCount))} 次` : `命中 ${escapeHtml(String(trap.count))} 次`}</span>` : '<span class="mistake-status">还没遇到</span>'}
      </div>
      ${lit ? `<p class="trap-why">${escapeHtml(trap.why)}</p><p class="note trap-signal">识别信号：${escapeHtml(trap.signal)}</p>` : `<p class="note">遇到了会自动点亮；先认识它的触发场景：${escapeHtml(trap.signal)}</p>`}
    </div>`;
  }).join("");
  return `<details class="trap-library" open>
    <summary>常见陷阱图鉴<span class="mistake-count">已点亮 ${escapeHtml(String(litCount))} / ${escapeHtml(String(traps.length))}</span></summary>
    <p class="mistake-empty">${escapeHtml(TRAP_LIBRARY_NOTE)}</p>
    <div class="trap-grid">${cards}</div>
  </details>`;
}

function renderMistakeRow(mistake) {
  if (!mistake) return "";
  const date = formatTs(mistake.ts);
  const excerpt = shorten(mistake.text, 60);
  const resolved = mistake.resolved === true;
  const weakest = findWeakestDim(mistake.dims);
  const weakPill = !resolved && weakest
    ? `<span class="dim-pill weak">${escapeHtml(MISTAKE_DIM_LABELS[weakest.key] || weakest.key)} 低${weakest.value != null ? ` · ${escapeHtml(String(weakest.value))}` : ""}</span>`
    : "";
  const issueChips = (Array.isArray(mistake.issues) ? mistake.issues : [])
    .map((label) => `<span class="mistake-issue-chip">${escapeHtml(String(label))}</span>`)
    .join("");
  return `<div class="mistake-item ${resolved ? "is-resolved" : ""}" data-mistake-id="${escapeHtml(mistake.id)}">
    <div class="log-meta">
      <time>${escapeHtml(date)}</time>
      <span class="source-badge">${escapeHtml(SOURCE_LABELS[mistake.source] || mistake.source || "手动")}</span>
      ${mistake.stage ? `<span class="stage-badge">${escapeHtml(mistake.stage.slice(0, 8))}</span>` : ""}
      <span class="mistake-status ${resolved ? "ok" : "open"}">${resolved ? "已解决" : "未解决"}</span>
    </div>
    <div class="mistake-text">${escapeHtml(excerpt)}</div>
    ${weakPill || issueChips ? `<div class="mistake-tags">${weakPill}${issueChips}</div>` : ""}
    <div class="mistake-actions">
      <button class="btn small" data-mistake-action="practice" data-id="${escapeHtml(mistake.id)}">重写练习</button>
      ${resolved ? "" : '<button class="btn small ghost" data-mistake-action="resolve" data-id="' + escapeHtml(mistake.id) + '">标记解决</button>'}
      <button class="btn small ghost danger-text" data-mistake-action="delete" data-id="${escapeHtml(mistake.id)}">删除</button>
    </div>
  </div>`;
}

function handleMistakeAction(action, id) {
  if (action === "practice") { openMistakePractice(id); return; }
  if (action === "resolve") { resolveMistakeDirectly(id); return; }
  if (action === "delete") { removeMistake(id); return; }
}

function resolveMistakeDirectly(id) {
  const mistake = getState().mistakes?.find((item) => item?.id === id);
  if (!mistake || mistake.resolved) return;
  const message = "确认将这条错题标记为已解决？\n\n不会附带重写记录，如需对比练习请使用「重写练习」。\n\n继续？";
  if (globalThis.confirm?.(message) !== true) return;
  mutate((state) => {
    state.mistakes = resolveMistake(state.mistakes, id);
  });
  $("apiStatus").textContent = "错题已标记解决。";
}

function removeMistake(id) {
  const mistake = getState().mistakes?.find((item) => item?.id === id);
  if (!mistake) return;
  const message = "确认删除这条错题？\n\n删除后不可恢复。\n\n继续？";
  if (globalThis.confirm?.(message) !== true) return;
  mutate((state) => {
    state.mistakes = deleteMistake(state.mistakes, id);
  });
  $("apiStatus").textContent = "错题已删除。";
}

// ── 重写练习（布局参考介入练习面板 render-intervention.js，全程本地评分，零 LLM）──

export function openMistakePractice(id) {
  const mistake = getState().mistakes?.find((item) => item?.id === id);
  if (!mistake) return;
  practiceContext = { mistake };
  lastRewriteResult = null;
  renderMistakePracticePanel();
  $("mistakePracticeModal")?.classList.remove("hidden");
}

export function closeMistakePractice() {
  $("mistakePracticeModal")?.classList.add("hidden");
  practiceContext = null;
  lastRewriteResult = null;
}

function renderMistakePracticePanel() {
  const ctx = practiceContext;
  const content = $("mistakePracticeContent");
  if (!ctx || !content) return;
  const mistake = ctx.mistake;
  const weakest = findWeakestDim(mistake.dims);
  const dimsLine = Object.entries(mistake.dims || {})
    .map(([key, value]) => `${MISTAKE_DIM_LABELS[key] || key} ${value == null ? "—" : value}`)
    .join(" · ");
  const issues = (Array.isArray(mistake.issues) ? mistake.issues : []).map((label) => escapeHtml(String(label))).join("、");
  content.innerHTML = `<div class="intervention-section"><h4>原文与上下文</h4><div class="review-body">
    <div class="review-element"><b>阶段</b>：${escapeHtml(mistake.stage || "未记录")}</div>
    <div class="review-element"><b>来源</b>：${escapeHtml(SOURCE_LABELS[mistake.source] || mistake.source || "手动")}</div>
    ${issues ? `<div class="review-element"><b>风险 / 短板</b>：${issues}</div>` : ""}
    ${weakest ? `<div class="review-element"><b>最弱维度</b>：${escapeHtml(MISTAKE_DIM_LABELS[weakest.key] || weakest.key)}${weakest.value != null ? `（${escapeHtml(String(weakest.value))}）` : ""}</div>` : ""}
    ${mistake.dims ? `<div class="review-element"><b>原始四维</b>：${escapeHtml(dimsLine)}</div>` : ""}
    <div class="long-msg me"><span class="long-msg-speaker">我</span><div class="long-msg-bubble">${escapeHtml(mistake.text)}</div></div>
  </div></div>
  <div class="intervention-section"><h4>你的重写</h4>
    <textarea id="mistakeRewriteInput" placeholder="用更低压力、更自然的方式重写这句话..." rows="3">${escapeHtml(mistake.rewriteText || "")}</textarea>
    <button class="btn primary" id="scoreMistakeRewriteBtn">本地评分</button>
    <p class="note">评分在本地完成（四维教练 + 风险检测），不调用模型。</p>
  </div>
  <div class="intervention-section" id="mistakeRewriteResult" style="display:none"></div>
  <div class="intervention-actions">
    <button class="btn small" id="resolveMistakePracticeBtn" style="display:none">标记解决</button>
    <button class="btn small ghost" id="backFromMistakePracticeBtn">返回错题本</button>
  </div>`;
  $("scoreMistakeRewriteBtn")?.addEventListener("click", scoreMistakeRewrite);
  $("backFromMistakePracticeBtn")?.addEventListener("click", closeMistakePractice);
  $("resolveMistakePracticeBtn")?.addEventListener("click", resolveFromPractice);
}

function scoreMistakeRewrite() {
  const ctx = practiceContext;
  const input = $("mistakeRewriteInput");
  const result = $("mistakeRewriteResult");
  if (!ctx || !input || !result) return;
  const rewriteText = input.value.trim();
  if (!rewriteText) {
    result.style.display = "block";
    result.innerHTML = '<p class="mistake-empty">先写下你的重写，再评分。</p>';
    return;
  }
  const memory = getPersonaMemory(getCurrentPersona());
  const rewriteScore = buildCoachScore(rewriteText, { risk: memory.boundaries, judgement: memory.background });
  const flags = detectReplyFlags(rewriteText, memory);
  const comparison = buildRewriteComparison(ctx.mistake.dims, rewriteScore, flags);
  lastRewriteResult = { rewriteText, comparison, rewriteScore };
  renderMistakeRewriteResult(comparison);
}

function renderMistakeRewriteResult(comparison) {
  const result = $("mistakeRewriteResult");
  if (!result || !comparison) return;
  result.style.display = "block";
  const rows = comparison.dims.map((dim) => {
    const before = dim.before == null ? "—" : String(dim.before);
    const after = dim.after == null ? "—" : String(dim.after);
    const delta = dim.delta === null ? "" : dim.delta > 0 ? `（+${dim.delta}）` : dim.delta < 0 ? `（${dim.delta}）` : "（持平）";
    const cls = dim.delta === null ? "" : dim.delta > 0 ? "up" : dim.delta < 0 ? "down" : "flat";
    return `<div class="mistake-compare-row"><span>${escapeHtml(dim.label)}</span><em class="${cls}">${escapeHtml(before)} → ${escapeHtml(after)}${escapeHtml(delta)}</em></div>`;
  }).join("");
  const riskBefore = practiceContext?.mistake?.issues?.length ? practiceContext.mistake.issues.join("、") : "无标签";
  const riskAfter = comparison.riskLevel === "high"
    ? `高危：${comparison.riskWarning}`
    : comparison.riskLevel === "medium"
      ? `提示：${comparison.riskWarning}`
      : "未发现明显风险";
  const hint = comparison.canResolve
    ? '<p class="note ok-text">各维均不低于原值且无高危警告，可以标记解决。</p>'
    : '<p class="note">还未达到可解决标准：需要各维不低于原值且无高危警告。</p>';
  result.innerHTML = `<h4>前后对比</h4><div class="mistake-compare">${rows}</div>
    <div class="review-element"><b>原风险</b>：${escapeHtml(riskBefore)}</div>
    <div class="review-element"><b>重写后风险</b>：${escapeHtml(riskAfter)}</div>
    ${hint}`;
  const resolveBtn = $("resolveMistakePracticeBtn");
  if (resolveBtn) resolveBtn.style.display = comparison.canResolve ? "inline-block" : "none";
}

function resolveFromPractice() {
  const ctx = practiceContext;
  if (!ctx || !lastRewriteResult || !lastRewriteResult.comparison?.canResolve) return;
  const message = "确认用这份重写解决这条错题？\n\n将记录重写文本与重写后四维，并写入训练日志。\n\n继续？";
  if (globalThis.confirm?.(message) !== true) return;
  const { rewriteText, comparison, rewriteScore } = lastRewriteResult;
  mutate((state) => {
    state.mistakes = resolveMistake(state.mistakes, ctx.mistake.id, {
      rewriteText,
      rewriteDims: Object.fromEntries(comparison.dims.map((dim) => [dim.key, dim.after]))
    });
    // 按 learning-state 机制记训练事件（createTrainingEvent 对 type 无白名单，字符串类型自由扩展）
    state.learning = recordTrainingEvent(state.learning, createCoachLearningEvent(rewriteScore, {
      id: `mistake-rewrite-${ctx.mistake.id}`,
      type: "mistake-rewrite",
      source: "local",
      createdAt: new Date().toISOString(),
      metadata: { mistakeId: ctx.mistake.id, beforeDims: ctx.mistake.dims, afterDims: Object.fromEntries(comparison.dims.map((dim) => [dim.key, dim.after])) }
    }));
  });
  $("apiStatus").textContent = "重写已记录，错题标记为已解决。";
  closeMistakePractice();
}

// ── 工具 ─────────────────────────────────────────────────────────────────────

function formatTs(value) {
  const time = typeof value === "number" ? value : Date.parse(String(value || ""));
  if (!Number.isFinite(time)) return "未知时间";
  return new Date(time).toLocaleString("zh-CN", { hour12: false });
}

function shorten(text, maxLength = 60) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}
