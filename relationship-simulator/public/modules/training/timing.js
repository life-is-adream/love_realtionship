const CLOSING_PATTERN = /早点休息|晚安|先睡|睡了|明天再聊|下次聊|先这样|不早了|改天聊|回头聊|到这里|先忙/;
const FATIGUE_PATTERN = /累|困|忙|加班|开会|赶|没电|低落|难受|状态不好|疲惫|休息/;
const BOUNDARY_PATTERN = /不想聊|不想说|不用了|别问|先别|需要.{0,4}(?:空间|安静)|不方便|算了|不太想|想一个人/;
const ACKNOWLEDGE_PATTERN = /收到|明白|好呀?|好的|你先|先忙|先休息|早点休息|晚安|不打扰|改天|明天|有空再|你忙完|辛苦了|注意休息/;
const PRESSURE_PATTERN = /必须|你得|赶紧|现在就|不回我|为什么不回|是不是不在乎|给个准话|答应我|不许|你应该/;
const TOO_INTENSE_PATTERN = /爱你|想你|喜欢你|离不开|女朋友|在一起|确定关系|表白|见家长|一辈子/;
const RETURN_POINT_PATTERN = /有空(?:再聊|时)|改天|明天|下次|周末|到时候|等你方便|你忙完|回头|晚点/;
const INVITATION_PATTERN = /一起|约|见面|咖啡|散步|吃饭|看电影|周末|有空/;

// P2-11：7 阶段枚举复用 stages.js 的共享常量（原此处硬编码 Set，两处枚举值已比对一致）。
import { STAGE_VALUES } from "../core/stages.js";

// stages.js 导出为数组；本模块用 Set 保持 O(1) 命中判断。
const STAGE_SET = new Set(STAGE_VALUES);

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function getMessageText(message) {
  if (typeof message === "string") return cleanText(message);
  return cleanText(message?.text ?? message?.content ?? message?.message);
}

function getSpeaker(message) {
  const value = String(
    message?.type ?? message?.speaker ?? message?.role ?? message?.from ?? ""
  ).toLowerCase();
  if (["me", "self", "user", "male", "我", "男方"].includes(value)) return "me";
  if (["her", "other", "assistant", "female", "她", "女方"].includes(value)) return "her";
  return "unknown";
}

function getTimestampValue(message) {
  if (!message || typeof message === "string") return null;
  return message.createdAt ?? message.timestamp ?? message.time ?? null;
}

function parseTimestamp(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = Math.abs(value) < 1e12 ? value * 1000 : value;
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value.trim());
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((message, index) => ({
      index,
      raw: message,
      text: getMessageText(message),
      speaker: getSpeaker(message),
      timestamp: parseTimestamp(getTimestampValue(message))
    }))
    .filter((message) => message.text);
}

function parseNow(now) {
  if (now === undefined || now === null) return Date.now();
  return parseTimestamp(now);
}

function countQuestions(text) {
  const value = cleanText(text);
  if (!value) return 0;

  const explicit = (value.match(/[?？]/g) || []).length;
  const parts = value.split(/[，,。！!；;：:]/).map((part) => part.trim()).filter(Boolean);
  return explicit + parts.filter((part) => !/[?？]/.test(part) && /吗$|呢$|是不是|为什么|怎么(?:样|办|回事)?|哪个|多少|如何/.test(part)).length;
}

function countConsecutive(messages, speaker) {
  let count = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].speaker !== speaker) break;
    count += 1;
  }
  return count;
}

function getLastMessage(messages) {
  return messages.length ? messages[messages.length - 1] : null;
}

function getLastHerMessage(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].speaker === "her") return messages[index];
  }
  return null;
}

function getLastMessageTime(messages) {
  const last = getLastMessage(messages);
  return last?.timestamp ?? null;
}

function formatElapsed(minutes) {
  if (minutes === null) return "间隔未知";
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `约${Math.round(minutes)}分钟`;
  return `约${Math.round(minutes / 60)}小时`;
}

function isLateNight(timestamp) {
  if (timestamp === null) return false;
  const hour = new Date(timestamp).getHours();
  return hour >= 23 || hour < 7;
}

function hasClearReturnPoint(text) {
  return RETURN_POINT_PATTERN.test(text) || /你方便(?:的话)?|不方便也没关系|你觉得呢|你更想|你愿意/.test(text);
}

function isLowPressure(text) {
  return !PRESSURE_PATTERN.test(text) && !BOUNDARY_PATTERN.test(text);
}

function getStageFit(text, stage) {
  const value = cleanText(stage);
  if (!value || !STAGE_SET.has(value)) return { score: 0, reason: "" };

  if ((value === "刚加微信后的第一晚" || value === "隔天轻联系") && TOO_INTENSE_PATTERN.test(text)) {
    return { score: -16, reason: "当前阶段适合轻量建立熟悉感，草稿里的关系推进偏快。" };
  }

  if (value === "第一次邀约" && INVITATION_PATTERN.test(text) && !PRESSURE_PATTERN.test(text)) {
    return { score: 7, reason: "草稿包含了具体但可选择的推进点，和第一次邀约阶段匹配。" };
  }

  if (value === "第一次约会后" && /今天|见到你|见面|开心|下次|回家|到家/.test(text) && isLowPressure(text)) {
    return { score: 5, reason: "草稿承接了约会后的共同经历，推进幅度比较自然。" };
  }

  if (value === "暧昧推进" && /下次|一起|有空|喜欢|想见|感觉/.test(text) && isLowPressure(text)) {
    return { score: 5, reason: "草稿有轻量的情绪或行动推进，同时保留了选择空间。" };
  }

  if (value === "表达好感" && /喜欢|在意|想见|开心|认真/.test(text) && !PRESSURE_PATTERN.test(text)) {
    return { score: 5, reason: "表达方式直接但没有把回应变成对方必须完成的任务。" };
  }

  if (value === "确定关系" && /一起|计划|沟通|感受|安排|约/.test(text) && !PRESSURE_PATTERN.test(text)) {
    return { score: 4, reason: "草稿更偏向共同安排和沟通，符合确定关系后的阶段。" };
  }

  if ((value === "刚加微信后的第一晚" || value === "隔天轻联系") && text.length <= 60 && countQuestions(text) <= 1 && isLowPressure(text)) {
    return { score: 4, reason: "草稿保持了轻量、单一重点，适合当前关系阶段。" };
  }

  return { score: 0, reason: "暂未发现明显的阶段错配，仍建议保留对方的选择空间。" };
}

function buildContext(input = {}) {
  const messages = normalizeMessages(input.messages);
  const latestDraft = cleanText(input.latestDraft);
  const now = parseNow(input.now);
  const last = getLastMessage(messages);
  const lastHer = getLastHerMessage(messages);
  const lastMessageTime = getLastMessageTime(messages);
  const timestampAvailable = Boolean(last && lastMessageTime !== null && now !== null);
  const elapsedMinutes = timestampAvailable ? Math.max(0, (now - lastMessageTime) / 60000) : null;
  const questionCount = countQuestions(latestDraft);
  const draftLength = Array.from(latestDraft).length;
  const consecutiveMe = countConsecutive(messages, "me");
  const otherClosing = Boolean(lastHer && CLOSING_PATTERN.test(lastHer.text));
  const otherFatigued = Boolean(lastHer && FATIGUE_PATTERN.test(lastHer.text));
  const otherBoundary = Boolean(lastHer && BOUNDARY_PATTERN.test(lastHer.text));
  const unansweredFollowUp = last?.speaker === "me";
  const continuousSend = consecutiveMe > 0;
  const lateNight = isLateNight(now);
  const stageFit = getStageFit(latestDraft, input.stage);
  const draftAcknowledgesSpace = ACKNOWLEDGE_PATTERN.test(latestDraft);
  const hasReturnPoint = hasClearReturnPoint(latestDraft);
  const concise = draftLength > 0 && draftLength <= 60 && questionCount <= 1;

  return {
    messages,
    latestDraft,
    stage: cleanText(input.stage),
    now,
    last,
    lastHer,
    lastMessageTime,
    timestampAvailable,
    elapsedMinutes,
    questionCount,
    draftLength,
    consecutiveMe,
    otherClosing,
    otherFatigued,
    otherBoundary,
    unansweredFollowUp,
    continuousSend,
    lateNight,
    stageFit,
    draftAcknowledgesSpace,
    hasReturnPoint,
    concise,
    hasDraft: Boolean(latestDraft)
  };
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function buildReasons(context) {
  const reasons = [];
  if (!context.timestampAvailable) {
    reasons.push("当前对话没有足够的有效时间戳，无法判断消息间隔；不对等待时长作推测。");
  }
  if (!context.hasDraft) {
    reasons.push("还没有待发送的草稿，暂时只能判断数据是否齐全。");
  }
  if (context.continuousSend) {
    reasons.push("对方上一条消息后你已经连续发送，当前草稿会继续形成连发节奏。");
  }
  if (context.unansweredFollowUp) {
    reasons.push("对方仍未回应上一条消息，继续追问容易让对方感到需要立即回应。");
  }
  if (context.otherClosing) {
    reasons.push("对方上一条消息带有收尾信号，先回应收尾比立即开启新话题更合适。");
  }
  if (context.otherFatigued) {
    reasons.push("对方表达了疲惫、忙碌或低电量，继续增加问题可能会提高沟通负担。");
  }
  if (context.otherBoundary) {
    reasons.push("对方表达了边界或需要空间，草稿应先尊重边界，不要把关心变成追问。");
  }
  if (context.draftLength > 120) {
    reasons.push("草稿偏长，一次塞入太多内容会增加对方理解和回应的成本。");
  } else if (context.draftLength > 60) {
    reasons.push("草稿偏长，建议只保留一个重点，让对方更容易接住。");
  }
  if (context.questionCount > 2) {
    reasons.push("草稿包含多个问题，容易变成连续追问；建议合并成一个最重要的问题。");
  } else if (context.questionCount === 2) {
    reasons.push("草稿包含两个问题，建议删掉一个，把回应空间留给对方。");
  }
  if (context.lateNight && (context.draftLength > 60 || context.questionCount > 1 || context.otherFatigued)) {
    reasons.push("当前处于较晚时段，长消息或多问题更容易让对方感到有压力。");
  }
  if (context.elapsedMinutes !== null && context.unansweredFollowUp && context.elapsedMinutes < 30) {
    reasons.push(`上一条消息距现在${formatElapsed(context.elapsedMinutes)}，在未获回应时继续发送会显得偏急。`);
  }
  if (context.stageFit.reason) reasons.push(context.stageFit.reason);
  if (context.concise && !context.continuousSend && !context.otherClosing && !context.otherFatigued && !context.otherBoundary) {
    reasons.push("草稿短而集中，没有明显的连环追问，给对方留下了自然的回应空间。");
  }
  if (context.hasReturnPoint && !context.otherBoundary) {
    reasons.push("草稿给出了清晰的回点或选择，方便对方按自己的节奏继续。");
  }
  return unique(reasons);
}

function buildSuggestions(context) {
  const suggestions = [];
  if (!context.timestampAvailable) {
    suggestions.push("补齐真实发送时间后再看节奏分数；在此之前只参考文字层面的提示。");
  }
  if (context.otherBoundary || context.otherClosing || context.otherFatigued) {
    suggestions.push("先简短承接对方的状态，必要时收尾并留出空间，不要立刻追加新问题。");
  }
  if (context.continuousSend || context.unansweredFollowUp) {
    suggestions.push("把当前草稿先放下，等对方回应后再继续；不要用第二条消息补解释或催促。");
  }
  if (context.draftLength > 60 || context.questionCount > 1) {
    suggestions.push("压缩成一个重点，最多保留一个问题，其他内容等对方接住后再展开。");
  }
  if (context.hasReturnPoint && context.stageFit.score > 0 && !context.continuousSend) {
    suggestions.push("当前推进点比较清楚，可以保留轻量、可选择的邀约或回点，让对方可以自然地说“不方便”。");
  }
  if (suggestions.length === 0 && context.concise) {
    suggestions.push("可以发送；保持一条消息一个重点，发送后留出回应空间。");
  }
  if (suggestions.length === 0) {
    suggestions.push("先让草稿更短、更具体，再决定是否发送。");
  }
  return unique(suggestions);
}

function buildFlags(context) {
  return {
    continuousSend: context.continuousSend,
    unansweredFollowUp: context.unansweredFollowUp,
    otherClosing: context.otherClosing,
    otherFatigued: context.otherFatigued,
    otherBoundary: context.otherBoundary,
    tooLong: context.draftLength > 60,
    multipleQuestions: context.questionCount > 1,
    lateNight: context.lateNight,
    stageMatched: context.stageFit.score > 0,
    clearReturnPoint: context.hasReturnPoint
  };
}

function buildMetrics(context) {
  return {
    elapsedMinutes: context.elapsedMinutes === null ? null : Math.round(context.elapsedMinutes * 10) / 10,
    consecutiveMe: context.consecutiveMe,
    questionCount: context.questionCount,
    draftLength: context.draftLength,
    lastSpeaker: context.last?.speaker ?? null,
    lastMessageAt: context.lastMessageTime === null ? null : new Date(context.lastMessageTime).toISOString()
  };
}

/**
 * Whether the input contains at least one parseable message timestamp.
 * This helper intentionally does not infer timestamps from message order.
 */
export function hasUsableTimestamps(messages) {
  return normalizeMessages(messages).some((message) => message.timestamp !== null);
}

/**
 * Return human-readable, evidence-based timing reasons without assigning a score.
 */
export function getTimingReasons(input = {}) {
  return buildReasons(buildContext(input));
}

/**
 * Score the timing of an unsent draft against the latest conversation turn.
 * The result is local, explainable, and deliberately returns a null score when
 * the latest turn does not have a real timestamp or when there is no draft.
 */
export function scoreTiming({ messages = [], latestDraft = "", stage = "", now } = {}) {
  const context = buildContext({ messages, latestDraft, stage, now });
  const reasons = buildReasons(context);
  const suggestions = buildSuggestions(context);
  const flags = buildFlags(context);
  const metrics = buildMetrics(context);
  const evidence = reasons.map((text) => ({ type: "timing", text }));
  const base = {
    source: "local",
    confidence: context.timestampAvailable && context.hasDraft ? "medium" : "low",
    dataAvailable: context.timestampAvailable && context.hasDraft,
    score: null,
    label: "数据不足",
    reasons,
    suggestions,
    evidence,
    flags,
    metrics
  };

  if (!base.dataAvailable) return base;

  let score = 76;
  if (context.continuousSend) score -= 14;
  if (context.unansweredFollowUp) score -= 12;
  if (context.unansweredFollowUp && context.elapsedMinutes !== null && context.elapsedMinutes < 30) score -= 8;
  if (context.otherClosing && !context.draftAcknowledgesSpace) score -= 18;
  if (context.otherFatigued && !context.draftAcknowledgesSpace) score -= 15;
  if (context.otherBoundary && !context.draftAcknowledgesSpace) score -= 22;
  if (context.draftLength > 120) score -= 14;
  else if (context.draftLength > 60) score -= 8;
  if (context.questionCount > 2) score -= 12;
  else if (context.questionCount === 2) score -= 7;
  if (context.lateNight && (context.draftLength > 60 || context.questionCount > 1 || context.otherFatigued)) score -= 6;
  score += context.stageFit.score;
  if (context.concise && !context.continuousSend && !context.otherBoundary) score += 6;
  if (context.draftAcknowledgesSpace && (context.otherClosing || context.otherFatigued || context.otherBoundary)) score += 8;
  if (context.hasReturnPoint && !context.otherBoundary) score += 4;

  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    ...base,
    score,
    label: score >= 80 ? "节奏自然" : score >= 60 ? "可以发送，但注意留白" : "建议先调整节奏"
  };
}
