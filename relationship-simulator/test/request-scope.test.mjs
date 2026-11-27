import test from "node:test";
import assert from "node:assert/strict";
import { createRequestScope } from "../public/modules/core/request-scope.js";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { runCoachFloatSearch } from "../public/modules/render/coach-float-search.js";
import { parseHerBubbles, joinHerReply } from "../public/modules/coach/her-reply.js";

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

test("关闭搜索只取消搜索通道，旧finish不影响重开的搜索或其它模型请求", () => {
  const scope = createRequestScope(() => "same");
  const chat = scope.begin("chat");
  const search = scope.begin("coach-search");
  scope.cancel("coach-search");
  assert.equal(search.signal.aborted, true);
  assert.equal(search.isCurrent(), false);
  assert.equal(chat.isCurrent(), true);
  const reopened = scope.begin("coach-search");
  search.finish();
  assert.equal(reopened.isCurrent(), true);
  scope.cancel("missing");
  assert.equal(chat.isCurrent(), true);
});

// 执行 app.js 的真实生成函数，用可控 Promise 模拟乱序响应，不调用任何模型。
const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

test("真实app搜索使用共享scope，关闭悬浮面板中断搜索但保留聊天请求", async () => {
  const scope = createRequestScope(() => "context");
  const chat = scope.begin("chat");
  const resultTarget = { innerHTML: "" };
  const panel = { innerHTML: "", classList: { toggle: () => true } };
  const controls = new Map([["coachFloatPanel", panel], ["stage", { value: "第一次邀约" }], ["coachFloatBtn", { classList: { toggle() {} } }]]);
  let complete, signal;
  const env = {
    state: { lastAnalysis: {} }, modelRequests: scope, $: (id) => controls.get(id),
    buildCoachFloatHtml: () => "", buildCoachFloatData: () => ({}),
    runCoachFloatSearchView: (options) => runCoachFloatSearch({ ...options, target: resultTarget,
      search: (_query, searchOptions) => { signal = searchOptions.signal; return new Promise((resolve) => { complete = resolve; }); }
    })
  };
  vm.createContext(env);
  vm.runInContext(source.slice(source.indexOf("function renderCoachFloat("), source.indexOf("function renderAnalysisPanel(")), env);
  const task = env.runCoachFloatSearch();
  env.toggleCoachFloat();
  assert.equal(signal.aborted, true);
  assert.equal(chat.isCurrent(), true);
  resultTarget.innerHTML = "closed panel";
  complete({ results: [{ title: "late", url: "https://apa.org/late" }], filtered: 0 });
  await task;
  assert.equal(resultTarget.innerHTML, "closed panel");
});
const dialogueFunctions = source.slice(source.indexOf("async function askAi("), source.indexOf("function renderDiffHtml("));
function mountGeneration() {
  let context = "old-conversation";
  const scope = createRequestScope(() => context);
  const pending = [];
  let commits = 0, fallbacks = 0, mutations = 0;
  const controls = new Map(["apiStatus", "endpoint", "apiKey", "generateHerBtn", "retryModelBtn", "nextBtn", "userInput"].map((name) => {
    // classList 要能真的记账：进行中状态是取消入口成立的前提，不能只是个空壳。
    const classes = new Set();
    return [name, {
      value: "", textContent: name, disabled: false,
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), has: (c) => classes.has(c) },
      focus() {}
    }];
  }));
  const env = {
    modelRequests: scope, STALE_RESULT: Symbol("stale"), isGenerating: false, MIMO_MODEL: "fake",
    HER_LANE: { thinking: { type: "disabled" }, maxCompletionTokens: 200 },
    COACH_LANE: { thinking: { type: "disabled" }, responseFormat: { type: "json_object" } },
    state: {}, $: (name) => controls.get(name), uiValues: () => ({}), isRelationshipStopped: () => false,
    savePersonaMemory() {}, appendMineIfNew() {}, afterChatRender() {},
    // 拆双角色后 askAi 走两次调用：先她的文本，再教练 JSON。
    buildGenerationContext: async () => ({ persona: { name: "她" }, memory: {}, messages: [], ui: {} }),
    buildHerMessages: () => [], buildCoachMessages: () => [],
    parseHerBubbles, joinHerReply, commitHerReply() {},
    resolveDeterministicReply: () => null,
    callLLM: (options) => new Promise((resolve, reject) => pending.push({ options, resolve, reject })),
    parseModelContent: () => ({ herReply: "synthetic reply" }),
    localAnalyze: () => ({ herReply: "local reply", coachScore: { total: 70 } }),
    commitAnalysis: (value) => { commits++; return value; },
    mutate: () => { mutations++; }, localFallback: () => { fallbacks++; return {}; },
    invalidatePreflight() {}, preflightRevision: 0, capturePreflightContext: () => context,
    // vm.createContext 给出的新上下文没有浏览器定时器；generateHerDialogue 用它显示已等秒数。
    setInterval: () => 1, clearInterval: () => {}
  };
  vm.createContext(env);
  vm.runInContext(dialogueFunctions, env);
  vm.runInContext(source.slice(source.indexOf("async function nextTurn("), source.indexOf("function exportSession(")), env);
  // 双调用序列的推进：结算一次调用，等下一次调用把 promise 排进 pending。
  const tick = () => new Promise(setImmediate);
  const settle = async (index, content) => { pending[index].resolve({ content }); await tick(); };
  return { env, pending, controls, scope, tick, settle, stats: () => ({ commits, fallbacks, mutations }), change: () => { context = "new-conversation"; scope.cancelAll(); }, bumpContext: () => { context = "with-her-reply"; } };
}

test("她的回复落盘改变会话上下文后，教练分析结果仍必须提交", async () => {
  // 回归：commitHerReply 会往 messages 追加一条，会话上下文随之变化。
  // 若教练调用沿用她的 ticket 做过期判断，结果回来必被判过期丢弃——整轮只剩她的回复。
  const ui = mountGeneration();
  ui.env.commitHerReply = () => ui.bumpContext();
  const task = ui.env.askAi({ silent: true });
  await ui.tick();
  await ui.settle(0, "早啊");
  await ui.settle(1, "{\"judgement\":\"ok\"}");
  const result = await task;
  assert.equal(ui.stats().commits, 1, "教练分析不能被自己刚落的回复判成过期");
  assert.equal(result.herReply, "早啊");
});

test("身份直问跳过角色模型生成，并将确定性回复来源标为本地", async () => {
  const ui = mountGeneration();
  const sources = [];
  ui.env.resolveDeterministicReply = () => ({ text: "我是 AI 模拟角色，不是真人。", source: "identity" });
  ui.env.commitHerReply = (_bubbles, source) => sources.push(source);
  const task = ui.env.askAi({ silent: true });
  await ui.tick();
  assert.deepEqual(sources, ["local"]);
  assert.equal(ui.pending.length, 1, "仅教练分析仍走模型，不应请求角色回复模型");
  await ui.settle(0, "{}");
  await task;
});

test("真实护栏接入 askAi：无依据的记忆追问不请求角色模型，只走教练通道", async () => {
  // 这里用真实的 resolveDeterministicReply，而不是 mock：
  // 目的是验证 app.js 的调用路径确实拿到护栏结果，而不是测试替身自说自话。
  const ui = mountGeneration();
  const committed = [];
  const { resolveDeterministicReply } = await import("../public/modules/core/api-client.js");
  ui.env.resolveDeterministicReply = resolveDeterministicReply;
  ui.env.buildGenerationContext = async () => ({
    persona: { name: "她" },
    memory: {},
    memorySource: {},
    messages: [{ type: "me", text: "你还记得我上周去了哪个城市吗？" }],
    ui: {}
  });
  ui.env.commitHerReply = (bubbles, source) => committed.push({ text: joinHerReply(bubbles), source });

  const task = ui.env.askAi({ silent: true });
  await ui.tick();
  assert.equal(ui.pending.length, 1, "只有教练通道应请求模型，角色通道被护栏短路");
  assert.equal(committed[0].source, "local");
  assert.match(committed[0].text, /没有可靠记录/);
  await ui.settle(0, "{}");
  await task;
});

test("两条通道各带自己的预算：她只要文本，教练要 JSON 且都关思考", async () => {
  // 混用会同时踩三个坑：开思考→角色每轮多等十几秒、教练多等几十秒甚至触发 504；
  // 不给教练开 JSON 模式→输出偶发不是合法 JSON，整轮 A/B/C 落到本地模板；
  // 给角色开 JSON 模式→她不再输出微信文本而是吐结构。
  const ui = mountGeneration();
  const task = ui.env.askAi({ silent: true });
  await ui.tick();
  await ui.settle(0, "早啊");
  await ui.settle(1, "{\"judgement\":\"ok\"}");
  await task;
  assert.deepEqual(ui.pending[0].options.thinking, { type: "disabled" }, "角色通道必须关思考");
  assert.equal(ui.pending[0].options.maxCompletionTokens, 200);
  assert.equal("responseFormat" in ui.pending[0].options, false, "角色通道输出纯文本，不能要 JSON 模式");
  assert.deepEqual(ui.pending[1].options.responseFormat, { type: "json_object" }, "教练通道必须开 JSON 模式");
  assert.deepEqual(ui.pending[1].options.thinking, { type: "disabled" }, "教练通道思考已由 A/B 实测判定为纯延迟代价");
});

test("取消提示必须区分「她已经回过一句」和「什么都没发生」", () => {
  const cases = [
    { messages: [{ type: "me", text: "周末有个画展" }], expect: "已取消本轮模型调用，没有写入任何内容。" },
    { messages: [{ type: "me", text: "周末有个画展" }, { type: "her", text: "哪个画展呀" }], expect: "已取消教练分析；她这一轮的回复已经落盘，保留在对话里。" },
    { messages: [], expect: "已取消本轮模型调用，没有写入任何内容。" }
  ];
  for (const testCase of cases) {
    const ui = mountGeneration();
    ui.env.state = { messages: testCase.messages };
    ui.env.cancelGeneration();
    // 角色通道先完成、教练通道还在跑时取消，说「都不会写入」是假话。
    assert.equal(ui.controls.get("apiStatus").textContent, testCase.expect);
  }
});

test("会话切换后旧模型成功或失败均不会写分析、错误或触发本地兜底", async () => {
  for (const fail of [false, true]) {
    const ui = mountGeneration();
    const task = ui.env.generateHerDialogue();
    await new Promise(setImmediate);
    ui.change();
    if (fail) ui.pending[0].reject(new Error("old failure"));
    else await ui.settle(0, "old reply");
    await task;
    assert.deepEqual(ui.stats(), { commits: 0, fallbacks: 0, mutations: 0 });
    assert.equal(ui.env.isGenerating, false);
  }
});

test("同会话两次 askAi 乱序返回时只提交后发请求", async () => {
  const ui = mountGeneration();
  const first = ui.env.askAi();
  await ui.tick();
  const second = ui.env.askAi();
  await ui.tick();
  // 先发请求（pending[0]）已过期；后发请求（pending[1] 她的回复 + pending[2] 教练分析）完整提交。
  await ui.settle(1, "new");
  await ui.settle(2, "{\"judgement\":\"new\"}");
  await second;
  ui.pending[0].resolve({ content: "old" });
  await first;
  assert.deepEqual(ui.stats(), { commits: 1, fallbacks: 0, mutations: 0 });
});

test("生成中的重复触发不启动请求，就地取消不兜底也不清空草稿", async () => {
  for (const firstMethod of ["generateHerDialogue", "nextTurn"]) {
    for (const fail of [false, true]) {
      const ui = mountGeneration();
      ui.controls.get("userInput").value = "kept draft";
      const task = ui.env[firstMethod]();
      await new Promise(setImmediate);
      // 锁的语义变了：generate 按钮不再 disabled，而是变成取消入口。
      // 防重复靠 isGenerating，不再靠「点不动」——所以这两条必须分开验。
      assert.equal(ui.controls.get("generateHerBtn").disabled, false, "生成按钮要能被点到，才能就地取消");
      assert.equal(ui.controls.get("generateHerBtn").classList.has("is-busy"), true, "必须显示进行中状态");
      for (const name of ["retryModelBtn", "nextBtn"]) assert.equal(ui.controls.get(name).disabled, true);
      await ui.env[firstMethod === "nextTurn" ? "generateHerDialogue" : "nextTurn"]();
      assert.equal(ui.pending.length, 1, "生成中再次触发不能启动第二个请求");
      assert.equal(ui.env.isGenerating, true);
      ui.env.cancelGeneration();
      ui.change();
      if (fail) ui.pending[0].reject(new Error("cancelled request"));
      else ui.pending[0].resolve({ content: "late reply" });
      await task;
      assert.deepEqual(ui.stats(), { commits: 0, fallbacks: 0, mutations: 0 }, "取消后不得提交分析、不得走本地兜底");
      assert.equal(ui.controls.get("userInput").value, "kept draft", "取消不能吞掉用户草稿");
      assert.equal(ui.env.isGenerating, false);
      for (const name of ["generateHerBtn", "retryModelBtn", "nextBtn"]) assert.equal(ui.controls.get(name).disabled, false);
      assert.equal(ui.controls.get("generateHerBtn").classList.has("is-busy"), false, "结束后必须解除进行中状态");
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
    else {
      // 双调用成功才算一轮完成：她的回复 + 教练分析都返回。
      await ui.settle(0, "reply");
      await ui.settle(1, "{\"judgement\":\"ok\"}");
    }
    await task;
    assert.equal(ui.stats().fallbacks, 0);
    assert.equal(ui.stats().commits, fail ? 0 : 1);
    assert.equal(ui.controls.get("userInput").value, fail ? "kept draft" : "");
  }
});

test("教练分析失败时保留已生成的她的回复，只用本地评估补分析", async () => {
  const ui = mountGeneration();
  const task = ui.env.askAi({ silent: true });
  await ui.tick();
  await ui.settle(0, "哈哈确实\\那我明天问你");
  ui.pending[1].reject(new Error("coach down"));
  const result = await task;
  assert.equal(ui.stats().commits, 1, "不回退到本地整轮兜底");
  assert.equal(ui.stats().fallbacks, 0);
  assert.equal(result.coachScore.total, 70, "教练字段由本地评估补齐");
  assert.equal(result.herReply, "哈哈确实 那我明天问你", "她的模型回复不被本地模板覆盖");
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
    renderAnalysisPanel() {}, renderActionPlan() {}, renderScenarioList() {}, renderIntelligencePanel() {}, renderMemoryPanel() {}, renderAbilityAssessment() {}
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
