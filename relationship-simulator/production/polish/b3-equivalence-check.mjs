// B3 等价性抽查（临时脚本，不入库）：对比迁移前写序列（手动 mutate + saveState）
// 与迁移后 mutate(fn) 的 localStorage 写入时机与持久化结果。
// 两条路径共用同一份基线快照，排除 defaultState 中易变时间戳的干扰。
const mockStorage = new Map();
let writeCount = 0;
global.localStorage = {
  getItem: (k) => mockStorage.get(k) ?? null,
  setItem: (k, v) => { mockStorage.set(k, v); writeCount++; },
  removeItem: (k) => mockStorage.delete(k),
  clear: () => mockStorage.clear()
};
if (typeof global.structuredClone !== "function") global.structuredClone = (o) => JSON.parse(JSON.stringify(o));
const { getState, loadState, saveState, mutate, onStateChange, setState } = await import("../../public/modules/core/state.js");

// 生成基线快照（一次），后续两条路径都从它 loadState 出发
setState(undefined);
const baseline = mockStorage.get("heartflow-state");

function restoreBaseline() {
  mockStorage.set("heartflow-state", baseline);
  writeCount = 0;
  loadState();
}

// ── 写点1：render-chat.js appendMine ──────────────────────────────────────────
function oldAppendMine() {  // 迁移前源码序列
  restoreBaseline();
  const s = getState();
  s.messages.push({ who: "我", type: "me", text: "抽查消息", source: "user" });
  saveState();
  return mockStorage.get("heartflow-state");
}
function newAppendMine() {  // 迁移后
  restoreBaseline();
  mutate((s) => { s.messages.push({ who: "我", type: "me", text: "抽查消息", source: "user" }); });
  return mockStorage.get("heartflow-state");
}

// ── 写点2：app.js handleRecall 清空分析 ──────────────────────────────────────
function primeRecallState() {
  const s = getState();
  s.lastAnalysis = { herReply: "x" };
  s.lastGenerationMeta = { source: "model", error: "" };
}
function oldHandleRecallClear() {  // 迁移前源码序列
  restoreBaseline();
  primeRecallState();
  const s = getState();
  s.lastAnalysis = null;
  s.lastGenerationMeta = null;
  saveState();
  return mockStorage.get("heartflow-state");
}
function newHandleRecallClear() {  // 迁移后
  restoreBaseline();
  primeRecallState();
  mutate((s) => { s.lastAnalysis = null; s.lastGenerationMeta = null; });
  return mockStorage.get("heartflow-state");
}

const results = [];
const pairs = [
  ["写点1 render-chat.appendMine", oldAppendMine, newAppendMine],
  ["写点2 app.handleRecall 清空分析", oldHandleRecallClear, newHandleRecallClear]
];
for (const [name, oldFn, newFn] of pairs) {
  let listenerCalls = 0;
  onStateChange(() => { listenerCalls++; });
  const oldSnapshot = oldFn(); const oldWrites = writeCount;
  writeCount = 0; listenerCalls = 0;
  const newSnapshot = newFn(); const newWrites = writeCount;
  onStateChange(null);
  console.log(name);
  console.log("  localStorage 写入次数  迁移前=" + oldWrites + "  迁移后=" + newWrites + "  " + (oldWrites === newWrites ? "OK" : "FAIL"));
  console.log("  持久化 JSON 逐字节一致  " + (oldSnapshot === newSnapshot ? "OK" : "FAIL"));
  console.log("  渲染回调触发（迁移后新增行为，同步执行无中间绘制）: " + listenerCalls + " 次");
  results.push(oldWrites === newWrites && oldSnapshot === newSnapshot);
}
console.log(results.every(Boolean) ? "等价性抽查：全部通过" : "等价性抽查：存在差异");
process.exit(results.every(Boolean) ? 0 : 1);
