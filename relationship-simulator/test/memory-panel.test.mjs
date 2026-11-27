import test from "node:test";
import assert from "node:assert/strict";

// ── 最小 DOM / storage 桩（本文件独立进程运行，不污染其他测试） ───────────────
const panel = {
  _html: "",
  set innerHTML(value) { this._html = String(value); },
  get innerHTML() { return this._html; },
  querySelectorAll: () => [],
  querySelector: () => null
};

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};
globalThis.document = { getElementById: (id) => (id === "memoryPanel" ? panel : null) };

const { setState, getState } = await import("../public/modules/core/state.js");
const { renderMemoryPanel, removeMemoryEntry, updateMemoryEntry } = await import("../public/modules/render/render-memory-panel.js");
const { buildMemoryInjection } = await import("../public/modules/core/memory.js");

function seedMemory() {
  setState({
    relationshipIntelligence: { consent: true },
    personaMemory: {
      lin: {
        _enhanced: {
          background: "", interests: "", boundaries: "",
          interactionHistory: { totalConversations: 3, messagesExchanged: 18, commonTopics: ["看展", "摄影"], patterns: [] },
          memoryTimeline: [
            { timestamp: "2026-10-20T10:00:00.000Z", type: "topics_discussed", content: "涉及话题：看展、摄影", source: "auto" },
            { timestamp: "2026-10-21T14:00:00.000Z", type: "topics_discussed", content: "<img src=x onerror=alert(1)>", source: "auto" }
          ],
          conversationSummaries: [],
          learnedPreferences: { riskAreas: [], strengths: [] }
        }
      }
    }
  });
}

// ── 授权闸门 ─────────────────────────────────────────────────────────────────

test("renderMemoryPanel：未授权时只显示 gate，不渲染任何记忆", () => {
  setState({ relationshipIntelligence: { consent: false } });
  renderMemoryPanel();
  assert.match(panel.innerHTML, /未授权/);
  assert.match(panel.innerHTML, /去授权/);
  assert.ok(!panel.innerHTML.includes("最近看展"));
});

test("renderMemoryPanel：已授权但无记忆时提示暂无记录", () => {
  setState({ relationshipIntelligence: { consent: true } });
  renderMemoryPanel();
  assert.match(panel.innerHTML, /暂无记录/);
});

// ── 渲染 ─────────────────────────────────────────────────────────────────────

test("renderMemoryPanel：渲染条目、统计与删除按钮", () => {
  seedMemory();
  renderMemoryPanel();
  assert.match(panel.innerHTML, /关系档案/);
  assert.match(panel.innerHTML, /记忆 2 条/);
  assert.match(panel.innerHTML, /data-memory-kind="timeline"/);
  assert.match(panel.innerHTML, /互动轮次 3/);
});

test("renderMemoryPanel：记忆内容必须 HTML 转义", () => {
  seedMemory();
  renderMemoryPanel();
  assert.ok(!panel.innerHTML.includes("<img src=x"), "原始标签不得进入 DOM");
  assert.match(panel.innerHTML, /&lt;img src=x/);
});

// ── 可见即生效 ───────────────────────────────────────────────────────────────

test("buildMemoryInjection：时间线进入 prompt 注入", () => {
  seedMemory();
  const injection = buildMemoryInjection(getState().personaMemory.lin._enhanced);
  assert.match(injection, /近期记忆/);
  assert.match(injection, /涉及话题：看展、摄影/);
});

test("removeMemoryEntry：删除后条目消失且不再注入", () => {
  seedMemory();
  const before = getState().personaMemory.lin._enhanced.memoryTimeline.length;
  assert.equal(removeMemoryEntry("lin", "timeline", 0), true);
  const after = getState();
  assert.equal(after.personaMemory.lin._enhanced.memoryTimeline.length, before - 1);
  assert.ok(!buildMemoryInjection(after.personaMemory.lin._enhanced).includes("涉及话题：看展、摄影"));
});

test("removeMemoryEntry：越界或目标不存在时安全返回 false", () => {
  seedMemory();
  assert.equal(removeMemoryEntry("lin", "timeline", 99), false);
  assert.equal(removeMemoryEntry("missing", "summary", 0), false);
  assert.equal(removeMemoryEntry("lin", "timeline", -1), false);
});

test("updateMemoryEntry：修改后角色注入立即采用新值，限制类型、边界和长度", () => {
  seedMemory();
  assert.equal(updateMemoryEntry("lin", "timeline", 0, "用户确认的兴趣：摄影"), true);
  const updated = getState().personaMemory.lin._enhanced;
  assert.match(buildMemoryInjection(updated), /用户确认的兴趣：摄影/);
  assert.equal(updateMemoryEntry("lin", "other", 0, "x"), false);
  assert.equal(updateMemoryEntry("lin", "timeline", 88, "x"), false);
  assert.equal(updateMemoryEntry("lin", "timeline", 0, "   "), false);
  assert.equal(updateMemoryEntry("lin", "timeline", 0, "x".repeat(501)), false);
  assert.equal(removeMemoryEntry("lin", "bad-kind", 0), false);
});

test("记忆面板编辑与删除按钮直接更新下一轮注入内容", () => {
  seedMemory();
  const node = () => ({ hidden: false, value: "", textContent: "", dataset: {}, listeners: {}, addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, click() { for (const fn of [...(this.listeners.click || [])]) fn({ preventDefault() {} }); } });
  const memoryEntry = node();
  memoryEntry.dataset.memoryKind = "timeline";
  memoryEntry.dataset.memoryIndex = "0";
  const editor = node();
  editor.value = "涉及话题：看展、摄影";
  const view = node();
  view.textContent = "涉及话题：看展、摄影";
  const edit = node(), save = node(), cancel = node();
  const row = { querySelector(selector) { return ({ "[data-memory-editor]": editor, "[data-memory-view]": view, "[data-memory-edit]": edit, "[data-memory-save]": save, "[data-memory-cancel]": cancel, "[data-memory-kind]": memoryEntry })[selector] || null; } };
  const deleteButton = node();
  deleteButton.dataset = { memoryKind: "timeline", memoryIndex: "1" };
  panel.querySelectorAll = (selector) => selector === "button[data-memory-kind]" ? [deleteButton] : selector === ".memory-row" ? [row] : [];
  renderMemoryPanel();
  edit.click();
  editor.value = "更新后的合成记忆";
  save.click();
  assert.match(buildMemoryInjection(getState().personaMemory.lin._enhanced), /更新后的合成记忆/);
  deleteButton.click();
  assert.ok(!buildMemoryInjection(getState().personaMemory.lin._enhanced).includes("<img"));
  panel.querySelectorAll = () => [];
});

// ── 与状态层联动 ─────────────────────────────────────────────────────────────

const LOW_MESSAGES = [
  { type: "me", text: "今天怎么样" },
  { type: "her", text: "还行" },
  { type: "me", text: "周末有安排吗" },
  { type: "her", text: "没" },
  { type: "me", text: "那要不要出去走走" },
  { type: "her", text: "看情况" },
  { type: "me", text: "最近在忙什么" },
  { type: "her", text: "上班" },
  { type: "me", text: "累不累" },
  { type: "her", text: "嗯" }
];

const HIGH_MESSAGES = [
  { type: "her", text: "今天上班好累，我那个项目又改了三次" },
  { type: "me", text: "听起来挺折腾的" },
  { type: "her", text: "你上次说的那家店我去了，还不错" },
  { type: "me", text: "那家我常去" },
  { type: "her", text: "你周末有空吗？要不要一起去看展" },
  { type: "me", text: "可以啊" },
  { type: "her", text: "你怎么看？我有点纠结" },
  { type: "me", text: "看你想看哪个" },
  { type: "her", text: "对了，你之前说想学摄影，后来去了吗？" },
  { type: "me", text: "还没，一直拖着" },
  { type: "her", text: "别太累，早点睡" },
  { type: "me", text: "你也是" }
];

test("setState：relationshipTier 由消息派生，随投入度变化", () => {
  setState({ relationshipIntelligence: { consent: true }, messages: LOW_MESSAGES });
  const low = getState().relationshipTier;
  assert.equal(low.sampleSize, 10);
  assert.ok(low.level <= 1, `低投入应 <=1，实际 ${low.level}`);

  setState({ relationshipIntelligence: { consent: true }, messages: HIGH_MESSAGES });
  const high = getState().relationshipTier;
  assert.equal(high.confidence, "high");
  assert.ok(high.level >= 3, `高投入应 >=3，实际 ${high.level}`);
  assert.ok(high.level > low.level);
  assert.equal(typeof high.updatedAt, "string");
});

test("setState：外部传入的 tier 不能绕过消息派生", () => {
  setState({
    messages: [{ type: "her", text: "嗯" }],
    relationshipTier: { level: 4, confidence: "high", sampleSize: 99 }
  });
  const tier = getState().relationshipTier;
  assert.equal(tier.level, 0, "不得接受伪造的高档位");
  assert.equal(tier.sampleSize, 1);
  assert.ok(["low", "medium", "high"].includes(tier.confidence));
});
