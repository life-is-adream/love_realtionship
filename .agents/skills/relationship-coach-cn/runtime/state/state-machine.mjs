export const RELATIONSHIP_STATES = Object.freeze([
  "UNKNOWN",
  "INITIAL_CONTACT",
  "MUTUAL_FAMILIARITY",
  "GROWING_INTEREST",
  "DATING_EXPLORATION",
  "COMMITTED_RELATIONSHIP",
  "CONFLICT",
  "REPAIR",
  "STABLE_RELATIONSHIP",
  "EXIT"
]);

const VALID_STATE = new Set(RELATIONSHIP_STATES);

function normalizeState(value) {
  return VALID_STATE.has(value) ? value : "UNKNOWN";
}

function result(from, to, reason, evidenceIds, reversible = true) {
  return { from, to, changed: from !== to, reason, evidenceIds, reversible };
}

/**
 * State transitions are deliberately conservative. A missing signal keeps the
 * current state instead of inventing progress.
 */
export function transitionState(currentState, signals = {}) {
  const from = normalizeState(currentState);
  const evidenceIds = Array.isArray(signals.evidenceIds) ? signals.evidenceIds.map(String).slice(0, 20) : [];
  if (signals.safetyRisk || signals.explicitExit) return result(from, "EXIT", "安全风险或明确退出信号优先", evidenceIds, false);
  if (signals.explicitRejection && !signals.counterOffer) return result(from, "EXIT", "明确拒绝且没有替代安排，停止继续推进", evidenceIds, false);
  if (signals.conflict) return result(from, "CONFLICT", "出现需要处理的冲突事实", evidenceIds);
  if (from === "CONFLICT" && signals.repairAttempt) return result(from, "REPAIR", "双方开始讨论具体行为、影响和修复请求", evidenceIds);
  if (from === "REPAIR" && signals.repairSucceeded) return result(from, "STABLE_RELATIONSHIP", "修复后出现可观察的稳定行为", evidenceIds);
  if (signals.relationshipEnded) return result(from, "EXIT", "关系已结束，进入退出与恢复路径", evidenceIds, false);
  if (from === "UNKNOWN" && signals.initialContact) return result(from, "INITIAL_CONTACT", "出现首次或重新开始的互动", evidenceIds);
  if (from === "INITIAL_CONTACT" && signals.repeatedInteraction) return result(from, "MUTUAL_FAMILIARITY", "互动出现重复且双方都参与", evidenceIds);
  if (from === "MUTUAL_FAMILIARITY" && signals.reciprocalInterest) return result(from, "GROWING_INTEREST", "双方出现可观察的互惠投入", evidenceIds);
  if (from === "GROWING_INTEREST" && signals.concreteDatePlan) return result(from, "DATING_EXPLORATION", "形成具体、可拒绝的现实见面安排", evidenceIds);
  if (from === "DATING_EXPLORATION" && signals.relationshipDefined) return result(from, "COMMITTED_RELATIONSHIP", "双方明确讨论并同意关系定义", evidenceIds);
  if (from === "COMMITTED_RELATIONSHIP" && signals.stableRoutine) return result(from, "STABLE_RELATIONSHIP", "持续的互惠日常和边界协商可观察", evidenceIds);
  if (from === "STABLE_RELATIONSHIP" && signals.conflict) return result(from, "CONFLICT", "稳定关系中出现待修复冲突", evidenceIds);
  if (from === "GROWING_INTEREST" && signals.lowReciprocity) return result(from, "MUTUAL_FAMILIARITY", "互惠证据不足，回到较保守的工作状态", evidenceIds);
  return result(from, from, "没有足够的新证据改变当前工作状态", evidenceIds);
}

export { normalizeState };
