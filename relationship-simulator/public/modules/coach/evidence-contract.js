const bounded = (value) => typeof value === "string" ? value.trim().slice(0, 240) : "";
const strings = (value) => (Array.isArray(value) ? value : []).map(bounded).filter(Boolean).slice(0, 4);

// 旧字段仍可解析，但不能把旧的“隐藏意图”字符串升级成事实。
export function normalizeCoachEvidence(value, explicitGoal = "") {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const observations = strings(source.observations);
  const hypotheses = (Array.isArray(source.hypotheses) ? source.hypotheses : []).slice(0, 2).flatMap((item) => {
    if (!item || typeof item !== "object" || !bounded(item.explanation)) return [];
    return [{ explanation: bounded(item.explanation), support: strings(item.support), counter: strings(item.counter) }];
  });
  const unknowns = strings(source.unknowns);
  if (!observations.length) unknowns.unshift("模型未返回可核对的行为证据；不能据此判断对方内心或现实关系结果。");
  if (!unknowns.length) unknowns.push("双方现实意愿、后续兑现和长期兼容性仍需直接沟通与观察。");
  return { observations, hypotheses, unknowns: unknowns.slice(0, 4), userGoal: bounded(explicitGoal) || "用户尚未明确具体目标。" };
}

export function coachEvidenceCards(data) {
  const evidence = normalizeCoachEvidence(data?.evidenceReasoning, data?.evidenceReasoning?.userGoal);
  const explanation = evidence.hypotheses.map((item) => `${item.explanation}\n支持：${item.support.join("；") || "支持证据不足"}\n反证或替代解释：${item.counter.join("；") || "尚未提供，需要补充核对"}`).join("\n\n");
  return [
    ["行为观察（需对照核实）", evidence.observations.join("\n") || "尚无可核对观察。"],
    ["可能解释与反证", explanation || "信息不足，不猜测对方心理。"],
    ["你的明确目标", evidence.userGoal],
    ["目前未知", evidence.unknowns.join("\n")],
    ["风险提醒（需核对）", bounded(data?.risk) || "风险信息不足，优先确认边界与安全。"]
  ];
}
