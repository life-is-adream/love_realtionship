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

test("恢复期间仅失效旧请求，旧成功或错误都不能改写恢复档案及记忆同意", async () => {
  for (const outcome of ["resolve", "reject"]) {
    const delayed = deferred();
    let appState = {
      messages: [{ type: "me", text: "合成旧会话" }],
      relationshipIntelligence: normalizeRelationshipIntelligenceState({ consent: true, memory: { currentState: "INITIAL_CONTACT" } })
    };
    let reads = 0;
    let saves = 0;
    let renders = 0;
    let requests = 0;
    const controller = createRelationshipIntelligenceController({
      getAppState: () => { reads += 1; return appState; },
      saveAppState: () => { saves += 1; },
      render: () => { renders += 1; },
      analyze: () => ++requests === 1 ? delayed.promise : Promise.resolve({ version: 1, decision: { value: "OBSERVE" }, memoryPatch: null })
    });
    const pending = controller.refresh();
    // 模拟成功恢复后 loadState 替换整个应用对象；不访问真实存储或聊天。
    appState = {
      messages: [{ type: "me", text: "合成已恢复会话" }],
      relationshipIntelligence: normalizeRelationshipIntelligenceState({ consent: false, lastResult: { version: 1, decision: { value: "OBSERVE" } } })
    };
    const restored = structuredClone(appState);
    const beforeCancel = { reads, saves, renders };
    controller.cancelPending();
    assert.deepEqual({ reads, saves, renders }, beforeCancel, "取消待处理请求必须没有读取、持久化或渲染副作用");
    assert.deepEqual(appState, restored);
    if (outcome === "resolve") delayed.resolve({ version: 1, decision: { value: "ADVANCE" }, memoryPatch: { currentState: "GROWING_INTEREST" } });
    else delayed.reject(new Error("合成旧请求错误"));
    assert.equal(await pending, null);
    assert.deepEqual(appState, restored, "旧成功结果和错误都不能覆盖恢复内容");
    assert.equal(appState.relationshipIntelligence.consent, false);
    assert.equal(appState.relationshipIntelligence.memory, null);
    assert.equal(saves, 0);
    assert.equal(renders, beforeCancel.renders);
    // 失效旧请求不会禁用后续的正常分析。
    await controller.refresh();
    assert.equal(appState.relationshipIntelligence.consent, false);
    assert.equal(appState.relationshipIntelligence.lastResult.decision.value, "OBSERVE");
    assert.equal(saves, 1);
  }
});
