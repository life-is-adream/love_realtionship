import test from "node:test";
import assert from "node:assert/strict";
import { appendObservation, createMemory, grantConsent, recordOutcome, summarizeMemory } from "./memory-store.mjs";

test("requires an anonymous case id and starts without persistence consent", () => {
  const memory = createMemory({ caseId: "case_001", goal: "判断下一步" });
  assert.equal(memory.consent.granted, false);
  assert.equal(memory.privacy.rawChatRetained, false);
  assert.throws(() => createMemory({ caseId: "张三" }), /anonymous case/);
});

test("does not write observations without consent", () => {
  const memory = createMemory({ caseId: "case_002" });
  const next = appendObservation(memory, { id: "obs_1", summary: "对方提出了替代时间" });
  assert.equal(next.observations.length, 0);
});

test("stores only bounded, redacted observations after consent", () => {
  const memory = grantConsent(createMemory({ caseId: "case_003" }), { scope: "case learning" });
  const next = appendObservation(memory, {
    id: "obs_1",
    kind: "counteroffer",
    summary: "对方提出周日下午，联系方式 13800138000",
    evidenceIds: ["conversation_evidence_4"],
    recordedAt: "2026-08-10T08:00:00+08:00"
  });
  assert.equal(next.observations.length, 1);
  assert.match(next.observations[0].summary, /redacted/);
  assert.equal(next.timeline.length, 1);
  assert.equal(next.privacy.thirdPartyIdentifiers, false);
});

test("rejects summaries that try to persist explicitly sensitive fields", () => {
  const memory = grantConsent(createMemory({ caseId: "case_003b" }), true);
  const next = appendObservation(memory, { id: "obs_sensitive", summary: "姓名和微信号不应进入长期记忆" });
  assert.equal(next.observations.length, 0);
});

test("records prediction outcome and lessons without mutating input", () => {
  const memory = grantConsent(createMemory({ caseId: "case_004" }), true);
  const next = recordOutcome(memory, {
    id: "outcome_1",
    prediction: "一次低压力邀约后观察是否出现替代安排",
    observedOutcome: "对方未能赴约，但之后主动说明了新的时间",
    update: "保留互惠假设，降低对回复速度的权重",
    lessons: ["先看具体安排，不用猜测动机"],
    recordedAt: "2026-08-10T08:30:00+08:00"
  });
  assert.equal(memory.outcomes.length, 0);
  assert.equal(next.outcomes.length, 1);
  assert.equal(next.lessons.length, 1);
  assert.equal(summarizeMemory(next).outcomeCount, 1);
});
