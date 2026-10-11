import { $, escapeHtml } from "../core/dom.js";
import { builtInPersonas, DEFAULT_MODEL } from "../core/config.js";
import { buildCoachScore } from "../coach/coach.js";
import { buildInterventionPrompt } from "../coach/prompts.js";
import { callLLM } from "../core/api-client.js";
import { loadChapterIndex } from "../content/long-content-loader.js";
import { getCurrentChapterContext } from "./render-longContent.js";
import { mutate } from "../core/state.js";
import { createRequestScope } from "../core/request-scope.js";

let interventionContext = null;
let openSequence = 0;
const reactionRequests = createRequestScope(() => JSON.stringify({ context: interventionContext?.reviewPointId, chapter: interventionContext?.chapterId, input: $("interventionInput")?.value }));

export async function openIntervention(reviewPointId) {
  const sequence = ++openSequence;
  reactionRequests.cancelAll();
  const { currentChapterId, currentChapterUnits } = getCurrentChapterContext();
  if (!currentChapterId) return;
  let chapter;
  try {
    chapter = await loadChapterIndex(currentChapterId);
  } catch {
    return;
  }
  if (!chapter || sequence !== openSequence || getCurrentChapterContext().currentChapterId !== currentChapterId) return;
  const reviewPoint = chapter.reviewPoints.find((item) => item.id === reviewPointId);
  if (!reviewPoint) return;
  const section = chapter.sections?.find((item) => item.id === reviewPoint.sectionId);
  const targetIndex = currentChapterUnits.findIndex((unit) => unit.type === "dialogue" && unit.speaker === "me" && unit.text === reviewPoint.originalMaleReply);
  const targetLine = targetIndex >= 0 ? currentChapterUnits[targetIndex].line : Infinity;
  const dialogue = currentChapterUnits.filter((unit, index) => {
    if (unit.type !== "dialogue" || !["me", "her"].includes(unit.speaker)) return false;
    if (targetIndex >= 0 && index >= targetIndex) return false;
    if (section && (unit.line < section.lineStart || unit.line > section.lineEnd)) return false;
    return unit.line < targetLine;
  }).map((unit) => ({ speaker: unit.speaker, text: unit.text }));
  interventionContext = {
    chapterId: chapter.id, reviewPointId: reviewPoint.id, sectionId: reviewPoint.sectionId,
    precedingDialogue: limitInterventionDialogue(dialogue), originalMaleReply: reviewPoint.originalMaleReply || "", originalFemaleFollowup: reviewPoint.originalFemaleFollowup || "",
    reviewPoint: { intent: reviewPoint.intent || "", benefit: reviewPoint.benefit || "", risk: reviewPoint.risk || "", correction: reviewPoint.correction || "", note: reviewPoint.note || "" },
    userReply: "", aiGeneratedReply: ""
  };
  renderInterventionPanel();
  $("interventionModal").classList.remove("hidden");
}

export function closeIntervention() {
  openSequence++;
  reactionRequests.cancelAll();
  $("interventionModal").classList.add("hidden");
  interventionContext = null;
}

function limitInterventionDialogue(dialogue, maxMessages = 20, maxChars = 2000) {
  const selected = [];
  let chars = 0;
  for (let i = dialogue.length - 1; i >= 0 && selected.length < maxMessages; i -= 1) {
    const item = dialogue[i];
    const text = String(item.text || "");
    if (!text) continue;
    if (chars + text.length > maxChars && selected.length > 0) break;
    selected.unshift(item);
    chars += text.length;
  }
  return selected;
}

export function renderInterventionPanel() {
  const ctx = interventionContext;
  if (!ctx) return;
  const content = $("interventionContent");
  if (!content) return;
  const rp = ctx.reviewPoint;
  const elements = (rp.intent || rp.benefit || rp.risk || rp.correction) ? [rp.intent && `<div class="review-element"><b>意图</b>：${escapeHtml(rp.intent)}</div>`, rp.benefit && `<div class="review-element"><b>好处</b>：${escapeHtml(rp.benefit)}</div>`, rp.risk && `<div class="review-element"><b>风险</b>：${escapeHtml(rp.risk)}</div>`, rp.correction && `<div class="review-element"><b>修正</b>：${escapeHtml(rp.correction)}</div>`].filter(Boolean).join("") : (rp.note ? `<div class="review-note">${escapeHtml(rp.note)}</div>` : "");
  content.innerHTML = `<div class="intervention-section"><h4>前文上下文</h4><div class="intervention-context">${ctx.precedingDialogue.map((item) => `<div class="long-msg ${item.speaker === "me" ? "me" : "her"}"><span class="long-msg-speaker">${item.speaker === "me" ? "我" : "夏紫桐"}</span><div class="long-msg-bubble">${escapeHtml(item.text)}</div></div>`).join("")}</div></div><div class="intervention-section"><h4>你的回复</h4><textarea id="interventionInput" placeholder="输入你想替换的男方回复..." rows="3"></textarea><button class="btn primary" id="submitInterventionBtn">生成女方反应</button></div><div class="intervention-section" id="interventionResult" style="display:none"></div><div class="intervention-section"><h4>原著复盘要点</h4><div class="review-body">${elements}</div></div><div class="intervention-actions"><button class="btn small" id="saveInterventionBtn" style="display:none">保存为训练日志</button><button class="btn small ghost" id="backToReadingBtn">返回阅读</button></div>`;
  $("submitInterventionBtn").addEventListener("click", submitIntervention);
  $("interventionInput").addEventListener("input", () => {
    reactionRequests.cancelAll();
    ctx.aiGeneratedReply = "";
    const save = $("saveInterventionBtn");
    if (save) save.style.display = "none";
    const result = $("interventionResult");
    if (result) result.style.display = "none";
  });
  $("backToReadingBtn").addEventListener("click", closeIntervention);
}

async function submitIntervention() {
  const ctx = interventionContext;
  const userReply = $("interventionInput")?.value.trim();
  if (!ctx || !userReply) return;
  ctx.userReply = userReply;
  const ticket = reactionRequests.begin("reaction");
  const button = $("submitInterventionBtn");
  button.disabled = true;
  button.textContent = "生成中...";
  try {
    const result = await callLLM({ endpoint: $("endpoint").value, apiKey: $("apiKey").value, model: DEFAULT_MODEL, signal: ticket.signal, messages: [{ role: "system", content: buildInterventionPrompt(builtInPersonas.zi, ctx.precedingDialogue, userReply) }], temperature: 0.7 });
    if (!ticket.isCurrent() || interventionContext !== ctx) return;
    ctx.aiGeneratedReply = String(result.content || "").trim() || "（未生成有效回复）";
    renderInterventionComparison();
  } catch (error) {
    if (!ticket.isCurrent() || interventionContext !== ctx) return;
    $("interventionResult").style.display = "block";
    $("interventionResult").innerHTML = `<p class="intervention-error">生成失败：${escapeHtml(error.message)}</p>`;
  } finally {
    ticket.finish();
    button.disabled = false;
    button.textContent = "生成女方反应";
  }
}

export function renderInterventionComparison() {
  const ctx = interventionContext;
  const result = $("interventionResult");
  if (!ctx || !result) return;
  result.style.display = "block";
  result.innerHTML = `<h4>AI 生成的夏紫桐反应</h4><div class="long-msg her"><span class="long-msg-speaker">夏紫桐</span><div class="long-msg-bubble">${escapeHtml(ctx.aiGeneratedReply)}</div></div><h4>对照</h4><div class="comparison-grid"><div class="comparison-col"><b>你的回复</b><p>${escapeHtml(ctx.userReply)}</p></div><div class="comparison-col"><b>原著男方回复</b><p>${escapeHtml(ctx.originalMaleReply || "（无）")}</p></div></div><div class="comparison-grid"><div class="comparison-col"><b>AI 女方反应</b><p>${escapeHtml(ctx.aiGeneratedReply)}</p></div><div class="comparison-col"><b>原著女方后续</b><p>${escapeHtml(ctx.originalFemaleFollowup || "（无）")}</p></div></div>`;
  const saveButton = $("saveInterventionBtn");
  if (saveButton) { saveButton.style.display = "inline-block"; saveButton.onclick = saveInterventionAsLog; }
}

export function saveInterventionAsLog() {
  const ctx = interventionContext;
  if (!ctx || !ctx.aiGeneratedReply || $("interventionInput")?.value.trim() !== ctx.userReply) return;
  mutate((state) => {
    state.trainingLog.unshift({ time: new Date().toLocaleString("zh-CN", { hour12: false }), stage: "介入练习", mine: ctx.userReply, herReply: ctx.aiGeneratedReply, source: "intervention", score: buildCoachScore(ctx.userReply, { risk: ctx.reviewPoint.risk, judgement: ctx.reviewPoint.intent }), baseline: "calibrated", sourceChapter: ctx.chapterId, sourceReviewPoint: ctx.reviewPointId });
    state.trainingLog = state.trainingLog.slice(0, 12);
  });
  $("apiStatus").textContent = "介入练习已保存为训练日志。";
  closeIntervention();
}
