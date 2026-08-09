import test from "node:test";
import assert from "node:assert/strict";
import {
  MICRO_TRAINING_SOURCE,
  MICRO_TRAINING_TYPES,
  getMasteryStatus,
  getTrainingStreak,
  gradeMicroTask,
  selectDailyTask
} from "../public/modules/training/micro-training.js";

function makeState(events = []) {
  return { schemaVersion: 2, events };
}

function event(dimension, score, date, extra = {}) {
  return { dimension, score, date, source: "coach", ...extra };
}

function taskOfType(dimension, type, startDay = 1) {
  for (let day = startDay; day <= startDay + 14; day += 1) {
    const date = `2026-07-${String(day).padStart(2, "0")}`;
    const task = selectDailyTask({}, date, { weakestDimension: dimension });
    if (task.type === type) return task;
  }
  assert.fail(`没有找到 ${dimension}/${type} 任务`);
}

test("selects the weakest dimension and is stable for the same date", () => {
  const state = makeState([
    event("initiative", 80, "2026-07-14"),
    event("curiosity", 75, "2026-07-14"),
    event("boundaries", 70, "2026-07-14"),
    event("timing", 45, "2026-07-14")
  ]);
  const first = selectDailyTask(state, "2026-07-16");
  const second = selectDailyTask(state, "2026-07-16");
  assert.deepEqual(first, second);
  assert.equal(first.dimension, "timing");
  assert.equal(first.timeLimit, 5);
  assert.equal(first.source, MICRO_TRAINING_SOURCE);
});

test("supports an explicit weakest-dimension override without persisting it", () => {
  const state = makeState([event("timing", 10, "2026-07-16")]);
  const task = selectDailyTask(state, "2026-07-16", { weakestDimension: "curiosity" });
  assert.equal(task.dimension, "curiosity");
  assert.equal(task.targetDimension, "curiosity");
  assert.equal("weakestDimension" in task, false);
});

test("rotates task type while keeping the date result deterministic", () => {
  const first = selectDailyTask(makeState(), "2026-07-16", { weakestDimension: "timing" });
  const second = selectDailyTask(makeState(), "2026-07-17", { weakestDimension: "timing" });
  assert.notEqual(`${first.date}:${first.id}`, `${second.date}:${second.id}`);
  assert.notEqual(first.type, second.type);
  assert.ok(MICRO_TRAINING_TYPES.includes(first.type));
  assert.ok(MICRO_TRAINING_TYPES.includes(second.type));
});

test("returns a five-minute task with a complete rubric for every dimension", () => {
  for (const dimension of ["initiative", "curiosity", "boundaries", "timing"]) {
    const task = selectDailyTask({}, "2026-07-16", { weakestDimension: dimension });
    assert.ok(task.id);
    assert.ok(task.title);
    assert.ok(task.prompt);
    assert.equal(task.dimension, dimension);
    assert.equal(task.timeLimit, 5);
    assert.ok(task.rubric.length >= 2);
    assert.ok(task.rubric.every((item) => item.key && item.label && item.pass));
    assert.equal(task.completionKey, `${task.date}:${task.id}`);
  }
});

test("covers rewrite, signal, pause, boundary, and replay task types", () => {
  const types = new Set();
  for (let day = 1; day <= 12; day += 1) {
    const date = `2026-07-${String(day).padStart(2, "0")}`;
    types.add(selectDailyTask({}, date, { weakestDimension: "timing" }).type);
  }
  assert.deepEqual([...types].sort(), [...MICRO_TRAINING_TYPES].sort());
});

test("grades a task with an explainable local score and a next action", () => {
  const task = selectDailyTask(makeState(), "2026-07-16", { weakestDimension: "curiosity" });
  const result = gradeMicroTask(task, "你最近最期待哪一件小事？", { context: "对方刚说今天有点累" });
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.equal(result.dimension, "curiosity");
  assert.ok(result.feedback);
  assert.ok(result.nextAction);
  assert.ok(Array.isArray(result.evidence));
  assert.equal(result.idempotencyKey, task.completionKey);
});

test("grades a respectful boundary answer higher than a pressuring answer", () => {
  const task = taskOfType("boundaries", "boundary");
  const safe = gradeMicroTask(task, "如果你现在不方便也没关系，想说的时候再说。", { context: "对方说今晚不太方便" });
  const pressuring = gradeMicroTask(task, "你为什么不回我？现在就给个准话。", { context: "对方说今晚不太方便" });
  assert.ok(safe.score > pressuring.score);
  assert.equal(safe.passed, true);
  assert.equal(pressuring.passed, false);
  assert.ok(pressuring.rubricResults.some((item) => item.passed === false));
});

test("supports signal classification with uncertainty instead of overclaiming", () => {
  const task = taskOfType("timing", "signal");
  const result = gradeMicroTask(task, "我会判断为疲惫和收尾，但不能仅凭这句话确定她的关系意愿。", {
    message: "早点休息，明天还要上班"
  });
  assert.ok(result.score >= 75);
  assert.equal(result.passed, true);
  assert.ok(result.evidence.some((item) => /不确定|收尾|线索/.test(item)));
});

test("returns an idempotent empty-answer result rather than throwing", () => {
  const task = selectDailyTask({}, "2026-07-16", { weakestDimension: "initiative" });
  const first = gradeMicroTask(task, "");
  const second = gradeMicroTask(task, "");
  assert.deepEqual(first, second);
  assert.equal(first.score, 0);
  assert.equal(first.passed, false);
});

test("counts only completed tasks on consecutive local calendar dates", () => {
  const tasks = [
    { date: "2026-07-13", completed: true },
    { date: "2026-07-14", status: "completed" },
    { date: "2026-07-15", passed: true },
    { date: "2026-07-15", completed: true },
    { date: "2026-07-16", completed: false }
  ];
  assert.equal(getTrainingStreak(tasks, "2026-07-16"), 3);
  assert.equal(getTrainingStreak(tasks, "2026-07-18"), 0);
});

test("does not count future completions or duplicate records twice", () => {
  const tasks = [
    { date: "2026-07-15", completed: true },
    { date: "2026-07-15", completed: true },
    { date: "2026-07-17", completed: true }
  ];
  assert.equal(getTrainingStreak(tasks, "2026-07-16"), 1);
});

test("returns honest empty mastery status", () => {
  assert.deepEqual(getMasteryStatus([], "timing"), {
    level: "not-started",
    progress: 0,
    sampleSize: 0,
    confidence: "low",
    label: "尚未开始"
  });
});

test("calculates mastery from recent scores and keeps evidence counts", () => {
  const events = [
    event("timing", 78, "2026-07-10", { source: "micro-training-v1", taskId: "a", sceneId: "chat" }),
    event("timing", 82, "2026-07-11", { source: "coach", sceneId: "chat" }),
    event("timing", 79, "2026-07-12", { source: "coach", sceneId: "invite" }),
    event("timing", 88, "2026-07-13", { source: "micro-training-v1", taskId: "b", sceneId: "invite" }),
    event("timing", 84, "2026-07-14", { source: "coach", sceneId: "chat" })
  ];
  const result = getMasteryStatus(events, "timing");
  assert.equal(result.sampleSize, 5);
  assert.equal(result.progress, 82);
  assert.equal(result.confidence, "high");
  assert.equal(result.level, "mastered");
  assert.equal(result.evidence.microTrainingCount, 2);
  assert.equal(result.evidence.sceneCount, 2);
});

test("accepts legacy dimension aliases and reports unstable high scores honestly", () => {
  const events = [
    event("boundary", 80, "2026-07-12"),
    event("boundary", 78, "2026-07-13"),
    event("boundary", 76, "2026-07-14")
  ];
  const result = getMasteryStatus(events, "boundaries");
  assert.equal(result.sampleSize, 3);
  assert.equal(result.progress, 78);
  assert.equal(result.level, "unstable");
  assert.equal(result.confidence, "medium");
});
