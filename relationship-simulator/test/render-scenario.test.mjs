import test from "node:test";
import assert from "node:assert/strict";

// ── DOM / storage 桩（本文件独立进程运行） ───────────────────────────────────
const elements = new Map();
const store = new Map();

globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};
globalThis.document = { getElementById: (id) => elements.get(id) || null };

function el(id, value = "") {
  const node = {
    value,
    textContent: "",
    innerHTML: "",
    dataset: {},
    listeners: {},
    className: "",
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    querySelector: () => null,
    querySelectorAll: () => []
  };
  elements.set(id, node);
  return node;
}

/** 只读取，不创建——`el(id)` 单参调用会用空节点覆盖已有值，取值必须走这里 */
function getEl(id) {
  return elements.get(id) || null;
}

const { REVIEW_MAPPING, loadScenario } = await import("../public/modules/render/render-scenario.js");
const { scenarios } = await import("../public/modules/content/scenarios.js");
const { getState, loadState } = await import("../public/modules/core/state.js");
const { STAGE_VALUES } = await import("../public/modules/core/stages.js");

// ── REVIEW_MAPPING ──────────────────────────────────────────────────────────

test("REVIEW_MAPPING：七个阶段全部有对照章节", () => {
  for (const stage of STAGE_VALUES) {
    const mapping = REVIEW_MAPPING[stage];
    assert.ok(mapping, `阶段「${stage}」缺少 REVIEW_MAPPING 条目`);
    assert.equal(typeof mapping.chapter, "number");
    assert.ok(mapping.topic.length > 0);
  }
  assert.equal(Object.keys(REVIEW_MAPPING).length, STAGE_VALUES.length);
});

test("REVIEW_MAPPING：章节编号落在 1–6 且单调递增", () => {
  const chapters = STAGE_VALUES.map((stage) => REVIEW_MAPPING[stage].chapter);
  for (const chapter of chapters) assert.ok(chapter >= 1 && chapter <= 6, `章节越界：${chapter}`);
  const sorted = [...chapters].sort((a, b) => a - b);
  assert.deepEqual(chapters, sorted, "阶段推进顺序应与章节递增一致");
});

// ── loadScenario ────────────────────────────────────────────────────────────

test("loadScenario：未知剧本 id 是安全 no-op，不改状态", () => {
  loadState();
  const before = JSON.stringify(getState().messages);
  const calls = [];
  loadScenario("不存在的剧本", {
    switchPersona: () => calls.push("switch"),
    onChanged: () => calls.push("changed")
  });
  assert.deepEqual(calls, [], "未知剧本不应触发任何回调");
  assert.equal(JSON.stringify(getState().messages), before);
});

test("loadScenario：载入剧本会重写消息并清空分析产物", () => {
  loadState();
  el("stage", "隔天轻联系");
  el("goal", "旧目标");
  el("apiStatus", "");
  const scenario = scenarios.find((item) => item.openingMessages?.length > 0);
  assert.ok(scenario, "至少要有一个带开场白的剧本");

  let changed = 0;
  loadScenario(scenario.id, { onChanged: () => { changed += 1; } });

  const state = getState();
  assert.equal(state.messages.length, scenario.openingMessages.length, "消息应被剧本开场白替换");
  assert.equal(state.lastAnalysis, null, "剧本切换必须清空上一次分析");
  assert.equal(state.lastGenerationMeta, null);
  assert.equal(changed, 1);
  assert.match(getEl("stage").value, /./, "推荐阶段应写入 stage");
  assert.match(getEl("apiStatus").textContent, /已加载剧本/);
});

test("loadScenario：contextHint 写入 goal 并解除 personaSynced", () => {
  loadState();
  el("stage", "");
  el("goal", "");
  const scenario = scenarios.find((item) => item.contextHint && item.openingMessages?.length > 0);
  assert.ok(scenario, "至少要有一个带 contextHint 的剧本");
  loadScenario(scenario.id);
  assert.equal(getEl("goal").value, scenario.contextHint);
  assert.equal(getEl("goal").dataset.personaSynced, "false");
});

test("loadScenario：无 DOM 节点时不抛错", () => {
  loadState();
  elements.clear();
  const scenario = scenarios.find((item) => item.openingMessages?.length > 0);
  assert.doesNotThrow(() => loadScenario(scenario.id));
});
