import test from "node:test";
import assert from "node:assert/strict";
import { parseReplayText, analyzeReplay } from "../public/modules/training/replay.js";
import { selectDailyTask, gradeMicroTask } from "../public/modules/training/micro-training.js";
import { normalizeLearningState, recordTrainingEvent } from "../public/modules/core/learning-state.js";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

test("replay-to-task path keeps raw replay out of persisted learning state", () => {
  const raw = "我：你还好吗？\n她：今天有点累，13812345678";
  const analysis = analyzeReplay(parseReplayText(raw).messages);
  const task = selectDailyTask({}, "2026-07-16", { weakestDimension: "timing" });
  const grade = gradeMicroTask(task, "先休息吧，方便时再聊。", { context: analysis.observations?.[0]?.evidence || "" });
  let state = normalizeLearningState({});
  state = recordTrainingEvent(state, { id: "replay-event", type: "replay-task", source: "replay", dimension: grade.dimension, score: grade.score, createdAt: "2026-07-16T10:00:00Z" });
  assert.equal(JSON.stringify(state).includes("13812345678"), false);
  assert.equal(state.events[0].source, "replay");
});

test("old training logs migrate while new replay and daily containers remain available", () => {
  const state = normalizeLearningState({ trainingLog: [{ score: { total: 62 }, dimension: "timing", time: "2026-07-15 10:00" }] });
  assert.equal(state.events[0].source, "legacy");
  assert.ok(Array.isArray(state.replayAnalyses));
  assert.ok(Array.isArray(state.dailyTasks));
});

test("phase 2 UI entry points are wired into the app", () => {
  for (const marker of ["openReplayBtn", "dailyTrainingPanel", "growthPanel", "renderDailyTraining", "renderGrowthProfile", "renderTextbookEvidence"]) {
    assert.match(appSource, new RegExp(marker));
  }
  assert.match(appSource, /不保存原文|raw replay|rawReplay/i);
});
