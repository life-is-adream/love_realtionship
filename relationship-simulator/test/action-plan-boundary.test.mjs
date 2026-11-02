import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { getState, setState } from "../public/modules/core/state.js";
import { renderActionPlan, renderPlanCard } from "../public/modules/render/render-coach.js";

test("本地关系已退出时，长期路线和迟到模型计划不再展示推进建议", (t) => {
  const priorDocument = globalThis.document;
  const priorState = structuredClone(getState());
  t.after(() => { globalThis.document = priorDocument; setState(priorState); });
  const panel = { innerHTML: "" }, button = { disabled: false };
  globalThis.document = { getElementById: (id) => id === "planPanel" ? panel : id === "planBtn" ? button : null };
  setState({ ...priorState, relationshipIntelligence: { ...priorState.relationshipIntelligence,
    lastResult: { decision: { value: "EXIT" }, state: { to: "EXIT" } }
  } });
  renderActionPlan();
  assert.match(panel.innerHTML, /停止推进/);
  assert.equal(button.disabled, true);
  renderPlanCard({ title: "stale invitation plan", steps: [], topics: [], decisionRules: [] });
  assert.doesNotMatch(panel.innerHTML, /stale invitation plan/);
});

test("真实app计划入口在已退出关系上不启动上游请求", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  let calls = 0, rendered = 0, cancelled = 0;
  const status = { textContent: "" };
  const env = {
    state: { messages: [], relationshipIntelligence: { lastResult: { decision: { value: "EXIT" } } } },
    modelRequests: { begin: () => ({ signal: new AbortController().signal, isCurrent: () => true, finish() {} }), cancel: () => { cancelled++; } },
    isRelationshipStopped: () => true, renderActionPlan: () => { rendered++; },
    getCurrentPersona: () => ({}), getPersonaMemory: () => ({}), buildActionPlan: () => ({}), uiValues: () => ({}),
    renderPlanCard() {}, buildActionPlanPrompt: () => "", normalizeActionPlan: () => ({}),
    $: () => status, MIMO_MODEL: "synthetic", callLLM: async () => { calls++; return { content: "{}" }; }
  };
  vm.createContext(env);
  vm.runInContext(source.slice(source.indexOf("async function generateActionPlan("), source.indexOf("async function checkHealth(")), env);
  await env.generateActionPlan();
  assert.equal(calls, 0);
  assert.equal(rendered, 1);
  assert.equal(cancelled, 1);
});
