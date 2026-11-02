/**
 * Conversation Intelligence: deterministic, observation-only feature extraction.
 *
 * This module deliberately does not infer attraction, intent, personality, or
 * diagnosis. It turns already supplied messages into bounded, auditable signals.
 */

const USER_ALIASES = new Set([
  "user", "me", "mine", "self", "我", "男方", "a", "甲"
]);
const OTHER_ALIASES = new Set([
  "other", "partner", "them", "her", "对方", "她", "女方", "b", "乙"
]);

const QUESTION_RE = /[?？]|(?:吗|么|呢)(?:[。！!，,、；;\s]|$)/u;
const WARM_RE = /谢谢|开心|期待|喜欢|高兴|愿意|哈哈|好呀|可以呀|有趣/u;
const LOW_ENERGY_RE = /忙|累|最近有点|改天|先休息|晚点|之后再说|哈哈还好/u;
const BOUNDARY_RE = /不想|不方便|别再|不用了|停止|停下|拒绝|不需要|先这样/u;
const CONFLICT_RE = /生气|失望|不舒服|吵|误会|为什么总|别这样|受不了|不尊重/u;
// These describe explicit statements, not every ordinary preference or boundary.
const RELATIONSHIP_REJECTION_RE = /(?:不想|不愿意|不愿|不希望|不打算)(?:和你|跟你)?(?:在一起|谈恋爱|交往|发展(?:关系)?)(?=[了。！!，,、；;\s]|$)|(?:不想|不愿意|不愿|不希望|不打算)(?:再|继续)(?:发展|交往|这段关系|我们的关系)?(?=[了。！!，,、；;\s]|$)|(?:不喜欢你|对你没有恋爱的感觉)(?=[。！!，,、；;\s]|$)|我们(?:还是)?(?:就此|到此|到这里)?(?:结束(?:这段关系|我们的关系)?|分手)(?=[了吧。！!，,、；;\s]|$)/u;
const NO_CONTACT_RE = /(?:(?:别|不要|请勿|不许|不用)(?:再|继续)?(?:联系(?:我)?|来找我|找我|纠缠我|给我发(?:消息|信息|微信|短信)|发(?:消息|信息|微信|短信)给我|给我打电话)|(?:停止|停下)(?:联系(?:我)?|联络(?:我)?|纠缠(?:我)?)|(?:不想|不愿意|不希望)(?:再|继续)(?:联系|见面))(?=[了吧好吗。！!，,、；;\s]|$)/u;
const CONTACT_PAUSE_RE = /(?:现在|今天|暂时|这几天|目前)(?:请)?(?:不想|不愿意|不要|别)(?:再|继续)?(?:聊|联系)|(?:请)?先(?:别|不要)(?:给我发(?:消息|信息|短信)|联系我|找我)|(?:请)?先(?:停止|停下)(?:聊天|联系)/u;
const SELF_EXIT_RE = /我(?:决定|想要)?(?:退出|结束)(?:这段|我们的)?关系|我(?:不想|不愿意|不愿|不打算)(?:再|继续)(?:发展|交往|这段关系|(?=[了。！!，,、；;\s]|$))/u;
const DECLARED_EXIT_RE = /我(?:决定|想要)?(?:退出|结束)(?:这段|我们的)?关系/u;
const SAFETY_RISK_RE = /(?:去|到|在).{0,12}(?:堵你|堵她|堵他|堵对方)|(?:跟踪|尾随)(?:你|她|他|对方)|(?:打死|杀了)(?:我|你|她|他|对方)|(?:他|她|对方|你)(?:会|要|想)?(?:打|威胁)我|(?:会|要|就|想)伤害(?:我|你|她|他|对方)|(?:担心|害怕).{0,12}(?:伤害|暴力)|(?:我|他|她)(?:就|会|要)(?:自杀|自伤|伤害自己)/u;

function explicitStatementFlags(message) {
  const translation = /(?:这句话|这句台词).{0,8}(?:怎么翻译|是什么意思|语法)/u.test(message.text);
  const fiction = /剧情|电影|小说|台词/u.test(message.text) && /(?:这句台词|这句话|这段话).{0,8}(?:意思|翻译|怎么|语法)/u.test(message.text);
  const thirdPartyDiscussion = /(?:朋友|同事|同学|邻居|家人)说/u.test(message.text) && /(?:这句话|这段话).{0,8}(?:翻译|意思|语法|怎么看)/u.test(message.text);
  if (translation || fiction || thirdPartyDiscussion) return { rejection: false, exit: false, pause: false, safety: false };
  // Quotation alone is not a reason to discard an actual refusal.
  const text = message.text.replace(/[“”‘’"「」『』]/gu, "")
    .replace(/(?:不是|并非|没有说|没说)(?:不想|不愿意|不愿|不希望|不打算)(?:和你|跟你)?(?:在一起|谈恋爱|交往|发展(?:关系)?|(?:再|继续)(?:发展|交往|这段关系|我们的关系)?)/gu, "")
    .replace(/(?:不是|并非|没有说|没说)不喜欢你/gu, "");
  const clauses = text.split(/[，,。！!？?；;\n]/u);
  const safetyText = text.replace(/(?:不会|不想|不要|不愿|不应|不能|避免|停止)(?:再)?(?:伤害|打死|杀了|跟踪|尾随)(?:我|你|她|他|对方)/gu, "")
    .replace(/(?:不|并不)(?:担心|害怕).{0,8}(?:伤害|暴力)/gu, "");
  return {
    rejection: message.speaker === "other" && RELATIONSHIP_REJECTION_RE.test(text),
    exit: DECLARED_EXIT_RE.test(text) || clauses.some((clause) => NO_CONTACT_RE.test(clause) && !CONTACT_PAUSE_RE.test(clause)) ||
      (message.speaker !== "other" && SELF_EXIT_RE.test(text)),
    pause: CONTACT_PAUSE_RE.test(text),
    safety: SAFETY_RISK_RE.test(safetyText)
  };
}
const EMOTION_PATTERNS = [
  ["warm", WARM_RE],
  ["low_energy", LOW_ENERGY_RE],
  ["boundary", BOUNDARY_RE],
  ["conflict", CONFLICT_RE]
];

function normalizeSpeaker(value) {
  const key = String(value ?? "").trim().toLowerCase();
  if (USER_ALIASES.has(key)) return "user";
  if (OTHER_ALIASES.has(key)) return "other";
  return "unknown";
}

function parseTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((message, index) => {
      const text = typeof message?.text === "string" ? message.text.trim() : "";
      if (!text) return null;
      return {
        id: String(message?.id || `message_${index + 1}`),
        index,
        speaker: normalizeSpeaker(message?.speaker),
        text,
        timestampMs: parseTimestamp(message?.timestamp)
      };
    })
    .filter(Boolean);
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

function toTopicTokens(text) {
  const normalized = String(text || "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
  const tokens = new Set();
  const latinTokens = normalized.match(/[a-z0-9]{2,}/g) || [];
  latinTokens.forEach((token) => tokens.add(token));
  const han = normalized.match(/[\u3400-\u9fff]/gu) || [];
  for (let index = 0; index < han.length - 1; index += 1) {
    tokens.add(han.slice(index, index + 2).join(""));
  }
  return tokens;
}

function jaccard(left, right) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function classifyEmotion(text) {
  const labels = EMOTION_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
  return labels.length ? labels : ["neutral"];
}

function classifyTopicContinuity(messages) {
  if (messages.length < 2) return { label: "insufficient_data", meanSimilarity: null };
  const similarities = [];
  for (let index = 1; index < messages.length; index += 1) {
    similarities.push(jaccard(toTopicTokens(messages[index - 1].text), toTopicTokens(messages[index].text)));
  }
  const mean = similarities.reduce((sum, value) => sum + value, 0) / similarities.length;
  const label = mean >= 0.35 ? "high" : mean >= 0.12 ? "medium" : "low";
  return { label, meanSimilarity: Number(mean.toFixed(4)) };
}

function classifyTimestampCoverage(messages) {
  const withTimestamp = messages.filter((message) => message.timestampMs !== null).length;
  if (!withTimestamp) return "missing";
  return withTimestamp === messages.length ? "complete" : "partial";
}

function getConversationStarts(messages, gapMs = 12 * 60 * 60 * 1000) {
  const starts = [];
  for (let index = 0; index < messages.length; index += 1) {
    const current = messages[index];
    const previous = messages[index - 1];
    const isStart = !previous || (
      current.timestampMs !== null && previous.timestampMs !== null &&
      current.timestampMs - previous.timestampMs >= gapMs
    );
    if (isStart && (current.speaker === "user" || current.speaker === "other")) starts.push(current.speaker);
  }
  return starts;
}

function getReplyGaps(messages) {
  const gaps = [];
  for (let index = 1; index < messages.length; index += 1) {
    const previous = messages[index - 1];
    const current = messages[index];
    if (previous.speaker === "user" && current.speaker === "other" &&
        previous.timestampMs !== null && current.timestampMs !== null &&
        current.timestampMs >= previous.timestampMs) {
      gaps.push(current.timestampMs - previous.timestampMs);
    }
  }
  return gaps;
}

function countConsecutiveFollowups(messages) {
  let count = 0;
  for (let index = 1; index < messages.length; index += 1) {
    if (messages[index - 1].speaker === "user" && messages[index].speaker === "user") count += 1;
  }
  return count;
}

function buildEvidence(messages, metrics) {
  const evidence = [];
  if (messages.length < 4) {
    evidence.push({ id: "conversation_evidence_1", kind: "data_quality", observation: "消息样本较少，无法稳定判断互动模式", source: "message_count" });
  }
  if (metrics.timestampCoverage !== "complete") {
    evidence.push({ id: "conversation_evidence_2", kind: "data_quality", observation: "时间戳不完整，不能把回复速度当作结论", source: "timestamps" });
  }
  if (metrics.userInitiationRatio !== null && metrics.userInitiationRatio >= 0.65) {
    evidence.push({ id: "conversation_evidence_3", kind: "investment", observation: "可观察到的会话开端更多由用户发起", source: "conversation_starts" });
  }
  if (metrics.otherQuestionRatio !== null && metrics.otherQuestionRatio >= 0.5) {
    evidence.push({ id: "conversation_evidence_4", kind: "reciprocity", observation: "对方消息中出现较多问题句", source: "question_marks" });
  }
  if (metrics.boundaryMessageCount > 0) {
    evidence.push({ id: "conversation_evidence_5", kind: "boundary", observation: "文本中出现需要尊重的边界表达", source: "lexical_flags" });
  }
  if (metrics.conflictMessageCount > 0) {
    evidence.push({ id: "conversation_evidence_6", kind: "conflict", observation: "文本中出现冲突或受伤表达", source: "lexical_flags" });
  }
  if (metrics.explicitRejectionMessageCount > 0 || metrics.explicitExitMessageCount > 0) {
    evidence.push({ id: "conversation_evidence_7", kind: "boundary", observation: "文本明确表达关系拒绝、退出或停止联系，旧推进信号不能覆盖", source: "explicit_statement_flags" });
  }
  if (metrics.contactPauseMessageCount > 0) {
    evidence.push({ id: "conversation_evidence_8", kind: "boundary", observation: "文本明确要求暂时停止聊天或联系，当前不应继续推进", source: "explicit_statement_flags" });
  }
  if (metrics.safetyRiskMessageCount > 0) {
    evidence.push({ id: "conversation_evidence_9", kind: "safety", observation: "文本出现人身威胁或跟踪表达，应停止推进并优先处理安全", source: "explicit_statement_flags" });
  }
  if (!evidence.length) {
    evidence.push({ id: "conversation_evidence_0", kind: "data_quality", observation: "当前文本未提供足够区分性信号", source: "feature_extraction" });
  }
  return evidence;
}

/**
 * @param {Array<{speaker:string,text:string,timestamp?:string,id?:string}>} messages
 * @returns {object}
 */
export function analyzeConversation(messages, options = {}) {
  const normalized = normalizeMessages(messages);
  const counts = { user: 0, other: 0, unknown: 0 };
  normalized.forEach((message) => { counts[message.speaker] += 1; });
  const otherMessages = normalized.filter((message) => message.speaker === "other");
  const emotionCounts = Object.fromEntries(EMOTION_PATTERNS.map(([label]) => [label, 0]));
  let boundaryMessageCount = 0;
  let conflictMessageCount = 0;
  let explicitRejectionMessageCount = 0;
  let explicitExitMessageCount = 0;
  let contactPauseMessageCount = 0;
  let safetyRiskMessageCount = 0;
  for (const message of normalized) {
    const labels = classifyEmotion(message.text);
    for (const label of labels) if (label in emotionCounts) emotionCounts[label] += 1;
    if (BOUNDARY_RE.test(message.text)) boundaryMessageCount += 1;
    if (CONFLICT_RE.test(message.text)) conflictMessageCount += 1;
    const explicit = explicitStatementFlags(message);
    if (explicit.rejection) explicitRejectionMessageCount += 1;
    if (explicit.exit) explicitExitMessageCount += 1;
    if (explicit.pause) contactPauseMessageCount += 1;
    if (explicit.safety) safetyRiskMessageCount += 1;
  }
  const replyGaps = getReplyGaps(normalized);
  const starts = getConversationStarts(normalized, options.segmentGapMs || 12 * 60 * 60 * 1000);
  const topicContinuity = classifyTopicContinuity(normalized);
  const timestampCoverage = classifyTimestampCoverage(normalized);
  const emotionLabels = Object.entries(emotionCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => label);
  const metrics = {
    messageCount: normalized.length,
    speakerCounts: counts,
    userInitiationRatio: ratio(starts.filter((speaker) => speaker === "user").length, starts.length),
    otherQuestionRatio: ratio(otherMessages.filter((message) => QUESTION_RE.test(message.text)).length, otherMessages.length),
    averageReplyGapMs: replyGaps.length ? Math.round(replyGaps.reduce((sum, gap) => sum + gap, 0) / replyGaps.length) : null,
    replyGapSampleCount: replyGaps.length,
    emotionalExchange: emotionLabels[0] || "neutral",
    emotionLabels: emotionLabels.length ? emotionLabels : ["neutral"],
    topicContinuity,
    conflictFrequency: ratio(conflictMessageCount, normalized.length),
    consecutiveFollowups: countConsecutiveFollowups(normalized),
    boundaryMessageCount,
    conflictMessageCount,
    explicitRejectionMessageCount,
    explicitExitMessageCount,
    contactPauseMessageCount,
    safetyRiskMessageCount,
    timestampCoverage,
    dataQuality: normalized.length >= 4 && timestampCoverage === "complete" ? "adequate" : "limited"
  };
  return {
    version: 1,
    metrics,
    evidence: buildEvidence(normalized, metrics),
    privacy: { rawMessagesRetained: false, anonymized: true },
    limitations: [
      "指标描述文本和时间的可观察特征，不等同于兴趣、人格或心理状态。",
      "缺少时间戳时不计算回复间隔；样本过少时不外推长期模式。"
    ]
  };
}

export { normalizeMessages, normalizeSpeaker };
