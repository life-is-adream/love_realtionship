import test from "node:test";
import assert from "node:assert/strict";
import { initWorkspaceNav } from "../public/modules/render/workspace-nav.js";

const VIEWS = ["home", "chat", "practice", "journey", "real", "coach", "growth", "abilities", "lifestyle", "settings"];

function makeElement(dataset = {}) {
  const classes = new Set();
  const attributes = new Map();
  const listeners = new Map();
  return {
    dataset, hidden: false, inert: false, textContent: "", focusCount: 0,
    classList: {
      toggle(name, force) { const active = force ?? !classes.has(name); if (active) classes.add(name); else classes.delete(name); return active; },
      contains(name) { return classes.has(name); }
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    removeAttribute(name) { attributes.delete(name); },
    addEventListener(type, listener) { const handlers = listeners.get(type) || []; handlers.push(listener); listeners.set(type, handlers); },
    click() { let prevented = false; for (const handler of listeners.get("click") || []) handler({ preventDefault() { prevented = true; } }); return prevented; },
    focus() { this.focusCount += 1; },
    listenerCount(type) { return (listeners.get(type) || []).length; },
    set innerHTML(_) { throw new Error("导航不能重建面板或表单"); }
  };
}

function page(hash = "", extraPanels = []) {
  const panels = [...VIEWS.map((view) => makeElement({ viewPanel: view })), ...extraPanels];
  const links = VIEWS.map((view) => makeElement({ view }));
  const elements = new Map(["workspaceTitle", "workspaceDescription", "workspaceSidebar", "workspaceMenuToggle"].map((id) => [id, makeElement()]));
  const listeners = new Map();
  let currentHash = hash;
  const browser = {
    writes: [], replacements: [],
    location: { get hash() { return currentHash; }, set hash(value) { currentHash = value; browser.writes.push(value); } },
    history: { replaceState(_state, _title, url) { currentHash = url; browser.replacements.push(url); } },
    addEventListener(type, listener) { const handlers = listeners.get(type) || []; handlers.push(listener); listeners.set(type, handlers); },
    navigateHash(value) { currentHash = value; for (const handler of listeners.get("hashchange") || []) handler(); },
    listenerCount(type) { return (listeners.get(type) || []).length; }
  };
  const root = {
    defaultView: browser,
    querySelectorAll(selector) { return selector === "[data-view-panel]" ? panels : selector === "[data-view]" ? links : []; },
    querySelector(selector) { return elements.get(selector.slice(1)) || null; }
  };
  return { root, panels, links, browser, element: (id) => elements.get(id) };
}

function assertVisible(ui, view) {
  assert.deepEqual(ui.panels.filter((panel) => !panel.hidden).map((panel) => panel.dataset.viewPanel), [view]);
  for (const panel of ui.panels) {
    assert.equal(panel.getAttribute("aria-hidden"), String(panel.hidden));
    assert.equal(panel.inert, panel.hidden);
    assert.equal(panel.getAttribute("inert") === "", panel.hidden);
  }
  for (const link of ui.links) {
    const active = link.dataset.view === view;
    assert.equal(link.classList.contains("active"), active);
    assert.equal(link.classList.contains("is-active"), active);
    assert.equal(link.getAttribute("aria-current"), active ? "page" : null);
  }
}

test("a valid initial hash wins and every other panel is hidden and inert", () => {
  const ui = page("#real");
  const changes = [];
  const nav = initWorkspaceNav({ root: ui.root, initialView: "chat", onViewChange: (view) => changes.push(view) });
  assert.equal(nav.currentView(), "real");
  assertVisible(ui, "real");
  assert.equal(ui.element("workspaceTitle").textContent, "现实练习与复盘");
  assert.match(ui.element("workspaceDescription").textContent, /可观察结果/);
  assert.deepEqual(changes, ["real"]);
  assert.equal(ui.element("workspaceTitle").focusCount, 0);
  assert.equal(ui.browser.writes.length, 0);
});

test("ability profile deep links and navigation retain assessment inputs", () => {
  const ui = page("#abilities");
  const abilityPanel = ui.panels.find((panel) => panel.dataset.viewPanel === "abilities");
  const draft = { value: "3", scenario: "respect" };
  abilityPanel.form = draft;
  const nav = initWorkspaceNav({ root: ui.root });
  assertVisible(ui, "abilities");
  assert.equal(ui.element("workspaceTitle").textContent, "个人恋爱能力画像");
  nav.show("lifestyle");
  ui.browser.navigateHash("#abilities");
  assertVisible(ui, "abilities");
  assert.equal(abilityPanel.form, draft);
  assert.equal(abilityPanel.form.value, "3");
});

test("unknown hashes and unknown programmatic views safely return to home", () => {
  for (const hash of ["#unknown", "#constructor", "#__proto__", "#chat/extra", "#CHAT", "#javascript:alert(1)"]) {
    const ui = page(hash);
    const nav = initWorkspaceNav({ root: ui.root, initialView: "chat" });
    assert.equal(nav.currentView(), "home");
    assertVisible(ui, "home");
    assert.deepEqual(ui.browser.replacements, ["#home"]);
    assert.deepEqual(ui.browser.writes, []);
    nav.show("chat");
    nav.show("invalid");
    assert.equal(ui.browser.location.hash, "#home");
  }
});

test("navigation clicks update hash, metadata and focus without double notification", () => {
  const ui = page();
  const changes = [];
  const nav = initWorkspaceNav({ root: ui.root, onViewChange: (view) => changes.push(view) });
  assert.deepEqual(ui.browser.replacements, ["#home"]);
  assert.equal(ui.links.find((link) => link.dataset.view === "chat").click(), true);
  assert.equal(nav.currentView(), "chat");
  assertVisible(ui, "chat");
  assert.deepEqual(ui.browser.writes, ["#chat"]);
  assert.equal(ui.element("workspaceTitle").textContent, "对话练习");
  assert.equal(ui.element("workspaceTitle").focusCount, 1);
  ui.browser.navigateHash("#chat");
  assert.deepEqual(changes, ["home", "chat"]);
  nav.show("settings", { focus: false });
  assert.equal(ui.element("workspaceTitle").focusCount, 1);
  assertVisible(ui, "settings");
});

test("browser back and forward apply hash changes without creating another history entry", () => {
  const ui = page("#chat");
  const nav = initWorkspaceNav({ root: ui.root });
  nav.show("growth");
  const writes = ui.browser.writes.length;
  ui.browser.navigateHash("#chat");
  assert.equal(nav.currentView(), "chat");
  assertVisible(ui, "chat");
  ui.browser.navigateHash("#growth");
  assertVisible(ui, "growth");
  assert.equal(ui.browser.writes.length, writes);
  ui.browser.navigateHash("#not-a-route");
  assertVisible(ui, "home");
  assert.equal(ui.browser.writes.length, writes);
  assert.deepEqual(ui.browser.replacements, ["#home"]);
});

test("mobile menu is controlled by is-open and closes after navigation while desktop sidebar stays visible", () => {
  const ui = page("#home");
  const nav = initWorkspaceNav({ root: ui.root });
  const toggle = ui.element("workspaceMenuToggle");
  const sidebar = ui.element("workspaceSidebar");
  assert.equal(toggle.getAttribute("aria-controls"), "workspaceSidebar");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  toggle.click();
  assert.equal(sidebar.classList.contains("is-open"), true);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  nav.show("practice");
  assert.equal(sidebar.classList.contains("is-open"), false);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(sidebar.hidden, false);
  assert.equal(sidebar.inert, false);
});

test("initialization is idempotent and switching does not discard form controls or values", () => {
  const ui = page("#chat");
  const chatPanel = ui.panels.find((panel) => panel.dataset.viewPanel === "chat");
  const draft = { value: "一段尚未提交的练习内容" };
  chatPanel.form = draft;
  const changes = [];
  const nav = initWorkspaceNav({ root: ui.root, onViewChange: (view) => changes.push(view) });
  const duplicate = initWorkspaceNav({ root: ui.root, initialView: "settings" });
  assert.equal(duplicate, nav);
  assert.equal(ui.browser.listenerCount("hashchange"), 1);
  assert.ok(ui.links.every((link) => link.listenerCount("click") === 1));
  assert.equal(ui.element("workspaceMenuToggle").listenerCount("click"), 1);
  nav.show("real");
  nav.show("chat");
  assert.equal(chatPanel.form, draft);
  assert.equal(chatPanel.form.value, "一段尚未提交的练习内容");
  assert.deepEqual(changes, ["chat", "real", "chat"]);
});

test("unrecognized and duplicate panels stay hidden so exactly one panel is reachable", () => {
  const duplicate = makeElement({ viewPanel: "chat" });
  const unknown = makeElement({ viewPanel: "unknown" });
  const ui = page("#chat", [duplicate, unknown]);
  initWorkspaceNav({ root: ui.root });
  assertVisible(ui, "chat");
  assert.equal(duplicate.hidden, true);
  assert.equal(unknown.inert, true);
});
