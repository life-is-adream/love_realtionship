/**
 * Consent-gated, anonymized relationship memory.
 *
 * The store is an immutable in-memory helper. Persisting it is intentionally
 * left to the caller, who must choose a private location and retention period.
 */

const REDACTION_RULES = [
  [/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[email redacted]"],
  [/(?<!\d)(?:\+?\d[\d -]{8,}\d)(?!\d)/g, "[phone redacted]"],
  [/(?:https?:\/\/|www\.)\S+/gi, "[url redacted]"],
  [/(?<!\d)\d{8,}(?!\d)/g, "[identifier redacted]"]
];
const SENSITIVE_MARKER_RE = /姓名|手机号|手机号码|微信号|身份证|学号|住址|地址|宿舍|精确定位|原始聊天|私密照片/u;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeCaseId(value) {
  const caseId = String(value || "").trim();
  if (!/^case_[a-z0-9][a-z0-9_-]{2,63}$/i.test(caseId)) {
    throw new TypeError("caseId must be an anonymous case_ identifier");
  }
  return caseId;
}

function redact(value) {
  let text = String(value || "").trim();
  for (const [pattern, replacement] of REDACTION_RULES) text = text.replace(pattern, replacement);
  return text.slice(0, 500);
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
    scope: redact(consent.scope || "relationship_context"),
    recordedAt: normalizeTimestamp(consent.recordedAt)
  };
}

function emptyMemory({ caseId, consent, goal = "" }) {
  return {
    version: 1,
    caseId: normalizeCaseId(caseId),
    consent: normalizeConsent(consent),
    goal: redact(goal),
    currentState: "UNKNOWN",
    timeline: [],
    observations: [],
    preferences: [],
    conflicts: [],
    promises: [],
    lessons: [],
    outcomes: [],
    privacy: {
      anonymized: true,
      rawChatRetained: false,
      thirdPartyIdentifiers: false
    }
  };
}

function normalizeObservation(observation) {
  if (!observation || typeof observation !== "object") return null;
  const id = String(observation.id || "").trim();
  const summary = redact(observation.summary);
  if (!id || !summary || SENSITIVE_MARKER_RE.test(summary)) return null;
  return {
    id: id.slice(0, 80),
    kind: redact(observation.kind || "observation").slice(0, 60),
    summary,
    stage: Number.isInteger(observation.stage) && observation.stage >= 0 && observation.stage <= 12 ? observation.stage : null,
    evidenceIds: Array.isArray(observation.evidenceIds) ? observation.evidenceIds.map((item) => String(item).slice(0, 80)).slice(0, 20) : [],
    source: redact(observation.source || "user_input").slice(0, 80),
    recordedAt: normalizeTimestamp(observation.recordedAt)
  };
}

function normalizeOutcome(outcome) {
  if (!outcome || typeof outcome !== "object") return null;
  const prediction = redact(outcome.prediction);
  const observedOutcome = redact(outcome.observedOutcome ?? outcome.outcome);
  if (!prediction || !observedOutcome || SENSITIVE_MARKER_RE.test(`${prediction} ${observedOutcome}`)) return null;
  return {
    id: String(outcome.id || "outcome_pending").slice(0, 80),
    prediction,
    observedOutcome,
    update: redact(outcome.update),
    lessons: Array.isArray(outcome.lessons) ? outcome.lessons.map(redact).filter(Boolean).slice(0, 8) : [],
    recordedAt: normalizeTimestamp(outcome.recordedAt)
  };
}

function canWrite(memory) {
  return Boolean(memory?.consent?.granted === true && memory?.privacy?.anonymized === true);
}

export function createMemory(options = {}) {
  return emptyMemory(options);
}

export function grantConsent(memory, consent = {}) {
  const next = clone(memory);
  next.consent = normalizeConsent({ ...consent, granted: true });
  return next;
}

export function appendObservation(memory, observation) {
  const next = clone(memory);
  if (!canWrite(next)) return next;
  const normalized = normalizeObservation(observation);
  if (!normalized) return next;
  if (next.observations.some((item) => item.id === normalized.id)) return next;
  next.observations.push(normalized);
  if (normalized.stage !== null) next.currentState = next.currentState || "UNKNOWN";
  next.timeline.push({
    id: `timeline_${normalized.id}`,
    kind: normalized.kind,
    summary: normalized.summary,
    recordedAt: normalized.recordedAt
  });
  return next;
}

export function recordOutcome(memory, outcome) {
  const next = clone(memory);
  if (!canWrite(next)) return next;
  const normalized = normalizeOutcome(outcome);
  if (!normalized || next.outcomes.some((item) => item.id === normalized.id)) return next;
  next.outcomes.push(normalized);
  next.lessons.push(...normalized.lessons);
  return next;
}

export function summarizeMemory(memory) {
  return {
    caseId: memory?.caseId || null,
    currentState: memory?.currentState || "UNKNOWN",
    observationCount: Array.isArray(memory?.observations) ? memory.observations.length : 0,
    outcomeCount: Array.isArray(memory?.outcomes) ? memory.outcomes.length : 0,
    recentObservations: (memory?.observations || []).slice(-3).map(({ id, kind, summary, stage, evidenceIds }) => ({ id, kind, summary, stage, evidenceIds })),
    lessons: [...new Set((memory?.lessons || []).filter(Boolean))].slice(-8),
    privacy: { anonymized: true, rawChatRetained: false }
  };
}

export { normalizeCaseId, redact };
