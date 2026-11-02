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
  assert.equal(next.privacy.thirdPartyIdentifiers, null);
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

test("rejects contact identifiers and filters unsafe evidence ids", () => {
  const memory = createMemory({ caseId: "case_id_audit", consent: true });
  for (const id of ["synthetic@example.invalid", "obs_13800000000", "obs_微信号_demo", "obs_wechat_demo"]) {
    assert.equal(appendObservation(memory, { id, summary: "出现新的可观察安排" }).observations.length, 0);
  }
  const next = appendObservation(memory, {
    id: "obs_safe",
    summary: "出现新的可观察安排",
    evidenceIds: ["conversation_evidence_1", "synthetic@example.invalid", "evidence_13800000000", "微信号_demo"]
  });
  assert.deepEqual(next.observations[0].evidenceIds, ["conversation_evidence_1"]);
  assert.throws(() => createMemory({ caseId: "case_13800000000" }), /anonymous case/);
});

test("preserves generated hexadecimal case and loop identifiers", () => {
  const memory = createMemory({ caseId: "case_0123456789012345", consent: true });
  const id = `loop_${"0123456789abcdef".repeat(4)}`;
  const next = appendObservation(memory, { id, summary: "仅有结构化观察" });
  assert.equal(next.observations[0].id, id);
  assert.equal(next.timeline[0].id, `timeline_${id}`);
});

test("applies the privacy rules to outcome ids, updates and lessons", () => {
  const memory = createMemory({ caseId: "case_outcome_audit", consent: true });
  assert.equal(recordOutcome(memory, {
    id: "synthetic@example.invalid", prediction: "观察安排", observedOutcome: "出现替代时间"
  }).outcomes.length, 0);
  const next = recordOutcome(memory, {
    id: "outcome_safe", prediction: "观察安排", observedOutcome: "出现替代时间",
    update: "微信号：wx_synthetic_contact",
    lessons: ["姓名：合成占位甲", "不猜测动机", "联系 synthetic@example.invalid"]
  });
  assert.equal(next.outcomes[0].update, "");
  assert.equal(next.lessons.length, 2);
  assert.doesNotMatch(JSON.stringify(next), /wx_synthetic_contact|合成占位甲|synthetic@example\.invalid/);
});

test("redacts all free-text fields and makes limited anonymization explicit", () => {
  let memory = createMemory({ caseId: "case_text_audit", consent: { granted: true, scope: "姓名：合成占位甲" }, goal: "微信号：wx_synthetic_contact" });
  memory = appendObservation(memory, {
    id: "obs_safe", summary: "联系 synthetic@example.invalid", kind: "姓名：合成占位甲", source: "微信号：wx_synthetic_contact"
  });
  assert.doesNotMatch(JSON.stringify(memory), /wx_synthetic_contact|合成占位甲|synthetic@example\.invalid/);
  assert.equal(memory.privacy.anonymized, false);
  assert.equal(memory.privacy.knownIdentifiersRedacted, true);
  assert.equal(memory.privacy.manualReviewRequired, true);
  assert.equal(memory.privacy.thirdPartyIdentifiers, null);
  assert.equal(appendObservation(memory, { id: "obs_next", summary: "新的观察" }).observations.length, 2);
});

test("rebuilds existing records rather than trusting caller privacy or unchecked fields", () => {
  const original = createMemory({ caseId: "case_restore_audit", consent: true });
  const supplied = {
    ...original, currentState: "姓名：合成占位甲", goal: "微信号：wx_synthetic_contact",
    observations: [{ id: "obs_safe", summary: "联系 synthetic@example.invalid", evidenceIds: ["synthetic@example.invalid"] }],
    timeline: [{ id: "synthetic@example.invalid", summary: "姓名：合成占位甲" }],
    lessons: ["微信号：wx_synthetic_contact"], preferences: ["姓名：合成占位甲"],
    conflicts: ["微信号：wx_synthetic_contact"], promises: ["synthetic@example.invalid"],
    custom: "wx_synthetic_contact", privacy: { anonymized: true }
  };
  const rebuilt = grantConsent(supplied);
  assert.equal("custom" in rebuilt, false);
  assert.equal(rebuilt.currentState, "UNKNOWN");
  assert.equal(rebuilt.timeline[0].id, "timeline_obs_safe");
  assert.deepEqual(rebuilt.preferences, []);
  assert.deepEqual(rebuilt.lessons, []);
  assert.doesNotMatch(JSON.stringify(rebuilt), /wx_synthetic_contact|合成占位甲|synthetic@example\.invalid/);
  assert.equal(rebuilt.privacy.anonymized, false);
  assert.doesNotMatch(JSON.stringify(summarizeMemory(supplied)), /wx_synthetic_contact|合成占位甲|synthetic@example\.invalid/);
  assert.equal(summarizeMemory(supplied).privacy.anonymized, false);
  const safe = grantConsent({ ...original, preferences: ["更适合周末见面"], conflicts: ["双方待协商见面频率"], promises: ["周末确认安排"] });
  assert.deepEqual(safe.preferences, ["更适合周末见面"]);
  assert.deepEqual(safe.conflicts, ["双方待协商见面频率"]);
  assert.deepEqual(safe.promises, ["周末确认安排"]);
});

test("rejects explicitly labelled identifiers with common Chinese and English labels", () => {
  const memory = createMemory({ caseId: "case_label_audit", consent: true });
  for (const summary of ["微信：wx_synthetic_contact", "name: Synthetic Person", "email=synthetic_contact", "phone：synthetic_contact", "QQ：synthetic_contact"]) {
    assert.equal(appendObservation(memory, { id: "obs_labelled", summary }).observations.length, 0);
  }
  const unchanged = createMemory({ caseId: "case_label_free", goal: "合成占位甲主动确认了安排" });
  assert.equal(unchanged.goal, "合成占位甲主动确认了安排");
  assert.equal(unchanged.privacy.anonymized, false);
  assert.equal(unchanged.privacy.manualReviewRequired, true);
});
