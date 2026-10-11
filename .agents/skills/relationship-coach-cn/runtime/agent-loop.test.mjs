import test from "node:test";
import assert from "node:assert/strict";
import { createMemory, grantConsent } from "./memory/memory-store.mjs";
import { runRelationshipLoop } from "./agent-loop.mjs";

test("explicit exit and historical EXIT cannot produce advancement or reopen conflict", () => {
  const messages = [{ speaker: "我", text: "你好" }];
  for (const signals of [{ explicitExit: true, concreteDatePlan: true }, { relationshipEnded: true, conflict: true }]) {
    const result = runRelationshipLoop({ messages, signals });
    assert.equal(result.state.to, "EXIT");
    assert.equal(result.decision.value, "EXIT");
  }
  const memory = grantConsent(createMemory({ caseId: "case_exit_test" }), true);
  memory.currentState = "EXIT";
  const result = runRelationshipLoop({ messages, memory, consent: true, signals: { conflict: true, counterOffer: true } });
  assert.equal(result.state.to, "EXIT");
  assert.equal(result.decision.value, "EXIT");
});

test("uses OBSERVE and alternative hypotheses for an ambiguous busy message", () => {
  const result = runRelationshipLoop({
    goal: "判断是否继续联系",
    messages: [
      { speaker: "我", text: "最近有空一起喝咖啡吗？" },
      { speaker: "对方", text: "最近有点忙，之后再说吧。" }
    ]
  });
  assert.equal(result.decision.value, "OBSERVE");
  assert.equal(result.prediction.decision, "OBSERVE");
  assert.equal(result.hypotheses.length, 2);
  assert.equal(result.analysis.metrics.averageReplyGapMs, null);
  assert.equal(result.privacy.rawMessagesReturned, false);
});

test("turns explicit rejection into de-escalation rather than a persuasion script", () => {
  const result = runRelationshipLoop({
    messages: [{ speaker: "对方", text: "我不想继续发展了。" }],
    signals: { explicitRejection: true, counterOffer: false, evidenceIds: ["obs_rejection"] }
  });
  assert.equal(result.decision.value, "DE_ESCALATE");
  assert.match(result.action, /停止追加说服/);
  assert.equal(result.state.to, "EXIT");
});

test("writes only a redacted memory patch when consent is granted", () => {
  const memory = grantConsent(createMemory({ caseId: "case_005" }), true);
  const result = runRelationshipLoop({
    memory,
    consent: true,
    messages: [
      { speaker: "我", text: "周日下午去看展吗？", timestamp: "2026-08-10T10:00:00+08:00" },
      { speaker: "对方", text: "可以，我下午有空。", timestamp: "2026-08-10T10:30:00+08:00" }
    ],
    signals: { concreteDatePlan: true, counterOffer: true }
  });
  assert.equal(result.decision.value, "ADVANCE");
  assert.equal(result.memoryPatch.observations.length, 1);
  assert.equal(result.memoryPatch.privacy.rawChatRetained, false);
  assert.equal(result.memoryPatch.observations[0].summary.includes("周日下午"), false);
});
