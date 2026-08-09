const SCENARIOS = Object.freeze([
  {
    id: "first-meeting",
    title: "活动后的第一次聊天",
    stage: 2,
    context: "你们刚在一个公开活动中认识，对方提到最近在看一部纪录片。",
    roleInstruction: "扮演一个有自己的安排、可以接受也可以拒绝继续聊天的对方；不要替用户写回复。",
    boundary: "用户可以随时暂停或退出练习。"
  },
  {
    id: "low-energy-reply",
    title: "对方回复较短",
    stage: 4,
    context: "最近几次聊天都较短，对方说‘最近有点忙’，没有明确答应下一次聊天。",
    roleInstruction: "只给简短但不侮辱用户的现实反应，等待用户自己选择是否给空间。",
    boundary: "不得通过冷处理、嫉妒或连续追问制造压力。"
  },
  {
    id: "low-pressure-invitation",
    title: "低压力邀约",
    stage: 5,
    context: "你们已经有过几次自然交流，附近周末有一个双方都提过的公开展览。",
    roleInstruction: "对具体、可拒绝的邀请作出有边界的答复；不因为拒绝而自动提供替代时间。",
    boundary: "练习重点是清楚表达和接受答案，不是拿到见面。"
  },
  {
    id: "conflict-repair",
    title: "联系频率冲突",
    stage: 11,
    context: "一方觉得联系太少，另一方觉得被追问；双方都还没有说出具体请求。",
    roleInstruction: "在用户先描述事实、影响和请求后，给出有限的可协商回应。",
    boundary: "不使用羞辱、冷暴力惩罚或威胁。"
  },
  {
    id: "breakup-recovery",
    title: "明确结束后的恢复",
    stage: 12,
    context: "对方已经明确表示不想继续，用户想通过更强的话术挽回。",
    roleInstruction: "保持明确边界，不被话术逼回关系；练习重点是体面退出和自我恢复。",
    boundary: "不模拟跟踪、威胁、自伤暗示或报复。"
  }
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function messageMeta(text) {
  const value = String(text || "").trim();
  const questionCount = (value.match(/[?？]/g) || []).length;
  const pressureCount = (value.match(/必须|立刻|不回就是|你敢|证明给我|凭什么不/g) || []).length;
  const concretePlan = /周[一二三四五六日天]|明天|下周|一起|如果你愿意|方便的话|可以拒绝/u.test(value);
  return { length: value.length, questionCount, pressureCount, concretePlan };
}

export function listScenarios() {
  return clone(SCENARIOS);
}

export function startScenario(scenarioId) {
  const scenario = SCENARIOS.find((item) => item.id === scenarioId);
  if (!scenario) throw new RangeError(`unknown scenario: ${scenarioId}`);
  return {
    version: 1,
    scenarioId: scenario.id,
    stage: scenario.stage,
    turn: 0,
    phase: "awaiting_user",
    attempts: 0,
    lastCritique: null,
    responseMeta: null,
    privacy: { rawResponsesRetained: false, anonymized: true }
  };
}

export function getScenario(scenarioId) {
  const scenario = SCENARIOS.find((item) => item.id === scenarioId);
  return scenario ? clone(scenario) : null;
}

export function critiqueResponse(session, response) {
  if (!session || session.phase !== "awaiting_user") throw new TypeError("scenario is not awaiting a user response");
  const meta = messageMeta(response);
  if (!meta.length) throw new TypeError("response is required");
  const points = {
    naturalness: meta.length >= 4 && meta.length <= 100 ? 2 : 1,
    questionDensity: meta.questionCount <= 1 ? 2 : meta.questionCount === 2 ? 1 : 0,
    listening: /听起来|我理解|你刚才|确实|原来|谢谢你说/u.test(String(response)) ? 2 : 1,
    boundaryAwareness: meta.pressureCount === 0 ? 2 : 0,
    momentum: meta.concretePlan ? 2 : 1,
    overExplanation: meta.length > 120 || meta.questionCount >= 3 ? 0 : 2
  };
  const priorities = [];
  if (points.boundaryAwareness === 0) priorities.push("先去掉施压、证明和追责语言");
  if (points.questionDensity === 0) priorities.push("一次只保留一个问题，并给对方退出空间");
  if (points.listening < 2) priorities.push("先回应对方已经说出的事实，再表达自己的话题");
  if (points.momentum < 2) priorities.push("需要推进时给出一个具体但可拒绝的选项");
  if (!priorities.length) priorities.push("保持这条表达的具体性，等待对方真实回应");
  return {
    session: {
      ...clone(session),
      phase: "awaiting_retry",
      attempts: session.attempts + 1,
      responseMeta: meta,
      privacy: { rawResponsesRetained: false, anonymized: true }
    },
    score: points,
    priorities: priorities.slice(0, 3),
    standardAnswer: null,
    note: "这是对用户实际回复的训练反馈，不提供可背诵的标准答案。"
  };
}

export function retryScenario(session, response) {
  if (!session || session.phase !== "awaiting_retry") throw new TypeError("scenario is not awaiting retry");
  const next = { ...clone(session), turn: session.turn + 1, phase: "awaiting_user", lastCritique: null };
  return critiqueResponse(next, response);
}
