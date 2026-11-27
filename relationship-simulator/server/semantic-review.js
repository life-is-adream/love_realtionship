// L2 可选模型复核适配器：只在 L1 判为 OBSERVE/证据不足时启用。
// 默认关闭；必须显式设置 HF_SEMANTIC_REVIEW=1 且注入 callModel，绝不在测试中联网。
const CATEGORIES = new Set(["EXIT", "DE_ESCALATE", "OBSERVE", "ADVANCE", "MAINTAIN"]);

export function validateModelReview(raw, messages = []) {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not_object" };
  if (!CATEGORIES.has(raw.category)) return { ok: false, reason: "invalid_category" };
  if (typeof raw.rationale !== "string" || raw.rationale.trim().length < 4) return { ok: false, reason: "missing_rationale" };
  if (!Array.isArray(raw.evidence) || raw.evidence.length === 0) return { ok: false, reason: "missing_evidence" };
  for (const item of raw.evidence) {
    if (!item || typeof item.message_id !== "string" || !Number.isInteger(item.start) || !Number.isInteger(item.end) || item.start < 0 || item.end <= item.start) return { ok: false, reason: "invalid_span" };
    const message = messages.find((m) => m.id === item.message_id);
    if (message && Array.from(message.text).slice(item.start, item.end).join("") !== String(item.text || "")) return { ok: false, reason: "span_text_mismatch" };
  }
  const confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return { ok: false, reason: "invalid_confidence" };
  return { ok: true, value: { category: raw.category, rationale: raw.rationale.trim(), evidence: raw.evidence, confidence } };
}

export function canReview(baseline) {
  return baseline?.category === "OBSERVE" || baseline?.evidence_status === "insufficient";
}

export async function maybeModelReview({ baseline, messages, callModel, enabled = process.env.HF_SEMANTIC_REVIEW === "1", timeoutMs = 3000 }) {
  const baseAudit = { ...(baseline?.audit || {}), model_used: false, review_skipped: null, review_reason: null, review_latency_ms: null };
  if (!enabled) return { decision: baseline, audit: { ...baseAudit, review_skipped: "disabled" } };
  if (!canReview(baseline)) return { decision: baseline, audit: { ...baseAudit, review_skipped: "not_ambiguous" } };
  if (typeof callModel !== "function") return { decision: baseline, audit: { ...baseAudit, review_skipped: "no_adapter" } };
  const started = Date.now();
  try {
    const raw = await Promise.race([
      callModel({ messages, baseline }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs))
    ]);
    const checked = validateModelReview(raw, messages);
    if (!checked.ok) return { decision: baseline, audit: { ...baseAudit, review_skipped: checked.reason, review_latency_ms: Date.now() - started } };
    // L0 门禁：L1 已判 EXIT/DE_ESCALATE 时不允许模型放宽（本函数入口已限制，仅作二次防御）。
    if (baseline.category === "EXIT" || baseline.category === "DE_ESCALATE") return { decision: baseline, audit: { ...baseAudit, review_skipped: "hard_boundary" } };
    const decision = {
      ...baseline,
      category: checked.value.category,
      rationale: checked.value.rationale,
      evidence: checked.value.evidence,
      evidence_status: checked.value.category === "OBSERVE" ? "insufficient" : "sufficient",
      abstain: checked.value.category === "OBSERVE",
      decision_source: "model_review",
      audit: { ...baseAudit, model_used: true, review_reason: checked.reason || null, review_confidence: checked.value.confidence, review_latency_ms: Date.now() - started }
    };
    return { decision, audit: decision.audit };
  } catch (error) {
    return { decision: baseline, audit: { ...baseAudit, review_skipped: error?.message === "timeout" ? "timeout" : "adapter_error", review_latency_ms: Date.now() - started } };
  }
}
