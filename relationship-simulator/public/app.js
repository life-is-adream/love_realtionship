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
import { extractMemoryFromConversation, updateMemoryState, buildMemoryInjection, migrateMemory } from "./modules/core/memory.js";
import { localAnalyze, parseModelContent, extractJsonObject, normalizeCoachScore, normalizeReplyOptions, parsePreflightEvaluation, parseStageResult } from "./modules/coach/parser.js";
import { buildHerMessages, buildCoachMessages, callLLM as callLLMPure, callLLMStream as callLLMStreamPure, checkHealth as checkHealthApi, resolveDeterministicReply } from "./modules/core/api-client.js";
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
import { initRelationshipFlow } from "./modules/relationship-flow/flow.js";
import { renderAbilityAssessment, resetAbilityAssessmentDrafts } from "./modules/render/render-ability-assessment.js";
import { createConversationResetState } from "./modules/core/state-reset.js";
import { modelStatusLabel } from "./modules/core/model-status.js";
import { autoDetectStage as autoDetectStageView, onStageManualChange, persistCurrentStage, renderStageProgress, restoreStageState } from "./modules/render/render-stage.js";
import { renderScenarioList, loadScenario as loadScenarioView, REVIEW_MAPPING } from "./modules/render/render-scenario.js";
import { markCoachUnread, clearCoachUnread } from "./modules/render/mobile-tabs.js";
import { initWorkspaceNav } from "./modules/render/workspace-nav.js";
import { sync as syncDropdownLabel } from "./modules/render/dropdown.js";
import { createRelationshipIntelligenceController } from "./modules/intelligence/controller.js";
import { renderRelationshipIntelligence } from "./modules/render/render-intelligence.js";
import { createTrainingModeController } from "./modules/training/training-mode-controller.js";
import { initComplianceBanner } from "./modules/render/compliance-banner.js";
import { createRequestScope } from "./modules/core/request-scope.js";
import { speakText, stopSpeaking, maybeAutoSpeak, TTS_ENGINES, voicesFor, getVoicePrefs, setVoicePrefs, fetchTtsHealth, setOnlineVoiceEnabled } from "./modules/voice/tts-client.js";

let state = loadState();
const MIMO_MODEL = DEFAULT_MODEL;
/**
 * 角色回复通道预算：实测 MiMo-V2.6-Flash 思考默认开启时完整回复 14.97s，
 * 关闭后 1.80s（48 个输出 token 里 29 个是推理 token）。教练分析通道不在此列。
 */
const HER_LANE = Object.freeze({ thinking: { type: "disabled" }, maxCompletionTokens: 200 });
/**
 * 教练通道预算：开 MiMo 的 JSON 模式，并同样关闭思考。
 *
 * JSON 模式：实测 5 用例下自由文本有 1/5 教练 JSON 解析失败并整轮落到本地模板，
 * 开 JSON 模式后 0/5 失败。
 * 关思考：5 用例 A/B（同提示词、同裁判配置）——教练 P50 73.97s → 24.22s，
 * 最慢 88.56s → 49.06s，一轮 504 超时 → 0 次，输出 token −38%；
 * 四项行为判定「回答问题 / 可发送 / 三条有别 / 像真人」从 3~4/5 全部升到 5/5，
 * 即关掉思考没有换来质量下降。数据见 docs/verification/ab-p0-arm*.md。
 * 输出上限 1500：2026-11-03 A-03 真实抽样 12 轮实测 completion 为 375–655（中位 503），
 * 唯一一次 62.4s 长尾跑到 4096 并 finish_reason=length（撞供应商默认上限，JSON 被截断）。
 * 1500 = 最大合法观测值的 2.3 倍，留足 P3 记忆注入与 P5 教材上下文变长的余量，
 * 同时把失控轮次砍掉 63%。改这个数必须重新量，不要凭感觉调。
 */
const COACH_LANE = Object.freeze({
  thinking: { type: "disabled" },
  responseFormat: { type: "json_object" },
  maxCompletionTokens: 1500
});
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
let relationshipFlow;
const workspaceNav = initWorkspaceNav({ onViewChange: (view) => {
  modelRequests.cancel("coach-search");
  if (view !== "caseflow") relationshipFlow?.leaveClosingDrill();
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
    chatStyle: ["daily", "humorous", "gentle"].includes($("chatStyle")?.value) ? $("chatStyle").value : "daily",
    tone: {
      sincerity: Number($("sincerity")?.value ?? 70),
      toneIntensity: Number($("toneIntensity")?.value ?? 50)
    }
  };
}

/**
 * 记忆核对的事实来源：只在显式授权时暴露 `_enhanced`。
 *
 * 不把整个 memory 传给护栏：`background/interests/boundaries` 是用户手填的场景设定，
 * 不是「我说过的事实」；`_enhancedInjection` 是派生字符串，也不是原始条目。
 */
function recallMemorySource() {
  if (state.relationshipIntelligence?.consent !== true) return {};
  const persona = getCurrentPersona();
  const enhanced = state.personaMemory?.[persona.id]?._enhanced;
  return enhanced ? { _enhanced: enhanced } : {};
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
  if ($("chatStyle")) {
    $("chatStyle").value = ["daily", "humorous", "gentle"].includes(state.chatStyle) ? state.chatStyle : "daily";
    // 原生 select 的属性赋值不触发 change；显式同步品牌下拉的可见标签。
    syncDropdownLabel($("chatStyle"));
  }
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
  const deterministic = resolveDeterministicReply(getLatestMineText(), state.messages, recallMemorySource());
  if (deterministic) {
    data.herReply = deterministic.text;
    data.herReplySource = deterministic.source;
  }
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
    enhancedInjection = memoryInjection;
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
  return {
    persona,
    memory: memoryWithTier,
    // 记忆核对只认原始条目，不认派生出来的 _enhancedInjection 字符串。
    memorySource: enhanced ? { _enhanced: enhanced } : {},
    messages: structuredClone(state.messages),
    ui,
    textbookContext
  };
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
  let streamBubble = null;
  try {
    savePersonaMemory(false);
    appendMineIfNew({ afterRender: afterChatRender });
    ticket = modelRequests.begin("dialogue");
    const { persona, memory, memorySource, messages, ui } = await buildGenerationContext();
    if (!ticket.isCurrent()) return STALE_RESULT;
    const api = { endpoint: $("endpoint").value, apiKey: $("apiKey").value, model: MIMO_MODEL, signal: ticket.signal };

    // 调用一：只要她的微信文本。先落盘、先渲染、先朗读——用户不必等教练分析。
    const latestMine = [...messages].reverse().find((message) => message.type === "me")?.text || "";
    // 身份直问与记忆核对共用同一个护栏入口，避免两条生成路径各写一份判断。
    const deterministic = resolveDeterministicReply(latestMine, messages, memorySource);
    let herResult;
    if (deterministic) {
      herResult = { content: deterministic.text };
    } else {
      const herMessages = buildHerMessages(persona, memory, messages, ui);
      streamBubble = openStreamBubble(persona.name);
      let sawReasoning = false;
      try {
        herResult = await callLLMStream({
          ...api, ...HER_LANE, messages: herMessages,
          onReasoning: (text) => {
            if (!ticket.isCurrent() || !streamBubble?.head) return;
            if (!sawReasoning) { sawReasoning = true; $("apiStatus").textContent = "她正在思考…"; }
            streamBubble.head.textContent = `思考中…（${text.length} 字）`;
          },
          onDelta: (text) => {
            if (!ticket.isCurrent() || !streamBubble?.body) return;
            streamBubble.head.textContent = "正在输入…";
            streamBubble.body.textContent = text;
            const chat = $("chat");
            if (chat) chat.scrollTop = chat.scrollHeight;
          }
        });
      } catch (streamError) {
        // 老浏览器不支持 ReadableStream / 服务端未升级时回退到非流式，功能不降级。
        if (String(streamError?.message || "").includes("流式")) {
          herResult = await callLLM({ ...api, ...HER_LANE, messages: herMessages });
        } else {
          throw streamError;
        }
      }
    }
    closeStreamBubble(streamBubble);
    streamBubble = null;
    if (!ticket.isCurrent()) return STALE_RESULT;
    const bubbles = parseHerBubbles(herResult.content, persona.name);
    if (!bubbles.length) throw new Error("模型未返回女方对话。");
    const herReply = joinHerReply(bubbles);
    commitHerReply(bubbles, deterministic ? "local" : "model");

    // 她的回复落盘会改变会话上下文，因此教练调用必须另开一条通道、在落盘之后取快照，
    // 否则结果回来一定被判定为过期而丢弃。
    coachTicket = modelRequests.begin("dialogue-coach");
    $("apiStatus").textContent = "教练正在分析…";
    let analysis;
    let coachDegraded = false;
    try {
      const coachResult = await callLLM({
        ...api,
        ...COACH_LANE,
        signal: coachTicket.signal,
        messages: buildCoachMessages({ persona, memory, messages, herReply, uiValues: ui })
      });
      if (!coachTicket.isCurrent()) return STALE_RESULT;
      // herReply 必须进解析上下文：教练契约本身不输出这条回复，不传就会被当成「缺字段」，
      // 兜底 A/B/C 会拿原始 JSON 文本去判断她在说什么。
      const coachContext = { ...ui, herReply };
      analysis = { ...parseModelContent(coachResult.content, coachContext), herReply };
    } catch (coachError) {
      if (!coachTicket.isCurrent()) return STALE_RESULT;
      coachDegraded = true;
      analysis = { ...localAnalyze(`教练分析失败：${coachError.message}`, { ...ui, herReply }), herReply };
    }
    analysis.herReplySource = deterministic ? deterministic.source : "model";
    $("apiStatus").textContent = coachDegraded
      ? "她已由模型回复；教练分析未通过，已用本地评估补上。"
      : "模型调用成功。";
    return commitAnalysis(analysis, "model", { replyAlreadyCommitted: true });
  } catch (error) {
    closeStreamBubble(streamBubble);
    streamBubble = null;
    // 她的回复落盘后 ticket 的上下文快照必然已过期，此处以最近一次为准，
    // 否则提交阶段的真实错误会被当成过期结果静默吞掉。
    const active = coachTicket || ticket;
    if (active && !active.isCurrent()) return STALE_RESULT;
    mutate((state) => { state.lastGenerationMeta = { source: "model", error: error.message || String(error) }; });
    $("apiStatus").textContent = "模型调用失败：" + error.message;
    if (!silent) throw error;
    return null;
  } finally {
    closeStreamBubble(streamBubble);
    ticket?.finish();
    coachTicket?.finish();
  }
}

async function callLLMStream(options) {
  if (typeof callLLMStreamPure !== "function") throw new Error("流式调用不可用");
  const result = await callLLMStreamPure(options);
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

/* 流式临时气泡：等首字期间给用户可见反馈，正式消息落盘后由 renderChat 覆盖。 */
function openStreamBubble(personaName) {
  if (typeof document === "undefined") return null;  // 测试/非浏览器环境
  const chat = $("chat");
  if (!chat) return null;
  const div = document.createElement("div");
  div.className = "msg her stream-bubble";
  div.innerHTML = `<div class="msg-head"><span class="who">${escapeHtmlShared(personaName)}</span><span class="msg-source">正在输入…</span></div><div class="msg-body"></div>`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return { el: div, head: div.querySelector(".msg-source"), body: div.querySelector(".msg-body") };
}

function closeStreamBubble(bubble) {
  if (bubble?.el?.parentNode) bubble.el.parentNode.removeChild(bubble.el);
}

async function generateHerDialogue(options = {}) {
  const { allowLocalFallback = true } = options;
  if (isGenerating) return null;
  isGenerating = true;
  const genBtn = $("generateHerBtn");
  const retryBtn = $("retryModelBtn");
  const nextBtn = $("nextBtn");
  const originalLabel = genBtn?.textContent;
  // 上游一轮可能要 25~50s，超时加重试能到 240s。按钮不能只是禁掉：
  // 用户既看不出是慢还是卡死，也没有就地取消的手段（原来只能切会话，会丢掉这一轮）。
  const startedAt = Date.now();
  let elapsedTimer = null;
  if (genBtn) {
    genBtn.classList.add("is-busy");
    genBtn.textContent = "生成中…（点击取消）";
    elapsedTimer = setInterval(() => {
      genBtn.textContent = `已等 ${Math.round((Date.now() - startedAt) / 1000)}s · 点击取消`;
    }, 1000);
  }
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
    if (elapsedTimer) clearInterval(elapsedTimer);
    isGenerating = false;
    if (genBtn) { genBtn.classList.remove("is-busy"); genBtn.textContent = originalLabel || "生成女方对话"; }
    if (retryBtn) retryBtn.disabled = false;
    if (nextBtn) nextBtn.disabled = false;
  }
}

/** 就地取消本轮：中断在飞的模型调用，让 generateHerDialogue 走 STALE_RESULT 退出。 */
function cancelGeneration() {
  // 取消时她那句可能已经落盘了（角色通道先完成、教练通道还在跑），
  // 说「都不会写入」是假话。最后一条是她的回复就说明这一轮已经出过她的声音。
  const messages = Array.isArray(state.messages) ? state.messages : [];
  const herReplyAlreadyLanded = messages.at(-1)?.type === "her";
  modelRequests.cancelAll();
  $("apiStatus").textContent = herReplyAlreadyLanded
    ? "已取消教练分析；她这一轮的回复已经落盘，保留在对话里。"
    : "已取消本轮模型调用，没有写入任何内容。";
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
  modelRequests.cancelAll();
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
$("generateHerBtn")?.addEventListener("click", () => {
  // 生成中时这个按钮就是取消入口；不再靠 disabled 假装它不可用。
  if (isGenerating) { cancelGeneration(); return; }
  generateHerDialogue();
});
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
  // 在线引擎先置灰；只有 health 报告它已注册时才解锁，避免聊天文本被静默送出本机。
  ttsEngineSelect.innerHTML = TTS_ENGINES.map((engine) => {
    const locked = Boolean(engine.optional);
    const label = engine.label + (locked ? " · 未启用" : "");
    return `<option value="${escapeHtml(engine.id)}"${locked ? " disabled" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
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

  // 在线引擎的可用性由 sidecar 的 health 决定：没开启时保持禁用，并把残留的
  // 偏好纠回离线引擎，避免用户以为在用御姐音、其实请求被悄悄丢给了 ChatTTS。
  const onlineToggle = $("ttsOnlineToggle");
  const syncOnlineEngine = (health) => {
    const option = ttsEngineSelect.querySelector('option[value="edge"]');
    const meta = TTS_ENGINES.find((engine) => engine.id === "edge");
    if (!option || !meta) return;
    const enabled = Boolean(health?.engines?.edge);
    option.disabled = !enabled;
    option.textContent = meta.label + (enabled ? "" : " · 未启用");
    // 开关状态以服务端为准，避免刷新页面后前端显示「已开」、服务端其实没开。
    if (onlineToggle && document.activeElement !== onlineToggle) {
      onlineToggle.checked = Boolean(health?.onlineEnabled) || enabled;
    }
    // 角色音色由独立进程 5002 承载：只有 health 报告它 ready 才解锁，
    // 否则留在下拉框里会让人以为点一下就能出声（实际会回退 Kokoro）。
    const charOption = ttsEngineSelect.querySelector('option[value="character"]');
    const charMeta = TTS_ENGINES.find((engine) => engine.id === "character");
    const charReady = health?.engines?.character?.status === "ready";
    if (charOption && charMeta) {
      charOption.disabled = !charReady;
      charOption.textContent = charMeta.label + (charReady ? "" : " · 服务未启动");
    }
    const activeEngine = ttsEngineSelect.value;
    if ((!enabled && activeEngine === "edge") || (!charReady && activeEngine === "character")) {
      const next = setVoicePrefs({ engine: TTS_ENGINES[0].id });
      ttsEngineSelect.value = next.engine;
      renderVoices(next.engine, next.voice);
    }
  };

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
      syncOnlineEngine({ engines: {} });
      statusEl.dataset.state = "down";
      statusEl.textContent = `未连接：${health.message || "本地语音服务未启动"} 请双击「启动语音服务.cmd」。`;
      return;
    }
    const engines = health.engines || {};
    syncOnlineEngine(health);
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
    if (engines.edge) lines.push(describe("edge"));
    const active = engines[getVoicePrefs().engine];
    statusEl.dataset.state = active?.status === "error" ? "error" : "ok";
    const privacy = engines.edge ? " ｜ 注意：在线音色合成时文本会离开本机" : "";
    statusEl.textContent = lines.join(" ｜ ") + privacy;
  };

  // 一键启用在线语音：先把隐私代价讲清楚并拿到显式同意，再送到本机服务。
  // 开关是运行时的，不用改环境变量、不用重启语音服务；关掉即恢复纯离线。
  onlineToggle?.addEventListener("change", async () => {
    const want = onlineToggle.checked;
    if (want && globalThis.confirm?.(
      "启用「微软神经语音」后，每次朗读的文本都会发送给微软的在线语音服务（离开本机）。\n" +
      "音质明显更好，但朗读内容不再是纯离线。要继续吗？"
    ) !== true) {
      onlineToggle.checked = false;
      return;
    }
    onlineToggle.disabled = true;
    try {
      const enabled = await setOnlineVoiceEnabled(want);
      // 启用后直接落到听感验收通过的「温柔 · 自然」，不再让用户从一堆废音色里挑。
      const next = setVoicePrefs(enabled
        ? { engine: "edge", voice: "edge_wenrou" }
        : { engine: TTS_ENGINES[0].id, voice: voicesFor(TTS_ENGINES[0].id)[0].id });
      ttsEngineSelect.value = next.engine;
      renderVoices(next.engine, next.voice);
      await refreshVoiceStatus();
    } catch (error) {
      onlineToggle.checked = !want;
      const statusEl = $("ttsStatus");
      if (statusEl) {
        statusEl.dataset.state = "error";
        statusEl.textContent = `切换在线语音失败：${error?.message || error}`;
      }
    } finally {
      onlineToggle.disabled = false;
    }
  });
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
$("chatStyle")?.addEventListener("change", (event) => {
  modelRequests.cancelAll();
  const value = ["daily", "humorous", "gentle"].includes(event.target.value) ? event.target.value : "daily";
  mutate((draft) => { draft.chatStyle = value; });
});
globalThis.addEventListener?.("heartflow:memory-changed", () => modelRequests.cancelAll());
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
relationshipFlow = initRelationshipFlow();
trainingModeController.render();
restoreStageState();
checkHealth();
// 档案损坏时提示"已保留原始副本"（隔离键见 core/config.js STORAGE_KEYS.stateQuarantine）。
const stateLoadIssue = getStateLoadIssue();
if (stateLoadIssue && $("apiStatus")) $("apiStatus").textContent = "检测到本地档案损坏，已保留原始副本（heartflow-state-quarantine），当前以默认档案继续。";
void intelligenceController.refresh();
