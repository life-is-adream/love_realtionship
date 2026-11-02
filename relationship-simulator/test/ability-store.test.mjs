import test from "node:test";
import assert from "node:assert/strict";
import { ABILITY_DIMENSIONS } from "../public/modules/training/ability-rubric.js";
import { recordAbilityAssessment, setAbilityConsent } from "../public/modules/training/ability-assessment.js";
import { normalizeLearningState, buildLearningSummary } from "../public/modules/core/learning-state.js";
import { normalizeState, serializeStateForStorage, getState, setState, mutate } from "../public/modules/core/state.js";
import { createConversationResetState } from "../public/modules/core/state-reset.js";
import { buildBackup, applyBackup } from "../public/modules/core/backup.js";
import { createCoachLearningEvent } from "../public/modules/core/training-scores.js";
import { buildAbilityContext } from "../public/modules/training/ability-context.js";

function assessment(consent = false) {
  const answers = {}, scenarioAnswers = {};
  for (const dimension of ABILITY_DIMENSIONS) {
    for (const indicator of dimension.indicators) answers[indicator.id] = 2;
    scenarioAnswers[dimension.scenario.id] = dimension.scenario.options.find(option => option.level === 4).id;
  }
  return recordAbilityAssessment(setAbilityConsent(null, consent), { answers, scenarioAnswers });
}
function storage() {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) };
}

test("旧存档补空画像，learning规范化保留新评估且不迁入旧聊天分", () => {
  const old = normalizeState({ learning: { events: [{ id: "old", dimension: "timing", score: 100 }] } });
  assert.deepEqual(old.learning.abilityAssessment.answers, {});
  const current = normalizeLearningState({ abilityAssessment: assessment() });
  assert.equal(current.abilityAssessment.history.length, 1);
});

test("未同意画像不进入存储、原始调用备份或恢复，序列化不改live", () => {
  const state = normalizeState({ learning: { abilityAssessment: assessment() } });
  const before = JSON.stringify(state);
  assert.equal(serializeStateForStorage(state).learning.abilityAssessment.history.length, 0);
  assert.equal(JSON.stringify(state), before);
  const backup = buildBackup(state, storage());
  assert.equal(JSON.parse(backup.data['heartflow-state']).learning.abilityAssessment.history.length, 0);
  backup.data['heartflow-state'] = JSON.stringify(state);
  const target = storage();
  assert.equal(applyBackup(backup, target).ok, true);
  assert.equal(JSON.parse(target.getItem('heartflow-state')).learning.abilityAssessment.history.length, 0);
});

test("同意后的枚举画像通过备份恢复，对话重置保留画像而清训练日志", () => {
  const state = normalizeState({ learning: { abilityAssessment: assessment(true), events: [{id:'training',dimension:'timing',score:80}] } });
  const target = storage();
  assert.equal(applyBackup(buildBackup(state, storage()), target).ok, true);
  assert.equal(JSON.parse(target.getItem('heartflow-state')).learning.abilityAssessment.history.length, 1);
  const reset = createConversationResetState(state);
  assert.equal(reset.learning.abilityAssessment.history.length, 1);
  assert.equal(reset.learning.events.length, 0);
});

test("画像提交保存失败时，真实store保留原评估与原存储", (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const mocked = storage();
  globalThis.localStorage = mocked;
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; });
  setState({});
  const before = JSON.stringify(getState()), stored = mocked.getItem('heartflow-state');
  mocked.setItem = () => { throw new Error('quota'); };
  assert.throws(() => mutate(draft => { draft.learning.abilityAssessment = assessment(true); }), /quota/);
  assert.equal(JSON.stringify(getState()), before);
  assert.equal(mocked.getItem('heartflow-state'), stored);
});

test("旧coach口径幂等修复，summary与growth使用分项，时机仍未知", () => {
  const old = { id: 'old-coach', type: 'coach-score', dimension: 'timing', score: 90, createdAt: new Date().toISOString(), metadata: { naturalness: 20, empathy: 40, boundary: 60, momentum: 80 } };
  const learning = normalizeLearningState({ events: [old] });
  assert.equal(learning.events[0].metadata.legacyTotal, 90);
  assert.deepEqual(normalizeLearningState(learning), learning);
  const summary = buildLearningSummary(learning);
  assert.equal(summary.byDimension.initiative.latestScore, 62);
  assert.equal(summary.byDimension.curiosity.latestScore, 40);
  assert.equal(summary.byDimension.boundaries.latestScore, 60);
  assert.equal(summary.byDimension.timing.latestScore, null);
  assert.equal(createCoachLearningEvent({ naturalness: null }).metadata.scores.naturalness, null);
  for (const value of [' ', [], [0], {}, false, true, null, undefined]) {
    assert.equal(createCoachLearningEvent({ naturalness: value }).metadata.scores.naturalness, null);
  }
  assert.equal(createCoachLearningEvent({ naturalness: 0 }).metadata.scores.naturalness, 0);
});

test("现实复核计数过滤未来记录，不由体重或拒绝制造能力分", () => {
  const now = Date.parse('2026-10-13T04:00:00Z');
  const base = buildAbilityContext({ lifestyle: { fitness: { weights: [{ date: '2026-10-12', kg: 65 }] } } }, { now });
  assert.equal(base.find(item => item.id === 'appearance').count, 0);
  const next = buildAbilityContext({ lifestyle: { fitness: { trainings: [{ date: '2026-10-12' }, { date: '2030-01-01' }] } } }, { now });
  assert.equal(next.find(item => item.id === 'appearance').count, 1);
  assert.equal(Object.hasOwn(next[0], 'score'), false);
});
