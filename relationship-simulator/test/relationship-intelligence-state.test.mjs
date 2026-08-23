import test from "node:test";
import assert from "node:assert/strict";
import {
  applyRelationshipIntelligenceResult,
  buildRelationshipIntelligenceRequest,
  normalizeRelationshipIntelligenceState,
  resetRelationshipIntelligenceSession,
  setRelationshipIntelligenceConsent,
  toPersistedRelationshipIntelligenceState
} from "../public/modules/intelligence/state.js";
import { normalizeState, serializeStateForStorage } from "../public/modules/core/state.js";

test("Relationship Intelligence 默认关闭长期记忆并生成匿名 caseId", () => {
  const state = normalizeRelationshipIntelligenceState(null);

  assert.equal(state.consent, false);
  assert.match(state.caseId, /^case_[a-f0-9]{16}$/);
  assert.equal(state.memory, null);
  assert.equal(state.lastResult, null);
  assert.equal(state.status, "idle");
});

test("撤回同意会清除匿名 memory，但保留当前页面的分析结果", () => {
  const current = normalizeRelationshipIntelligenceState({
    consent: true,
    caseId: "case_0123456789abcdef",
    memory: { version: 1, caseId: "case_0123456789abcdef" },
    lastResult: { decision: { value: "OBSERVE" } }
  });

  const revoked = setRelationshipIntelligenceConsent(current, false);

  assert.equal(revoked.consent, false);
  assert.equal(revoked.memory, null);
  assert.equal(revoked.lastResult.decision.value, "OBSERVE");
});

test("未同意时持久化副本移除 memory 和当前分析结果", () => {
  const current = normalizeRelationshipIntelligenceState({
    consent: false,
    caseId: "case_0123456789abcdef",
    memory: { shouldNotPersist: true },
    lastResult: { decision: { value: "OBSERVE" } },
    lastError: ""
  });

  const persisted = toPersistedRelationshipIntelligenceState(current);

  assert.equal(persisted.memory, null);
  assert.equal(persisted.lastResult, null);
  assert.equal(persisted.status, "idle");
});

test("启用同意后构建请求会带匿名 memory，且不会带 apiKey", () => {
  const intelligence = normalizeRelationshipIntelligenceState({
    consent: true,
    caseId: "case_0123456789abcdef",
    memory: { currentState: "INITIAL_CONTACT" }
  });
  const request = buildRelationshipIntelligenceRequest({
    messages: [{ type: "me", text: "你好", createdAt: "2026-08-20T08:00:00Z" }],
    goal: "自然聊天",
    intelligence,
    apiKey: "must-not-leak"
  });

  assert.equal(request.consent, true);
  assert.equal(request.caseId, "case_0123456789abcdef");
  assert.equal(request.memory.currentState, "INITIAL_CONTACT");
  assert.equal(Object.hasOwn(request, "apiKey"), false);
  assert.equal(request.messages[0].text, "你好");
});

test("运行结果只在同意时接纳 memory patch", () => {
  const result = {
    version: 1,
    decision: { value: "OBSERVE" },
    memoryPatch: { currentState: "INITIAL_CONTACT" }
  };
  const withoutConsent = applyRelationshipIntelligenceResult(
    normalizeRelationshipIntelligenceState({ consent: false }),
    result
  );
  const withConsent = applyRelationshipIntelligenceResult(
    normalizeRelationshipIntelligenceState({ consent: true }),
    result
  );

  assert.equal(withoutConsent.memory, null);
  assert.equal(withConsent.memory.currentState, "INITIAL_CONTACT");
  assert.equal(withoutConsent.lastResult.decision.value, "OBSERVE");
});

test("重置会话会生成新 caseId 并清空分析，同时保留同意偏好", () => {
  const current = normalizeRelationshipIntelligenceState({
    consent: true,
    caseId: "case_0123456789abcdef",
    memory: { currentState: "INITIAL_CONTACT" },
    lastResult: { decision: { value: "OBSERVE" } }
  });

  const reset = resetRelationshipIntelligenceSession(current, new Uint8Array(8).fill(1));

  assert.equal(reset.consent, true);
  assert.equal(reset.caseId, "case_0101010101010101");
  assert.notEqual(reset.caseId, current.caseId);
  assert.equal(reset.memory, null);
  assert.equal(reset.lastResult, null);
});

test("应用总状态持久化时执行 Relationship Intelligence 隐私裁剪", () => {
  const current = normalizeState({
    personaMemory: {
      lin: {
        background: "手工填写的角色背景",
        _enhanced: { summaries: ["旧版自动提取内容"] }
      }
    },
    relationshipIntelligence: {
      consent: false,
      caseId: "case_0123456789abcdef",
      lastResult: { decision: { value: "OBSERVE" } }
    }
  });
  const persisted = serializeStateForStorage(current);

  assert.equal(current.relationshipIntelligence.lastResult.decision.value, "OBSERVE");
  assert.equal(persisted.relationshipIntelligence.lastResult, null);
  assert.equal(current.personaMemory.lin._enhanced.summaries.length, 1);
  assert.equal(Object.hasOwn(persisted.personaMemory.lin, "_enhanced"), false);
  assert.equal(persisted.personaMemory.lin.background, "手工填写的角色背景");
});
