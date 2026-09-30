import { $, escapeHtml } from "../core/dom.js";
import { buildSignalExercise, classifySocialSignals, evaluateSignalGuess } from "../training/signals.js";
import { scoreTiming } from "../training/timing.js";
import { selectDailyTask, gradeMicroTask, getTrainingStreak } from "../training/micro-training.js";
import { aggregateGrowth, buildRadarData, getMastery, buildGrowthSummary, GROWTH_DIMENSION_LABELS } from "../training/growth.js";
import { buildCoachTextbookEvidence, buildTextbookCoachContext } from "../content/textbook-search.js";
import { getSharedTextbookIndex } from "../content/textbook-index.js";
import { recordTrainingEvent } from "../core/learning-state.js";
import { getState, mutate } from "../core/state.js";

// 教材检索索引自拆包后为异步构建；用序号 guard 保证并发渲染时后到的旧渲染不覆盖新渲染。
let textbookRenderSeq = 0;

function shortenText(value, maxLength = 132) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export function renderTiming() {
  const panel = $("timingPanel");
  if (!panel) return;
  const result = scoreTiming({ messages: getState().messages, latestDraft: $("userInput")?.value || "", stage: $("stage")?.value || "" });
  const title = result.dataAvailable ? `时机感 ${result.score}/100` : "时机感：数据不足";
  panel.innerHTML = `<div class="timing-summary"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(result.reasons?.[0] || "时机评分只作参考，不会阻止发送。")}</span></div>`;
}

function signalLabelText(label) {
  return { positive: "积极/轻松", polite: "礼貌回应", lowEnergy: "低能量", boundary: "边界/拒绝", closing: "准备收尾", ambiguous: "信息不足" }[label] || label;
}

export function renderSignalPractice() {
  const panel = $("signalPanel");
  if (!panel) return;
  const latestHer = [...getState().messages].reverse().find((message) => message.type === "her")?.text || "";
  if (!latestHer) { panel.innerHTML = ""; return; }
  const analysis = classifySocialSignals(latestHer);
  const exercise = buildSignalExercise(latestHer, `${getState().messages.length}:${latestHer}`);
  panel.innerHTML = `<div class="signal-card"><div class="signal-head"><strong>社交信号练习</strong><span>${escapeHtml(analysis.confidence)} 置信度</span></div><p>${escapeHtml(analysis.uncertainty)}</p><div class="signal-tags">${analysis.labels.map((label) => `<span>${escapeHtml(signalLabelText(label))}</span>`).join("")}</div><div class="signal-evidence">${analysis.evidence.slice(0, 2).map((item) => `<small>证据：${escapeHtml(item)}</small>`).join("")}<div class="signal-guess-row"><select id="signalGuessSelect"><option value="ambiguous">信息不足</option>${exercise.options.map((item) => `<option value="${escapeHtml(item.key)}">${escapeHtml(item.label)}</option>`).join("")}</select><button class="btn small" id="submitSignalBtn">提交判断</button></div><div id="signalFeedback"></div></div></div>`;
  $("submitSignalBtn")?.addEventListener("click", () => {
    const selected = $("signalGuessSelect")?.value;
    const feedback = $("signalFeedback");
    const result = evaluateSignalGuess(analysis, selected);
    mutate((state) => {
      state.learning.signalAttempts = [...(state.learning.signalAttempts || []), { createdAt: new Date().toISOString(), correct: Boolean(result.correct), labels: analysis.labels }].slice(-30);
    });
    // mutate 触发的渲染回调会重建信号面板，反馈文本需在其后写入（与迁移前最终 DOM 一致）。
    if (feedback) feedback.textContent = result.message || (result.correct ? "判断方向基本准确。" : "再结合上下文观察，不要急着下结论。");
  });
}

export function renderDailyTraining() {
  const panel = $("dailyTrainingPanel");
  if (!panel) return;
  const state = getState();
  const task = selectDailyTask(state.learning, new Date().toISOString().slice(0, 10));
  panel.innerHTML = `<div class="daily-card"><div class="daily-head"><strong>今日 5 分钟训练</strong><span>连续 ${getTrainingStreak(state.learning?.dailyTasks || [])} 天</span></div><p>${escapeHtml(task.prompt || task.title || "完成一个低压力回复练习")}</p><textarea id="dailyTaskInput" rows="2" placeholder="写下你的答案"></textarea><button class="btn small" id="submitDailyTaskBtn">提交训练</button><div id="dailyTaskFeedback"></div></div>`;
  $("submitDailyTaskBtn")?.addEventListener("click", () => {
    const answer = $("dailyTaskInput")?.value.trim() || "";
    const grade = gradeMicroTask(task, answer, { context: task.context || "" });
    mutate((state) => {
      state.learning = recordTrainingEvent(state.learning, { id: `micro-${Date.now()}`, type: "micro-training", source: "micro-training", dimension: grade.dimension, score: grade.score, createdAt: new Date().toISOString(), metadata: { taskType: task.type } });
    });
    $("dailyTaskFeedback").textContent = `${grade.score} 分：${grade.nextAction || grade.feedback || "继续保持可观察、低压力的表达。"}`;
  });
}

export function renderGrowthProfile() {
  const panel = $("growthPanel");
  if (!panel) return;
  const summary = aggregateGrowth(getState().learning?.events || [], { now: new Date(), windowDays: 30 });
  const radar = buildRadarData(summary);
  const growth = buildGrowthSummary(summary);
  panel.innerHTML = `<div class="growth-card"><div class="daily-head"><strong>成长画像</strong><span>${escapeHtml(growth.headline)}</span></div><div class="growth-grid">${radar.map((item) => { const mastery = getMastery(summary, item.key); return `<div><b>${escapeHtml(item.label)}</b><span>${item.value == null ? "—" : item.value} · ${escapeHtml(mastery.label)}</span></div>`; }).join("")}</div>${growth.focus ? `<p class="note">当前重点：${escapeHtml(growth.focus.label)}。${escapeHtml(growth.focus.reason)}</p>` : ""}</div>`;
}

export async function renderTextbookEvidence(analysis = getState().lastAnalysis, { openLongReader = () => {} } = {}) {
  const panel = $("textbookPanel");
  if (!panel) return;
  const seq = ++textbookRenderSeq;
  let textbookSearchIndex;
  try {
    textbookSearchIndex = await getSharedTextbookIndex();
  } catch (error) {
    if (seq !== textbookRenderSeq) return;
    panel.innerHTML = `<section class="textbook-card" aria-label="教材依据"><div class="textbook-card-head"><span class="textbook-mark" aria-hidden="true">✦</span><div class="textbook-heading"><span class="textbook-kicker">FIELD NOTES / OFFLINE</span><strong>教材依据</strong><p>教材索引暂不可用：${escapeHtml(error.message)}</p></div><span class="textbook-count">00</span></div></section>`;
    return;
  }
  if (seq !== textbookRenderSeq) return;
  const evidence = buildCoachTextbookEvidence({ ...(analysis || {}), stage: $("stage")?.value || "" }, textbookSearchIndex);
  const context = buildTextbookCoachContext({ summary: evidence.message, results: evidence.results });
  const resultCount = evidence.results.length;
  const resultLabel = resultCount ? `这轮对话命中 ${resultCount} 个可复盘片段` : "先完成一轮分析，再把对话放回教材里看";
  const resultCards = evidence.results.map((item, index) => {
    const tags = (Array.isArray(item.matchedTerms) ? item.matchedTerms : item.tags || []).slice(0, 3);
    return `<button class="textbook-result" type="button" data-chapter="${escapeHtml(item.chapterId || "")}" data-review-id="${escapeHtml(item.reviewPointId || "")}">
      <span class="textbook-result-index">${String(index + 1).padStart(2, "0")}</span>
      <span class="textbook-result-main">
        <span class="textbook-result-meta">第${escapeHtml(item.chapterId || "—")}章 · ${escapeHtml(item.chapterTitle || "教材章节")}</span>
        <strong>${escapeHtml(item.title || "打开复盘片段")}</strong>
        <small>${escapeHtml(shortenText(item.searchExcerpt || item.title))}</small>
        ${tags.length ? `<span class="textbook-result-tags">${tags.map((tag) => `<em>${escapeHtml(tag)}</em>`).join("")}</span>` : ""}
      </span>
      <span class="textbook-result-arrow" aria-hidden="true">↗</span>
    </button>`;
  }).join("");
  panel.innerHTML = `<section class="textbook-card" aria-label="教材依据">
    <div class="textbook-card-head">
      <span class="textbook-mark" aria-hidden="true">✦</span>
      <div class="textbook-heading"><span class="textbook-kicker">FIELD NOTES / ${resultCount ? "MATCHED" : "WAITING"}</span><strong>教材依据</strong><p>${escapeHtml(resultLabel)}</p></div>
      <span class="textbook-count">${String(resultCount).padStart(2, "0")}</span>
    </div>
    ${resultCards ? `<div class="textbook-result-list">${resultCards}</div>` : `<div class="textbook-empty"><span>◎</span><p>${escapeHtml(context.summary || evidence.message)}</p></div>`}
  </section>`;
  panel.querySelectorAll("button[data-chapter]").forEach((button) => button.addEventListener("click", () => openLongReader(Number(button.dataset.chapter), button.dataset.reviewId || null)));
}
