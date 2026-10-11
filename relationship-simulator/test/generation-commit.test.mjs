import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { getState, setState, mutate, onStateChange, getCurrentPersona } from "../public/modules/core/state.js";
import { appendGeneratedReply } from "../public/modules/core/conversation.js";
import { appendHerIfNeeded } from "../public/modules/render/render-chat.js";
import { shouldCollectFromScore, collectMistake } from "../public/modules/core/mistakes.js";
import { recordTrainingEvent } from "../public/modules/core/learning-state.js";

const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const scoreCollection = source.slice(source.indexOf("function collectCoachMistake("), source.indexOf("function renderIntelligencePanel("));
const commitFunctions = source.slice(source.indexOf("function addTrainingLog("), source.indexOf("function localFallback("));
const analysis = { herReply: "synthetic generated reply", coachScore: { total: 50, naturalness: 50, empathy: 50, boundary: 50, momentum: 50, weakestDim: "boundary" } };

function mount(t, extra = {}) {
  const descriptors = new Map(["document", "localStorage"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const storage = new Map();
  let writes = 0, notifications = 0;
  globalThis.document = { getElementById: () => null };
  globalThis.localStorage = { getItem: (key) => storage.get(key) || null, setItem: (key, value) => { writes++; storage.set(key, value); } };
  setState({ messages: [{ type: "me", text: "synthetic mine", source: "user" }], ...extra });
  writes = 0;
  onStateChange(() => { notifications++; });
  t.after(() => {
    onStateChange(null);
    for (const [key, value] of descriptors) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; }
  });
  const env = {
    state: getState(), mutate, getCurrentPersona, appendGeneratedReply, appendHerIfNeeded,
    recordTrainingEvent, shouldCollectFromScore, collectMistake, MISTAKE_DIM_LABELS: { boundary: "边界" },
    $: () => ({ value: "第一次邀约" }), enableTextbookIndexLoad() {}, renderAll() {}, emit() {},
    Events: { ANALYSIS_COMMITTED: "committed" }, intelligenceController: { refresh: async () => {} }
  };
  vm.createContext(env);
  vm.runInContext(scoreCollection + commitFunctions, env);
  return { env, storage, counts: () => ({ writes, notifications }) };
}

test("生成提交使用真实 store，一次提交消息、分析、日志、学习事件与错题", (t) => {
  const ui = mount(t);
  const root = getState();
  const result = ui.env.commitAnalysis(analysis, "model");
  assert.equal(getState(), root);
  assert.equal(result, root.lastAnalysis);
  assert.equal(root.messages.length, 2);
  assert.equal(root.messages[1].text, analysis.herReply);
  assert.equal(root.trainingLog.length, 1);
  assert.equal(root.trainingLog[0].mine, "synthetic mine");
  assert.equal(root.learning.events.length, 1);
  assert.equal(root.mistakes.length, 1);
  assert.deepEqual(ui.counts(), { writes: 1, notifications: 1 });
  const stored = JSON.parse(ui.storage.get("heartflow-state"));
  assert.equal(stored.messages.length, 2);
  assert.equal(stored.trainingLog.length, 1);
});

test("重复女方回复不追加消息，但该次分析的日志不丢失", (t) => {
  const ui = mount(t, { messages: [{ type: "me", text: "synthetic mine" }, { type: "her", text: analysis.herReply }] });
  ui.env.commitAnalysis(analysis, "local");
  assert.equal(getState().messages.length, 2);
  assert.equal(getState().trainingLog.length, 1);
  ui.env.commitAnalysis(analysis, "local");
  assert.equal(getState().trainingLog.length, 1, "同一对话日志继续去重");
});

test("生成提交保存失败时，消息、分析和训练记录全部回滚", (t) => {
  const ui = mount(t);
  const before = JSON.stringify(getState());
  localStorage.setItem = () => { throw new Error("quota exceeded"); };
  assert.throws(() => ui.env.commitAnalysis(analysis, "model"), /quota/);
  assert.equal(JSON.stringify(getState()), before);
  assert.deepEqual(ui.counts(), { writes: 0, notifications: 0 });
});
