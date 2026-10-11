import test from "node:test";
import assert from "node:assert/strict";
import { createRequestScope } from "../public/modules/core/request-scope.js";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("同一通道的后发请求取代先发请求，旧 finish 不影响新任务", () => {
  const scope = createRequestScope(() => "context");
  const a = scope.begin("chat");
  const b = scope.begin("chat");
  assert.equal(a.signal.aborted, true);
  a.finish();
  assert.equal(b.isCurrent(), true);
  b.finish();
  assert.equal(b.isCurrent(), false);
});

test("上下文变化使结果过期；显式取消即使切换回相同内容也不复活", () => {
  let context = "first";
  const scope = createRequestScope(() => context);
  const ticket = scope.begin("plan");
  context = "other";
  assert.equal(ticket.isCurrent(), false);
  scope.cancelAll();
  context = "first";
  assert.equal(ticket.isCurrent(), false);
  assert.equal(ticket.signal.aborted, true);
});

test("不同功能可以独立工作，cancelAll 一次取消全部", () => {
  const scope = createRequestScope(() => "same");
  const a = scope.begin("plan");
  const b = scope.begin("preflight");
  assert.equal(a.isCurrent(), true);
  assert.equal(b.isCurrent(), true);
  scope.cancelAll();
  assert.equal(a.signal.aborted && b.signal.aborted, true);
});

// 执行 app.js 的真实生成函数，用可控 Promise 模拟乱序响应，不调用任何模型。
const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const dialogueFunctions = source.slice(source.indexOf("async function askAi("), source.indexOf("function renderDiffHtml("));
function mountGeneration() {
  let context = "old-conversation";
  const scope = createRequestScope(() => context);
  const pending = [];
  let commits = 0, fallbacks = 0, mutations = 0;
  const controls = new Map(["apiStatus", "endpoint", "apiKey", "generateHerBtn", "retryModelBtn", "nextBtn", "userInput"].map((name) => [name, {
    value: "", textContent: name, disabled: false, classList: { add() {}, remove() {} }, focus() {}
  }]));
  const env = {
    modelRequests: scope, STALE_RESULT: Symbol("stale"), isGenerating: false, MIMO_MODEL: "fake",
    state: {}, $: (name) => controls.get(name), uiValues: () => ({}),
    savePersonaMemory() {}, appendMineIfNew() {}, afterChatRender() {}, buildMessages: async () => [],
    callLLM: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    parseModelContent: () => ({ herReply: "synthetic reply" }),
    commitAnalysis: (value) => { commits++; return value; },
    mutate: () => { mutations++; }, localFallback: () => { fallbacks++; return {}; },
    invalidatePreflight() {}, preflightRevision: 0, capturePreflightContext: () => context
  };
  vm.createContext(env);
  vm.runInContext(dialogueFunctions, env);
  vm.runInContext(source.slice(source.indexOf("async function nextTurn("), source.indexOf("function exportSession(")), env);
  return { env, pending, controls, scope, stats: () => ({ commits, fallbacks, mutations }), change: () => { context = "new-conversation"; scope.cancelAll(); } };
}

test("会话切换后旧模型成功或失败均不会写分析、错误或触发本地兜底", async () => {
  for (const fail of [false, true]) {
    const ui = mountGeneration();
    const task = ui.env.generateHerDialogue();
    await new Promise(setImmediate);
    ui.change();
    if (fail) ui.pending[0].reject(new Error("old failure"));
    else ui.pending[0].resolve({ content: "old reply" });
    await task;
    assert.deepEqual(ui.stats(), { commits: 0, fallbacks: 0, mutations: 0 });
    assert.equal(ui.env.isGenerating, false);
  }
});

test("同会话两次 askAi 乱序返回时只提交后发请求", async () => {
  const ui = mountGeneration();
  const first = ui.env.askAi();
  await new Promise(setImmediate);
  const second = ui.env.askAi();
  await new Promise(setImmediate);
  ui.pending[1].resolve({ content: "new" });
  await second;
  ui.pending[0].resolve({ content: "old" });
  await first;
  assert.deepEqual(ui.stats(), { commits: 1, fallbacks: 0, mutations: 0 });
});

test("生成和然后共享按钮锁，重复触发不启动请求，取消不会兜底或清空草稿", async () => {
  for (const firstMethod of ["generateHerDialogue", "nextTurn"]) {
    for (const fail of [false, true]) {
      const ui = mountGeneration();
      ui.controls.get("userInput").value = "kept draft";
      const task = ui.env[firstMethod]();
      await new Promise(setImmediate);
      for (const name of ["generateHerBtn", "retryModelBtn", "nextBtn"]) assert.equal(ui.controls.get(name).disabled, true);
      await ui.env[firstMethod === "nextTurn" ? "generateHerDialogue" : "nextTurn"]();
      assert.equal(ui.pending.length, 1);
      assert.equal(ui.env.isGenerating, true);
      ui.change();
      if (fail) ui.pending[0].reject(new Error("cancelled request"));
      else ui.pending[0].resolve({ content: "late reply" });
      await task;
      assert.deepEqual(ui.stats(), { commits: 0, fallbacks: 0, mutations: 0 });
      assert.equal(ui.controls.get("userInput").value, "kept draft");
      assert.equal(ui.env.isGenerating, false);
      for (const name of ["generateHerBtn", "retryModelBtn", "nextBtn"]) assert.equal(ui.controls.get(name).disabled, false);
    }
  }
});

test("然后只有成功时清空草稿，调用失败保留输入且不使用本地兜底", async () => {
  for (const fail of [false, true]) {
    const ui = mountGeneration();
    ui.controls.get("userInput").value = "kept draft";
    const task = ui.env.nextTurn();
    await new Promise(setImmediate);
    if (fail) ui.pending[0].reject(new Error("synthetic failure"));
    else ui.pending[0].resolve({ content: "reply" });
    await task;
    assert.equal(ui.stats().fallbacks, 0);
    assert.equal(ui.stats().commits, fail ? 0 : 1);
    assert.equal(ui.controls.get("userInput").value, fail ? "kept draft" : "");
  }
});

test("输入或会话变化后，消息优化和行动计划不覆盖新页面", async () => {
  const functions = source.slice(source.indexOf("async function preflightReply("), source.indexOf("async function checkHealth("));
  for (const method of ["preflightReply", "generateActionPlan"]) {
    for (const fail of [false, true]) {
      const ui = mountGeneration();
      let rendered = 0;
      ui.env.state.messages = [];
      for (const name of ["userInput", "preflightPanel", "stage", "goal"]) ui.controls.set(name, { value: "synthetic input" });
      Object.assign(ui.env, {
        getCurrentPersona: () => ({ name: "synthetic persona" }), getPersonaMemory: () => ({}),
        buildCoachScore: () => ({}), detectReplyFlags: () => ({}), collectPreflightMistake() {},
        buildLocalOptimizations: () => ({}), buildActionPlan: () => ({}),
        renderPreflightPanel: () => rendered++, renderPlanCard: () => rendered++,
        buildOptimizerPrompt: () => ({}), buildActionPlanPrompt: () => "", normalizeOptimizationResult: () => ({}),
        extractJsonObject: (value) => value
      });
      vm.runInContext(functions, ui.env);
      const task = ui.env[method]();
      await new Promise(setImmediate);
      assert.equal(rendered, 1);
      ui.change();
      ui.controls.get("apiStatus").textContent = "new page status";
      if (fail) ui.pending[0].reject(new Error("old request failed"));
      else ui.pending[0].resolve({ content: "{}" });
      await task;
      assert.equal(rendered, 1);
      assert.equal(ui.controls.get("apiStatus").textContent, "new page status");
    }
  }
});

function mountPreflight() {
  function element(value = "") {
    const listeners = new Map();
    return { value, textContent: "", disabled: false, focus() {},
      addEventListener(name, handler) {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(handler);
      },
      dispatch(name) { for (const handler of listeners.get(name) || []) handler(); }
    };
  }
  const controls = new Map(["userInput", "stage", "goal", "styleBias", "sincerity", "toneIntensity", "endpoint", "apiKey", "apiStatus", "memoryBackground", "memoryInterests", "memoryBoundaries"].map((name) => [name, element()]));
  controls.get("userInput").value = "original draft";
  controls.get("stage").value = "initial stage";
  controls.get("goal").value = "initial goal";
  const panel = { html: "", buttons: [],
    get innerHTML() { return this.html; },
    set innerHTML(value) {
      this.html = value;
      this.buttons = value.includes("data-optimizer-variant") ? ["lowPressure", "proactive"].map((variant) => ({ ...element(), dataset: { optimizerVariant: variant } })) : [];
    },
    querySelectorAll() { return this.buttons; }
  };
  controls.set("preflightPanel", panel);
  const pending = [];
  const optimization = (source) => ({ source, lowPressure: { text: `${source} low pressure` }, proactive: { text: `${source} proactive` } });
  const env = {
    state: { personaId: "synthetic", messages: [], personaMemory: {}, relationshipIntelligence: { consent: false } },
    preflightRevision: 0, currentPreflightContext: null, MIMO_MODEL: "fake", $: (name) => controls.get(name),
    getCurrentPersona: () => ({ id: env.state.personaId, name: "synthetic persona" }), getPersonaMemory: () => ({}),
    buildCoachScore: () => ({ total: 70 }), detectReplyFlags: () => ({}), collectPreflightMistake() {},
    buildLocalOptimizations: () => optimization("local"), normalizeOptimizationResult: () => optimization("model"),
    buildOptimizerPrompt: () => ({}), escapeHtml: (value) => String(value || ""), renderDiffHtml: () => "", renderTiming() {},
    callLLM: ({ signal }) => new Promise((resolve, reject) => pending.push({ resolve, reject, signal })),
    renderStageProgress() {}, renderPersonaControls() {}, renderCoachFloat() {}, renderChat() {}, afterChatRender() {},
    renderAnalysisPanel() {}, renderActionPlan() {}, renderScenarioList() {}, renderIntelligencePanel() {}
  };
  vm.createContext(env);
  vm.runInContext(source.slice(source.indexOf("function uiValues("), source.indexOf("function afterChatRender(")), env);
  vm.runInContext(source.slice(source.indexOf("function capturePreflightContext("), source.indexOf("function normalizeActionPlan(")), env);
  vm.runInContext(source.slice(source.indexOf("function renderAll("), source.indexOf("function addTrainingLog(")), env);
  const listenersStart = source.indexOf('for (const id of ["userInput"');
  vm.runInContext(source.slice(listenersStart, source.indexOf('$("stage")?.addEventListener("change", () => { renderTiming();', listenersStart)), env);
  env.modelRequests = createRequestScope(() => env.capturePreflightContext());
  return { env, controls, panel, pending };
}

test("优化完成或仍在请求时编辑草稿会立即清空旧面板，改回原文不能复活采用按钮", async () => {
  for (const completed of [false, true]) {
    const ui = mountPreflight();
    const task = ui.env.preflightReply();
    if (completed) { ui.pending[0].resolve({ content: "synthetic optimization" }); await task; }
    const staleButton = ui.panel.buttons[0];
    ui.controls.get("userInput").value = "edited draft";
    ui.controls.get("userInput").dispatch("input");
    assert.equal(ui.panel.innerHTML, "");
    assert.equal(staleButton.disabled, true);
    ui.controls.get("userInput").value = "original draft";
    ui.controls.get("userInput").dispatch("input");
    staleButton.dispatch("click");
    assert.equal(ui.controls.get("userInput").value, "original draft");
    if (!completed) {
      assert.equal(ui.pending[0].signal.aborted, true);
      ui.pending[0].resolve({ content: "late optimization" });
      await task;
      assert.equal(ui.panel.innerHTML, "");
    }
  }
});

test("角色、消息、记忆、阶段、目标和同意状态变化后旧优化失效，恢复相同上下文也不能采用", async () => {
  const changes = [
    (ui) => { ui.env.state.personaId = "other-persona"; },
    (ui) => { ui.env.state.messages.push({ type: "her", text: "new message" }); },
    (ui) => { ui.env.state.personaMemory.synthetic = { boundaries: "new boundary" }; },
    (ui) => { ui.controls.get("stage").value = "other stage"; },
    (ui) => { ui.controls.get("goal").value = "other goal"; },
    (ui) => { ui.env.state.relationshipIntelligence.consent = true; },
    (ui) => { ui.env.state.trainingMode = "pua"; }
  ];
  for (const change of changes) {
    const ui = mountPreflight();
    const originalState = structuredClone(ui.env.state);
    const task = ui.env.preflightReply();
    ui.pending[0].resolve({ content: "synthetic optimization" });
    await task;
    const staleButton = ui.panel.buttons[0];
    change(ui);
    ui.env.renderAll();
    assert.equal(ui.panel.innerHTML, "");
    ui.env.state = originalState;
    ui.controls.get("stage").value = "initial stage";
    ui.controls.get("goal").value = "initial goal";
    ui.env.renderAll();
    staleButton.dispatch("click");
    assert.equal(ui.controls.get("userInput").value, "original draft");
  }
});

test("采用本地优化会取消仍在运行的增强请求，旧结果不能再次覆盖输入或面板", async () => {
  const ui = mountPreflight();
  const task = ui.env.preflightReply();
  ui.panel.buttons[0].dispatch("click");
  assert.equal(ui.controls.get("userInput").value, "local low pressure");
  assert.equal(ui.pending[0].signal.aborted, true);
  assert.equal(ui.panel.innerHTML, "");
  ui.pending[0].resolve({ content: "late optimization" });
  await task;
  assert.equal(ui.controls.get("userInput").value, "local low pressure");
  assert.equal(ui.panel.innerHTML, "");
});

test("采用时再次检查原文和上下文；当前模型优化可以采用，过期优化不能覆盖输入", async () => {
  for (const change of [null, "userInput", "stage", "goal"]) {
    const ui = mountPreflight();
    const task = ui.env.preflightReply();
    ui.pending[0].resolve({ content: "synthetic optimization" });
    await task;
    if (change) ui.controls.get(change).value = "changed without input event";
    const expectedInput = change ? ui.controls.get("userInput").value : "model low pressure";
    ui.panel.buttons[0].dispatch("click");
    assert.equal(ui.controls.get("userInput").value, expectedInput);
    assert.equal(ui.panel.innerHTML, "");
  }
});

test("相同原文重新优化后旧采用按钮不能清除新面板或覆盖输入", async () => {
  const ui = mountPreflight();
  const first = ui.env.preflightReply();
  const staleButton = ui.panel.buttons[0];
  const second = ui.env.preflightReply();
  staleButton.dispatch("click");
  assert.notEqual(ui.panel.innerHTML, "");
  assert.equal(ui.controls.get("userInput").value, "original draft");
  ui.pending[1].resolve({ content: "new optimization" });
  await second;
  ui.pending[0].resolve({ content: "old optimization" });
  await first;
  assert.equal(ui.panel.innerHTML.includes("model low pressure"), true);
});

test("教材练习关闭后，迟到成功或失败不写入替换后的弹窗", async () => {
  const intervention = await readFile(new URL("../public/modules/render/render-intervention.js", import.meta.url), "utf8");
  const submit = intervention.slice(intervention.indexOf("async function submitIntervention("), intervention.indexOf("export function renderInterventionComparison("));
  for (const fail of [false, true]) {
    let resolve, reject, rendered = 0;
    const controls = new Map(["interventionInput", "submitInterventionBtn", "interventionResult", "endpoint", "apiKey"].map((name) => [name, { value: "synthetic input", innerHTML: "new modal", style: {} }]));
    const env = {
      interventionContext: { reviewPointId: "one", precedingDialogue: [] },
      $: (name) => controls.get(name), DEFAULT_MODEL: "fake", builtInPersonas: { zi: {} },
      buildInterventionPrompt: () => "", callLLM: () => new Promise((yes, no) => { resolve = yes; reject = no; }),
      renderInterventionComparison: () => rendered++, escapeHtml: (value) => value
    };
    env.reactionRequests = createRequestScope(() => env.interventionContext?.reviewPointId);
    vm.createContext(env);
    vm.runInContext(submit, env);
    const task = env.submitIntervention();
    env.reactionRequests.cancelAll();
    env.interventionContext = { reviewPointId: "two" };
    if (fail) reject(new Error("late failure"));
    else resolve({ content: "late answer" });
    await task;
    assert.equal(rendered, 0);
    assert.equal(controls.get("interventionResult").innerHTML, "new modal");
  }
});
