/**
 * 教练悬浮快速呼出（Lovekey 悬浮球三步流的启发）。
 *
 * 聊天界面右下角一个悬浮按钮，点击弹出最近一次教练分析摘要：
 * A/B/C 回复建议 + 四维评分，减少在聊天与教练面板间来回切换。
 * 纯函数构建内容，渲染由 app.js 挂接到 DOM。
 */
import { clampScore } from "../coach/coach.js";

/** 四维评分标签 */
export const DIMENSION_LABELS = [
  { key: "naturalness", label: "自然度" },
  { key: "empathy", label: "共情" },
  { key: "boundary", label: "边界感" },
  { key: "momentum", label: "推进力" }
];

/**
 * 从最近一次分析构造悬浮面板的展示数据。
 * @param {object|null} analysis 最近的 lastAnalysis（无则返回 null）
 * @returns {object|null} {score: number, weakest: string, options: Array, summary: string}
 */
export function buildCoachFloatData(analysis) {
  if (!analysis || typeof analysis !== "object") return null;
  const score = analysis.coachScore;
  if (!score || typeof score !== "object") return null;
  const options = Array.isArray(analysis.replyOptions) ? analysis.replyOptions.slice(0, 3) : [];
  const weakestDim = DIMENSION_LABELS.find((item) => item.key === score.weakestDim)?.label || "";
  return {
    score: clampScore(score.total),
    weakest: weakestDim,
    options,
    summary: String(score.summary || analysis.judgement || ""),
    hasOptions: options.length > 0
  };
}

/**
 * 生成悬浮面板 HTML（纯字符串，已转义）。
 * @param {object|null} data buildCoachFloatData 的返回值
 * @returns {string}
 */
export function buildCoachFloatHtml(data) {
  if (!data) {
    return `<div class="coach-float-empty">还没有分析结果。先发送回复并生成女方对话，教练建议会出现在这里。</div>
      <button class="btn small ghost coach-float-search-btn" id="coachFloatSearchBtn" type="button">🔍 联网查依据</button>
      <div class="coach-float-search-result" id="coachFloatSearchResult"></div>`;
  }
  const optionsHtml = data.hasOptions
    ? data.options.map((option) => `<div class="coach-float-option"><b>${escapeHtml(option.label || "")}</b><p>${escapeHtml(option.text || "")}</p></div>`).join("")
    : `<div class="coach-float-empty">本轮暂无 A/B/C 建议。</div>`;
  return `
    <div class="coach-float-head">
      <strong>教练快速呼出</strong>
      <span class="coach-float-score">${data.score} 分${data.weakest ? ` · 短板：${data.weakest}` : ""}</span>
    </div>
    ${data.summary ? `<p class="coach-float-summary">${escapeHtml(data.summary)}</p>` : ""}
    <div class="coach-float-options">${optionsHtml}</div>
    <button class="btn small ghost coach-float-search-btn" id="coachFloatSearchBtn" type="button">🔍 联网查依据</button>
    <div class="coach-float-search-result" id="coachFloatSearchResult"></div>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
