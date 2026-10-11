import {
  RELATIONSHIP_STATES,
  appendObservation,
  createMemory,
  recordOutcome,
  runRelationshipLoop
} from "../../.agents/skills/relationship-coach-cn/runtime/index.mjs";
import { redact } from "../../.agents/skills/relationship-coach-cn/runtime/memory/memory-store.mjs";
import {
  readRequestJson,
  RequestBodyTooLargeError,
  sendJson
} from "./http.js";

const MAX_MESSAGES = 80;
const MAX_TEXT_LENGTH = 2_000;
const MAX_MEMORY_ITEMS = 100;
const VALID_RUNTIME_STATES = new Set(RELATIONSHIP_STATES);
const SIGNAL_KEYS = new Set([
  "safetyRisk",
  "relationshipEnded",
  "explicitExit",
  "explicitRejection",
  "counterOffer",
  "conflict",
  "repairAttempt",
  "repairSucceeded",
  "reciprocalInterest",
  "concreteDatePlan",
  "relationshipDefined",
  "stableRoutine",
  "lowReciprocity"
]);

export class ProductIntelligenceInputError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ProductIntelligenceInputError";
    this.code = code;
    this.status = status;
  }
}

function normalizeSpeaker(message) {
  const speaker = String(message?.speaker || "").trim().toLowerCase();
  if (["user", "me", "mine", "self", "我", "男方"].includes(speaker)) return "user";
  if (["other", "partner", "them", "her", "对方", "她", "女方"].includes(speaker)) return "other";
  if (message?.type === "me") return "user";
  if (message?.type === "her") return "other";
  return "unknown";
}

function normalizeTimestamp(value) {
  if (!value) return undefined;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? undefined : timestamp.toISOString();
}

function normalizeMessageId(value, fallback) {
  const id = String(value || "").trim();
  return /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(id) ? id : fallback;
}

/**
 * Convert the HeartFlow browser message shape to the bounded runtime contract.
 * Only the newest 80 non-empty messages are considered.
 */
export function normalizeProductMessages(messages) {
  const source = Array.isArray(messages) ? messages : [];
  return source
    .map((message, index) => {
      const text = typeof message?.text === "string" ? message.text.trim().slice(0, MAX_TEXT_LENGTH) : "";
      if (!text) return null;
      const normalized = {
        id: normalizeMessageId(message?.id, `heartflow_${index + 1}`),
        speaker: normalizeSpeaker(message),
        text
      };
      const timestamp = normalizeTimestamp(message?.timestamp ?? message?.createdAt);
      if (timestamp) normalized.timestamp = timestamp;
      return normalized;
    })
    .filter(Boolean)
    .slice(-MAX_MESSAGES);
}

function normalizeSignals(value) {
  if (!value || typeof value !== "object") return {};
  const signals = {};
  for (const [key, enabled] of Object.entries(value)) {
    if (SIGNAL_KEYS.has(key) && typeof enabled === "boolean") signals[key] = enabled;
  }
  return signals;
}

function createValidatedMemory({ caseId, goal, memory }) {
  let next;
  try {
    next = createMemory({
      caseId,
      goal,
      consent: { granted: true, scope: "relationship_context", recordedAt: null }
    });
  } catch {
    throw new ProductIntelligenceInputError(
      "invalid_case_id",
      "启用匿名结构化记忆时，caseId 必须是 case_ 开头的匿名标识。"
    );
  }

  if (VALID_RUNTIME_STATES.has(memory?.currentState)) next.currentState = memory.currentState;

  const observations = Array.isArray(memory?.observations)
    ? memory.observations.slice(-MAX_MEMORY_ITEMS)
    : [];
  for (const observation of observations) next = appendObservation(next, observation);

  const outcomes = Array.isArray(memory?.outcomes)
    ? memory.outcomes.slice(-MAX_MEMORY_ITEMS)
    : [];
  for (const outcome of outcomes) next = recordOutcome(next, outcome);

  return next;
}

/**
 * Run the deterministic Relationship Intelligence runtime for HeartFlow.
 * Raw message text is consumed locally but never returned by the runtime.
 */
export function runProductRelationshipIntelligence(body = {}) {
  const messages = normalizeProductMessages(body.messages);
  if (!messages.length) {
    throw new ProductIntelligenceInputError(
      "messages_required",
      "`messages` 必须至少包含一条非空消息。"
    );
  }

  const consent = body.consent === true;
  const goal = redact(body.goal).slice(0, 300);
  const memory = consent
    ? createValidatedMemory({ caseId: body.caseId, goal, memory: body.memory })
    : null;

  return runRelationshipLoop({
    messages,
    memory,
    goal,
    consent,
    signals: normalizeSignals(body.signals)
  });
}

export async function handleRelationshipIntelligence(req, res) {
  let body;
  try {
    body = await readRequestJson(req);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError || error?.code === "BODY_TOO_LARGE") {
      return sendJson(res, 413, {
        error: "payload_too_large",
        message: "请求体超过 2MB 限制。"
      });
    }
    return sendJson(res, 400, {
      error: "invalid_json",
      message: "请求体不是合法 JSON。"
    });
  }

  try {
    return sendJson(res, 200, runProductRelationshipIntelligence(body));
  } catch (error) {
    if (error instanceof ProductIntelligenceInputError) {
      return sendJson(res, error.status, { error: error.code, message: error.message });
    }
    return sendJson(res, 500, {
      error: "relationship_intelligence_error",
      message: "本地关系分析暂时不可用。"
    });
  }
}
