import test from "node:test";
import assert from "node:assert/strict";
import { builtInPersonas } from "../public/modules/core/config.js";

// ── 纯函数测试（不依赖 localStorage）──────────────────────────────────────────

// Import pure functions only after setting up mocks
let getAllPersonas, normalizeState, defaultMemoryFor, normalizeMessages, buildConversationSummary, getLatestMineText, defaultMemoryForFn, mutate, onStateChange, getState, saveState, loadState;

// We need to mock localStorage before importing state.js
const mockStorage = new Map();
global.localStorage = {
  getItem: (key) => mockStorage.get(key) ?? null,
  setItem: (key, value) => mockStorage.set(key, value),
  removeItem: (key) => mockStorage.delete(key),
  clear: () => mockStorage.clear()
};

// Mock structuredClone for Node.js < 17
if (typeof global.structuredClone !== "function") {
  global.structuredClone = (obj) => JSON.parse(JSON.stringify(obj));
}

const stateModule = await import("../public/modules/core/state.js");
getAllPersonas = stateModule.getAllPersonas;
normalizeState = stateModule.normalizeState;
defaultMemoryFor = stateModule.defaultMemoryFor;
normalizeMessages = stateModule.normalizeMessages;
buildConversationSummary = stateModule.buildConversationSummary;
getLatestMineText = stateModule.getLatestMineText;
mutate = stateModule.mutate;
onStateChange = stateModule.onStateChange;
getState = stateModule.getState;
saveState = stateModule.saveState;
loadState = stateModule.loadState;

// ── getAllPersonas ─────────────────────────────────────────────────────────────

test("getAllPersonas 返回内置角色", () => {
  const personas = getAllPersonas({});
  assert.ok(personas.lin);
  assert.ok(personas.xu);
  assert.ok(personas.tang);
  assert.equal(personas.lin.name, "林知夏");
});

test("getAllPersonas 合并自定义角色", () => {
  const custom = { custom1: { id: "custom1", name: "自定义" } };
  const personas = getAllPersonas(custom);
  assert.ok(personas.custom1);
  assert.equal(personas.custom1.name, "自定义");
});

// ── normalizeState ─────────────────────────────────────────────────────────────

test("normalizeState 填充默认值", () => {
  const state = normalizeState({});
  assert.equal(state.personaId, "lin");
  assert.ok(Array.isArray(state.messages));
  assert.ok(state.messages.length > 0);
  assert.ok(Array.isArray(state.trainingLog));
  assert.ok(state.learning);
  assert.equal(state.learning.schemaVersion, 2);
});

test("normalizeState 保留有效字段", () => {
  const state = normalizeState({ personaId: "xu" });
  assert.equal(state.personaId, "xu");
});

test("normalizeState 修复无效角色 ID", () => {
  const state = normalizeState({ personaId: "nonexistent" });
  assert.equal(state.personaId, "lin");
});

test("normalizeState 处理空消息列表", () => {
  const state = normalizeState({ messages: [] });
  assert.ok(Array.isArray(state.messages));
  assert.ok(state.messages.length > 0);
});

test("normalizeState 修复无效 customPersonas", () => {
  const state = normalizeState({ customPersonas: null });
  assert.deepEqual(state.customPersonas, {});
});

test("normalizeState 修复无效 personaMemory", () => {
  const state = normalizeState({ personaMemory: "invalid" });
  assert.deepEqual(state.personaMemory, {});
});

// ── defaultMemoryFor ──────────────────────────────────────────────────────────

test("defaultMemoryFor 返回角色默认记忆", () => {
  const memory = defaultMemoryFor(builtInPersonas.lin);
  assert.ok(memory.background);
  assert.ok(memory.interests);
  assert.ok(memory.boundaries);
  assert.ok(memory.background.includes("林知夏"));
});

test("defaultMemoryFor 过滤角色标签中的负面关键词", () => {
  const persona = { ...builtInPersonas.lin, tags: ["边界感强", "慢热", "讨厌油腻"] };
  const memory = defaultMemoryFor(persona);
  assert.ok(!memory.interests.includes("讨厌油腻"));
});

// ── normalizeMessages ─────────────────────────────────────────────────────────

test("normalizeMessages 过滤无效消息", () => {
  const result = normalizeMessages([
    { type: "me", text: "你好" },
    null,
    { type: "her", text: "嗨" }
  ]);
  assert.equal(result.length, 2, `expected 2, got ${result.length}: ${JSON.stringify(result)}`);
  assert.equal(result[0].text, "你好");
  assert.equal(result[1].text, "嗨");
});

test("normalizeMessages 补充 source 字段", () => {
  const result = normalizeMessages([{ type: "me", text: "你好" }]);
  assert.equal(result[0].source, "");
});

test("normalizeMessages 非数组返回空数组", () => {
  assert.deepEqual(normalizeMessages(null), []);
  assert.deepEqual(normalizeMessages(undefined), []);
});

// ── buildConversationSummary ───────────────────────────────────────────────────

test("buildConversationSummary 构建对话摘要", () => {
  const messages = [
    { type: "me", text: "你好", who: "我" },
    { type: "her", text: "嗨", who: "林知夏" }
  ];
  const summary = buildConversationSummary(messages);
  assert.ok(summary.includes("我"));
  assert.ok(summary.includes("她"));
  assert.ok(summary.includes("林知夏"));
});

test("buildConversationSummary 空消息返回空字符串", () => {
  assert.equal(buildConversationSummary([]), "");
});

// ── getLatestMineText ─────────────────────────────────────────────────────────

test("getLatestMineText 返回 typed 输入", () => {
  const result = getLatestMineText("当前输入");
  assert.equal(result, "当前输入");
});

test("getLatestMineText 无 typed 输入时不报错", () => {
  // Should return empty string or whatever is in state
  const result = getLatestMineText("");
  assert.equal(typeof result, "string");
});

// ── mutate / onStateChange（P2-6 store 收敛）─────────────────────────────────

test("mutate 修改后自动写入 localStorage 并返回 fn 结果", () => {
  loadState();
  const returned = mutate((state) => {
    state.personaId = "xu";
    return "ok";
  });
  assert.equal(returned, "ok");
  const stored = JSON.parse(mockStorage.get("heartflow-state") ?? "null");
  assert.ok(stored, "localStorage 应有状态快照");
  assert.equal(stored.personaId, "xu");
});

test("mutate 后触发 onStateChange 回调恰好一次并携带状态", () => {
  loadState();
  let calls = 0;
  let observed = null;
  onStateChange((state) => { calls += 1; observed = state; });
  try {
    const returned = mutate((state) => { state.personaId = "tang"; });
    assert.equal(returned, undefined);
    assert.equal(calls, 1);
    assert.equal(observed.personaId, "tang");
    assert.equal(observed, getState());
  } finally {
    onStateChange(null);
  }
});

test("mutate 中 fn 抛错时不保存不通知", () => {
  loadState();
  mutate((state) => { state.personaId = "lin"; });
  const snapshotBefore = mockStorage.get("heartflow-state");
  let calls = 0;
  onStateChange(() => { calls += 1; });
  try {
    assert.throws(() => mutate((state) => {
      state.personaId = "xu";
      throw new Error("boom");
    }), /boom/);
    assert.equal(calls, 0, "fn 抛错时不应通知渲染回调");
    assert.equal(mockStorage.get("heartflow-state"), snapshotBefore, "fn 抛错时 localStorage 不应更新");
  } finally {
    onStateChange(null);
  }
});