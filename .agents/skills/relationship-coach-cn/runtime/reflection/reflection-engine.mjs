const DECISIONS = new Set(["ADVANCE", "MAINTAIN", "OBSERVE", "DE_ESCALATE", "EXIT"]);

function bounded(value, limit = 300) {
  return String(value || "").trim().slice(0, limit);
}

export function createPrediction({ decision, action, expectedSignal, evidenceIds = [], id = "prediction_001" } = {}) {
  if (!DECISIONS.has(decision)) throw new TypeError("prediction decision is invalid");
  if (!bounded(action) || !bounded(expectedSignal)) throw new TypeError("prediction action and expectedSignal are required");
  return {
    version: 1,
    id: bounded(id, 80),
    decision,
    action: bounded(action),
    expectedSignal: bounded(expectedSignal),
    evidenceIds: Array.isArray(evidenceIds) ? evidenceIds.map((item) => bounded(item, 80)).slice(0, 20) : [],
    status: "pending"
  };
}

export function reflectOnOutcome(prediction, outcome = {}) {
  if (!prediction || prediction.version !== 1) throw new TypeError("prediction is invalid");
  const observedOutcome = bounded(outcome.observedOutcome ?? outcome.outcome);
  const hasExplicitMatch = typeof outcome.matchesExpected === "boolean";
  const calibration = !observedOutcome || !hasExplicitMatch
    ? "unknown"
    : outcome.matchesExpected ? "calibrated" : "mismatch";
  const update = calibration === "calibrated"
    ? "保留这条预测与证据之间的联系，但不把一次命中推广为稳定规律。"
    : calibration === "mismatch"
      ? "降低原判断的权重，记录反例并寻找下一条可观察证据。"
      : "结果信息不足，暂不更新关系判断。";
  return {
    version: 1,
    predictionId: prediction.id,
    prediction: {
      decision: prediction.decision,
      action: prediction.action,
      expectedSignal: prediction.expectedSignal,
      evidenceIds: prediction.evidenceIds
    },
    observedOutcome: observedOutcome || null,
    calibration,
    update,
    nextTest: bounded(outcome.nextTest || "下一次只验证一个最小、可逆的现实信号。"),
    privacy: { rawOutcomeRetained: false, anonymized: true }
  };
}
