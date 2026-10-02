/**
 * F4 会话复盘报告 UI：学习工具区的「生成会话复盘」按钮 + 可折叠报告卡（布局对齐错题本先例）。
 *
 * 惯例对齐：
 * - render-* 模块由 app.js renderAll 链挂载；全部插值过 escapeHtml；
 * - 状态写入一律 mutate(fn)（本模块只落一条 session-report 训练事件，经
 *   recordTrainingEvent 的同 id 幂等保证重复点击不重复落账）；
 * - 教材检索走既有懒加载 gate：报告按钮点击属真实触发（规格明示），先
 *   enableTextbookIndexLoad() 再经 getSharedTextbookIndex() 取索引，不绕过 B4 语义；
 * - 教材引用跳转复用 openLongReader(chapterId, reviewPointId) 既有实现。
 */

import { $, escapeHtml } from "../core/dom.js";
import { getState, mutate } from "../core/state.js";
import { recordTrainingEvent } from "../core/learning-state.js";
import { buildAnalysesFromTrainingLog, buildSessionReport, buildReportMarkdown, REPORT_DIM_KEYS } from "../training/session-report.js";
import { MISTAKE_DIM_LABELS } from "../training/mistake-patterns.js";
import { searchTextbook } from "../content/textbook-search.js";
import { getSharedTextbookIndex } from "../content/textbook-index.js";
import { enableTextbookIndexLoad } from "./render-learning.js";

let lastReport = null; // 最近一次生成的报告对象（浏览器会话内缓存，切换面板不丢）
let openReaderFn = null; // 教材引用跳转用的 openLongReader（由 app.js 注入）

/** 学习面板渲染入口（app.js renderLearningPanels 调用） */
export function renderSessionReport() {
  const panel = $("sessionReportPanel");
  if (!panel) return;
  if (!lastReport) {
    panel.innerHTML = "";
    return;
  }
  panel.innerHTML = renderReportCard(lastReport);
  bindReportActions(panel);
  bindTextbookJumps(openReaderFn);
}

/** 生成会话复盘（学习工具区按钮调用）。按钮点击 = 真实触发，放开教材索引懒加载 gate。 */
export async function generateSessionReport({ openLongReader = null } = {}) {
  if (typeof openLongReader === "function") openReaderFn = openLongReader;
  // B4 懒加载 gate：报告按钮点击算真实触发（与提交一轮分析同级），此后允许构建全章检索索引
  enableTextbookIndexLoad();
  const state = getState();
  const analyses = buildAnalysesFromTrainingLog(state.trainingLog);
  const previous = findPreviousReportSummary(state);
  const report = await buildSessionReport(state.messages, analyses, {
    stage: $("stage")?.value || "",
    mode: state.trainingMode === "pua" ? "pua" : "anti",
    now: Date.now(),
    lastReport: previous,
    searchTextbook: buildSearchTextbook()
  });
  lastReport = report;
  renderSessionReport();
  $("apiStatus").textContent = `已生成会话复盘：覆盖 ${report.analyzedCount}/${report.messageCount} 条消息。`;
  return report;
}

/** 教材检索注入：gate 已放开后取共享索引，构建失败降级为恒空（报告卡显示未命中文案） */
function buildSearchTextbook() {
  return async (query, limit) => {
    const index = await getSharedTextbookIndex();
    return searchTextbook(query, index, limit);
  };
}

/** 上一份报告摘要：取 learning.events 最近一条 session-report 事件（未保存过则为 null） */
function findPreviousReportSummary(state) {
  const events = Array.isArray(state.learning?.events) ? state.learning.events : [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "session-report") continue;
    return {
      generatedAt: event.createdAt || null,
      dimAverages: event.metadata?.dimAverages || null
    };
  }
  return null;
}

function renderReportCard(report) {
  const generatedLabel = formatTs(report.generatedAt);
  const coveragePct = Math.round((Number(report.coverage) || 0) * 100);
  const saved = isReportSaved(report);
  const dimsRows = REPORT_DIM_KEYS.map((key) => {
    const value = report.dimAverages?.[key];
    const text = value == null ? "—" : String(value);
    const barWidth = value == null ? 0 : Math.max(0, Math.min(100, Number(value)));
    return `<div class="session-report-dim"><b>${escapeHtml(MISTAKE_DIM_LABELS[key] || key)}</b>
      <span class="session-report-bar"><i style="width:${escapeHtml(String(barWidth))}%"></i></span>
      <em>${escapeHtml(text)}</em></div>`;
  }).join("");

  return `<details class="mistakes-box session-report-box" open>
    <summary>会话复盘<span class="mistake-count">覆盖 ${escapeHtml(String(report.analyzedCount))}/${escapeHtml(String(report.messageCount))} 条 · ${escapeHtml(generatedLabel)}</span></summary>
    <div class="radar-stats session-report-head">
      <span>阶段：<b>${escapeHtml(report.stage || "—")}</b></span>
      <span>模式：<b>${escapeHtml(report.mode === "pua" ? "PUA 觉察" : "反操控")}</b></span>
      <span>覆盖率：<b>${escapeHtml(String(coveragePct))}%</b></span>
    </div>
    <div class="session-report-dims">${dimsRows}</div>
    ${renderExtremeCard("最佳消息", report.best)}
    ${renderExtremeCard("最差消息", report.worst)}
    ${renderTextbookSection(report.textbookRefs)}
    ${renderInsights(report.insights)}
    <div class="mistake-actions">
      <button class="btn small" data-report-action="copy">复制报告</button>
      <button class="btn small" data-report-action="save" ${saved ? "disabled" : ""}>${saved ? "已保存训练事件" : "保存为训练事件"}</button>
    </div>
    <p class="mistake-empty">报告纯本地生成（四维聚合 + 教材检索），不调用模型；保存走训练事件同 id 幂等，重复点击不重复落账。</p>
  </details>`;
}

function renderExtremeCard(title, extreme) {
  if (!extreme) {
    return `<div class="session-report-card"><b>${escapeHtml(title)}</b><p class="mistake-empty">暂无可评分消息。</p></div>`;
  }
  const fullText = String(extreme.text || "");
  const excerpt = shorten(fullText, 80);
  const dimsLine = REPORT_DIM_KEYS
    .map((key) => {
      const value = extreme.dims?.[key];
      return `${MISTAKE_DIM_LABELS[key] || key} ${value == null ? "—" : value}`;
    })
    .join(" · ");
  const issueChips = (Array.isArray(extreme.issues) ? extreme.issues : [])
    .map((label) => `<span class="mistake-issue-chip">${escapeHtml(String(label))}</span>`)
    .join("");
  return `<div class="session-report-card ${title === "最佳消息" ? "is-best" : "is-worst"}">
    <div class="log-meta"><b>${escapeHtml(title)}</b><span class="mistake-status ${title === "最佳消息" ? "ok" : "open"}">${escapeHtml(String(extreme.overall))} 分</span></div>
    <div class="mistake-text" title="${escapeHtml(fullText)}">${escapeHtml(excerpt)}</div>
    <div class="radar-stats"><span>${escapeHtml(dimsLine)}</span></div>
    ${issueChips ? `<div class="mistake-tags">${issueChips}</div>` : ""}
  </div>`;
}

function renderTextbookSection(refs) {
  const list = Array.isArray(refs) ? refs : [];
  if (!list.length) {
    return `<div class="session-report-textbook"><b>📖 教材复盘</b><p class="mistake-empty">未命中教材复盘</p></div>`;
  }
  const cards = list.map((ref, index) => `<button class="textbook-result" type="button" data-report-chapter="${escapeHtml(String(ref.chapter ?? ""))}" data-report-review="${escapeHtml(String(ref.reviewPointId ?? ""))}">
    <span class="textbook-result-index">${String(index + 1).padStart(2, "0")}</span>
    <span class="textbook-result-main">
      <span class="textbook-result-meta">第${escapeHtml(String(ref.chapter ?? "—"))}章 · ${escapeHtml(ref.chapterTitle || "教材章节")}</span>
      <strong>${escapeHtml(ref.title || "打开复盘片段")}</strong>
      <small>${escapeHtml(shorten(ref.excerpt, 96))}</small>
    </span>
    <span class="textbook-result-arrow" aria-hidden="true">↗</span>
  </button>`).join("");
  return `<div class="session-report-textbook"><b>📖 教材复盘</b><div class="textbook-result-list">${cards}</div></div>`;
}

function renderInsights(insights) {
  const list = Array.isArray(insights) ? insights : [];
  if (!list.length) return "";
  return `<div class="radar-insights">${list.map((line) => `<p>· ${escapeHtml(String(line))}</p>`).join("")}</div>`;
}

// ── 动作 ─────────────────────────────────────────────────────────────────────

function bindReportActions(panel) {
  panel.querySelectorAll("button[data-report-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.reportAction === "copy") void copySessionReport();
      if (button.dataset.reportAction === "save") saveSessionReportEvent();
    });
  });
}

/** 教材引用跳转：点击后才绑定 openLongReader（复用阅读器既有跳转实现） */
function bindTextbookJumps(openLongReader) {
  const panel = $("sessionReportPanel");
  if (!panel || typeof openLongReader !== "function") return;
  panel.querySelectorAll("button[data-report-chapter]").forEach((button) => {
    button.addEventListener("click", () => {
      const chapter = Number(button.dataset.reportChapter);
      openLongReader(Number.isFinite(chapter) && chapter > 0 ? chapter : null, button.dataset.reportReview || null);
    });
  });
}

async function copySessionReport() {
  if (!lastReport) return;
  const text = buildReportMarkdown(lastReport);
  const status = $("apiStatus");
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }
    if (status) status.textContent = "报告已复制到剪贴板（Markdown 纯文本）。";
  } catch (error) {
    if (status) status.textContent = `复制失败：${error.message}`;
  }
}

function saveSessionReportEvent() {
  const report = lastReport;
  if (!report) return;
  // id 用 generatedAt 时间戳：同一份报告重复点击走 recordTrainingEvent 同 id 去重，不重复落账
  const id = `session-report-${report.generatedAt}`;
  mutate((state) => {
    state.learning = recordTrainingEvent(state.learning, {
      id,
      type: "session-report",
      source: "local",
      dimension: null,
      // 注意：不传 score 字段（learning-state 的 normalizeScore(null)===0 会把 null 归零，
      // 与 F2 踩过的 Number(null) 陷阱同源；缺省时 createTrainingEvent 存 null）
      createdAt: report.generatedAt,
      metadata: {
        messageCount: report.messageCount,
        analyzedCount: report.analyzedCount,
        coverage: report.coverage,
        dimAverages: report.dimAverages,
        bestOverall: report.best?.overall ?? null,
        worstOverall: report.worst?.overall ?? null,
        textbookRefCount: Array.isArray(report.textbookRefs) ? report.textbookRefs.length : 0
      }
    });
  });
  renderSessionReport();
  $("apiStatus").textContent = "报告已保存为训练事件（重复点击不会重复落账）。";
}

function isReportSaved(report) {
  if (!report?.generatedAt) return false;
  const id = `session-report-${report.generatedAt}`;
  const events = Array.isArray(getState().learning?.events) ? getState().learning.events : [];
  return events.some((event) => event?.id === id);
}

// ── 工具 ─────────────────────────────────────────────────────────────────────

function formatTs(value) {
  const time = typeof value === "number" ? value : Date.parse(String(value || ""));
  if (!Number.isFinite(time)) return "未知时间";
  return new Date(time).toLocaleString("zh-CN", { hour12: false });
}

function shorten(text, maxLength = 80) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}
