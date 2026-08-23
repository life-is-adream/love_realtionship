/* HeartFlow controller: this file only assembles state, API and render modules. */
import { builtInPersonas, defaultState, DEFAULT_MODEL } from "./modules/core/config.js";
import { buildCoachScore, clampScore, detectReplyFlags } from "./modules/coach/coach.js";
import { buildReplyOptionsForHer, isUsableModelReplyOptions } from "./modules/coach/replies.js";
import { buildOptimizerPrompt, buildInterventionPrompt, buildStageDetectionPrompt, buildActionPlanPrompt, PROMPT_VERSION } from "./modules/coach/prompts.js";
import { isValidStage } from "./modules/core/stages.js";
import { scenarios } from "./modules/content/scenarios.js";
import { longContentIndex } from "./modules/content/long-content-index.js";
import { normalizeLearningState, recordTrainingEvent } from "./modules/core/learning-state.js";
import { buildLocalOptimizations, normalizeOptimizationResult, diffText } from "./modules/training/optimizer.js";
import { buildSignalExercise, classifySocialSignals, evaluateSignalGuess } from "./modules/training/signals.js";
import { scoreTiming } from "./modules/training/timing.js";
import { parseReplayText, redactSensitiveText, analyzeReplay, buildReplaySummary } from "./modules/training/replay.js";
import { selectDailyTask, gradeMicroTask, getTrainingStreak } from "./modules/training/micro-training.js";
import { aggregateGrowth, buildRadarData, getMastery, buildGrowthSummary, GROWTH_DIMENSION_LABELS } from "./modules/training/growth.js";
import { buildTextbookSearchIndex, buildCoachTextbookEvidence, buildTextbookCoachContext } from "./modules/content/textbook-search.js";
import { getSharedTextbookIndex } from "./modules/content/textbook-index.js";
import { formatRedactionNotice } from "./modules/core/privacy.js";
import { $, escapeHtml as escapeHtmlShared } from "./modules/core/dom.js";
import {
  getAllPersonas, getCurrentPersona, getLatestMineText, getPersonaMemory, getState,
  loadState, saveState, setState as setStateStore
} from "./modules/core/state.js";
import { extractMemoryFromConversation, updateMemoryState, buildMemoryInjection, buildConversationSummary, migrateMemory, analyzeLongTermPatterns, buildPatternInjection } from "./modules/core/memory.js";
import { localAnalyze, parseModelContent, extractJsonObject, normalizeCoachScore, normalizeReplyOptions, parsePreflightEvaluation, parseStageResult } from "./modules/coach/parser.js";
import { buildMessages as buildMessagesPure, callLLM as callLLMPure, checkHealth as checkHealthApi } from "./modules/core/api-client.js";
import { emit, Events } from "./modules/core/events.js";
import { appendHerIfNeeded, appendMine, appendMineIfNew, recallMine, renderChat } from "./modules/render/render-chat.js";
import { renderPersonaControls, savePersonaMemory, switchPersona as switchPersonaView, saveCustomPersona as saveCustomPersonaView, deleteCurrentPersona as deleteCurrentPersonaView, uploadAvatar, resetAvatar, setAvatarPosition, beginAvatarDrag, moveAvatarDrag, endAvatarDrag } from "./modules/render/render-persona.js";
import { card, renderActionPlan, renderAnalysis as renderCoachAnalysis, renderPlanCard, buildActionPlan } from "./modules/render/render-coach.js";
import { buildCoachFloatData, buildCoachFloatHtml } from "./modules/render/coach-float.js";
import { runCoachFloatSearch as runCoachFloatSearchView } from "./modules/render/coach-float-search.js";
import { renderTiming, renderSignalPractice, renderDailyTraining, renderGrowthProfile, renderTextbookEvidence } from "./modules/render/render-learning.js";
import { openLongReader as openLongReaderView, closeLongReader, renderChapterList, loadChapter } from "./modules/render/render-longContent.js";
import { openIntervention, closeIntervention } from "./modules/render/render-intervention.js";
import { autoDetectStage as autoDetectStageView, onStageManualChange, persistCurrentStage, renderStageProgress, restoreStageState } from "./modules/render/render-stage.js";
import { renderScenarioList, loadScenario as loadScenarioView, REVIEW_MAPPING } from "./modules/render/render-scenario.js";
import { initMobileTabs, markCoachUnread } from "./modules/render/mobile-tabs.js";
import { init as initDropdowns } from "./modules/render/dropdown.js";
import { createRelationshipIntelligenceController } from "./modules/intelligence/controller.js";
import { renderRelationshipIntelligence } from "./modules/render/render-intelligence.js";
import { createTrainingModeController } from "./modules/training/training-mode-controller.js";

let state = loadState();
const MIMO_MODEL = DEFAULT_MODEL;
const textbookSearchIndex = getSharedTextbookIndex();
let isGenerating = false;

const intelligenceController = createRelationshipIntelligenceController({
  getAppState: () => state,
  saveAppState: saveState,
  getGoal: () => $("goal")?.value || "",
  render: renderIntelligencePanel
});

const trainingModeController = createTrainingModeController({
  getAppState: () => state,
  saveAppState: saveState,
  getElement: $,
  setStatus: (message) => { if ($("apiStatus")) $("apiStatus").textContent = message; }
});

// Compatibility facade: DOM, persistence, parsing and rendering now live in modules.
function escapeHtml(value) { return escapeHtmlShared(value); }

function uiValues() {
  return {
    stage: $("stage")?.value || "",
    styleBias: $("styleBias")?.value || "mix",
    goal: $("goal")?.value || "",
    typedInput: $("userInput")?.value || "",
    mode: state.trainingMode === "pua" ? "pua" : "anti",
    tone: {
      sincerity: Number($("sincerity")?.value ?? 70),
      toneIntensity: Number($("toneIntensity")?.value ?? 50)
    }
  };
}

function afterChatRender() {
  renderTiming();
  renderSignalPractice();
}

function showReviewComparison(stage) {
  const mapping = REVIEW_MAPPING[stage];
  if (!mapping) return "";
  const chapter = longContentIndex.chapters.find((item) => item.id === mapping.chapter);
  if (!chapter) return "";
  return `<div class="review-comparison-link" data-chapter="${mapping.chapter}">📖 对照长篇第${mapping.chapter}章「${escapeHtml(chapter.title)}」的复盘要点</div>`;
}

function openLongReader(chapterId = null, reviewPointId = null) {
  return openLongReaderView(chapterId, reviewPointId, { openIntervention });
}

function renderLearningPanels() {
  renderTiming();
  renderSignalPractice();
  renderDailyTraining();
  renderGrowthProfile();
  renderTextbookEvidence(state.lastAnalysis, { openLongReader });
}

function renderIntelligencePanel(value = state.relationshipIntelligence) {
  renderRelationshipIntelligence(value);
  const consent = $("relationshipIntelligenceConsent");
  if (consent) consent.checked = value?.consent === true;
}

function renderCoachFloat() {
  const panel = $("coachFloatPanel");
  if (!panel) return;
  panel.innerHTML = buildCoachFloatHtml(buildCoachFloatData(state.lastAnalysis));
}

function toggleCoachFloat() {
  const panel = $("coachFloatPanel");
  if (!panel) return;
  const hidden = panel.classList.toggle("hidden");
  if (!hidden) renderCoachFloat();
  $("coachFloatBtn")?.classList.toggle("is-open", !hidden);
}

async function runCoachFloatSearch() {
  return runCoachFloatSearchView({
    analysis: state.lastAnalysis || {},
    stage: $("stage")?.value || ""
  });
}

function renderAll() {
  renderStageProgress($("stage")?.value || "");
  renderPersonaControls();
  renderCoachFloat();
  renderChat({ afterRender: afterChatRender });
  renderCoachAnalysis(state.lastAnalysis, {
    showReviewComparison,
    openLongReader,
    onAfterRender: () => {
      renderLearningPanels();
      if (state.lastAnalysis) markCoachUnread();
    }
  });
  renderActionPlan();
  renderScenarioList();
  renderIntelligencePanel();
}

function addTrainingLog(data) {
  if (!data?.coachScore) return;
  if (!Array.isArray(state.trainingLog)) state.trainingLog = [];
  const lastMine = getLatestMineText();
  const last = state.trainingLog[0];
  if (last?.mine === lastMine && last?.herReply === data.herReply) return;
  state.trainingLog.unshift({
    time: new Date().toLocaleString("zh-CN", { hour12: false }),
    stage: $("stage")?.value || "",
    mine: lastMine,
    herReply: data.herReply || "",
    source: data.generationSource || data.source || state.lastGenerationMeta?.source || "",
    score: data.coachScore,
    baseline: "calibrated"
  });
  state.trainingLog = state.trainingLog.slice(0, 12);
  const dimension = { momentum: "initiative", empathy: "curiosity", boundary: "boundaries", naturalness: "timing" }[data.coachScore.weakestDim] || "initiative";
  state.learning = recordTrainingEvent(state.learning, {
    id: `coach-event-${Date.now()}-${state.messages.length}`,
    type: "coach-score",
    source: data.generationSource || data.source || "local",
    dimension,
    score: data.coachScore.total,
    createdAt: new Date().toISOString(),
    metadata: { naturalness: data.coachScore.naturalness, empathy: data.coachScore.empathy, boundary: data.coachScore.boundary, momentum: data.coachScore.momentum, weakestDim: data.coachScore.weakestDim || null }
  });
}

function commitAnalysis(data, source) {
  state.lastAnalysis = { ...data, source, generationSource: source };
  appendHerIfNeeded(state.lastAnalysis.herReply, source, { afterRender: afterChatRender });
  addTrainingLog(state.lastAnalysis);
  state.lastGenerationMeta = { source, error: "" };

  // 旧版增强记忆与新 runtime 共用同一显式同意开关；默认不持久化。
  if (state.relationshipIntelligence?.consent === true) {
    const persona = getCurrentPersona();
    const memoryUpdates = extractMemoryFromConversation(state.messages, state.lastAnalysis);
    if (Object.keys(memoryUpdates).length > 0) {
      if (!state.personaMemory[persona.id]) state.personaMemory[persona.id] = {};
      const currentEnhanced = state.personaMemory[persona.id]._enhanced || null;
      state.personaMemory[persona.id]._enhanced = updateMemoryState(
        migrateMemory(currentEnhanced),
        memoryUpdates,
        state.messages
      );
    }
  }

  saveState();
  renderAll();
  emit(Events.ANALYSIS_COMMITTED, { source, score: data.coachScore });
  void intelligenceController.refresh();
  return state.lastAnalysis;
}

function localFallback(modelError = "") {
  const data = localAnalyze(modelError, uiValues());
  appendMineIfNew({ afterRender: afterChatRender });
  return commitAnalysis(data, "local");
}

function buildMessages() {
  const persona = getCurrentPersona();
  const memory = getPersonaMemory(persona);
  const evidence = buildCoachTextbookEvidence({ ...(state.lastAnalysis || {}), stage: $("stage")?.value || "" }, textbookSearchIndex);
  const textbookContext = buildTextbookCoachContext({ summary: evidence.message || buildReplaySummary({ observations: [], suggestions: [] }), results: evidence.results || [] });

  // 注入增强记忆 + 长期模式分析
  const enhanced = state.relationshipIntelligence?.consent === true
    ? state.personaMemory?.[persona.id]?._enhanced
    : null;
  let enhancedInjection = "";
  if (enhanced) {
    const memoryInjection = buildMemoryInjection(enhanced);
    const patterns = analyzeLongTermPatterns(enhanced);
    const patternInjection = buildPatternInjection(patterns);
    enhancedInjection = [memoryInjection, patternInjection].filter(Boolean).join("\n");
  }
  const memoryWithEnhanced = enhancedInjection ? {
    ...memory,
    _enhancedInjection: enhancedInjection
  } : memory;

  return buildMessagesPure(persona, memoryWithEnhanced, state.messages, { ...uiValues(), textbookContext });
}

async function callLLM(options) {
  const result = await callLLMPure(options);
  const notice = formatRedactionNotice(result.redactionHits);
  const el = $("privacyNotice");
  if (el) {
    if (notice) {
      el.textContent = `🛡 ${notice}`;
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  }
  return result;
}

async function askAi({ silent = false } = {}) {
  $("apiStatus").textContent = "模型调用中...";
  try {
    savePersonaMemory(false);
    appendMineIfNew({ afterRender: afterChatRender });
    const result = await callLLM({ endpoint: $("endpoint").value, apiKey: $("apiKey").value, model: MIMO_MODEL, messages: buildMessages() });
    const parsed = parseModelContent(result.content, uiValues());
    if (!parsed.herReply) throw new Error("模型未返回女方对话。");
    $("apiStatus").textContent = "模型调用成功。";
    return commitAnalysis(parsed, "model");
  } catch (error) {
    state.lastGenerationMeta = { source: "model", error: error.message || String(error) };
    saveState();
    $("apiStatus").textContent = "模型调用失败：" + error.message;
    if (!silent) throw error;
    return null;
  }
}

async function generateHerDialogue(options = {}) {
  const { allowLocalFallback = true } = options;
  if (isGenerating) return null;
  isGenerating = true;
  const genBtn = $("generateHerBtn");
  const retryBtn = $("retryModelBtn");
  const originalLabel = genBtn?.textContent;
  if (genBtn) { genBtn.disabled = true; genBtn.classList.add("is-busy"); genBtn.textContent = "生成中…"; }
  if (retryBtn) retryBtn.disabled = true;
  try {
    const parsed = await askAi({ silent: !allowLocalFallback });
    if (parsed) return parsed;
    if (!allowLocalFallback) return null;
    return localFallback(state.lastGenerationMeta?.error || "模型返回为空");
  } catch (error) {
    if (!allowLocalFallback) { $("apiStatus").textContent = "MiMo 失败：" + error.message; return null; }
    $("apiStatus").textContent = "MiMo 失败，已切换到本地兜底：" + error.message;
    return localFallback(error.message);
  } finally {
    isGenerating = false;
    if (genBtn) { genBtn.disabled = false; genBtn.classList.remove("is-busy"); genBtn.textContent = originalLabel || "生成女方对话"; }
    if (retryBtn) retryBtn.disabled = false;
  }
}

function renderDiffHtml(before, after) {
  return diffText(before, after).map((part) => {
    const text = escapeHtml(part.text);
    return part.type === "added" ? `<ins>${text}</ins>` : part.type === "removed" ? `<del>${text}</del>` : text;
  }).join("");
}

function renderPreflightPanel({ panel, original, score, flags, optimization }) {
  panel.innerHTML = `<div class="preflight-card"><div class="preflight-head"><strong>发送前测验</strong><span>${score.total}/100</span></div><p>${escapeHtml(score.summary || "先看风险，再决定是否发送。")}</p><div class="preflight-risks">${flags.warning ? escapeHtml(flags.warning) : "未发现明显风险"}</div><div class="optimizer-grid"><div class="optimizer-variant"><b>原文</b><p>${escapeHtml(original)}</p></div><div class="optimizer-variant"><b>低压力版</b><p>${escapeHtml(optimization.lowPressure.text)}</p><small>${escapeHtml(optimization.lowPressure.reason || "")}</small><button class="btn small" data-optimizer-variant="lowPressure">采用</button></div><div class="optimizer-variant"><b>主动推进版</b><p>${escapeHtml(optimization.proactive.text)}</p><small>${escapeHtml(optimization.proactive.reason || "")}</small><button class="btn small" data-optimizer-variant="proactive">采用</button></div></div><p class="note">修改理由 / Diff：${renderDiffHtml(original, optimization.lowPressure.text)}</p></div>`;
  panel.querySelectorAll("button[data-optimizer-variant]").forEach((button) => button.addEventListener("click", () => {
    const picked = optimization[button.dataset.optimizerVariant]?.text;
    if (picked) { $("userInput").value = picked; renderTiming(); $("userInput").focus(); }
  }));
}

async function preflightReply() {
  const original = $("userInput").value.trim();
  const panel = $("preflightPanel");
  if (!original) { panel.innerHTML = card("发送前测验", "先输入你准备发送的回复。"); renderTiming(); return; }
  const persona = getCurrentPersona();
  const memory = getPersonaMemory(persona);
  const lastHerMsg = [...state.messages].reverse().find((m) => m.type === "her")?.text || "";
  const score = buildCoachScore(original, { risk: memory.boundaries, judgement: memory.background, herLastMessage: lastHerMsg });
  const flags = detectReplyFlags(original, memory);
  const conversation = state.messages.slice(-6).map((message) => ({ speaker: message.type === "her" ? (message.who || persona.name) : "我", text: message.text }));
  let optimization = buildLocalOptimizations(original, { stage: $("stage")?.value || "", goal: $("goal")?.value || "", recentTopic: conversation.at(-1)?.text || "" });
  renderPreflightPanel({ panel, original, score, flags, optimization });
  try {
    $("apiStatus").textContent = "正在调用 MiMo 增强消息优化...";
    const prompt = buildOptimizerPrompt({ original, stage: $("stage")?.value || "", goal: $("goal")?.value || "", conversation });
    const result = await callLLM({ endpoint: $("endpoint").value, apiKey: $("apiKey").value, model: MIMO_MODEL, temperature: 0.5, messages: [{ role: "system", content: prompt.systemPrompt }, { role: "user", content: prompt.userPrompt }] });
    optimization = normalizeOptimizationResult(result.content, { original, fallback: optimization, stage: $("stage")?.value || "" });
    renderPreflightPanel({ panel, original, score, flags, optimization });
    $("apiStatus").textContent = optimization.source === "model" ? "MiMo 已完成消息优化。" : "MiMo 输出未完全通过安全校验，已保留本地备用版本。";
  } catch (error) {
    $("apiStatus").textContent = `MiMo 消息优化失败，已保留本地版本：${error.message}`;
  }
}

function normalizeActionPlan(content, fallback) {
  try {
    const parsed = JSON.parse(extractJsonObject(content));
    if (!parsed.title || !parsed.objective || !Array.isArray(parsed.steps) || parsed.steps.length < 3 || !Array.isArray(parsed.topics) || parsed.topics.length < 4 || !Array.isArray(parsed.decisionRules) || parsed.decisionRules.length < 3) return fallback;
    return { title: String(parsed.title), pacing: String(parsed.pacing || fallback.pacing), objective: String(parsed.objective), steps: parsed.steps.slice(0, 3).map((step) => ({ title: String(step.title || "下一步"), detail: String(step.detail || "") })), topics: parsed.topics.slice(0, 4).map(String), decisionRules: parsed.decisionRules.slice(0, 3).map(String), warning: String(parsed.warning || fallback.warning) };
  } catch { return fallback; }
}

async function generateActionPlan() {
  const persona = getCurrentPersona();
  const memory = getPersonaMemory(persona);
  const fallback = buildActionPlan(persona, memory, state.lastAnalysis?.coachScore || state.trainingLog?.[0]?.score || null, uiValues());
  renderPlanCard(fallback);
  try {
    $("apiStatus").textContent = "正在调用 MiMo 生成行动计划...";
    const conversation = state.messages.map((message) => ({ speaker: message.type === "her" ? (message.who || persona.name) : "我", text: message.text }));
    const prompt = buildActionPlanPrompt({
      persona,
      memory,
      coachScore: state.lastAnalysis?.coachScore || {},
      stage: uiValues().stage,
      conversation
    });
    const result = await callLLM({ endpoint: $("endpoint").value, apiKey: $("apiKey").value, model: MIMO_MODEL, messages: [{ role: "user", content: prompt }], temperature: 0.7 });
    renderPlanCard(normalizeActionPlan(result.content, fallback));
    $("apiStatus").textContent = "MiMo 已生成行动计划。";
  } catch (error) {
    $("apiStatus").textContent = `行动计划调用失败，已显示本地计划：${error.message}`;
  }
}

async function checkHealth() {
  try {
    const json = await checkHealthApi();
    $("apiStatus").textContent = `服务正常。模式：${json.apiMode || "unknown"}。模型：${json.model}。密钥：${json.hasApiKey ? "已配置" : "未配置"}`;
  } catch (error) {
    $("apiStatus").textContent = `服务不可用：${error.message}`;
  }
}

async function nextTurn() {
  const parsed = await askAi({ silent: true });
  if (parsed) { $("userInput").value = ""; $("userInput").focus(); }
}

function exportSession() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = "heartflow-session.json"; anchor.click(); URL.revokeObjectURL(url);
}

function resetSession() {
  const previousIntelligence = state.relationshipIntelligence;
  state = setStateStore({ ...structuredClone(defaultState), personaId: state.personaId, customPersonas: state.customPersonas, personaMemory: state.personaMemory, avatarOverrides: state.avatarOverrides, relationshipIntelligence: previousIntelligence });
  intelligenceController.reset();
  $("userInput").value = getCurrentPersona().sampleReply || "";
  renderAll();
  $("apiStatus").textContent = "当前对话已重置。";
  emit(Events.STATE_RESET, {});
  void intelligenceController.refresh();
}

function handleRecall(index) {
  const result = recallMine(index);
  if (!result.ok) return;
  const removedReply = result.removed.find((message) => message.type === "her");
  if (removedReply && state.lastAnalysis?.herReply === removedReply.text) {
    state.lastAnalysis = null;
    state.lastGenerationMeta = null;
    saveState();
  }
  $("userInput").value = result.message.text;
  renderAll();
  $("userInput").focus();
  $("apiStatus").textContent = "已撤回这条消息，可以修改后重新发送。";
  void intelligenceController.refresh();
}

function switchPersona(personaId, resetConversation = true) {
  switchPersonaView(personaId, resetConversation, { onChanged: renderAll });
  state = getState();
  if (resetConversation) {
    intelligenceController.reset();
    void intelligenceController.refresh();
  }
  emit(Events.PERSONA_SWITCHED, { personaId });
}

function saveCustomPersona() { saveCustomPersonaView({ onChanged: renderAll }); state = getState(); }
function deleteCurrentPersona() { deleteCurrentPersonaView({ onChanged: renderAll }); state = getState(); }

function loadScenario(scenarioId) {
  loadScenarioView(scenarioId, { switchPersona, onChanged: renderAll });
  persistCurrentStage();
  intelligenceController.reset();
  void intelligenceController.refresh();
}

function sendMine() {
  if (appendMine({ afterRender: afterChatRender })) void intelligenceController.refresh();
}

function setRelationshipIntelligenceConsentFromUi() {
  const granted = $("relationshipIntelligenceConsent")?.checked === true;
  if (!granted) {
    for (const memory of Object.values(state.personaMemory || {})) {
      if (memory && typeof memory === "object") delete memory._enhanced;
    }
  }
  intelligenceController.setConsent(granted);
  if (granted) void intelligenceController.refresh();
}

function openReplayModal() { $("replayModal")?.classList.remove("hidden"); }
function closeReplayModal() { $("replayModal")?.classList.add("hidden"); }

function runReplayAnalysis() {
  const raw = $("replayInput")?.value || "";
  const parsed = parseReplayText(raw);
  const analysis = analyzeReplay(parsed.messages);
  const result = $("replayResult");
  if (!result) return;
  result.innerHTML = `<div class="mini"><h4>本地回放结果</h4><p>${escapeHtml(buildReplaySummary(analysis))}</p>${(analysis.observations || []).slice(0, 4).map((item) => `<p>· ${escapeHtml(item.text || item.observation || "")}</p>`).join("")}</div>`;
  state.learning.replayAnalyses = [...(state.learning.replayAnalyses || []), { createdAt: new Date().toISOString(), summary: buildReplaySummary(analysis), observations: (analysis.observations || []).slice(0, 4).map((item) => item.text || item.observation || "") }].slice(-12);
  saveState();
}

async function enhanceReplayWithMiMo() {
  // Raw replay remains local; only redactSensitiveText/short summary may cross the model boundary.
  $("apiStatus").textContent = "真实对话默认只在本地分析。";
}

// Compatibility markers retained for the existing integration contract. The implementations are now in modules.
// normalized.learning = normalizeLearningState(normalized)
// state.learning = normalizeLearningState(state.learning)
// normalized.messages = structuredClone(all[normalized.personaId].starterMessages)
// state.messages = structuredClone(persona.starterMessages)
// state.messages = [...scenario.openingMessages]
// Object.entries(replyOptions) is normalized by parser.js.
// escapeHtml(part.text), textContent =, data.dataAvailable and raw replay are handled by render modules.
// signalPanel / confidence / evidence / recommendedDirection / 不会阻止发送 / replyOptionsSource: useModelOptions ? "model" : "local"
// signalAttempts / dailyTrainingPanel / growthPanel / renderDailyTraining / renderGrowthProfile / renderTextbookEvidence
// openReplayBtn / data-review-id / 暂未找到直接对应内容 / 打开复盘点
// loadChapter(chapterId, pendingReviewPointId) / reviewPointId

window.RelationshipLLM = {
  buildMessages,
  call: callLLM,
  preflightReply,
  getPersonaMemory,
  getState: () => structuredClone(getState()),
  setState: (next) => { state = setStateStore(next); renderAll(); }
};

$("retryModelBtn")?.addEventListener("click", () => generateHerDialogue({ allowLocalFallback: false }));
$("generateHerBtn")?.addEventListener("click", () => generateHerDialogue());
$("sendMineBtn")?.addEventListener("click", sendMine);
$("modeBtnAnti")?.addEventListener("click", () => trainingModeController.setMode("anti"));
$("modeBtnPua")?.addEventListener("click", () => trainingModeController.setMode("pua", { ask: true }));
$("chat")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-recall-index]");
  if (button) handleRecall(button.dataset.recallIndex);
});
$("preflightBtn")?.addEventListener("click", preflightReply);
$("planBtn")?.addEventListener("click", generateActionPlan);
$("nextBtn")?.addEventListener("click", nextTurn);
$("healthBtn")?.addEventListener("click", checkHealth);
$("exportBtn")?.addEventListener("click", exportSession);
$("resetBtn")?.addEventListener("click", resetSession);
$("personaSelect")?.addEventListener("change", (event) => switchPersona(event.target.value, true));
$("savePersonaBtn")?.addEventListener("click", saveCustomPersona);
$("deletePersonaBtn")?.addEventListener("click", deleteCurrentPersona);
$("avatarUpload")?.addEventListener("change", uploadAvatar);
$("resetAvatarBtn")?.addEventListener("click", resetAvatar);
$("avatarPosX")?.addEventListener("input", () => setAvatarPosition($("avatarPosX").value, $("avatarPosY").value));
$("avatarPosY")?.addEventListener("input", () => setAvatarPosition($("avatarPosX").value, $("avatarPosY").value));
$("personaAvatar")?.addEventListener("pointerdown", beginAvatarDrag);
$("personaAvatar")?.addEventListener("pointermove", moveAvatarDrag);
$("personaAvatar")?.addEventListener("pointerup", endAvatarDrag);
$("personaAvatar")?.addEventListener("pointercancel", endAvatarDrag);
$("saveMemoryBtn")?.addEventListener("click", () => savePersonaMemory(true));
$("goal")?.addEventListener("input", () => { $("goal").dataset.personaSynced = "false"; });
$("sincerity")?.addEventListener("input", () => { if ($("sincerityValue")) $("sincerityValue").textContent = $("sincerity").value; });
$("toneIntensity")?.addEventListener("input", () => { if ($("toneIntensityValue")) $("toneIntensityValue").textContent = $("toneIntensity").value; });
$("userInput")?.addEventListener("input", renderTiming);
$("stage")?.addEventListener("change", () => { renderTiming(); onStageManualChange(); });
$("longContentBtn")?.addEventListener("click", () => openLongReader());
$("closeLongReaderBtn")?.addEventListener("click", closeLongReader);
$("closeInterventionBtn")?.addEventListener("click", closeIntervention);
$("interventionOverlay")?.addEventListener("click", closeIntervention);
$("autoStageBtn")?.addEventListener("click", () => autoDetectStageView({ model: MIMO_MODEL, endpoint: $("endpoint").value, apiKey: $("apiKey").value, onStatus: (message) => { $("apiStatus").textContent = message; } }));
$("loadScenarioBtn")?.addEventListener("click", () => loadScenario());
$("openReplayBtn")?.addEventListener("click", openReplayModal);
$("closeReplayBtn")?.addEventListener("click", closeReplayModal);
$("replayOverlay")?.addEventListener("click", closeReplayModal);
$("analyzeReplayBtn")?.addEventListener("click", runReplayAnalysis);
$("coachFloatBtn")?.addEventListener("click", toggleCoachFloat);
$("relationshipIntelligenceConsent")?.addEventListener("change", setRelationshipIntelligenceConsentFromUi);
$("refreshRelationshipIntelligenceBtn")?.addEventListener("click", () => void intelligenceController.refresh());
// 悬浮面板内按钮用事件委托，避免每次打开面板重复绑定。
$("coachFloatPanel")?.addEventListener("click", (event) => {
  if (event.target.closest("#coachFloatSearchBtn")) runCoachFloatSearch();
});

renderAll();
trainingModeController.render();
initMobileTabs();
restoreStageState();
checkHealth();
void intelligenceController.refresh();
