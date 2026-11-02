import test from "node:test";
import assert from "node:assert/strict";
import { createPrediction, reflectOnOutcome } from "./reflection-engine.mjs";
import { createMemory, recordOutcome } from "../memory/memory-store.mjs";

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

test("redacts prediction and reflection contacts and declares manual review", () => {
  const prediction = createPrediction({
    decision: "OBSERVE", action: "观察 synthetic@example.invalid 的回应",
    expectedSignal: "收到 13800000000 的新安排",
    evidenceIds: ["conversation_evidence_1", "synthetic@example.invalid", "evidence_13800000000"]
  });
  assert.deepEqual(prediction.evidenceIds, ["conversation_evidence_1"]);
  const reflection = reflectOnOutcome(prediction, {
    observedOutcome: "synthetic@example.invalid 给出了新安排",
    nextTest: "观察 13800000000 的下一次行动", matchesExpected: true
  });
  assert.doesNotMatch(JSON.stringify(reflection), /synthetic@example\.invalid|13800000000/);
  assert.equal(reflection.privacy.anonymized, false);
  assert.equal(reflection.privacy.knownIdentifiersRedacted, true);
  assert.equal(reflection.privacy.manualReviewRequired, true);
  assert.equal(reflection.privacy.rawOutcomeRetained, false);
});

test("rejects unsafe prediction ids and sensitive fields instead of certifying anonymity", () => {
  for (const id of ["synthetic@example.invalid", "prediction_13800000000", "prediction_wechat_demo"]) {
    assert.throws(() => createPrediction({ id, decision: "OBSERVE", action: "观察", expectedSignal: "新证据" }), /identifier/);
  }
  const prediction = createPrediction({ decision: "OBSERVE", action: "观察", expectedSignal: "新证据" });
  const reflection = reflectOnOutcome(prediction, {
    observedOutcome: "姓名：合成占位甲；微信号：wx_synthetic_contact", nextTest: "住址：合成地址", matchesExpected: true
  });
  assert.equal(reflection.observedOutcome, null);
  assert.equal(reflection.calibration, "unknown");
  assert.doesNotMatch(JSON.stringify(reflection), /wx_synthetic_contact|合成占位甲|合成地址/);
});

test("revalidates prediction fields passed directly to reflection", () => {
  const prediction = {
    version: 1, id: "prediction_safe", decision: "OBSERVE",
    action: "观察 synthetic@example.invalid", expectedSignal: "等待新证据",
    evidenceIds: ["conversation_evidence_1", "synthetic@example.invalid"]
  };
  const reflection = reflectOnOutcome(prediction, { observedOutcome: "尚无新信息" });
  assert.doesNotMatch(JSON.stringify(reflection), /synthetic@example\.invalid/);
  assert.deepEqual(reflection.prediction.evidenceIds, ["conversation_evidence_1"]);
  assert.equal(prediction.action, "观察 synthetic@example.invalid");
});

test("filters spaced account labels across memory and reflection fields", () => {
  const labels = ["微信 ID：synthetic_account", "Wechat ID: synthetic_account", "QQ 号：synthetic_account", "Weixin number: synthetic_account"];
  const prediction = createPrediction({ decision: "OBSERVE", action: "观察安排", expectedSignal: "出现新证据" });
  for (const value of labels) {
    const memory = recordOutcome(createMemory({ caseId: "case_spaced_label", consent: true }), {
      id: "outcome_label", prediction: "观察安排", observedOutcome: "出现替代安排", update: value, lessons: [value, "保持现实证据"]
    });
    assert.equal(memory.outcomes[0].update, "");
    assert.deepEqual(memory.lessons, ["保持现实证据"]);
    const reflection = reflectOnOutcome(prediction, { observedOutcome: value, nextTest: value, matchesExpected: true });
    assert.equal(reflection.observedOutcome, null);
    assert.equal(reflection.calibration, "unknown");
    assert.doesNotMatch(JSON.stringify({ memory, reflection }), /synthetic_account/);
  }
});
