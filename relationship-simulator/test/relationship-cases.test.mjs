import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRelationshipCases, createRelationshipCase, selectRelationshipCase, setCaseConsent,
  addCaseEvent, deleteCaseEvent, addCaseAssessment, deleteCaseAssessment, setCaseMemory, deleteRelationshipCase
} from "../public/modules/core/relationship-cases.js";
import { normalizeState, serializeStateForStorage } from "../public/modules/core/state.js";
import { createConversationResetState } from "../public/modules/core/state-reset.js";
import { buildBackup, applyBackup } from "../public/modules/core/backup.js";
import { STORAGE_KEYS } from "../public/modules/core/config.js";

const A = "case_aaaaaaaaaaaaaaaa";
const B = "case_bbbbbbbbbbbbbbbb";
const E = "entry_cccccccccccccccc";
const S = "score_dddddddddddddddd";
const now = new Date("2026-11-13T12:00:00+08:00");

test("档案默认关闭复盘保存，未授权记录不能进入本地存储", () => {
  const state = createRelationshipCase(null, "关系 A", A);
  assert.equal(state.cases[0].consent, false);
  assert.throws(() => addCaseEvent(state, A, { date: "2026-11-12", observation: "对方说本周忙" }, now, E), /允许保存/);
  const forged = { ...state, cases: [{ ...state.cases[0], events: [{ id: E, date: "2026-11-12", observation: "不应保存" }], memory: "不应保存" }] };
  const persisted = serializeStateForStorage(normalizeState({ relationshipCases: forged }));
  assert.deepEqual(persisted.relationshipCases.cases[0].events, []);
  assert.equal(persisted.relationshipCases.cases[0].memory, "");
});

test("两段关系各自授权、记录、撤销与删除，不串用摘要", () => {
  let state = createRelationshipCase(null, "关系 A", A);
  state = createRelationshipCase(state, "关系 B", B);
  state = setCaseConsent(state, A, true);
  state = addCaseEvent(state, A, { date: "2026-11-12", observation: "对方说本周忙", hypothesis: "可能时间不方便", outcome: "尚未观察" }, now, E);
  state = setCaseMemory(state, A, "我的目标是放慢节奏");
  state = selectRelationshipCase(state, B);
  assert.deepEqual(state.cases.find((item) => item.id === B).events, []);
  assert.equal(state.cases.find((item) => item.id === B).memory, "");
  assert.throws(() => setCaseMemory(state, B, "不应保存"), /允许保存/);
  state = setCaseConsent(state, A, false);
  assert.deepEqual(state.cases.find((item) => item.id === A).events, []);
  assert.equal(state.cases.find((item) => item.id === A).memory, "");
  assert.equal(state.activeId, B);
  state = deleteRelationshipCase(state, B);
  assert.equal(state.activeId, null);
  assert.equal(state.cases.length, 1);
});

test("事件保留事实、推测和结果的不同字段，并可单独删除", () => {
  let state = setCaseConsent(createRelationshipCase(null, "关系 A", A), A, true);
  state = addCaseEvent(state, A, { date: "2026-11-12", observation: "对方说本周忙", hypothesis: "原因未知", outcome: "尚无后续" }, now, E);
  const entry = state.cases[0].events[0];
  assert.deepEqual([entry.observation, entry.hypothesis, entry.outcome], ["对方说本周忙", "原因未知", "尚无后续"]);
  state = deleteCaseEvent(state, A, E);
  assert.deepEqual(state.cases[0].events, []);
});

test("电话等已知标识会脱敏，非法日期与重复事件被拒绝", () => {
  let state = setCaseConsent(createRelationshipCase(null, "关系 A", A), A, true);
  state = addCaseEvent(state, A, { date: "2026-11-12", observation: "留下 13800138000" }, now, E);
  assert.doesNotMatch(JSON.stringify(state), /13800138000/);
  assert.throws(() => addCaseEvent(state, A, { date: "2026-11-14", observation: "未来事件" }, now, "entry_dddddddddddddddd"), /有效日期/);
  assert.throws(() => addCaseEvent(state, A, { date: "2026-11-12", observation: "重复" }, now, E), /重复/);
});

test("对话重置保留已授权的独立档案，损坏数据不会成为记忆", () => {
  let cases = setCaseConsent(createRelationshipCase(null, "关系 A", A), A, true);
  cases = setCaseMemory(cases, A, "我希望表达清楚");
  const reset = createConversationResetState({ relationshipCases: cases });
  assert.equal(reset.relationshipCases.cases[0].memory, "我希望表达清楚");
  assert.deepEqual(normalizeRelationshipCases({ schemaVersion: 99, cases: [{ id: A, label: "坏数据", consent: true, memory: "坏数据" }] }).cases, []);
});

test("备份恢复时保留已授权档案并丢弃未授权摘要", () => {
  let cases = setCaseConsent(createRelationshipCase(null, "关系 A", A), A, true);
  cases = setCaseMemory(cases, A, "已确认的摘要");
  cases = createRelationshipCase(cases, "关系 B", B);
  cases.cases.find((item) => item.id === B).memory = "未授权摘要";
  const backup = buildBackup(normalizeState({ relationshipCases: cases }), null);
  const values = new Map();
  const storage = { setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  assert.equal(applyBackup(backup, storage).ok, true);
  const restored = JSON.parse(values.get(STORAGE_KEYS.state)).relationshipCases.cases;
  assert.equal(restored.find((item) => item.id === A).memory, "已确认的摘要");
  assert.equal(restored.find((item) => item.id === B).memory, "");
});

test("2.1 量表评分可保存并保留版本号", () => {
  let cases = setCaseConsent(createRelationshipCase(null, "关系 A", A), A, true);
  const evaluation = { rubric_version: "2.1.0", dimensions: [
    { id: "listening", status: "scored", score: 3, reason: "原文不应保存", evidence: [{ quote: "原文不应保存" }] }
  ] };
  cases = addCaseAssessment(cases, A, "low-energy-reply", evaluation, now, S);
  assert.deepEqual(cases.cases[0].assessments[0].dimensions, { listening: 3 });
  assert.equal(cases.cases[0].assessments[0].rubricVersion, "2.1.0");
  assert.doesNotMatch(JSON.stringify(cases), /原文不应保存/);
});

test("练习分数须单独授权和主动保存，只保留规则分值并随撤销清除", () => {
  let cases = createRelationshipCase(null, "关系 A", A);
  const evaluation = { rubric_version: "1.1.0", dimensions: [
    { id: "boundary", status: "scored", score: 4, reason: "原文不应保存", evidence: [{ quote: "原文不应保存" }] },
    { id: "naturalness", status: "insufficient_evidence", score: null }
  ] };
  assert.throws(() => addCaseAssessment(cases, A, "low-energy-reply", evaluation, now, S), /允许保存/);
  cases = setCaseConsent(cases, A, true);
  cases = addCaseAssessment(cases, A, "low-energy-reply", evaluation, now, S);
  assert.deepEqual(cases.cases[0].assessments[0].dimensions, { boundary: 4 });
  assert.doesNotMatch(JSON.stringify(cases), /原文不应保存/);
  cases = createRelationshipCase(cases, "关系 B", B);
  assert.deepEqual(cases.cases.find((item) => item.id === B).assessments, []);
  const deleted = deleteCaseAssessment(cases, A, S);
  assert.deepEqual(deleted.cases.find((item) => item.id === A).assessments, []);
  cases = setCaseConsent(cases, A, false);
  assert.deepEqual(cases.cases.find((item) => item.id === A).assessments, []);
});
