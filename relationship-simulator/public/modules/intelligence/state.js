const CASE_ID_RE = /^case_[a-f0-9]{16}$/;
const VALID_STATUSES = new Set(["idle", "loading", "ready", "error"]);
const RESULT_KEYS = [
  "version",
  "goal",
  "analysis",
  "hypotheses",
  "state",
  "decision",
  "action",
  "prediction",
  "privacy"
];

function clone(value) {
  if (value === null || value === undefined) return value;
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function randomCaseBytes() {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(bytes);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

export function createAnonymousCaseId(bytes = randomCaseBytes()) {
  const source = bytes instanceof Uint8Array && bytes.length >= 8 ? bytes : randomCaseBytes();
  const suffix = Array.from(source.slice(0, 8), (value) => value.toString(16).padStart(2, "0")).join("");
  return `case_${suffix}`;
}

function normalizeResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {};
  for (const key of RESULT_KEYS) {
    if (Object.hasOwn(value, key)) result[key] = clone(value[key]);
  }
  return Object.keys(result).length ? result : null;
}

export function normalizeRelationshipIntelligenceState(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const consent = source.consent === true;
  return {
    schemaVersion: 1,
    consent,
    caseId: CASE_ID_RE.test(String(source.caseId || ""))
      ? String(source.caseId)
      : createAnonymousCaseId(),
    memory: consent && source.memory && typeof source.memory === "object"
      ? clone(source.memory)
      : null,
    lastResult: normalizeResult(source.lastResult),
    lastError: String(source.lastError || "").slice(0, 300),
    status: VALID_STATUSES.has(source.status) ? source.status : "idle",
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : null
  };
}

export function setRelationshipIntelligenceConsent(value, granted) {
  const current = normalizeRelationshipIntelligenceState(value);
  return {
    ...current,
    consent: granted === true,
    memory: granted === true ? current.memory : null,
    lastError: ""
  };
}

export function resetRelationshipIntelligenceSession(value, bytes) {
  const current = normalizeRelationshipIntelligenceState(value);
  return {
    schemaVersion: 1,
    consent: current.consent,
    caseId: createAnonymousCaseId(bytes),
    memory: null,
    lastResult: null,
    lastError: "",
    status: "idle",
    updatedAt: null
  };
}

export function markRelationshipIntelligenceLoading(value) {
  const current = normalizeRelationshipIntelligenceState(value);
  return { ...current, status: "loading", lastError: "" };
}

export function markRelationshipIntelligenceError(value, error) {
  const current = normalizeRelationshipIntelligenceState(value);
  return {
    ...current,
    status: "error",
    lastError: String(error?.message || error || "本地关系分析暂时不可用。").slice(0, 300)
  };
}

export function applyRelationshipIntelligenceResult(value, runtimeResult) {
  const current = normalizeRelationshipIntelligenceState(value);
  const result = normalizeResult(runtimeResult);
  if (!result) return markRelationshipIntelligenceError(current, "本地关系分析返回了无效结果。");
  return {
    ...current,
    memory: current.consent && runtimeResult?.memoryPatch && typeof runtimeResult.memoryPatch === "object"
      ? clone(runtimeResult.memoryPatch)
      : null,
    lastResult: result,
    lastError: "",
    status: "ready",
    updatedAt: new Date().toISOString()
  };
}

export function buildRelationshipIntelligenceRequest({ messages, goal, intelligence, signals } = {}) {
  const current = normalizeRelationshipIntelligenceState(intelligence);
  const boundedMessages = (Array.isArray(messages) ? messages : [])
    .slice(-80)
    .filter((message) => message && typeof message.text === "string" && message.text.trim())
    .map((message) => ({
      id: message.id,
      type: message.type,
      speaker: message.speaker,
      text: message.text.slice(0, 2_000),
      createdAt: message.createdAt,
      timestamp: message.timestamp
    }));
  const request = {
    messages: boundedMessages,
    goal: String(goal || "").trim().slice(0, 300),
    consent: current.consent
  };
  if (current.consent) {
    request.caseId = current.caseId;
    request.memory = clone(current.memory);
  }
  if (signals && typeof signals === "object") request.signals = clone(signals);
  return request;
}

export function toPersistedRelationshipIntelligenceState(value) {
  const current = normalizeRelationshipIntelligenceState(value);
  if (current.consent) return current;
  return {
    ...current,
    memory: null,
    lastResult: null,
    status: "idle",
    updatedAt: null
  };
}
