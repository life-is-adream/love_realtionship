import test from "node:test";
import assert from "node:assert/strict";
import { createPrediction, reflectOnOutcome } from "./reflection-engine.mjs";

test("creates an auditable prediction without a probability", () => {
  const prediction = createPrediction({
    decision: "OBSERVE",
    action: "发出一次低压力邀请后停止追问",
    expectedSignal: "对方提出可行的替代时间",
    evidenceIds: ["conversation_evidence_3"]
  });
  assert.equal(prediction.status, "pending");
  assert.equal("probability" in prediction, false);
});

test("marks explicit matching outcome as calibrated but not universal", () => {
  const prediction = createPrediction({ decision: "MAINTAIN", action: "保持正常联系", expectedSignal: "对方主动开启下一次话题" });
  const reflection = reflectOnOutcome(prediction, {
    observedOutcome: "对方第二天主动分享了新话题",
    matchesExpected: true
  });
  assert.equal(reflection.calibration, "calibrated");
  assert.match(reflection.update, /不把一次命中/);
});

test("keeps missing outcomes unknown instead of forcing a lesson", () => {
  const prediction = createPrediction({ decision: "OBSERVE", action: "暂停追问", expectedSignal: "出现新的互惠安排" });
  const reflection = reflectOnOutcome(prediction, {});
  assert.equal(reflection.calibration, "unknown");
  assert.equal(reflection.observedOutcome, null);
  assert.match(reflection.update, /信息不足/);
});
