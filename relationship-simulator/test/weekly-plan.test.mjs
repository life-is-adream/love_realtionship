import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWeeklyPlan } from "../public/modules/training/weekly-plan.js";
import { normalizeState, serializeStateForStorage } from "../public/modules/core/state.js";
import { createConversationResetState } from "../public/modules/core/state-reset.js";

const plan = {
  schemaVersion: 1, createdAt: "2026-11-13T12:00:00Z", focus: "boundary", focusLabel: "边界尊重",
  source: "last_practice", reason: "最近练习", secret: "不应保存",
  tasks: ["learn", "practice", "reflect"].map((id, index) => ({ id, day: 1 + index * 2, title: id, description: "五分钟练习", done: false, rawChat: "不应保存" }))
};

test("每周计划只保留已知练习字段，并在重置对话后保留", () => {
  const normalized = normalizeWeeklyPlan(plan);
  assert.equal(normalized.tasks.length, 3);
  assert.doesNotMatch(JSON.stringify(normalized), /不应保存/);
  const stored = serializeStateForStorage(normalizeState({ learning: { weeklyPlan: plan } }));
  assert.equal(stored.learning.weeklyPlan.focus, "boundary");
  assert.equal(createConversationResetState(stored).learning.weeklyPlan.focus, "boundary");
});

test("未知维度或不完整任务不能被恢复成有效计划", () => {
  assert.equal(normalizeWeeklyPlan({ ...plan, focus: "unknown" }), null);
  assert.equal(normalizeWeeklyPlan({ ...plan, tasks: plan.tasks.slice(0, 2) }), null);
});
