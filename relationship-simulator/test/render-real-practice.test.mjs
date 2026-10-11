import test from "node:test";
import assert from "node:assert/strict";
import { getState, onStateChange, setState } from "../public/modules/core/state.js";
import { PRACTICE_OPTIONS, reflectPracticeRecord, shanghaiDate } from "../public/modules/training/real-practice.js";
import { renderRealPractice, resetRealPracticeDrafts } from "../public/modules/render/render-real-practice.js";

const sample = (extra = {}) => ({ date: "2026-08-21", planId: "connection", attempt: "done", response: "reciprocal", comfort: "comfortable", expression: "clear", regulation: "maintained", boundary: "respected", expected: "reciprocal", ...extra });

/** 隔离 DOM 和内存存储，运行真实 renderer 的监听器；不访问用户的浏览器。 */
function mount(t, practice = { planId: "connection", records: [] }) {
  const descriptors = new Map(["document", "localStorage"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const controls = new Map();
  const storage = new Map();
  const element = (attributes = "") => ({
    value: attributes.match(/\bvalue="([^"]*)"/)?.[1] || "",
    checked: /\bchecked\b/.test(attributes),
    textContent: "",
    listeners: new Map(),
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    dispatch(type) { this.listeners.get(type)?.({ target: this, preventDefault() {} }); }
  });
  const panel = {
    html: "", buttons: [],
    get innerHTML() { return this.html; },
    set innerHTML(html) {
      this.html = html;
      controls.clear();
      controls.set("realPracticePanel", this);
      for (const match of html.matchAll(/<(select|input|form|button|p)\b([^>]*)>/g)) {
        const id = match[2].match(/\bid="([^"]*)"/)?.[1];
        if (!id) continue;
        const control = element(match[2]);
        if (match[1] === "select") {
          const options = html.slice(match.index + match[0].length).split("</select>")[0];
          control.value = options.match(/<option\b[^>]*value="([^"]*)"[^>]*\bselected\b/)?.[1] || "";
        }
        controls.set(id, control);
      }
      this.buttons = [...html.matchAll(/<button\b[^>]*data-practice-edit="([^"]+)"[^>]*>/g)].map((match) => ({ ...element(), dataset: { practiceEdit: match[1] } }));
    },
    querySelectorAll(selector) { return selector === "[data-practice-edit]" ? this.buttons : []; }
  };
  controls.set("realPracticePanel", panel);
  Object.defineProperty(globalThis, "document", { configurable: true, value: { getElementById: (id) => controls.get(id) || null } });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) } });
  resetRealPracticeDrafts();
  setState({ relationshipPractice: practice });
  onStateChange(renderRealPractice);
  renderRealPractice();
  t.after(() => {
    onStateChange(null);
    resetRealPracticeDrafts();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return {
    panel,
    control: (id) => controls.get(id),
    fill(input) {
      for (const [field, value] of Object.entries(input)) {
        const control = controls.get(field === "date" ? "practice-date" : `practice-${field}`);
        if (control) control.value = value;
      }
    },
    submit() { controls.get("practiceOutcomeForm").dispatch("submit"); },
    edit(id) { panel.buttons.find((button) => button.dataset.practiceEdit === id).dispatch("click"); }
  };
}

test("renderer exposes every saved event and all observation fields with direct course links", (t) => {
  const records = Array.from({ length: 30 }, (_, index) => sample({ date: `2026-07-${String(index + 1).padStart(2, "0")}` }));
  const ui = mount(t, { planId: "connection", consent: true, records });
  assert.equal((ui.panel.html.match(/class="practice-history-entry"/g) || []).length, 30);
  assert.equal(ui.panel.buttons.length, 30);
  const history = ui.panel.html.split('<div class="practice-history">')[1];
  assert.match(history, /2026-07-01/);
  assert.match(history, /2026-07-30/);
  for (const field of Object.keys(PRACTICE_OPTIONS)) assert.ok(history.includes(PRACTICE_OPTIONS[field][records[0][field]]), `摘要应显示 ${field}`);
  assert.match(ui.panel.html, /href="\/love-learning.html\?course=5"/);
  assert.equal(ui.control("practice-date").value, shanghaiDate());
});

test("real submit listeners add distinct events, keep the chosen direction and preserve rejection", (t) => {
  const ui = mount(t);
  ui.fill(sample({ response: "refused" }));
  ui.submit();
  assert.equal(getState().relationshipPractice.records.length, 1);
  assert.equal(ui.control("practice-response").value, "");
  assert.match(ui.panel.html, /下一轮准备建议：等待或受挫时反复分析/);
  assert.equal(getState().relationshipPractice.planId, "connection");
  ui.fill(sample());
  ui.submit();
  const records = getState().relationshipPractice.records;
  assert.equal(records.length, 2);
  assert.equal(records[0].response, "refused");
  assert.equal(reflectPracticeRecord(records[0]).decision, "EXIT");
  assert.equal(reflectPracticeRecord(records[1]).decision, "MAINTAIN");
  assert.notEqual(records[0].id, records[1].id);
  assert.match(ui.panel.html, /对方明确拒绝/);
});

test("editing loads an existing event, retains unknown fields and marks the preserved previous version", (t) => {
  const ui = mount(t, { planId: "opening", consent: true, records: [sample({ response: "refused", regulation: "unknown" })] });
  const id = getState().relationshipPractice.records[0].id;
  ui.edit(id);
  assert.equal(ui.control("practice-response").value, "refused");
  assert.equal(ui.control("practice-date").value, "2026-08-21");
  assert.match(ui.panel.html, /补充旧事件/);
  ui.fill({ response: "notObserved", comfort: "unknown", expression: "", regulation: "maintained", boundary: "uncertain", expected: "unknown" });
  ui.submit();
  const state = getState().relationshipPractice;
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].id, id);
  assert.equal(state.records[0].response, "refused");
  assert.equal(state.records[0].regulation, "maintained");
  assert.equal(state.records[0].history.length, 1);
  assert.equal(state.records[0].history[0].regulation, "unknown");
  assert.equal(state.planId, "opening");
  assert.match(ui.panel.html, /已更新，保留此前观察/);
  assert.match(ui.panel.html, /原观察/);
  assert.equal(ui.control("cancelPracticeEdit"), undefined);
});

test("cancel editing restores a new-event draft and reset clears only transient form choices", (t) => {
  const ui = mount(t, { planId: "opening", records: [sample()] });
  ui.fill({ attempt: "noOpportunity", expected: "space", date: "2026-08-20" });
  const id = getState().relationshipPractice.records[0].id;
  ui.edit(id);
  ui.fill({ regulation: "struggled" });
  ui.control("cancelPracticeEdit").dispatch("click");
  assert.equal(ui.control("practice-attempt").value, "noOpportunity");
  assert.equal(ui.control("practice-expected").value, "space");
  assert.equal(ui.control("practice-date").value, "2026-08-20");
  const saved = structuredClone(getState().relationshipPractice);
  ui.edit(id);
  resetRealPracticeDrafts();
  renderRealPractice();
  assert.deepEqual(getState().relationshipPractice, saved);
  assert.equal(ui.control("practice-attempt").value, "");
  assert.equal(ui.control("practice-expected").value, "");
  assert.equal(ui.control("cancelPracticeEdit"), undefined);
});

test("save-consent rerender retains an unsent draft; future dates fail without modifying events", (t) => {
  const ui = mount(t);
  ui.fill(sample({ response: "unclear" }));
  ui.control("practiceSaveConsent").checked = true;
  ui.control("practiceSaveConsent").dispatch("change");
  assert.equal(ui.control("practice-response").value, "unclear");
  assert.equal(ui.control("practice-date").value, "2026-08-21");
  ui.fill({ date: "2099-01-01" });
  ui.submit();
  assert.match(ui.control("practiceOutcomeError").textContent, /有效/);
  assert.equal(getState().relationshipPractice.records.length, 0);
});

test("withdrawing storage consent clears saved versions and an in-progress supplement", (t) => {
  const ui = mount(t, { planId: "connection", consent: true, records: [sample({ response: "refused" })] });
  ui.edit(getState().relationshipPractice.records[0].id);
  ui.fill({ regulation: "struggled" });
  ui.control("practiceSaveConsent").checked = false;
  ui.control("practiceSaveConsent").dispatch("change");
  assert.equal(getState().relationshipPractice.consent, false);
  assert.equal(getState().relationshipPractice.records.length, 0);
  assert.equal(ui.control("cancelPracticeEdit"), undefined);
  assert.equal(ui.control("practice-response").value, "");
  assert.equal(ui.control("practice-regulation").value, "");
});
