import test from "node:test";
import assert from "node:assert/strict";
import { maybeModelReview, validateModelReview } from "../server/semantic-review.js";

const messages = [{ id: "msg_001", speaker: "user", text: "周末有空吗？" }, { id: "msg_002", speaker: "other", text: "我不忙，周末可以。" }];
const baseline = { category: "OBSERVE", evidence_status: "insufficient", abstain: true, evidence: [], audit: { rule_version: "sem-v2.1.0", model_used: false } };

test("L2 默认关闭，不调用模型", async () => {
  let called = false;
  const result = await maybeModelReview({ baseline, messages, enabled: false, callModel: async () => { called = true; } });
  assert.equal(called, false);
  assert.equal(result.decision, baseline);
  assert.equal(result.audit.review_skipped, "disabled");
});

test("L2 只复核 OBSERVE，不覆盖硬边界", async () => {
  const hard = { ...baseline, category: "EXIT", evidence_status: "sufficient", abstain: false };
  let called = false;
  const result = await maybeModelReview({ baseline: hard, messages, enabled: true, callModel: async () => { called = true; return {}; } });
  assert.equal(called, false);
  assert.equal(result.decision.category, "EXIT");
  assert.equal(result.audit.review_skipped, "not_ambiguous");
});

test("L2 接受带证据的合法复核并记录审计", async () => {
  const result = await maybeModelReview({ baseline, messages, enabled: true, callModel: async () => ({ category: "ADVANCE", rationale: "对方明确说周末可以。", confidence: 0.82, evidence: [{ message_id: "msg_002", start: 4, end: 8, text: "周末可以" }] }) });
  assert.equal(result.decision.category, "ADVANCE");
  assert.equal(result.decision.decision_source, "model_review");
  assert.equal(result.audit.model_used, true);
  assert.equal(result.decision.evidence[0].text, "周末可以");
});

test("L2 非法输出、超时与证据不匹配全部回退", async () => {
  for (const bad of [null, {}, { category: "ADVANCE", rationale: "x", confidence: 0.9, evidence: [] }, { category: "ADVANCE", rationale: "合法理由", confidence: 0.9, evidence: [{ message_id: "msg_002", start: 0, end: 2, text: "错的" }] }]) {
    const result = await maybeModelReview({ baseline, messages, enabled: true, callModel: async () => bad });
    assert.equal(result.decision, baseline);
    assert.equal(result.audit.model_used, false);
  }
  const timeout = await maybeModelReview({ baseline, messages, enabled: true, timeoutMs: 10, callModel: () => new Promise(() => {}) });
  assert.equal(timeout.decision, baseline);
  assert.equal(timeout.audit.review_skipped, "timeout");
});

test("L2 证据 span 必须与原文一致", () => {
  assert.equal(validateModelReview({ category: "ADVANCE", rationale: "明确愿意", confidence: 0.8, evidence: [{ message_id: "msg_002", start: 4, end: 8, text: "周末可以" }] }, messages).ok, true);
  assert.equal(validateModelReview({ category: "ADVANCE", rationale: "明确愿意", confidence: 0.8, evidence: [{ message_id: "msg_002", start: 0, end: 2, text: "我在" }] }, messages).ok, false);
});
