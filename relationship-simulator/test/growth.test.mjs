import test from "node:test";
import assert from "node:assert/strict";
import {
  FIVE_SCORE_MAPPING,
  GROWTH_DIMENSIONS,
  aggregateGrowth,
  buildGrowthSummary,
  buildRadarData,
  getMastery
} from "../public/modules/training/growth.js";

function date(value) {
  return new Date(`${value}T12:00:00.000Z`);
}

function event(dimension, score, source, createdAt, extra = {}) {
  return { dimension, score, source, createdAt, ...extra };
}

function analysisEvent(scores, source, createdAt, extra = {}) {
  return { scores, source, createdAt, ...extra };
}

test("exposes all four training dimensions and an explicit five-score mapping", () => {
  assert.deepEqual(GROWTH_DIMENSIONS, ["initiative", "curiosity", "boundaries", "timing"]);
  assert.equal(FIVE_SCORE_MAPPING.initiative.momentum, 0.7);
  assert.equal(FIVE_SCORE_MAPPING.initiative.naturalness, 0.3);
  assert.equal(FIVE_SCORE_MAPPING.curiosity.empathy, 0.7);
  assert.equal(FIVE_SCORE_MAPPING.boundaries.boundary, 1);
  assert.equal(FIVE_SCORE_MAPPING.timing.timing, 1);
});

test("separates baseline from recent change and keeps source metadata", () => {
  const summary = aggregateGrowth([
    event("initiative", 42, "legacy", "2026-06-20"),
    event("initiative", 78, "coach", "2026-07-15")
  ], { windowDays: 30, now: date("2026-07-16") });

  assert.equal(summary.dimensions.initiative.baseline, 42);
  assert.equal(summary.dimensions.initiative.score, 78);
  assert.equal(summary.dimensions.initiative.change, 36);
  assert.equal(summary.dimensions.initiative.baselineSource, "legacy");
  assert.equal(summary.dimensions.initiative.source, "coach");
  assert.equal(summary.trend[1].source, "coach");
  assert.equal(summary.windowDays, 30);
});

test("supports seven-day and thirty-day windows without fabricating timestamps", () => {
  const events = [
    event("timing", 40, "legacy", "2026-06-20"),
    event("timing", 60, "coach", "2026-07-10"),
    event("timing", 80, "micro-training", "2026-07-15"),
    event("timing", 90, "coach", null)
  ];

  const seven = aggregateGrowth(events, { windowDays: 7, now: date("2026-07-16") });
  const thirty = aggregateGrowth(events, { windowDays: 30, now: date("2026-07-16") });
  assert.equal(seven.dimensions.timing.score, 80);
  assert.equal(seven.dimensions.timing.sampleSize, 2);
  assert.equal(thirty.dimensions.timing.score, 80);
  assert.equal(thirty.dimensions.timing.sampleSize, 3);
  assert.equal(seven.trend.some((point) => point.score === 90), false);
});

test("maps phase-1 five scores explicitly and lets direct task scores win", () => {
  const summary = aggregateGrowth([
    analysisEvent({ naturalness: 40, empathy: 60, boundary: 70, momentum: 80, timing: 50 }, "coach", "2026-07-15"),
    event("initiative", 95, "micro-training-v1", "2026-07-15", { taskId: "initiative-task" }),
    analysisEvent({ naturalness: 20, empathy: 20, boundary: 20, momentum: 20, timing: 20 }, "legacy", "2026-07-14")
  ], { now: date("2026-07-16") });

  assert.equal(summary.dimensions.initiative.score, 95);
  assert.equal(summary.dimensions.boundaries.score, 70);
  assert.equal(summary.dimensions.timing.score, 50);
  assert.equal(summary.dimensions.curiosity.score, 60);
  assert.equal(summary.trend.find((item) => item.dimension === "initiative" && item.date === "2026-07-15").source, "micro-training-v1");
});

test("uses explicit question evidence when deriving curiosity", () => {
  const summary = aggregateGrowth([
    analysisEvent({ empathy: 60 }, "coach", "2026-07-15", { questionScore: 90 })
  ], { now: date("2026-07-16") });

  assert.equal(summary.dimensions.curiosity.score, 69);
});

test("normalizes malformed scores, preserves arbitrary valid sources, and keeps empty dimensions honest", () => {
  const summary = aggregateGrowth([
    event("timing", 140, "custom-adapter", "2026-07-15"),
    event("boundaries", "not-a-score", "bad", "2026-07-15"),
    event("unknown", 80, "ignored", "2026-07-15"),
    event("curiosity", 70, "missing-date", null)
  ], { now: date("2026-07-16") });

  assert.equal(summary.dimensions.timing.score, 100);
  assert.equal(summary.dimensions.timing.source, "custom-adapter");
  assert.equal(summary.dimensions.boundaries.score, null);
  assert.equal(summary.dimensions.curiosity.score, null);
  assert.equal(summary.dimensions.curiosity.baseline, null);
  assert.equal(summary.empty, false);
});

test("returns honest empty data without fabricating a radar score", () => {
  const summary = aggregateGrowth([], { now: date("2026-07-16") });
  assert.equal(summary.empty, true);
  assert.equal(buildRadarData(summary).every((point) => point.value === null), true);
  assert.equal(buildRadarData(summary).every((point) => point.baseline === null), true);
  assert.equal(getMastery(summary, "timing").label, "起步");
});

test("requires minimum samples before declaring stable or transferable", () => {
  const summary = aggregateGrowth([
    event("timing", 82, "coach", "2026-07-14"),
    event("timing", 84, "coach", "2026-07-15")
  ], { now: date("2026-07-16") });
  const mastery = getMastery(summary, "timing");
  assert.equal(mastery.level, "practicing");
  assert.equal(mastery.label, "练习中");
  assert.match(mastery.explanation, /样本较少/);
});

test("returns stable and transferable labels from observable evidence", () => {
  const summary = aggregateGrowth([
    event("initiative", 78, "coach", "2026-07-10", { type: "coach" }),
    event("initiative", 82, "coach", "2026-07-11", { type: "coach" }),
    event("initiative", 80, "micro-training-v1", "2026-07-12", { type: "rewrite" }),
    event("initiative", 84, "micro-training-v1", "2026-07-13", { type: "rewrite" }),
    event("initiative", 86, "coach", "2026-07-14", { type: "coach" })
  ], { now: date("2026-07-16") });

  const mastery = getMastery(summary, "initiative");
  assert.equal(mastery.level, "transferable");
  assert.equal(mastery.label, "可迁移");
  assert.equal(mastery.progress, 86);
});

test("builds a non-diagnostic growth summary with a focus and concrete actions", () => {
  const summary = aggregateGrowth([
    event("initiative", 86, "coach", "2026-07-14"),
    event("curiosity", 62, "micro-training-v1", "2026-07-15"),
    event("boundaries", 74, "coach", "2026-07-15"),
    event("timing", 55, "local", "2026-07-15")
  ], { now: date("2026-07-16") });
  const result = buildGrowthSummary(summary);

  assert.ok(result.headline);
  assert.ok(Array.isArray(result.strengths));
  assert.equal(result.focus.dimension, "timing");
  assert.ok(result.actions.every((item) => item.action));
  assert.equal(/人格|依恋|诊断|恋爱结果/.test(JSON.stringify(result)), false);
});
