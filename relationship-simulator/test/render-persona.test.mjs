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
// 渲染函数会触达任意面板节点，因此这里按 id 自动补桩（与 render-scenario 的显式
// null 场景不同：那份测试故意要验证"节点缺失时不抛错"）。
globalThis.document = { getElementById: (id) => (elements.has(id) ? elements.get(id) : el(id)) };

function el(id, value = "") {
  const node = {
    value,
    textContent: "",
    innerHTML: "",
    dataset: {},
    listeners: {},
    className: "",
    style: {},
    disabled: false,
    src: "",
    options: [],
    selectedIndex: -1,
    classList: {
      add() {}, remove() {}, toggle() {}, contains: () => false
    },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute() {},
    getAttribute: () => null,
    appendChild() {},
    remove() {}
  };
  elements.set(id, node);
  return node;
}

const { buildCustomPersona, deleteCurrentPersona } = await import("../public/modules/render/render-persona.js");
const { loadState, getState, setState } = await import("../public/modules/core/state.js");

function fillCustomForm({ name = "林小满", meta = "测试角色", tags = "安静，喜欢展", logic = "她看重尊重", opening = "今天挺开心的。" } = {}) {
  el("customName", name);
  el("customMeta", meta);
  el("customTags", tags);
  el("customLogic", logic);
  el("customOpening", opening);
}

// ── buildCustomPersona ──────────────────────────────────────────────────────

test("buildCustomPersona：填表后产出完整角色契约", () => {
  loadState();
  setState({ personaId: "lin" });
  fillCustomForm();

  const persona = buildCustomPersona();
  assert.equal(persona.name, "林小满");
  assert.equal(persona.avatar, "林", "头像用姓名首字");
  assert.equal(persona.meta, "测试角色");
  assert.deepEqual(persona.tags, ["安静", "喜欢展"], "中文逗号分隔的标签应拆开");
  assert.match(persona.systemRole, /女方叫林小满/);
  assert.match(persona.systemRole, /她看重尊重/);
  assert.equal(persona.localHerReply, "今天挺开心的。");
  assert.equal(persona.starterMessages.length, 3);
  assert.equal(persona.starterMessages[1].type, "her", "第二句是她的开场白");
  assert.equal(persona.starterMessages[1].who, "林小满");
  assert.equal(persona.starterMessages[1].text, "今天挺开心的。");
});

test("buildCustomPersona：姓名为空抛错，不产出半成品", () => {
  loadState();
  fillCustomForm({ name: "   " });
  assert.throws(() => buildCustomPersona(), /自定义角色需要姓名/);
});

test("buildCustomPersona：缺省字段走保守默认值而非空串", () => {
  loadState();
  fillCustomForm({ name: "阿七", meta: "", tags: "", logic: "", opening: "" });
  const persona = buildCustomPersona();
  assert.equal(persona.meta, "自定义角色");
  assert.deepEqual(persona.tags, ["自定义", "待观察", "重视边界"]);
  assert.match(persona.logic, /尊重|边界/);
  assert.ok(persona.localHerReply.length > 0);
  assert.ok(persona.defaultGoal.length > 0);
});

test("buildCustomPersona：自定义 id 在重存时保持稳定", () => {
  loadState();
  // personaId 必须真实存在于 customPersonas 中，否则 normalizeState 会按未知角色重置为 lin。
  setState({
    personaId: "custom-123",
    customPersonas: {
      "custom-123": { id: "custom-123", name: "旧", avatar: "旧", meta: "", tags: [], logic: "", systemRole: "", starterMessages: [], defaultGoal: "", localHerReply: "" }
    }
  });
  fillCustomForm();
  assert.equal(buildCustomPersona().id, "custom-123", "已是 custom- 前缀且存在时不得换 id");
});

test("buildCustomPersona：内置角色新建时分配新 custom- id", () => {
  loadState();
  setState({ personaId: "lin" });
  fillCustomForm();
  const id = buildCustomPersona().id;
  assert.match(id, /^custom-/);
  assert.notEqual(id, "lin");
});

// ── deleteCurrentPersona ────────────────────────────────────────────────────

test("deleteCurrentPersona：内置角色不得删除", () => {
  loadState();
  setState({ personaId: "lin" });
  el("apiStatus", "");
  const before = JSON.stringify(getState().customPersonas);
  deleteCurrentPersona();
  assert.equal(JSON.stringify(getState().customPersonas), before, "内置角色不应改动 customPersonas");
  assert.notEqual(getState().personaId, undefined);
});

test("deleteCurrentPersona：删除自定义角色后回退到内置角色", () => {
  loadState();
  setState({
    personaId: "custom-9",
    customPersonas: {
      "custom-9": { id: "custom-9", name: "临时", avatar: "临", meta: "", tags: [], logic: "", systemRole: "", starterMessages: [], defaultGoal: "", localHerReply: "" }
    }
  });
  el("apiStatus", "");
  deleteCurrentPersona();
  const state = getState();
  assert.equal(state.customPersonas["custom-9"], undefined, "自定义角色应被移除");
  assert.notEqual(state.personaId, "custom-9", "不得停留在已删除的 id 上");
});
