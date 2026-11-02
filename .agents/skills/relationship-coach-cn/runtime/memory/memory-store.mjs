/**
 * Consent-gated relationship memory with bounded, redacted free text.
 *
 * The store is an immutable in-memory helper. Persisting it is intentionally
 * left to the caller, who must choose a private location and retention period.
 */

import { RELATIONSHIP_STATES } from "../state/state-machine.mjs";

const REDACTION_RULES = [
  [/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[email redacted]"],
  [/(?<!\d)(?:\+?\d[\d -]{8,}\d)(?!\d)/g, "[phone redacted]"],
  [/(?:https?:\/\/|www\.)\S+/gi, "[url redacted]"],
  [/(?<!\d)\d{8,}(?!\d)/g, "[identifier redacted]"]
];
const SENSITIVE_MARKER_RE = /姓名|真实名字|手机号|手机号码|微信\s*(?:号|ID)|QQ\s*号|身份证|学号|住址|地址|宿舍|精确定位|原始聊天|私密照片|(?:微信|QQ|电话|手机|邮箱|密码|API密钥)\s*[:：=]|(?:^|\b)(?:(?:full[_ -]?)?name|phone|mobile|e-?mail|(?:wechat|weixin)(?:[\s_-]*(?:id|number))?|address|password|api[_ -]?key|(?:access|refresh)[_ -]?token)\s*[:：=]/iu;
const SENSITIVE_ID_MARKER_RE = /(?:^|[_-])(?:name|phone|mobile|wechat|weixin|wx|qq|email|address|password|token)(?:[_-]|$)/i;
const VALID_STATES = new Set(RELATIONSHIP_STATES);

/** Validate opaque identifiers without truncating an unsafe value into an id. */
function normalizeAnonymousId(value) {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!/^[a-z][a-z0-9_-]{0,79}$/i.test(id) || SENSITIVE_ID_MARKER_RE.test(id)) return null;
  // Browser-generated case ids and loop digests can contain long digit runs.
  const generatedHex = /^(?:case_[a-f0-9]{16}|(?:timeline_)?loop_[a-f0-9]{64})$/i.test(id);
  if (!generatedHex && /\d{8,}/.test(id)) return null;
  return id;
}

function normalizeCaseId(value) {
  const caseId = String(value || "").trim();
  if (!/^case_[a-z0-9][a-z0-9_-]{2,63}$/i.test(caseId) || !normalizeAnonymousId(caseId)) {
    throw new TypeError("caseId must be an anonymous case_ identifier");
  }
  return caseId;
}

function redact(value) {
  if (typeof value !== "string") return "";
  let text = value.trim();
  if (SENSITIVE_MARKER_RE.test(text)) return "[sensitive field redacted]";
  for (const [pattern, replacement] of REDACTION_RULES) text = text.replace(pattern, replacement);
  return text.slice(0, 500);
}

function normalizeFreeText(value, limit = 500) {
  if (typeof value !== "string" || SENSITIVE_MARKER_RE.test(value)) return "";
  return redact(value).slice(0, limit);
}

/** Pattern redaction cannot certify arbitrary free text as anonymous. */
function limitedTextPrivacy(fields = {}) {
  return {
    ...fields,
    anonymized: false,
    knownIdentifiersRedacted: true,
    manualReviewRequired: true,
    anonymizationScope: "known_patterns_and_controlled_identifiers",
    thirdPartyIdentifiers: null
  };
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function normalizeConsent(consent) {
  if (consent === true) return { granted: true, scope: "relationship_context", recordedAt: null };
  if (!consent || consent.granted !== true) return { granted: false, scope: "none", recordedAt: null };
  return {
    granted: true,
    scope: normalizeFreeText(consent.scope, 80) || "relationship_context",
    recordedAt: normalizeTimestamp(consent.recordedAt)
  };
}

function emptyMemory({ caseId, consent, goal = "" }) {
  return {
    version: 1,
    caseId: normalizeCaseId(caseId),
    consent: normalizeConsent(consent),
    goal: normalizeFreeText(goal),
    currentState: "UNKNOWN",
    timeline: [],
    observations: [],
    preferences: [],
    conflicts: [],
    promises: [],
    lessons: [],
    outcomes: [],
    privacy: limitedTextPrivacy({ rawChatRetained: false })
  };
}

function normalizeObservation(observation) {
  if (!observation || typeof observation !== "object") return null;
  const id = normalizeAnonymousId(observation.id);
  const summary = normalizeFreeText(observation.summary);
  if (!id || !summary) return null;
  return {
    id,
    kind: normalizeFreeText(observation.kind, 60) || "observation",
    summary,
    stage: Number.isInteger(observation.stage) && observation.stage >= 0 && observation.stage <= 12 ? observation.stage : null,
    evidenceIds: Array.isArray(observation.evidenceIds) ? observation.evidenceIds.map((item) => normalizeAnonymousId(item)).filter(Boolean).slice(0, 20) : [],
    source: normalizeFreeText(observation.source, 80) || "user_input",
    recordedAt: normalizeTimestamp(observation.recordedAt)
  };
}

function normalizeOutcome(outcome) {
  if (!outcome || typeof outcome !== "object") return null;
  const id = normalizeAnonymousId(outcome.id ?? "outcome_pending");
  const prediction = normalizeFreeText(outcome.prediction);
  const observedOutcome = normalizeFreeText(outcome.observedOutcome ?? outcome.outcome);
  if (!id || !prediction || !observedOutcome) return null;
  return {
    id,
    prediction,
    observedOutcome,
    update: normalizeFreeText(outcome.update),
    lessons: Array.isArray(outcome.lessons) ? outcome.lessons.map((item) => normalizeFreeText(item)).filter(Boolean).slice(0, 8) : [],
    recordedAt: normalizeTimestamp(outcome.recordedAt)
  };
}

function canWrite(memory) {
  return memory?.consent?.granted === true;
}

function addObservation(memory, observation) {
  if (!observation || memory.observations.some((item) => item.id === observation.id)) return;
  memory.observations.push(observation);
  memory.timeline.push({
    id: `timeline_${observation.id}`,
    kind: observation.kind,
    summary: observation.summary,
    recordedAt: observation.recordedAt
  });
}

function addOutcome(memory, outcome) {
  if (!outcome || memory.outcomes.some((item) => item.id === outcome.id)) return;
  memory.outcomes.push(outcome);
  memory.lessons.push(...outcome.lessons);
}

/** Rebuild the supported schema so caller-provided privacy flags are never trusted. */
function normalizeMemory(memory) {
  const next = emptyMemory(memory || {});
  if (VALID_STATES.has(memory?.currentState)) next.currentState = memory.currentState;
  for (const key of ["preferences", "conflicts", "promises"]) {
    next[key] = (Array.isArray(memory?.[key]) ? memory[key] : [])
      .map((item) => normalizeFreeText(item)).filter(Boolean).slice(0, 100);
  }
  for (const item of Array.isArray(memory?.observations) ? memory.observations : []) {
    addObservation(next, normalizeObservation(item));
  }
  for (const item of Array.isArray(memory?.outcomes) ? memory.outcomes : []) {
    addOutcome(next, normalizeOutcome(item));
  }
  // Timeline and lessons are derived rather than copied from unchecked input.
  return next;
}

export function createMemory(options = {}) {
  return emptyMemory(options);
}

export function grantConsent(memory, consent = {}) {
  const next = normalizeMemory(memory);
  next.consent = normalizeConsent({ ...consent, granted: true });
  return next;
}

export function appendObservation(memory, observation) {
  const next = normalizeMemory(memory);
  if (!canWrite(next)) return next;
  const normalized = normalizeObservation(observation);
  if (!normalized) return next;
  addObservation(next, normalized);
  return next;
}

export function recordOutcome(memory, outcome) {
  const next = normalizeMemory(memory);
  if (!canWrite(next)) return next;
  const normalized = normalizeOutcome(outcome);
  addOutcome(next, normalized);
  return next;
}

export function summarizeMemory(memory) {
  const next = memory?.caseId ? normalizeMemory(memory) : null;
  return {
    caseId: next?.caseId || null,
    currentState: next?.currentState || "UNKNOWN",
    observationCount: next?.observations.length || 0,
    outcomeCount: next?.outcomes.length || 0,
    recentObservations: (next?.observations || []).slice(-3).map(({ id, kind, summary, stage, evidenceIds }) => ({ id, kind, summary, stage, evidenceIds })),
    lessons: [...new Set(next?.lessons || [])].slice(-8),
    privacy: limitedTextPrivacy({ rawChatRetained: false })
  };
}

export { limitedTextPrivacy, normalizeAnonymousId, normalizeCaseId, normalizeFreeText, redact };
