import test from "node:test";
import assert from "node:assert/strict";
import { getState, onStateChange, setState } from "../public/modules/core/state.js";
import { ABILITY_DIMENSIONS } from "../public/modules/training/ability-rubric.js";
import { buildAbilityProfile, normalizeAbilityAssessment, recordAbilityAssessment } from "../public/modules/training/ability-assessment.js";
import { renderAbilityAssessment, resetAbilityAssessmentDrafts } from "../public/modules/render/render-ability-assessment.js";

/** 隔离 DOM 和内存存储，运行实际监听器及状态事务；不读真实浏览器数据。 */
function mount(t, assessment = {}) {
  const descriptors = new Map(["document", "localStorage"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const controls = new Map();
  const storage = new Map();
  let failStorage = false;
  const element = (attributes = "") => ({
    value: attributes.match(/\bvalue="([^"]*)"/)?.[1] ?? "",
    checked: /\bchecked\b/.test(attributes),
    disabled: /\bdisabled\b/.test(attributes),
    open: /\bopen\b/.test(attributes),
    textContent: "", dataset: {}, listeners: new Map(),
    addEventListener(type, listener) { const handlers = this.listeners.get(type) || []; handlers.push(listener); this.listeners.set(type, handlers); },
    dispatch(type) { for (const listener of this.listeners.get(type) || []) listener({ target: this, preventDefault() {} }); }
  });
  const panel = {
    html: "", dimensions: [],
    get innerHTML() { return this.html; },
    set innerHTML(html) {
      this.html = html;
      controls.clear();
      controls.set("abilityAssessmentPanel", this);
      this.dimensions = [];
      for (const match of html.matchAll(/<(select|input|form|button|p|details)\b([^>]*)>/g)) {
        const id = match[2].match(/\bid="([^"]*)"/)?.[1];
        const dimensionId = match[2].match(/\bdata-ability-dimension="([^"]*)"/)?.[1];
        if (!id && !dimensionId) continue;
        const control = element(match[2]);
        if (match[1] === "select") {
          const options = html.slice(match.index + match[0].length).split("</select>")[0];
          control.value = options.match(/<option\b[^>]*value="([^"]*)"[^>]*\bselected\b/)?.[1] ?? "";
        }
        if (dimensionId) { control.dataset.abilityDimension = dimensionId; this.dimensions.push(control); }
        if (id) controls.set(id, control);
      }
    },
    querySelectorAll(selector) { return selector === "[data-ability-dimension]" ? this.dimensions : []; }
  };
  controls.set("abilityAssessmentPanel", panel);
  Object.defineProperty(globalThis, "document", { configurable: true, value: { getElementById: (id) => controls.get(id) || null } });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key) => storage.get(key) ?? null,
    setItem(key, value) { if (failStorage) throw new Error("controlled storage failure"); storage.set(key, value); },
    removeItem: (key) => storage.delete(key)
  } });
  resetAbilityAssessmentDrafts();
  setState({ learning: { abilityAssessment: assessment } });
  onStateChange(renderAbilityAssessment);
  renderAbilityAssessment();
  t.after(() => {
    onStateChange(null);
    resetAbilityAssessmentDrafts();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return {
    panel,
    control: (id) => controls.get(id),
    setLevel(indicatorId, value) { controls.get(`ability-answer-${indicatorId}`).value = String(value); },
    scenario(scenario, optionId) {
      for (const option of [{ id: "unknown" }, ...scenario.options]) controls.get(`ability-scenario-${scenario.id}-${option.id}`).checked = option.id === (optionId || "unknown");
    },
    fillAll(level = 4) {
      for (const dimension of ABILITY_DIMENSIONS) {
        for (const indicator of dimension.indicators) this.setLevel(indicator.id, level);
        this.scenario(dimension.scenario, dimension.scenario.options.find((option) => option.level === 4).id);
      }
    },
    submit() { controls.get("abilityAssessmentForm").dispatch("submit"); },
    consent(granted) { const control = controls.get("abilitySaveConsent"); control.checked = granted; control.dispatch("change"); },
    focus(id, checked = true) { const control = controls.get(`ability-focus-${id}`); control.checked = checked; control.dispatch("change"); },
    failStorage(value = true) { failStorage = value; }
  };
}

test("initial profile offers eight dimensions and unknown choices without leaking scenario feedback", (t) => {
  const ui = mount(t);
  assert.equal(ui.panel.dimensions.length, 8);
  assert.equal(ui.panel.dimensions.filter((item) => item.open).length, 1);
  assert.equal((ui.panel.html.match(/<select\b/g) || []).length, 16);
  assert.equal(ui.control("abilitySaveConsent").checked, false);
  assert.equal(ui.control("abilityAssessmentEditor").open, false);
  assert.match(ui.panel.html, /综合分待评估/);
  assert.match(ui.panel.html, /已答 0 \/ 24/);
  assert.match(ui.panel.html, /尚未作为科学量表验证/);
  assert.match(ui.panel.html, /不收集姓名、照片、声音或聊天原文/);
  for (const dimension of ABILITY_DIMENSIONS) {
    for (const indicator of dimension.indicators) assert.equal(ui.control(`ability-answer-${indicator.id}`).value, "");
    for (const option of dimension.scenario.options) assert.ok(!ui.panel.html.includes(option.feedback), "初次作答前不展示情境标准反馈");
  }
});

test("partial submission preserves unknowns and displays actual scenario explanation", (t) => {
  const ui = mount(t);
  const dimension = ABILITY_DIMENSIONS[0];
  ui.setLevel(dimension.indicators[0].id, 0);
  const option = dimension.scenario.options.find((item) => item.level === 4);
  ui.scenario(dimension.scenario, option.id);
  ui.submit();
  const saved = getState().learning.abilityAssessment;
  assert.equal(saved.answers[dimension.indicators[0].id], 0);
  assert.equal(saved.scenarioAnswers[dimension.scenario.id], option.id);
  assert.equal(saved.history.length, 1);
  assert.equal(buildAbilityProfile(saved).total, null);
  assert.match(ui.panel.html, /已答 2 \/ 24/);
  assert.ok(ui.panel.html.includes(option.feedback));
  assert.match(ui.panel.html, /首次作答/);
});

test("submitting every field as unknown leaves profile unscored and explains the missing input", (t) => {
  const ui = mount(t);
  ui.submit();
  assert.equal(getState().learning.abilityAssessment.history.length, 0);
  assert.match(ui.control("abilityAssessmentError").textContent, /至少完成一项/);
  assert.match(ui.panel.html, /综合分待评估/);
});

test("complete submit displays overall score and critical gaps override the grade", (t) => {
  const ui = mount(t);
  ui.fillAll();
  ui.submit();
  assert.match(ui.panel.html, /100 \/ 100/);
  assert.match(ui.panel.html, /已答 24 \/ 24/);
  const criticalDimension = ABILITY_DIMENSIONS.find((dimension) => dimension.scenario.options.some((option) => option.critical));
  const criticalOption = criticalDimension.scenario.options.find((option) => option.critical);
  ui.scenario(criticalDimension.scenario, criticalOption.id);
  ui.submit();
  assert.match(ui.panel.html, /关键知识待补/);
  assert.match(ui.panel.html, /优先补齐关键边界与知识/);
  assert.ok(ui.panel.html.includes(criticalOption.feedback));
  assert.match(ui.panel.html, /重试，首次答案仍保留/);
});

test("unsubmitted inputs and editor state survive focus, consent and unrelated renders", (t) => {
  const ui = mount(t);
  const dimension = ABILITY_DIMENSIONS[0];
  ui.control("abilityAssessmentEditor").open = true;
  ui.setLevel(dimension.indicators[0].id, 3);
  const option = dimension.scenario.options[1];
  ui.scenario(dimension.scenario, option.id);
  ui.focus(dimension.id);
  ui.consent(true);
  renderAbilityAssessment();
  assert.equal(ui.control(`ability-answer-${dimension.indicators[0].id}`).value, "3");
  assert.equal(ui.control(`ability-scenario-${dimension.scenario.id}-${option.id}`).checked, true);
  assert.equal(ui.control("abilityAssessmentEditor").open, true);
  assert.equal(getState().learning.abilityAssessment.history.length, 0, "保存设置不自动提交表单");
});

test("focus selection is capped at two without inflating submitted scores", (t) => {
  const ui = mount(t);
  ui.fillAll(2);
  ui.submit();
  const total = buildAbilityProfile(getState().learning.abilityAssessment).total;
  ui.focus(ABILITY_DIMENSIONS[0].id);
  ui.focus(ABILITY_DIMENSIONS[1].id);
  assert.equal(ui.control(`ability-focus-${ABILITY_DIMENSIONS[2].id}`).disabled, true);
  assert.equal(buildAbilityProfile(getState().learning.abilityAssessment).total, total);
  ui.focus(ABILITY_DIMENSIONS[0].id, false);
  assert.equal(ui.control(`ability-focus-${ABILITY_DIMENSIONS[2].id}`).disabled, false);
});

test("withdrawing consent clears assessments while retaining unsent edits, explicit clear erases both", (t) => {
  const ui = mount(t);
  ui.consent(true);
  ui.fillAll();
  ui.submit();
  const indicator = ABILITY_DIMENSIONS[0].indicators[0];
  ui.setLevel(indicator.id, 1);
  ui.consent(false);
  assert.equal(getState().learning.abilityAssessment.history.length, 0);
  assert.equal(ui.control(`ability-answer-${indicator.id}`).value, "1");
  assert.match(ui.panel.html, /综合分待评估/);
  ui.control("clearAbilityAssessment").dispatch("click");
  assert.equal(ui.control(`ability-answer-${indicator.id}`).value, "");
  assert.equal(getState().learning.abilityAssessment.history.length, 0);
});

test("failed state persistence reports an error and keeps previous results and draft", (t) => {
  const ui = mount(t);
  ui.fillAll(2);
  ui.submit();
  const before = structuredClone(getState().learning.abilityAssessment);
  const indicator = ABILITY_DIMENSIONS[0].indicators[0];
  ui.setLevel(indicator.id, 3);
  ui.failStorage();
  ui.submit();
  assert.deepEqual(getState().learning.abilityAssessment, before);
  assert.equal(ui.control(`ability-answer-${indicator.id}`).value, "3");
  assert.match(ui.control("abilityAssessmentError").textContent, /未更新.*未能保存/);
  ui.consent(true);
  assert.equal(ui.control("abilitySaveConsent").checked, before.consent);
});

test("restoring the saved profile resets only unsubmitted drafts and uses Shanghai timestamps", (t) => {
  const answers = Object.fromEntries(ABILITY_DIMENSIONS.flatMap((dimension) => dimension.indicators.map((indicator) => [indicator.id, 2])));
  const scenarioAnswers = Object.fromEntries(ABILITY_DIMENSIONS.map((dimension) => [dimension.scenario.id, dimension.scenario.options.find((option) => option.level === 4).id]));
  const assessment = recordAbilityAssessment(normalizeAbilityAssessment(), { answers, scenarioAnswers }, { now: Date.parse("2025-10-13T02:15:00.000Z") });
  const ui = mount(t, assessment);
  const indicator = ABILITY_DIMENSIONS[0].indicators[0];
  ui.setLevel(indicator.id, 4);
  renderAbilityAssessment();
  resetAbilityAssessmentDrafts();
  renderAbilityAssessment();
  assert.equal(ui.control(`ability-answer-${indicator.id}`).value, "2");
  assert.equal(ui.control("abilityAssessmentEditor").open, false);
  assert.match(ui.panel.html, /2025\/10\/13 10:15/);
  assert.match(ui.panel.html, /上海时间/);
  assert.equal(getState().learning.abilityAssessment.history.length, 1);
});

test("expanding a dimension closes the previous one without rebuilding or changing form values", (t) => {
  const ui = mount(t);
  const indicator = ABILITY_DIMENSIONS[0].indicators[0];
  ui.setLevel(indicator.id, 3);
  const second = ui.panel.dimensions[1];
  second.open = true;
  second.dispatch("toggle");
  assert.equal(ui.panel.dimensions.filter((item) => item.open).length, 1);
  assert.equal(ui.panel.dimensions[0].open, false);
  assert.equal(ui.control(`ability-answer-${indicator.id}`).value, "3");
});
