import { limitedTextPrivacy, normalizeAnonymousId, normalizeFreeText } from "../memory/memory-store.mjs";

const DECISIONS = new Set(["ADVANCE", "MAINTAIN", "OBSERVE", "DE_ESCALATE", "EXIT"]);

export function createPrediction({ decision, action, expectedSignal, evidenceIds = [], id = "prediction_001" } = {}) {
  if (!DECISIONS.has(decision)) throw new TypeError("prediction decision is invalid");
  const normalizedId = normalizeAnonymousId(id);
  if (!normalizedId) throw new TypeError("prediction id must be a controlled identifier");
  const safeAction = normalizeFreeText(action, 300);
  const safeExpectedSignal = normalizeFreeText(expectedSignal, 300);
  if (!safeAction || !safeExpectedSignal) throw new TypeError("prediction action and expectedSignal must be non-sensitive text");
  return {
    version: 1,
    id: normalizedId,
    decision,
    action: safeAction,
    expectedSignal: safeExpectedSignal,
    evidenceIds: Array.isArray(evidenceIds) ? evidenceIds.map((item) => normalizeAnonymousId(item)).filter(Boolean).slice(0, 20) : [],
    status: "pending"
  };
}

export function reflectOnOutcome(prediction, outcome = {}) {
  if (!prediction || prediction.version !== 1) throw new TypeError("prediction is invalid");
  const safePrediction = createPrediction(prediction);
  const observedOutcome = normalizeFreeText(outcome.observedOutcome ?? outcome.outcome, 300);
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
    predictionId: safePrediction.id,
    prediction: {
      decision: safePrediction.decision,
      action: safePrediction.action,
      expectedSignal: safePrediction.expectedSignal,
      evidenceIds: safePrediction.evidenceIds
    },
    observedOutcome: observedOutcome || null,
    calibration,
    update,
    nextTest: normalizeFreeText(outcome.nextTest, 300) || "下一次只验证一个最小、可逆的现实信号。",
    privacy: limitedTextPrivacy({ rawOutcomeRetained: false })
  };
}
