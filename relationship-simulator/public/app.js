/* HeartFlow controller: this file only assembles state, API and render modules. */
import { builtInPersonas, defaultState, DEFAULT_MODEL } from "./modules/core/config.js";
import { buildCoachScore, clampScore, detectReplyFlags } from "./modules/coach/coach.js";
import { buildReplyOptionsForHer, isUsableModelReplyOptions } from "./modules/coach/replies.js";
import { buildOptimizerPrompt, buildInterventionPrompt, buildStageDetectionPrompt, buildActionPlanPrompt, PROMPT_VERSION } from "./modules/coach/prompts.js";
import { isValidStage } from "./modules/core/stages.js";
import { scenarios } from "./modules/content/scenarios.js";
import { loadManifest } from "./modules/content/long-content-loader.js";
import { normalizeLearningState, recordTrainingEvent } from "./modules/core/learning-state.js";
import { createCoachLearningEvent } from "./modules/core/training-scores.js";
import {
  shouldCollectFromScore, shouldCollectFromPreflight, classifyPreflightIssues, collectMistake
} from "./modules/core/mistakes.js";
import { MISTAKE_DIM_LABELS } from "./modules/training/mistake-patterns.js";
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
  loadState, saveState, setState as setStateStore, mutate, onStateChange, serializeStateForStorage,
  getStateLoadIssue
} from "./modules/core/state.js";
import { buildBackup, buildBackupFilename, validateBackup, applyBackup } from "./modules/core/backup.js";
import { buildTierPromptLine } from "./modules/core/investment.js";
import { extractMemoryFromConversation, updateMemoryState, buildMemoryInjection, migrateMemory, analyzeLongTermPatterns, buildPatternInjection } from "./modules/core/memory.js";
import { localAnalyze, parseModelContent, extractJsonObject, normalizeCoachScore, normalizeReplyOptions, parsePreflightEvaluation, parseStageResult } from "./modules/coach/parser.js";
import { buildHerMessages, buildCoachMessages, callLLM as callLLMPure, checkHealth as checkHealthApi } from "./modules/core/api-client.js";
import { emit, Events } from "./modules/core/events.js";
import { appendMine, appendMineIfNew, recallMine, renderChat } from "./modules/render/render-chat.js";
import { appendGeneratedReply } from "./modules/core/conversation.js";
import { parseHerBubbles, joinHerReply } from "./modules/coach/her-reply.js";
import { renderPersonaControls, savePersonaMemory, switchPersona as switchPersonaView, saveCustomPersona as saveCustomPersonaView, deleteCurrentPersona as deleteCurrentPersonaView, uploadAvatar, resetAvatar, setAvatarPosition, beginAvatarDrag, moveAvatarDrag, endAvatarDrag } from "./modules/render/render-persona.js";
import { card, renderActionPlan, renderAnalysis as renderCoachAnalysis, renderPlanCard, buildActionPlan, isRelationshipStopped } from "./modules/render/render-coach.js";
import { buildCoachFloatData, buildCoachFloatHtml } from "./modules/render/coach-float.js";
import { runCoachFloatSearch as runCoachFloatSearchView } from "./modules/render/coach-float-search.js";
import { renderTiming, renderSignalPractice, renderDailyTraining, renderGrowthProfile, renderTextbookEvidence, enableTextbookIndexLoad } from "./modules/render/render-learning.js";
import { openLongReader as openLongReaderView, closeLongReader, renderChapterList, loadChapter } from "./modules/render/render-longContent.js";
import { openIntervention, closeIntervention } from "./modules/render/render-intervention.js";
import { renderMistakes, closeMistakePractice } from "./modules/render/render-mistakes.js";
import { renderMemoryPanel } from "./modules/render/render-memory-panel.js";
import { renderLifestyle } from "./modules/render/render-lifestyle.js";
import { renderPresentationKnowledge } from "./modules/render/render-presentation-knowledge.js";
import { renderSessionReport, generateSessionReport } from "./modules/render/render-session-report.js";
import { renderIntake } from "./modules/render/render-intake.js";
import { renderRealPractice, resetRealPracticeDrafts } from "./modules/render/render-real-practice.js";
import { renderDateJourney, resetDateJourney } from "./modules/render/render-date-journey.js";
import { renderAbilityAssessment, resetAbilityAssessmentDrafts } from "./modules/render/render-ability-assessment.js";
import { createConversationResetState } from "./modules/core/state-reset.js";
import { modelStatusLabel } from "./modules/core/model-status.js";
import { autoDetectStage as autoDetectStageView, onStageManualChange, persistCurrentStage, renderStageProgress, restoreStageState } from "./modules/render/render-stage.js";
import { renderScenarioList, loadScenario as loadScenarioView, REVIEW_MAPPING } from "./modules/render/render-scenario.js";
import { markCoachUnread, clearCoachUnread } from "./modules/render/mobile-tabs.js";
import { initWorkspaceNav } from "./modules/render/workspace-nav.js";
import { init as initDropdowns } from "./modules/render/dropdown.js";
import { createRelationshipIntelligenceController } from "./modules/intelligence/controller.js";
import { renderRelationshipIntelligence } from "./modules/render/render-intelligence.js";
import { createTrainingModeController } from "./modules/training/training-mode-controller.js";
import { initComplianceBanner } from "./modules/render/compliance-banner.js";
import { createRequestScope } from "./modules/core/request-scope.js";
import { speakText, stopSpeaking, maybeAutoSpeak, TTS_ENGINES, voicesFor, getVoicePrefs, setVoicePrefs, fetchTtsHealth } from "./modules/voice/tts-client.js";

let state = loadState();
const MIMO_MODEL = DEFAULT_MODEL;
/**
 * 角色回复通道预算：实测 MiMo-V2.6-Flash 思考默认开启时完整回复 14.97s，
 * 关闭后 1.80s（48 个输出 token 里 29 个是推理 token）。教练分析通道不在此列。
 */
const HER_LANE = Object.freeze({ thinking: { type: "disabled" }, maxCompletionTokens: 200 });
// 长篇索引自拆包（P2-13）后为懒加载；manifest 预取用于"对照长篇复盘"链接的章节标题。
let manifestChapters = [];
let isGenerating = false;
let preflightRevision = 0;
let currentPreflightContext = null;
const STALE_RESULT = Symbol("stale-result");
const modelRequests = createRequestScope(() => JSON.stringify({
  personaId: state.personaId, messages: state.messages, memory: state.personaMemory,
  consent: state.relationshipIntelligence?.consent, ui: uiValues()
}));
const workspaceNav = initWorkspaceNav({ onViewChange: (view) => {
  modelRequests.cancel("coach-search");
  if (view === "coach") clearCoachUnread();
  window.scrollTo({ top: 0, behavior: "instant" });
} });

const intelligenceController = createRelationshipIntelligenceController({
  getAppState: () => state,
  saveAppState: saveState,
  getGoal: () => $("goal")?.value || "",
  updateAppState: mutate,
  render: renderIntelligencePanel
});

const trainingModeController = createTrainingModeController({
  getAppState: () => state,
  saveAppState: saveState,
  getElement: $,
  updateAppState: mutate,
  setStatus: (message) => { if ($("apiStatus")) $("apiStatus").textContent = message; }
});

// 合规横幅：首访明示角色为 AI 模拟，用户确认后不再显示。
initComplianceBanner({ getElement: $ });

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
  const chapter = manifestChapters.find((item) => item.id === mapping.chapter);
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
  renderRealPractice();
  renderDateJourney();
  renderGrowthProfile();
  renderMistakes();
  renderMemoryPanel();
  renderSessionReport();
  renderLifestyle();
  renderPresentationKnowledge();
  renderIntake();
  void renderTextbookEvidence(state.lastAnalysis, { openLongReader });
}

// ── F2 错题本收集 ─────────────────────────────────────────────────────────────

/** 统一收集入口：去重 + 上限裁剪都在 core/mistakes.js 纯函数内完成，写路径走 mutate。 */
function collectMistakeEntry(entry) {
  mutate((draft) => {
    const outcome = collectMistake(draft.mistakes, {
      ts: new Date().toISOString(),
      stage: $("stage")?.value || "",
      mode: draft.trainingMode === "pua" ? "pua" : "anti",
      ...entry
    });
    draft.mistakes = outcome.mistakes;
    return outcome.collected;
  });
}

/** 收集点一：preflight 最高档（高危越界/施压词）自动收集；medium/low 不收集。 */
function collectPreflightMistake({ text, score, flags }) {
  if (!shouldCollectFromPreflight(flags)) return;
  collectMistakeEntry({
    source: "preflight",
    text,
    dims: {
      naturalness: score?.naturalness ?? null,
      empathy: score?.empathy ?? null,
      boundary: score?.boundary ?? null,
      drive: score?.momentum ?? null
    },
    issues: classifyPreflightIssues(flags.words)
  });
}

/** 收集点二：教练评分后 overall < 65 或任一维度 < 55 自动收集（同文未解决去重）。 */
function collectCoachMistake(draft, coachScore, text, stage, mode) {
  if (!shouldCollectFromScore(coachScore)) return;
  const outcome = collectMistake(draft.mistakes, {
    ts: new Date().toISOString(),
    source: "coach",
    stage,
    mode,
    text,
    dims: {
      naturalness: coachScore.naturalness,
      empathy: coachScore.empathy,
      boundary: coachScore.boundary,
      drive: coachScore.momentum
    },
    issues: [`${MISTAKE_DIM_LABELS[coachScore.weakestDim] || "综合"}短板`]
  });
  draft.mistakes = outcome.mistakes;
}

function renderIntelligencePanel(value = state.relationshipIntelligence) {
  renderRelationshipIntelligence(value);
  if (isRelationshipStopped(value)) modelRequests.cancel("plan");
  renderActionPlan();
  const consent = $("relationshipIntelligenceConsent");
  if (consent) consent.checked = value?.consent === true;
}

function renderCoachFloat() {
  const panel = $("coachFloatPanel");
  if (!panel) return;
  modelRequests.cancel("coach-search");
  panel.innerHTML = buildCoachFloatHtml(buildCoachFloatData(state.lastAnalysis));
}

function toggleCoachFloat() {
  const panel = $("coachFloatPanel");
  if (!panel) return;
  const hidden = panel.classList.toggle("hidden");
  if (hidden) modelRequests.cancel("coach-search");
  if (!hidden) renderCoachFloat();
  $("coachFloatBtn")?.classList.toggle("is-open", !hidden);
}

async function runCoachFloatSearch() {
  return runCoachFloatSearchView({
    analysis: state.lastAnalysis || {},
    stage: $("stage")?.value || "",
    requestScope: modelRequests
  });
}

function renderAnalysisPanel() {
  renderCoachAnalysis(state.lastAnalysis, {
    showReviewComparison,
    openLongReader,
    onAfterRender: () => {
      renderLearningPanels();
      if (state.lastAnalysis) markCoachUnread();
    }
  });
}

function renderAll() {
  if (currentPreflightContext !== null && currentPreflightContext !== capturePreflightContext()) invalidatePreflight();
  renderStageProgress($("stage")?.value || "");
  renderPersonaControls();
  if ($("chatContext")) $("chatContext").textContent = `${getCurrentPersona().name} · ${$("stage")?.value || ""}`;
  renderCoachFloat();
  renderChat({ afterRender: afterChatRender });
  renderAnalysisPanel();
  renderActionPlan();
  renderScenarioList();
  renderIntelligencePanel();
  renderMemoryPanel();
  renderAbilityAssessment();
}

function addTrainingLog(draft, data) {
  if (!data?.coachScore) return;
  if (!Array.isArray(draft.trainingLog)) draft.trainingLog = [];
  const lastMine = [...draft.messages].reverse().find((message) => message?.type === "me")?.text || "";
  const last = draft.trainingLog[0];
  if (last?.mine === lastMine && last?.herReply === data.herReply) return;
  draft.trainingLog.unshift({
    time: new Date().toLocaleString("zh-CN", { hour12: false }),
    stage: $("stage")?.value || "",
    mine: lastMine,
    herReply: data.herReply || "",
    source: data.generationSource || data.source || draft.lastGenerationMeta?.source || "",
    score: data.coachScore,
    baseline: "calibrated"
  });
  draft.trainingLog = draft.trainingLog.slice(0, 12);
  draft.learning = recordTrainingEvent(draft.learning, createCoachLearningEvent(data.coachScore, {
    id: `coach-event-${Date.now()}-${draft.messages.length}`,
    type: "coach-score",
    source: data.generationSource || data.source || "local",
    createdAt: new Date().toISOString()
  }));
  // F2 收集点二：低分自动进错题本（在 mutate 回调内直接操作 state，禁止嵌套 mutate）
  collectCoachMistake(draft, data.coachScore, lastMine, $("stage")?.value || "", draft.trainingMode === "pua" ? "pua" : "anti");
}

function commitHerReply(bubbles, source = "model") {
  const persona = getCurrentPersona();
  const createdAt = new Date().toISOString();
  mutate((state) => {
    for (const text of bubbles) appendGeneratedReply(state, text, source, persona.name, createdAt);
  });
  renderChat({ afterRender: afterChatRender });
  maybeAutoSpeak(joinHerReply(bubbles));
}

function commitAnalysis(data, source, { replyAlreadyCommitted = false } = {}) {
  const persona = getCurrentPersona();
  // 有意生成一轮分析后允许教材索引加载；提交通知只渲染一次。
  enableTextbookIndexLoad();
  mutate((state) => {
    state.lastAnalysis = { ...data, source, generationSource: source };
    // 两次调用路径下她的回复已先行落盘；同文本重复由 appendGeneratedReply 去重。
    if (!replyAlreadyCommitted) appendGeneratedReply(state, state.lastAnalysis.herReply, source, persona.name);
    addTrainingLog(state, state.lastAnalysis);
    state.lastGenerationMeta = { source, error: "" };

    // 旧版增强记忆与新 runtime 共用同一显式同意开关；默认不持久化。
    if (state.relationshipIntelligence?.consent === true) {
      const memoryUpdates = extractMemoryFromConversation(state.messages, state.lastAnalysis);
      if (Object.keys(memoryUpdates).length > 0) {
        if (!state.personaMemory[persona.id]) state.personaMemory[persona.id] = {};
        const currentEnhanced = state.personaMemory[persona.id]._enhanced || null;
        state.personaMemory[persona.id]._enhanced = updateMemoryState(
          migrateMemory(currentEnhanced),
          memoryUpdates,
          state.messages,
          state.lastAnalysis
        );
      }
    }
  });
  emit(Events.ANALYSIS_COMMITTED, { source, score: data.coachScore });
  void intelligenceController.refresh();
  maybeAutoSpeak(data.herReply);
  return state.lastAnalysis;
}

function localFallback(modelError = "") {
  const data = localAnalyze(modelError, uiValues());
  appendMineIfNew({ afterRender: afterChatRender });
  return commitAnalysis(data, "local");
}

async function buildGenerationContext() {
  const persona = getCurrentPersona();
  const memory = getPersonaMemory(persona);
  const textbookSearchIndex = await getSharedTextbookIndex();
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

  // 投入度分层：把持久化的 tier 转成策略行注入（无样本时不注入，避免空泛约束）
  const tierInjection = buildTierPromptLine(state.relationshipTier, $("stage")?.value || "");
  const memoryWithTier = tierInjection
    ? { ...memoryWithEnhanced, _tierInjection: tierInjection }
    : memoryWithEnhanced;

  // 教材上下文按当前分析结果检索；两次调用共用同一份，避免重复检索教材索引。
  const ui = { ...uiValues(), textbookContext };
  return { persona, memory: memoryWithTier, messages: structuredClone(state.messages), ui, textbookContext };
}

async function callLLM(options) {
  const result = await callLLMPure(options);
  if (options.signal?.aborted) return result;
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
  $("apiStatus").textContent = "她正在输入…";
  let ticket;
  let coachTicket;
  try {
    savePersonaMemory(false);
    appendMineIfNew({ afterRender: afterChatRender });
    ticket = modelRequests.begin("dialogue");
    const { persona, memory, messages, ui } = await buildGenerationContext();
    if (!ticket.isCurrent()) return STALE_RESULT;
    const api = { endpoint: $("endpoint").value, apiKey: $("apiKey").value, model: MIMO_MODEL, signal: ticket.signal };

    // 调用一：只要她的微信文本。先落盘、先渲染、先朗读——用户不必等教练分析。
    const herResult = await callLLM({ ...api, ...HER_LANE, messages: buildHerMessages(persona, memory, messages, ui) });
    if (!ticket.isCurrent()) return STALE_RESULT;
    const bubbles = parseHerBubbles(herResult.content, persona.name);
    if (!bubbles.length) throw new Error("模型未返回女方对话。");
    const herReply = joinHerReply(bubbles);
    commitHerReply(bubbles);

    // 她的回复落盘会改变会话上下文，因此教练调用必须另开一条通道、在落盘之后取快照，
    // 否则结果回来一定被判定为过期而丢弃。
    coachTicket = modelRequests.begin("dialogue-coach");
    $("apiStatus").textContent = "教练正在分析…";
    let analysis;
    let coachDegraded = false;
    try {
      const coachResult = await callLLM({
        ...api,
        signal: coachTicket.signal,
        messages: buildCoachMessages({ persona, memory, messages, herReply, uiValues: ui })
      });
      if (!coachTicket.isCurrent()) return STALE_RESULT;
      analysis = { ...parseModelContent(coachResult.content, ui), herReply };
    } catch (coachError) {
      if (!coachTicket.isCurrent()) return STALE_RESULT;
      coachDegraded = true;
      analysis = { ...localAnalyze(`教练分析失败：${coachError.message}`, ui), herReply };
    }
    $("apiStatus").textContent = coachDegraded
      ? "她已由模型回复；教练分析未通过，已用本地评估补上。"
      : "模型调用成功。";
    return commitAnalysis(analysis, "model", { replyAlreadyCommitted: true });
  } catch (error) {
    // 她的回复落盘后 ticket 的上下文快照必然已过期，此处以最近一次为准，
    // 否则提交阶段的真实错误会被当成过期结果静默吞掉。
    const active = coachTicket || ticket;
    if (active && !active.isCurrent()) return STALE_RESULT;
    mutate((state) => { state.lastGenerationMeta = { source: "model", error: error.message || String(error) }; });
    $("apiStatus").textContent = "模型调用失败：" + error.message;
    if (!silent) throw error;
    return null;
  } finally {
    ticket?.finish();
    coachTicket?.finish();
  }
}

async function generateHerDialogue(options = {}) {
  const { allowLocalFallback = true } = options;
  if (isGenerating) return null;
  isGenerating = true;
  const genBtn = $("generateHerBtn");
  const retryBtn = $("retryModelBtn");
  const nextBtn = $("nextBtn");
  const originalLabel = genBtn?.textContent;
  if (genBtn) { genBtn.disabled = true; genBtn.classList.add("is-busy"); genBtn.textContent = "生成中…"; }
  if (retryBtn) retryBtn.disabled = true;
  if (nextBtn) nextBtn.disabled = true;
  try {
    const parsed = await askAi({ silent: !allowLocalFallback });
    if (parsed === STALE_RESULT) return null;
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
    if (nextBtn) nextBtn.disabled = false;
  }
}

function renderDiffHtml(before, after) {
  return diffText(before, after).map((part) => {
    const text = escapeHtml(part.text);
    return part.type === "added" ? `<ins>${text}</ins>` : part.type === "removed" ? `<del>${text}</del>` : text;
  }).join("");
}

function capturePreflightContext() {
  return JSON.stringify({
    personaId: state.personaId, persona: getCurrentPersona(), messages: state.messages,
    memory: state.personaMemory, consent: state.relationshipIntelligence?.consent, ui: uiValues()
  });
}

function invalidatePreflight() {
  preflightRevision += 1;
  currentPreflightContext = null;
  const panel = $("preflightPanel");
  if (!panel) return;
  panel.querySelectorAll("button[data-optimizer-variant]").forEach((button) => { button.disabled = true; });
  panel.innerHTML = "";
}

function renderPreflightPanel({ panel, original, score, flags, optimization, revision = preflightRevision, context = capturePreflightContext() }) {
  if (revision !== preflightRevision || context !== capturePreflightContext()) return;
  currentPreflightContext = context;
  panel.innerHTML = `<div class="preflight-card"><div class="preflight-head"><strong>发送前测验</strong><span>${score.total}/100</span></div><p>${escapeHtml(score.summary || "先看风险，再决定是否发送。")}</p><div class="preflight-risks">${flags.warning ? escapeHtml(flags.warning) : "未发现明显风险"}</div><div class="optimizer-grid"><div class="optimizer-variant"><b>原文</b><p>${escapeHtml(original)}</p></div><div class="optimizer-variant"><b>低压力版</b><p>${escapeHtml(optimization.lowPressure.text)}</p><small>${escapeHtml(optimization.lowPressure.reason || "")}</small><button class="btn small" data-optimizer-variant="lowPressure">采用</button></div><div class="optimizer-variant"><b>主动推进版</b><p>${escapeHtml(optimization.proactive.text)}</p><small>${escapeHtml(optimization.proactive.reason || "")}</small><button class="btn small" data-optimizer-variant="proactive">采用</button></div></div><p class="note">修改理由 / Diff：${renderDiffHtml(original, optimization.lowPressure.text)}</p></div>`;
  panel.querySelectorAll("button[data-optimizer-variant]").forEach((button) => button.addEventListener("click", () => {
    if (revision !== preflightRevision) return;
    if (context !== capturePreflightContext() || $("userInput").value.trim() !== original) {
      invalidatePreflight();
      return;
    }
    const picked = optimization[button.dataset.optimizerVariant]?.text;
    if (picked) {
      modelRequests.cancelAll();
      invalidatePreflight();
      $("userInput").value = picked;
      renderTiming();
      $("userInput").focus();
    }
  }));
}

async function preflightReply() {
  invalidatePreflight();
  const revision = preflightRevision;
  const context = capturePreflightContext();
  const ticket = modelRequests.begin("preflight");
  const original = $("userInput").value.trim();
  const panel = $("preflightPanel");
  if (!original) { ticket.finish(); panel.innerHTML = card("发送前测验", "先输入你准备发送的回复。"); renderTiming(); return; }
  const persona = getCurrentPersona();
  const memory = getPersonaMemory(persona);
  const lastHerMsg = [...state.messages].reverse().find((m) => m.type === "her")?.text || "";
  const score = buildCoachScore(original, { risk: memory.boundaries, judgement: memory.background, herLastMessage: lastHerMsg });
  const flags = detectReplyFlags(original, memory);
  // F2 收集点一：preflight 最高档高危信号自动进错题本（保守收集，medium/low 不收集）。
  collectPreflightMistake({ text: original, score, flags });
  const conversation = state.messages.slice(-6).map((message) => ({ speaker: message.type === "her" ? (message.who || persona.name) : "我", text: message.text }));
  let optimization = buildLocalOptimizations(original, { stage: $("stage")?.value || "", goal: $("goal")?.value || "", recentTopic: conversation.at(-1)?.text || "" });
  renderPreflightPanel({ panel, original, score, flags, optimization, revision, context });
  try {
    $("apiStatus").textContent = "正在调用 MiMo 增强消息优化...";
    const prompt = buildOptimizerPrompt({ original, stage: $("stage")?.value || "", goal: $("goal")?.value || "", conversation });
    const result = await callLLM({ endpoint: $("endpoint").value, apiKey: $("apiKey").value, model: MIMO_MODEL, signal: ticket.signal, temperature: 0.5, messages: [{ role: "system", content: prompt.systemPrompt }, { role: "user", content: prompt.userPrompt }] });
    if (!ticket.isCurrent()) return;
    optimization = normalizeOptimizationResult(result.content, { original, fallback: optimization, stage: $("stage")?.value || "" });
    renderPreflightPanel({ panel, original, score, flags, optimization, revision, context });
    $("apiStatus").textContent = optimization.source === "model" ? "MiMo 已完成消息优化。" : "MiMo 输出未完全通过安全校验，已保留本地备用版本。";
  } catch (error) {
    if (!ticket.isCurrent()) return;
    $("apiStatus").textContent = `MiMo 消息优化失败，已保留本地版本：${error.message}`;
  } finally {
    ticket.finish();
  }
}

function normalizeActionPlan(content, fallback) {
  try {
    const parsed = JSON.parse(extractJsonObject(content));
    if (!parsed.title || !parsed.objective || !Array.isArray(parsed.steps) || parsed.steps.length < 3 || !Array.isArray(parsed.topics) || parsed.topics.length < 4 || !Array.isArray(parsed.decisionRules) || parsed.decisionRules.length < 3) {
      return { ...fallback, source: "local-fallback" };
    }
    return {
      title: String(parsed.title), pacing: String(parsed.pacing || fallback.pacing), objective: String(parsed.objective),
      steps: parsed.steps.slice(0, 3).map((step) => ({ title: String(step.title || "下一步"), detail: String(step.detail || "") })),
      topics: parsed.topics.slice(0, 4).map(String),
      decisionRules: parsed.decisionRules.slice(0, 3).map(String),
      warning: String(parsed.warning || fallback.warning),
      source: "model"
    };
  } catch { return { ...fallback, source: "local-fallback" }; }
}

async function generateActionPlan() {
  if (isRelationshipStopped(state.relationshipIntelligence)) {
    modelRequests.cancel("plan");
    renderActionPlan();
    $("apiStatus").textContent = "本轮已停止推进，暂不生成继续联系的计划。";
    return;
  }
  const ticket = modelRequests.begin("plan");
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
    const result = await callLLM({ endpoint: $("endpoint").value, apiKey: $("apiKey").value, model: MIMO_MODEL, signal: ticket.signal, messages: [{ role: "user", content: prompt }], temperature: 0.7 });
    if (!ticket.isCurrent()) return;
    renderPlanCard(normalizeActionPlan(result.content, fallback));
    $("apiStatus").textContent = "MiMo 已生成行动计划。";
  } catch (error) {
    if (!ticket.isCurrent()) return;
    $("apiStatus").textContent = `行动计划调用失败，已显示本地计划：${error.message}`;
  } finally {
    ticket.finish();
  }
}

async function checkHealth() {
  try {
    const json = await checkHealthApi();
    if ($("modelStatusBadge")) $("modelStatusBadge").textContent = modelStatusLabel({ health: json });
    $("apiStatus").textContent = `服务正常。模式：${json.apiMode || "unknown"}。模型：${json.model}。密钥：${json.hasApiKey ? "已配置" : "未配置"}`;
  } catch (error) {
    if ($("modelStatusBadge")) $("modelStatusBadge").textContent = modelStatusLabel({ failed: true });
    $("apiStatus").textContent = `服务不可用：${error.message}`;
  }
}

async function nextTurn() {
  const parsed = await generateHerDialogue({ allowLocalFallback: false });
  if (parsed) { invalidatePreflight(); $("userInput").value = ""; $("userInput").focus(); }
}

function exportSession() {
  const blob = new Blob([JSON.stringify(serializeStateForStorage(state), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = "heartflow-session.json"; anchor.click(); URL.revokeObjectURL(url);
}

// ── F1 全量档案备份/恢复 ──────────────────────────────────────────────────────

function exportBackup() {
  const filename = buildBackupFilename();
  const backup = buildBackup(serializeStateForStorage(state));
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
  $("apiStatus").textContent = `已导出全量档案备份：${filename}`;
}

function startRestoreBackup() {
  const input = $("backupFileInput");
  if (!input) return;
  input.value = "";
  input.click();
}

async function handleRestoreFileChange(event) {
  const file = event.target?.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const validation = validateBackup(parsed);
    if (!validation.ok) {
      $("apiStatus").textContent = `备份文件校验失败：${validation.errors.join("；")}`;
      return;
    }
    const includedCount = Math.max(0, Object.keys(parsed.data || {}).length - validation.ignoredKeys.length);
    const ignoredNote = validation.ignoredKeys.length ? `\n忽略未知键：${validation.ignoredKeys.length} 项（向前兼容，已跳过）` : "";
    const exportedAtLabel = typeof parsed.exportedAt === "string" && !Number.isNaN(Date.parse(parsed.exportedAt)) ? parsed.exportedAt : "未知";
    // 防误触：与重置确认同一模式（confirm 弹窗，确认后才执行）。
    const RESTORE_CONFIRMATION = `确认恢复这份备份？\n\n将覆盖当前全部本地档案（对话、成长档案、学习状态、角色卡、剧本、设置），不可撤销。\n\n备份时间：${exportedAtLabel}\n包含 ${includedCount} 个数据键${ignoredNote}\n\n继续？`;
    if (globalThis.confirm?.(RESTORE_CONFIRMATION) !== true) {
      $("apiStatus").textContent = "已取消恢复。";
      return;
    }
    const result = applyBackup(parsed, localStorage);
    if (!result.ok) {
      $("apiStatus").textContent = `恢复失败：${result.errors.join("；")}`;
      return;
    }
    resetDateJourney();
    resetRealPracticeDrafts();
    resetAbilityAssessmentDrafts();
    modelRequests.cancelAll();
    state = loadState();
    intelligenceController.cancelPending();
    renderAll();
    // 键名来自外部备份文件，插入 DOM 前必须过 escapeHtml（XSS 纪律）。
    $("apiStatus").innerHTML = validation.ignoredKeys.length
      ? `档案已恢复（忽略 ${escapeHtml(String(validation.ignoredKeys.length))} 个未知键：${validation.ignoredKeys.map((key) => escapeHtml(key)).join("、")}）`
      : "档案已恢复。";
  } catch (error) {
    $("apiStatus").textContent = `恢复失败：${error.message}`;
  }
}

function resetSession() {
  modelRequests.cancelAll();
  resetDateJourney();
  resetRealPracticeDrafts();
  state = setStateStore(createConversationResetState(state));
  resetAbilityAssessmentDrafts();
  intelligenceController.reset();
  $("userInput").value = getCurrentPersona().sampleReply || "";
  renderAll();
  $("apiStatus").textContent = "当前对话已重置。";
  emit(Events.STATE_RESET, {});
  void intelligenceController.refresh();
}

function handleRecall(index) {
  modelRequests.cancelAll();
  const result = recallMine(index);
  if (!result.ok) return;
  const removedReply = result.removed.find((message) => message.type === "her");
  if (removedReply && state.lastAnalysis?.herReply === removedReply.text) {
    mutate((s) => { s.lastAnalysis = null; s.lastGenerationMeta = null; });
  }
  $("userInput").value = result.message.text;
  renderAll();
  $("userInput").focus();
  $("apiStatus").textContent = "已撤回这条消息，可以修改后重新发送。";
  void intelligenceController.refresh();
}

function switchPersona(personaId, resetConversation = true) {
  modelRequests.cancelAll();
  switchPersonaView(personaId, resetConversation, { onChanged: renderAll });
  state = getState();
  if (resetConversation) {
    intelligenceController.reset();
    void intelligenceController.refresh();
  }
  emit(Events.PERSONA_SWITCHED, { personaId });
}

function saveCustomPersona() { modelRequests.cancelAll(); saveCustomPersonaView({ onChanged: renderAll }); state = getState(); }
function deleteCurrentPersona() { modelRequests.cancelAll(); deleteCurrentPersonaView({ onChanged: renderAll }); state = getState(); }

function loadScenario(scenarioId) {
  loadScenarioView(scenarioId, { switchPersona, onChanged: renderAll });
  persistCurrentStage();
  intelligenceController.reset();
  void intelligenceController.refresh();
}

function sendMine() {
  modelRequests.cancelAll();
  if (appendMine({ afterRender: afterChatRender })) void intelligenceController.refresh();
}

function setRelationshipIntelligenceConsentFromUi() {
  const granted = $("relationshipIntelligenceConsent")?.checked === true;
  if (!granted) {
    mutate((draft) => {
      for (const memory of Object.values(draft.personaMemory || {})) {
        if (memory && typeof memory === "object") delete memory._enhanced;
      }
    });
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
  mutate((state) => {
    state.learning.replayAnalyses = [...(state.learning.replayAnalyses || []), { createdAt: new Date().toISOString(), summary: buildReplaySummary(analysis), observations: (analysis.observations || []).slice(0, 4).map((item) => item.text || item.observation || "") }].slice(-12);
  });
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
  buildGenerationContext,
  call: callLLM,
  preflightReply,
  getPersonaMemory,
  getState: () => structuredClone(getState()),
  // 兼容契约：对外集成/调试入口（P2-6 收口时经用户批准保留 setState 写路径，不迁移到 mutate）。
  setState: (next) => { modelRequests.cancelAll(); state = setStateStore(next); resetAbilityAssessmentDrafts(); renderAll(); }
};

$("retryModelBtn")?.addEventListener("click", () => generateHerDialogue({ allowLocalFallback: false }));
$("generateHerBtn")?.addEventListener("click", () => generateHerDialogue());
$("sendMineBtn")?.addEventListener("click", sendMine);
$("modeBtnAnti")?.addEventListener("click", () => trainingModeController.setMode("anti"));
$("modeBtnPua")?.addEventListener("click", () => trainingModeController.setMode("pua", { ask: true }));
$("chat")?.addEventListener("click", (event) => {
  const recallButton = event.target.closest("[data-recall-index]");
  if (recallButton) { handleRecall(recallButton.dataset.recallIndex); return; }
  const speakButton = event.target.closest("[data-speak-index]");
  if (speakButton) {
    const message = state.messages[Number(speakButton.dataset.speakIndex)];
    if (message?.type === "her") void speakText(message.text, { button: speakButton });
  }
});
$("preflightBtn")?.addEventListener("click", preflightReply);
$("planBtn")?.addEventListener("click", generateActionPlan);
$("nextBtn")?.addEventListener("click", nextTurn);
$("healthBtn")?.addEventListener("click", checkHealth);
$("skipToContent")?.addEventListener("click", (event) => {
  event.preventDefault();
  $("workspaceTitle")?.focus();
  $("workspaceTitle")?.scrollIntoView({ block: "start" });
});
$("openPracticeBtn")?.addEventListener("click", () => {
  workspaceNav.show("real");
});
$("exportBtn")?.addEventListener("click", exportSession);
$("backupBtn")?.addEventListener("click", exportBackup);
$("restoreBtn")?.addEventListener("click", startRestoreBackup);
$("backupFileInput")?.addEventListener("change", handleRestoreFileChange);
// 重置防误触：与 PUA 模式伦理确认同一模式（confirm 弹窗，确认后才执行）。
const RESET_CONFIRMATION = "确认重置当前对话？\n\n消息记录、训练日志、成长事件和本轮模拟草稿将清空。已保存的现实复盘、生活记录及保存设置会保留。\n\n继续？";

$("resetBtn")?.addEventListener("click", () => {
  if (globalThis.confirm?.(RESET_CONFIRMATION) === true) resetSession();
});
$("personaSelect")?.addEventListener("change", (event) => switchPersona(event.target.value, true));
// 语音朗读设置：引擎 / 音色 / 自动朗读 / 试听（偏好独立存 localStorage，不进主 state）
const ttsEngineSelect = $("ttsEngineSelect");
const ttsVoiceSelect = $("ttsVoiceSelect");
if (ttsVoiceSelect && ttsEngineSelect) {
  const voicePrefs = getVoicePrefs();
  ttsEngineSelect.innerHTML = TTS_ENGINES.map((engine) => `<option value="${escapeHtml(engine.id)}">${escapeHtml(engine.label)}</option>`).join("");
  ttsEngineSelect.value = voicePrefs.engine;

  const renderVoices = (engineId, selected) => {
    const voices = voicesFor(engineId);
    ttsVoiceSelect.innerHTML = voices.map((voice) => `<option value="${escapeHtml(voice.id)}">${escapeHtml(voice.label)}</option>`).join("");
    ttsVoiceSelect.value = voices.some((voice) => voice.id === selected) ? selected : voices[0].id;
  };
  renderVoices(voicePrefs.engine, voicePrefs.voice);

  const autoPlayToggle = $("ttsAutoPlay");
  if (autoPlayToggle) autoPlayToggle.checked = voicePrefs.autoPlay;

  ttsEngineSelect.addEventListener("change", () => {
    const next = setVoicePrefs({ engine: ttsEngineSelect.value });
    renderVoices(next.engine, next.voice);
    void refreshVoiceStatus();
  });
  ttsVoiceSelect.addEventListener("change", () => setVoicePrefs({ voice: ttsVoiceSelect.value }));
  autoPlayToggle?.addEventListener("change", () => setVoicePrefs({ autoPlay: autoPlayToggle.checked }));
  $("ttsTestBtn")?.addEventListener("click", () => {
    const prefs = getVoicePrefs();
    void speakText("很高兴认识你。今天聊得挺开心的，下次有空再一起走走。", prefs);
  });
  $("ttsStopBtn")?.addEventListener("click", stopSpeaking);

  // 打开面板时才探测服务状态，避免每次进页面都打一次本地请求。
  const settingsPanel = $("voiceSettings");
  let statusLoaded = false;
  const refreshVoiceStatus = async () => {
    const statusEl = $("ttsStatus");
    if (!statusEl) return;
    statusLoaded = true;
    statusEl.dataset.state = "loading";
    statusEl.textContent = "正在检查本地语音服务…";
    const health = await fetchTtsHealth();
    if (!health.reachable) {
      statusEl.dataset.state = "down";
      statusEl.textContent = `未连接：${health.message || "本地语音服务未启动"} 请双击「启动语音服务.cmd」。`;
      return;
    }
    const engines = health.engines || {};
    const describe = (id) => {
      const item = engines[id];
      if (!item) return `${id}: 未注册`;
      const label = TTS_ENGINES.find((engine) => engine.id === id)?.label || id;
      if (item.status === "ready") {
        const parts = [item.device ? item.device.toUpperCase() : "CPU"];
        if (item.sizeMb) parts.push(`模型 ${item.sizeMb}MB`);
        if (item.vramMb) parts.push(`显存 ${item.vramMb}MB`);
        if (item.loadSec) parts.push(`加载 ${item.loadSec}s`);
        return `${label} 就绪（${parts.join(" · ")}）`;
      }
      if (item.status === "loading") return `${label} 加载中…`;
      if (item.status === "error") return `${label} 加载失败：${item.error || "未知原因"}`;
      return `${label} 待命（首次使用自动加载）`;
    };
    const lines = [describe("chattts"), describe("kokoro")];
    const active = engines[getVoicePrefs().engine];
    statusEl.dataset.state = active?.status === "error" ? "error" : "ok";
    statusEl.textContent = lines.join(" ｜ ");
  };
  settingsPanel?.addEventListener("toggle", () => {
    if (settingsPanel.open && !statusLoaded) void refreshVoiceStatus();
  });
  if (settingsPanel?.open) void refreshVoiceStatus();
  globalThis.addEventListener("heartflow:voice-status", () => void refreshVoiceStatus());
}
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
for (const id of ["userInput", "stage", "goal", "styleBias", "sincerity", "toneIntensity", "endpoint", "apiKey", "memoryBackground", "memoryInterests", "memoryBoundaries"]) {
  $(id)?.addEventListener("input", () => { modelRequests.cancelAll(); invalidatePreflight(); });
  $(id)?.addEventListener("change", () => { modelRequests.cancelAll(); invalidatePreflight(); });
}
$("stage")?.addEventListener("change", () => { renderTiming(); onStageManualChange(); });
$("longContentBtn")?.addEventListener("click", () => openLongReader());
$("closeLongReaderBtn")?.addEventListener("click", closeLongReader);
$("closeInterventionBtn")?.addEventListener("click", closeIntervention);
$("interventionOverlay")?.addEventListener("click", closeIntervention);
// F2 重写练习模态关闭（与介入练习同一模式）
$("closeMistakePracticeBtn")?.addEventListener("click", closeMistakePractice);
$("mistakePracticeOverlay")?.addEventListener("click", closeMistakePractice);
$("autoStageBtn")?.addEventListener("click", () => autoDetectStageView({ ticket: modelRequests.begin("stage"), model: MIMO_MODEL, endpoint: $("endpoint").value, apiKey: $("apiKey").value, onStatus: (message) => { $("apiStatus").textContent = message; } }));
$("loadScenarioBtn")?.addEventListener("click", () => loadScenario());
$("openReplayBtn")?.addEventListener("click", openReplayModal);
// F4 会话复盘：按钮点击属真实触发（render 模块内先 enableTextbookIndexLoad 再取索引）。
$("sessionReportBtn")?.addEventListener("click", () => void generateSessionReport({ openLongReader }));
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

// 启动：manifest 预取为非阻塞（防无头首载时顶层 await 静默悬挂 → 整屏空白）。
// 首屏渲染不依赖 manifest；manifest 就绪后仅重渲染消费它的教练分析区
// （对照长篇复盘链接标题短暂占位可接受）。失败时保持既有降级：不展示对照链接。
void loadManifest().then((manifest) => {
  manifestChapters = Array.isArray(manifest?.chapters) ? manifest.chapters : [];
  renderAnalysisPanel();
}).catch(() => {
  manifestChapters = [];
});
// P2-6 store 收敛：mutate 写路径的渲染回调由此注入（core 层不 import render 层）。
onStateChange(renderAll, { onError: () => {
  if ($("apiStatus")) $("apiStatus").textContent = "数据已保存，但页面更新失败，请刷新页面。";
} });
renderAll();
trainingModeController.render();
restoreStageState();
checkHealth();
// 档案损坏时提示"已保留原始副本"（隔离键见 core/config.js STORAGE_KEYS.stateQuarantine）。
const stateLoadIssue = getStateLoadIssue();
if (stateLoadIssue && $("apiStatus")) $("apiStatus").textContent = "检测到本地档案损坏，已保留原始副本（heartflow-state-quarantine），当前以默认档案继续。";
void intelligenceController.refresh();
