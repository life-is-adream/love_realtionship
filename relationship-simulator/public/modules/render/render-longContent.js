import { $, escapeHtml } from "../core/dom.js";
import { loadManifest, loadChapterIndex } from "../content/long-content-loader.js";
import { parseChapterContent } from "../coach/parser.js";

const LONG_READ_PROGRESS_KEY = "heartflow-long-read-progress";
let currentChapterId = null;
let currentChapterUnits = [];
let longReaderLoaded = false;

export async function openLongReader(chapterId = null, reviewPointId = null, { openIntervention = () => {} } = {}) {
  document.querySelector(".layout")?.classList.add("hidden");
  $("longReader").classList.remove("hidden");
  if (!longReaderLoaded) { await renderChapterList({ openIntervention }); longReaderLoaded = true; }
  const progress = loadReadProgress();
  if (chapterId) await loadChapter(chapterId, reviewPointId, { openIntervention });
  else if (progress.chapterId) await loadChapter(progress.chapterId, null, { openIntervention });
}

export function closeLongReader() {
  $("longReader").classList.add("hidden");
  document.querySelector(".layout")?.classList.remove("hidden");
}

export async function renderChapterList({ openIntervention = () => {} } = {}) {
  const list = $("chapterList");
  if (!list) return;
  const manifest = await loadManifest();
  const progress = loadReadProgress();
  list.innerHTML = manifest.chapters.map((chapter) => `<div class="chapter-item ${progress.readChapters?.includes(chapter.id) ? "read" : ""}" data-chapter="${chapter.id}"><span class="chapter-num">第${chapter.id}章</span><span class="chapter-title">${escapeHtml(chapter.title)}</span>${progress.readChapters?.includes(chapter.id) ? '<span class="chapter-check">✓</span>' : ""}<span class="chapter-reviews">${chapter.reviewCount} 复盘</span></div>`).join("");
  list.querySelectorAll(".chapter-item").forEach((item) => item.addEventListener("click", () => loadChapter(Number(item.dataset.chapter), null, { openIntervention })));
}

export async function loadChapter(chapterId, reviewPointId = null, { openIntervention = () => {} } = {}) {
  currentChapterId = chapterId;
  const content = $("chapterContent");
  if (!content) return;
  content.innerHTML = `<p class="long-reader-hint">正在加载第${chapterId}章...</p>`;
  try {
    const response = await fetch(`/api/long-content/${chapterId}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const chapter = await loadChapterIndex(chapterId);
    if (!chapter) throw new Error("章节索引未找到");
    currentChapterUnits = parseChapterContent(await response.text(), chapter);
    renderChapterContent(chapter, currentChapterUnits, { openIntervention });
    if (reviewPointId) {
      const target = content.querySelector(`details[data-review-id="${CSS.escape(String(reviewPointId))}"]`);
      if (target) { target.open = true; target.scrollIntoView({ behavior: "smooth", block: "center" }); }
    }
    saveReadProgress(chapterId, null);
    renderChapterList({ openIntervention });
  } catch (error) {
    content.innerHTML = `<p class="long-reader-hint">加载失败：${escapeHtml(error.message)}</p>`;
  }
}

export function renderChapterContent(chapter, units, { openIntervention = () => {} } = {}) {
  const content = $("chapterContent");
  if (!content) return;
  const html = [`<h2 class="chapter-heading">第${chapter.id}章 · ${escapeHtml(chapter.title)}</h2>`];
  if (chapter.summary) html.push(`<p class="chapter-summary">${escapeHtml(chapter.summary)}</p>`);
  for (const unit of units) {
    if (unit.type === "section") html.push(`<h3 class="long-section-title">${escapeHtml(unit.title)}</h3>`);
    else if (unit.type === "time") html.push(`<div class="long-time">${escapeHtml(unit.title)}</div>`);
    else if (unit.type === "dialogue") html.push(`<div class="long-msg ${unit.speaker === "me" ? "me" : "her"}"><span class="long-msg-speaker">${escapeHtml(unit.speakerName)}</span><div class="long-msg-bubble">${escapeHtml(unit.text)}</div></div>`);
    else if (unit.type === "narrative") html.push(`<div class="long-narrative">${escapeHtml(unit.text)}</div>`);
    else if (unit.type === "review") {
      const rp = unit.reviewPoint;
      const hasFour = rp && (rp.intent || rp.benefit || rp.risk || rp.correction);
      const elements = hasFour ? [rp.intent && `<div class="review-element"><b>意图</b>：${escapeHtml(rp.intent)}</div>`, rp.benefit && `<div class="review-element"><b>好处</b>：${escapeHtml(rp.benefit)}</div>`, rp.risk && `<div class="review-element"><b>风险</b>：${escapeHtml(rp.risk)}</div>`, rp.correction && `<div class="review-element"><b>修正</b>：${escapeHtml(rp.correction)}</div>`].filter(Boolean).join("") : (rp?.note ? `<div class="review-note">${escapeHtml(rp.note)}</div>` : "");
      const canIntervene = rp && rp.originalMaleReply;
      html.push(`<details class="review-card" data-review-id="${escapeHtml(rp?.id || "")}"><summary>${escapeHtml(unit.title)}</summary><div class="review-body">${elements}</div>${canIntervene ? `<button class="btn small intervention-btn" data-review-id="${escapeHtml(rp.id)}">介入练习</button>` : ""}</details>`);
    }
  }
  content.innerHTML = html.join("");
  content.scrollTop = 0;
  content.querySelectorAll(".intervention-btn").forEach((button) => button.addEventListener("click", () => openIntervention(button.dataset.reviewId)));
}

export function saveReadProgress(chapterId, sectionId) {
  try {
    const progress = loadReadProgress();
    progress.chapterId = chapterId;
    if (sectionId) progress.sectionId = sectionId;
    if (chapterId && !progress.readChapters?.includes(chapterId)) progress.readChapters = [...(progress.readChapters || []), chapterId];
    localStorage.setItem(LONG_READ_PROGRESS_KEY, JSON.stringify(progress));
  } catch { /* localStorage unavailable */ }
}

export function loadReadProgress() {
  try { return JSON.parse(localStorage.getItem(LONG_READ_PROGRESS_KEY)) || { readChapters: [] }; } catch { return { readChapters: [] }; }
}

export function getCurrentChapterContext() {
  return { currentChapterId, currentChapterUnits };
}
