/**
 * Versioned local learning state and training-event helpers.
 *
 * This module intentionally owns only the learning portion of HeartFlow's
 * state. It can be embedded as `state.learning` by the app, or called with a
 * legacy/root state while the UI migration is being rolled out.
 */

import { normalizeAbilityAssessment } from "../training/ability-assessment.js";
import { clampScoreOrNull } from "./number.js";
import { correctLegacyCoachEvent, trainingScoresFromEvent } from "./training-scores.js";

export const LEARNING_SCHEMA_VERSION = 2;
export const LEARNING_LIMITS = Object.freeze({
  events: 200,
  dailyTasks: 60,
  signalAttempts: 200,
  growthSnapshots: 90
});

export const LEARNING_DIMENSIONS = Object.freeze([
  "initiative",
  "curiosity",
  "boundaries",
  "timing"
]);

/**
 * Normalize a current or legacy learning state without mutating its input.
 * The returned object contains all containers reserved by the design contract.
 * @param {object|null|undefined} value
 * @returns {object}
 */
export function normalizeLearningState(value = {}) {
  const input = getLearningInput(value);
  const rawEvents = Array.isArray(input.events) ? input.events : [];
  const events = rawEvents.map(normalizeStoredEvent).filter(Boolean);
  const legacyLogs = getLegacyLogs(value, input);
  const knownIds = new Set(events.map((event) => event.id));

  for (let index = 0; index < legacyLogs.length; index += 1) {
    const legacyEvent = migrateLegacyLog(legacyLogs[index], index);
    // 幂等迁移：相同 id 的 legacy 事件只迁移一次，避免每次 normalize
    // 都重复追加（老用户每次刷新都会把 trainingLog 重新迁移进 events）。
    if (legacyEvent && !knownIds.has(legacyEvent.id)) {
      events.push(legacyEvent);
      knownIds.add(legacyEvent.id);
    }
  }

  const state = {
    schemaVersion: LEARNING_SCHEMA_VERSION,
    // `version` is a read-compatible alias for early phase-2 consumers. The
    // persisted contract remains schemaVersion and is always authoritative.
    version: LEARNING_SCHEMA_VERSION,
    sessions: copyArray(input.sessions),
    events: events.slice(-LEARNING_LIMITS.events),
    replayAnalyses: copyArray(input.replayAnalyses),
    dailyTasks: copyArray(input.dailyTasks).slice(-LEARNING_LIMITS.dailyTasks),
    growthSnapshots: copyArray(input.growthSnapshots).slice(-LEARNING_LIMITS.growthSnapshots),
    signalAttempts: copyArray(input.signalAttempts).slice(-LEARNING_LIMITS.signalAttempts),
    textbookProgress: copyRecord(input.textbookProgress),
    settings: copyRecord(input.settings),
    abilityAssessment: normalizeAbilityAssessment(input.abilityAssessment)
  };

  return state;
}

/**
 * Create one normalized event. Optional task fields stay top-level so later
 * task and growth modules can query them without interpreting metadata.
 * @param {object|null|undefined} input
 * @returns {object}
 */
export function createTrainingEvent(input = {}) {
  if (!isRecord(input)) {
    throw new TypeError("training event must be an object");
  }

  const event = {
    id: normalizeId(input.id),
    type: normalizeString(input.type, "unknown"),
    source: normalizeString(input.source, "local"),
    dimension: normalizeNullableString(input.dimension),
    score: normalizeNullableScore(input.score),
    createdAt: normalizeCreatedAt(input),
    metadata: copyRecord(input.metadata)
  };

  if (input.taskId !== undefined && input.taskId !== null) {
    event.taskId = normalizeString(input.taskId, "");
  }
  if (input.date !== undefined && input.date !== null) {
    event.date = normalizeString(input.date, "");
  }
  if (typeof input.passed === "boolean") event.passed = input.passed;

  return event;
}

/**
 * Append an event immutably. Reusing a non-empty event id is idempotent, which
 * prevents a double click from recording one exercise twice.
 * @param {object|null|undefined} state
 * @param {object|null|undefined} event
 * @returns {object}
 */
export function recordTrainingEvent(state, event) {
  if (!isRecord(event)) throw new TypeError("training event must be an object");

  const next = normalizeLearningState(state);
  const normalized = createTrainingEvent(event);
  if (next.events.some((item) => item.id === normalized.id)) return next;

  next.events = [...next.events, normalized].slice(-LEARNING_LIMITS.events);
  return next;
}

/**
 * Return a compact, UI-safe summary of learning progress.
 * @param {object|null|undefined} state
 * @param {Date|string|number} now
 * @returns {object}
 */
export function buildLearningSummary(state, now = Date.now()) {
  const normalized = normalizeLearningState(state);
  const byDimension = Object.fromEntries(
    LEARNING_DIMENSIONS.map((dimension) => [dimension, createDimensionSummary()])
  );

  for (const event of normalized.events) {
    for (const [dimension, score] of Object.entries(trainingScoresFromEvent(event))) {
      if (!byDimension[dimension] || score === null) continue;
      const bucket = byDimension[dimension];
      bucket.count += 1;
      bucket.totalScore += score;
      bucket.averageScore = Math.round(bucket.totalScore / bucket.count);
      const eventTime = toTime(event.createdAt);
      if (bucket.latestTime === null || (eventTime !== null && eventTime >= bucket.latestTime)) {
        bucket.latestScore = score;
        bucket.latestSource = event.source;
        bucket.latestTime = eventTime;
      }
    }
  }

  for (const bucket of Object.values(byDimension)) {
    delete bucket.totalScore;
    delete bucket.latestTime;
  }

  const datedEvents = normalized.events
    .map((event) => ({ event, time: toTime(event.createdAt) }))
    .filter((item) => item.time !== null)
    .sort((a, b) => b.time - a.time);

  const completedTaskCount = normalized.dailyTasks.filter((task) => task?.completed === true).length;
  const asOf = toTime(now);

  return {
    schemaVersion: LEARNING_SCHEMA_VERSION,
    eventCount: normalized.events.length,
    completedTaskCount,
    dailyTaskCount: normalized.dailyTasks.length,
    signalAttemptCount: normalized.signalAttempts.length,
    replayAnalysisCount: normalized.replayAnalyses.length,
    growthSnapshotCount: normalized.growthSnapshots.length,
    byDimension,
    lastActivityAt: datedEvents[0]?.event.createdAt || null,
    asOf: asOf === null ? null : new Date(asOf).toISOString()
  };
}

/** Return normalized events optionally filtered by a predicate. */
export function selectTrainingEvents(state, predicate = () => true) {
  const normalized = normalizeLearningState(state);
  return normalized.events.filter((event, index) => predicate(event, index));
}

function getLearningInput(value) {
  if (!isRecord(value)) return {};
  if (isRecord(value.learning)) return { ...value.learning };
  return value;
}

function getLegacyLogs(root, input) {
  if (Array.isArray(input.logs)) return input.logs;
  if (Array.isArray(input.trainingLog)) return input.trainingLog;
  if (isRecord(root) && Array.isArray(root.logs)) return root.logs;
  if (isRecord(root) && Array.isArray(root.trainingLog)) return root.trainingLog;
  return [];
}

function normalizeStoredEvent(value) {
  if (!isRecord(value)) return null;
  try {
    // Re-reading old persisted events must not invent a current timestamp.
    // Only newly created events receive the current time by default.
    return correctLegacyCoachEvent(createTrainingEvent(
      Object.prototype.hasOwnProperty.call(value, "createdAt")
        ? value
        : { ...value, createdAt: null }
    ));
  } catch {
    return null;
  }
}

function migrateLegacyLog(value, index) {
  if (!isRecord(value)) return null;

  const metadata = {};
  for (const [key, item] of Object.entries(value)) {
    if (["mine", "herReply", "text", "raw", "content"].includes(key)) continue;
    if (["score", "dimension", "time", "createdAt", "source", "type", "id"].includes(key)) continue;
    if (item === null || ["string", "number", "boolean"].includes(typeof item)) metadata[key] = item;
  }

  const timestamp = value.createdAt ?? value.time ?? null;
  return createTrainingEvent({
    id: value.id || `legacy-${index + 1}`,
    type: value.type || "legacy-log",
    source: "legacy",
    dimension: value.dimension,
    score: value.score,
    createdAt: timestamp,
    metadata
  });
}

function createDimensionSummary() {
  return {
    count: 0,
    totalScore: 0,
    averageScore: null,
    latestScore: null,
    latestSource: null,
    latestTime: null,
    confidence: "low"
  };
}

function normalizeId(value) {
  const id = normalizeString(value, "");
  return id || `event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeString(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeNullableString(value) {
  const text = normalizeString(value, "");
  return text || null;
}

function normalizeNullableScore(value) {
  return clampScoreOrNull(value);
}

function normalizeCreatedAt(input) {
  if (Object.prototype.hasOwnProperty.call(input, "createdAt")) {
    return input.createdAt ? String(input.createdAt) : null;
  }
  return new Date().toISOString();
}

function copyArray(value) {
  return Array.isArray(value) ? value.map((item) => cloneJsonValue(item)) : [];
}

function copyRecord(value) {
  return isRecord(value) ? cloneJsonValue(value) : {};
}

function cloneJsonValue(value) {
  if (Array.isArray(value)) return value.map((item) => cloneJsonValue(item));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]));
  }
  return value;
}

function toTime(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
