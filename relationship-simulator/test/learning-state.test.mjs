import test from "node:test";
import assert from "node:assert/strict";
import {
  LEARNING_SCHEMA_VERSION,
  buildLearningSummary,
  createTrainingEvent,
  normalizeLearningState,
  recordTrainingEvent
} from "../public/modules/core/learning-state.js";

test("normalizes the versioned learning state with all reserved containers", () => {
  const state = normalizeLearningState();

  assert.equal(state.schemaVersion, LEARNING_SCHEMA_VERSION);
  assert.equal(state.schemaVersion, 2);
  assert.ok(Array.isArray(state.sessions));
  assert.ok(Array.isArray(state.events));
  assert.ok(Array.isArray(state.dailyTasks));
  assert.ok(Array.isArray(state.signalAttempts));
  assert.ok(Array.isArray(state.growthSnapshots));
  assert.ok(Array.isArray(state.replayAnalyses));
  assert.deepEqual(state.textbookProgress, {});
  assert.deepEqual(state.settings, {});
});

test("preserves existing learning records and does not mutate input", () => {
  const input = {
    schemaVersion: 1,
    events: [{ id: "e1", type: "signal", source: "local", score: 72 }],
    dailyTasks: [{ date: "2026-07-16", taskId: "timing-pause" }],
    signalAttempts: [{ label: "closing", correct: true }],
    growthSnapshots: [{ date: "2026-07-16", timing: 72 }],
    replayAnalyses: [{ id: "r1", source: "local-replay-v1" }],
    textbookProgress: { "1": { read: true } },
    settings: { localOnly: true }
  };
  const snapshot = structuredClone(input);

  const state = normalizeLearningState(input);

  assert.equal(state.schemaVersion, 2);
  assert.equal(state.events[0].id, "e1");
  assert.equal(state.events[0].score, 72);
  assert.equal(state.events[0].source, "local");
  assert.deepEqual(state.dailyTasks, input.dailyTasks);
  assert.deepEqual(state.signalAttempts, input.signalAttempts);
  assert.deepEqual(state.growthSnapshots, input.growthSnapshots);
  assert.deepEqual(state.replayAnalyses, input.replayAnalyses);
  assert.deepEqual(state.textbookProgress, input.textbookProgress);
  assert.deepEqual(state.settings, input.settings);
  assert.deepEqual(input, snapshot);
});

test("migrates old logs into events marked as legacy", () => {
  const state = normalizeLearningState({
    logs: [
      { score: 60, dimension: "timing", time: "2026-07-15 20:00:00", stage: "初聊" },
      { score: 84, source: "model", dimension: "empathy", time: "2026-07-16 20:00:00" }
    ]
  });

  assert.equal(state.events.length, 2);
  assert.deepEqual(state.events.map((event) => event.source), ["legacy", "legacy"]);
  assert.deepEqual(state.events.map((event) => event.score), [60, 84]);
  assert.deepEqual(state.events.map((event) => event.dimension), ["timing", "empathy"]);
  assert.equal(state.events[0].metadata.stage, "初聊");
  assert.equal(state.events[0].metadata.mine, undefined);
});

test("creates a normalized event with optional training fields", () => {
  const event = createTrainingEvent({
    id: "task-event-1",
    type: "training",
    source: "replay",
    taskId: "timing-pause",
    date: "2026-07-16",
    dimension: "timing",
    score: 108,
    passed: true,
    createdAt: "2026-07-16T12:00:00.000Z",
    metadata: { scenario: "late-night" }
  });

  assert.deepEqual(event, {
    id: "task-event-1",
    type: "training",
    source: "replay",
    taskId: "timing-pause",
    date: "2026-07-16",
    dimension: "timing",
    score: 100,
    passed: true,
    createdAt: "2026-07-16T12:00:00.000Z",
    metadata: { scenario: "late-night" }
  });
});

test("records events immutably and avoids adding malformed events", () => {
  const original = normalizeLearningState({ events: [{ id: "e1", type: "coach" }] });
  const next = recordTrainingEvent(original, {
    id: "e2",
    type: "training",
    dimension: "boundaries",
    score: 75
  });

  assert.equal(original.events.length, 1);
  assert.equal(next.events.length, 2);
  assert.equal(next.events[1].id, "e2");
  assert.notEqual(next, original);
  assert.throws(() => recordTrainingEvent(original, null), /event/i);
});

test("builds a compact learning summary from valid events and tasks", () => {
  const state = normalizeLearningState({
    events: [
      { id: "e1", type: "training", source: "legacy", dimension: "timing", score: 40, createdAt: "2026-07-10T00:00:00.000Z" },
      { id: "e2", type: "training", source: "local", dimension: "timing", score: 80, createdAt: "2026-07-15T00:00:00.000Z" },
      { id: "e3", type: "signal", source: "local", dimension: "boundaries", score: 70, createdAt: "2026-07-16T00:00:00.000Z" }
    ],
    dailyTasks: [
      { date: "2026-07-15", completed: true },
      { date: "2026-07-16", completed: false }
    ]
  });
  const summary = buildLearningSummary(state, "2026-07-16T12:00:00.000Z");

  assert.equal(summary.schemaVersion, 2);
  assert.equal(summary.eventCount, 3);
  assert.equal(summary.completedTaskCount, 1);
  assert.equal(summary.byDimension.timing.count, 2);
  assert.equal(summary.byDimension.timing.averageScore, 60);
  assert.equal(summary.byDimension.timing.latestScore, 80);
  assert.equal(summary.lastActivityAt, "2026-07-16T00:00:00.000Z");
});

test("uses the newest timestamp when events are stored out of order", () => {
  const state = normalizeLearningState({
    events: [
      { id: "new", dimension: "timing", score: 88, createdAt: "2026-07-16T00:00:00.000Z" },
      { id: "old", dimension: "timing", score: 30, createdAt: "2026-07-10T00:00:00.000Z" }
    ]
  });

  assert.equal(buildLearningSummary(state).byDimension.timing.latestScore, 88);
});
