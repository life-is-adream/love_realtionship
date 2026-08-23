import test from "node:test";
import assert from "node:assert/strict";
import { createRelationshipIntelligenceController } from "../public/modules/intelligence/controller.js";
import { normalizeRelationshipIntelligenceState } from "../public/modules/intelligence/state.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function harness(analyze) {
  const appState = {
    messages: [{ type: "me", text: "你好" }],
    relationshipIntelligence: normalizeRelationshipIntelligenceState({
      caseId: "case_0123456789abcdef"
    })
  };
  const renders = [];
  let saves = 0;
  const controller = createRelationshipIntelligenceController({
    getAppState: () => appState,
    saveAppState: () => { saves += 1; },
    getGoal: () => "自然聊天",
    analyze,
    render: (value) => renders.push(value)
  });
  return { appState, controller, renders, get saves() { return saves; } };
}

test("刷新会构建请求、写入有界结果并保存", async () => {
  const requests = [];
  const h = harness(async (request) => {
    requests.push(request);
    return { version: 1, decision: { value: "OBSERVE" }, memoryPatch: null };
  });

  await h.controller.refresh();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].goal, "自然聊天");
  assert.equal(requests[0].consent, false);
  assert.equal(h.appState.relationshipIntelligence.status, "ready");
  assert.equal(h.appState.relationshipIntelligence.lastResult.decision.value, "OBSERVE");
  assert.equal(h.saves, 1);
  assert.equal(h.renders.at(-1).status, "ready");
});

test("较旧的慢请求不能覆盖较新的分析结果", async () => {
  const first = deferred();
  const second = deferred();
  let call = 0;
  const h = harness(() => (++call === 1 ? first.promise : second.promise));

  const older = h.controller.refresh();
  const newer = h.controller.refresh();
  second.resolve({ version: 1, decision: { value: "MAINTAIN" }, memoryPatch: null });
  await newer;
  first.resolve({ version: 1, decision: { value: "ADVANCE" }, memoryPatch: null });
  await older;

  assert.equal(h.appState.relationshipIntelligence.lastResult.decision.value, "MAINTAIN");
  assert.equal(h.saves, 1);
});

test("运行时错误只更新独立面板状态，不向外抛出", async () => {
  const h = harness(async () => { throw new Error("本地服务未启动"); });

  const result = await h.controller.refresh();

  assert.equal(result, null);
  assert.equal(h.appState.relationshipIntelligence.status, "error");
  assert.equal(h.appState.relationshipIntelligence.lastError, "本地服务未启动");
  assert.equal(h.saves, 0);
});

test("同意切换与会话重置由控制器统一处理", () => {
  const h = harness(async () => ({ version: 1, decision: { value: "OBSERVE" }, memoryPatch: null }));

  h.controller.setConsent(true);
  assert.equal(h.appState.relationshipIntelligence.consent, true);
  h.appState.relationshipIntelligence.memory = { currentState: "INITIAL_CONTACT" };
  h.controller.setConsent(false);
  assert.equal(h.appState.relationshipIntelligence.memory, null);
  const oldCaseId = h.appState.relationshipIntelligence.caseId;
  h.controller.reset(new Uint8Array(8).fill(2));
  assert.equal(h.appState.relationshipIntelligence.caseId, "case_0202020202020202");
  assert.notEqual(h.appState.relationshipIntelligence.caseId, oldCaseId);
  assert.equal(h.saves, 3);
});
