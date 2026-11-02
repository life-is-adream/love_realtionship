import { createHash } from "node:crypto";
import { analyzeConversation, normalizeMessages } from "./conversation/analyzer.mjs";
import { appendObservation, redact } from "./memory/memory-store.mjs";
import { transitionState } from "./state/state-machine.mjs";
import { createPrediction } from "./reflection/reflection-engine.mjs";

const DECISIONS = Object.freeze(["ADVANCE", "MAINTAIN", "OBSERVE", "DE_ESCALATE", "EXIT"]);
const OBSERVATION_SIGNAL_KEYS = Object.freeze([
  "safetyRisk", "relationshipEnded", "explicitExit", "explicitRejection", "contactPause",
  "initialContact", "repeatedInteraction", "conflict", "counterOffer", "concreteDatePlan",
  "repairAttempt", "repairSucceeded", "reciprocalInterest", "relationshipDefined",
  "stableRoutine", "lowReciprocity"
]);

function decisionFor(analysis, signals = {}, currentState = "UNKNOWN") {
  if (currentState === "EXIT" || signals.safetyRisk || signals.relationshipEnded || signals.explicitExit) return "EXIT";
  if (signals.explicitRejection || signals.contactPause) return "DE_ESCALATE";
  if (signals.conflict || analysis.metrics.conflictMessageCount > 0) return "MAINTAIN";
  if (signals.concreteDatePlan || signals.counterOffer) return "ADVANCE";
  if (analysis.metrics.dataQuality === "limited" || analysis.metrics.otherQuestionRatio === null) return "OBSERVE";
  if (analysis.metrics.otherQuestionRatio >= 0.5 && (analysis.metrics.userInitiationRatio ?? 1) <= 0.75) return "MAINTAIN";
  return "OBSERVE";
}

function actionFor(decision) {
  return {
    ADVANCE: "给出一个具体、低压力且容易拒绝的现实选项，发出后等待对方回应。",
    MAINTAIN: "保持当前双方都能承受的节奏，把分歧改写成具体行为和请求。",
    OBSERVE: "保留至少两个解释，只做一个最小、可逆的观察，不连续追问。",
    DE_ESCALATE: "停止追加说服，降低投入并给对方空间；若没有新的互惠证据就退出推进。",
    EXIT: "停止推进和数据收集，保护隐私、边界与安全；必要时寻求现实支持。"
  }[decision];
}

function expectedSignalFor(decision) {
  return {
    ADVANCE: "对方确认或提出可行的替代安排",
    MAINTAIN: "双方继续出现可观察的互惠和边界协商",
    OBSERVE: "下一次互动提供更具体的投入、边界或现实安排信息",
    DE_ESCALATE: "降低投入后是否自然出现新的互惠证据",
    EXIT: "停止推进后安全和尊严得到保持"
  }[decision];
}

function hypothesesFor(analysis) {
  const lowEnergy = analysis.metrics.emotionLabels.includes("low_energy");
  const hypotheses = [];
  if (lowEnergy) {
    hypotheses.push({
      label: "对方当前精力或时间有限",
      confidence: "medium_low",
      support: ["文本出现忙碌或低能量表达"],
      counter: ["尚无足够现实安排信息"]
    });
  }
  hypotheses.push({
    label: "当前互惠程度仍不明确",
    confidence: "insufficient_evidence",
    support: analysis.evidence.slice(0, 2).map((item) => item.observation),
    counter: ["后续具体安排或主动行为可能改变判断"]
  });
  return hypotheses.slice(0, 2);
}

function deriveSignals(analysis, signals = {}) {
  return {
    ...signals,
    safetyRisk: Boolean(signals.safetyRisk || analysis.metrics.safetyRiskMessageCount > 0),
    explicitExit: Boolean(signals.explicitExit || analysis.metrics.explicitExitMessageCount > 0),
    explicitRejection: Boolean(signals.explicitRejection || analysis.metrics.explicitRejectionMessageCount > 0),
    contactPause: Boolean(analysis.metrics.contactPauseMessageCount > 0),
    initialContact: signals.initialContact ?? analysis.metrics.messageCount > 0,
    repeatedInteraction: signals.repeatedInteraction ?? analysis.metrics.messageCount >= 4,
    conflict: signals.conflict ?? analysis.metrics.conflictMessageCount > 0,
    evidenceIds: analysis.evidence.map((item) => item.id).concat(Array.isArray(signals.evidenceIds) ? signals.evidenceIds : []).slice(0, 20)
  };
}

function observationIdFor(messages, signals) {
  // Content is consumed transiently; only its digest and feature summary remain.
  // Exclude caller IDs so retries with fresh transport IDs are still idempotent.
  const content = normalizeMessages(messages).map(({ speaker, text, timestampMs }) => ({ speaker, text, timestampMs }));
  const signalSnapshot = Object.fromEntries(OBSERVATION_SIGNAL_KEYS.map((key) => [key, Boolean(signals[key])]));
  return `loop_${createHash("sha256").update(JSON.stringify({ content, signals: signalSnapshot })).digest("hex")}`;
}

function buildMemoryPatch(memory, state, analysis, decision, observationId) {
  if (!memory) return null;
  const summary = `观察到${analysis.metrics.messageCount}条消息；当前建议为${decision}，仅保留结构化摘要。`;
  const next = appendObservation(memory, {
    id: observationId,
    kind: "agent_loop",
    summary,
    stage: null,
    evidenceIds: analysis.evidence.map((item) => item.id),
    source: "conversation_analyzer"
  });
  if (next.consent?.granted) next.currentState = state.to;
  return next;
}

/**
 * Run the local, auditable portion of the relationship intelligence loop.
 * Model calls, if any, should consume this bounded output rather than raw chat.
 */
export function runRelationshipLoop({ messages = [], memory = null, goal = "", consent = false, signals = {} } = {}) {
  const analysis = analyzeConversation(messages);
  const normalizedSignals = deriveSignals(analysis, signals);
  const currentState = memory?.currentState || "UNKNOWN";
  const observationId = memory ? observationIdFor(messages, normalizedSignals) : null;
  const observationReplayed = Array.isArray(memory?.observations) && memory.observations.some(({ id }) => id === observationId);
  const state = transitionState(currentState, { ...normalizedSignals, observationReplayed });
  const decision = decisionFor(analysis, normalizedSignals, currentState);
  const action = actionFor(decision);
  const prediction = createPrediction({
    id: `prediction_${analysis.metrics.messageCount || 0}`,
    decision,
    action,
    expectedSignal: expectedSignalFor(decision),
    evidenceIds: analysis.evidence.map((item) => item.id)
  });
  const memoryPatch = buildMemoryPatch(memory, state, analysis, decision, observationId);
  return {
    version: 1,
    goal: redact(goal).slice(0, 300),
    analysis,
    hypotheses: hypothesesFor(analysis),
    state,
    decision: {
      value: decision,
      allowed: DECISIONS,
      reason: action,
      evidenceIds: analysis.evidence.map((item) => item.id)
    },
    action,
    prediction,
    memoryPatch,
    privacy: {
      rawMessagesReturned: false,
      memoryWriteAttempted: Boolean(memory),
      consentProvided: Boolean(consent || memory?.consent?.granted)
    }
  };
}

export { actionFor, decisionFor, hypothesesFor };
