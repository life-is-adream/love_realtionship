/**
 * 本地聊天回放解析与分析模块。
 *
 * 这个模块不读取 DOM、不写 localStorage，也不调用模型。真实聊天内容在
 * 调用方明确同意前只应留在内存中；需要发送给模型时，应先调用
 * redactSensitiveText，再只发送分析摘要和必要证据。
 */

import { redactSensitiveText } from "../core/privacy.js";

// 向后兼容：脱敏实现已收敛到 core/privacy.js，这里保留导出。
export { redactSensitiveText };

const SELF_ALIASES = new Set(["我", "我方", "男方", "自己"]);
const OTHER_ALIASES = new Set(["她", "夏紫桐", "对方", "女生"]);
const SPEAKER_LABELS = ["夏紫桐", "我方", "男方", "自己", "女生", "对方", "我", "她"];
const SPEAKER_PREFIX_RE = new RegExp(
  `^\\s*(?:\\*\\*\\s*)?(${SPEAKER_LABELS.join("|")})\\s*(?:\\*\\*)?\\s*[：:]\\s*(?:\\*\\*)?\\s?(.*)$`,
  "u"
);

// 只接受带日期和时间的前缀，避免把普通数字或日期误当成消息时间。
const TIMESTAMP_PREFIX_RE = /^\s*(?:[\[【]\s*)?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:\s?(?:Z|[+-]\d{2}:?\d{2}))?)(?:\s*[\]】])?\s*(?:[|｜-]\s*)?/u;

const BOUNDARY_SIGNAL_TABLE = [
  { key: "busy", label: "忙", pattern: /忙|在开会|有事要处理/ },
  { key: "tired", label: "累", pattern: /累|疲惫|困|精力不太够/ },
  { key: "later", label: "改天", pattern: /改天|下次|之后再/ },
  { key: "rest", label: "先休息", pattern: /先休息|早点休息|想休息|先睡/ },
  { key: "inconvenient", label: "不太方便", pattern: /不太方便|不方便|不合适/ },
  { key: "quiet", label: "想安静", pattern: /想安静|安静一会儿|不想说了|不想聊/ },
  { key: "closing", label: "收尾", pattern: /晚安|明天再聊|先这样|先到这/ }
];

const QUESTION_WORD_RE = /(?:吗|呢|嘛|么)\s*[。！!?？]*$/u;
const QUESTION_START_RE = /^(?:你|有没有|是否|怎么|为什么|什么时候|哪里|哪个|哪种|多少|能不能|可以不可以|会不会|是不是)/u;
const PRESSURE_RE = /必须|一定要?|马上|赶紧|你怎么还|为什么不回|在干嘛呢?\s*[？?]|约吗|出来吗|确定关系|做我(?:的)?(?:男|女)朋友/u;
const NEUTRAL_SHORT_RE = /^(?:哈哈?还好(?:吧)?|还好(?:吧)?|嗯+|哦+|没事(?:儿)?|正常|挺好|还行|随便|好的?)[。！!?？~～…\s]*$/u;

function clamp(value, min = 0, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function asText(value) {
  return value == null ? "" : String(value);
}

function speakerFromLabel(label) {
  if (SELF_ALIASES.has(label)) return "self";
  if (OTHER_ALIASES.has(label)) return "other";
  return "unknown";
}

function normalizeTimestamp(value) {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function extractTimestampPrefix(line) {
  const match = line.match(TIMESTAMP_PREFIX_RE);
  if (!match) return { timestamp: null, rest: line };

  // Date.parse 接受的格式比我们的输入范围更宽，但这里的正则已经把范围
  // 限定为 ISO-like 日期；无效日期则按普通异常行保留，不吞掉用户内容。
  const rawTimestamp = match[1].replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");
  const timestamp = normalizeTimestamp(rawTimestamp.replace(/\s+(?=[+-]\d{2}:?\d{2}$)/u, ""));
  if (!timestamp) return { timestamp: null, rest: line };

  return { timestamp, rest: line.slice(match[0].length) };
}

function buildUnknownWarning(count) {
  if (!count) return "";
  return `有 ${count} 行未识别说话人，已保留为 unknown；可改成“我：内容”或“她：内容”后重试。`;
}

/**
 * 解析粘贴的聊天记录。
 *
 * @param {unknown} raw
 * @returns {{messages: Array, warnings: string[], stats: {total: number, parsed: number, unknown: number}}}
 */
export function parseReplayText(raw) {
  const source = asText(raw).replace(/\r\n?/gu, "\n");
  const lines = source.split("\n");
  const messages = [];
  let parsed = 0;
  let unknown = 0;

  lines.forEach((rawLine, index) => {
    if (!rawLine.trim()) return;

    const lineNumber = index + 1;
    const timestampInfo = extractTimestampPrefix(rawLine);
    const candidate = timestampInfo.timestamp ? timestampInfo.rest.trim() : rawLine.trim();
    const match = candidate.match(SPEAKER_PREFIX_RE);
    const speaker = match ? speakerFromLabel(match[1]) : "unknown";
    const text = match ? match[2].trim() : candidate;

    if (speaker === "unknown") unknown += 1;
    else parsed += 1;

    messages.push({
      id: `replay-${messages.length + 1}`,
      speaker,
      text,
      line: lineNumber,
      timestamp: timestampInfo.timestamp
    });
  });

  const warnings = [];
  if (!messages.length) warnings.push("没有找到可分析的非空消息行，请粘贴聊天内容。");
  const unknownWarning = buildUnknownWarning(unknown);
  if (unknownWarning) warnings.push(unknownWarning);
  if (messages.length && !messages.some((message) => message.timestamp)) {
    warnings.push("未检测到可用时间戳；分析不会对消息时机下结论。");
  }

  return {
    messages,
    warnings,
    stats: { total: messages.length, parsed, unknown }
  };
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((message, index) => {
    const speaker = ["self", "other", "unknown"].includes(message?.speaker)
      ? message.speaker
      : "unknown";
    const timestamp = normalizeTimestamp(message?.timestamp ?? message?.createdAt);
    return {
      id: asText(message?.id) || `replay-${index + 1}`,
      speaker,
      text: asText(message?.text).trim(),
      line: Number.isFinite(Number(message?.line)) ? Number(message.line) : index + 1,
      timestamp
    };
  });
}

function questionCount(text) {
  const value = asText(text).trim();
  if (!value) return 0;
  const punctuationCount = (value.match(/[？?]/gu) || []).length;
  const lexicalQuestion = QUESTION_WORD_RE.test(value) || QUESTION_START_RE.test(value);
  return Math.max(punctuationCount, lexicalQuestion ? 1 : 0);
}

function hasQuestion(text) {
  return questionCount(text) > 0;
}

function findNextKnown(messages, startIndex) {
  for (let index = startIndex; index < messages.length; index += 1) {
    if (messages[index].speaker !== "unknown") return index;
  }
  return -1;
}

function getMessageLength(message) {
  return Array.from(asText(message.text).replace(/\s/gu, "")).length;
}

function averageLength(messages, speaker) {
  const selected = messages.filter((message) => message.speaker === speaker);
  if (!selected.length) return 0;
  return round(selected.reduce((sum, message) => sum + getMessageLength(message), 0) / selected.length);
}

function detectBoundarySignals(message) {
  if (!message || message.speaker !== "other") return [];
  return BOUNDARY_SIGNAL_TABLE
    .filter((signal) => signal.pattern.test(message.text))
    .map(({ key, label }) => ({ key, label }));
}

function evidenceSnippet(text, maxLength = 72) {
  const redacted = redactSensitiveText(asText(text)).text.replace(/\s+/gu, " ").trim();
  if (redacted.length <= maxLength) return redacted;
  return `${redacted.slice(0, Math.max(0, maxLength - 1))}…`;
}

function confidenceForSample(sampleSize) {
  if (sampleSize >= 8) return "high";
  if (sampleSize >= 3) return "medium";
  return "low";
}

function dimension(score, status, evidence, sampleSize, confidence = confidenceForSample(sampleSize)) {
  return {
    score: score == null ? null : Math.round(clamp(score)),
    status,
    evidence: Array.isArray(evidence) ? evidence : [],
    sampleSize,
    confidence
  };
}

function makeObservation(type, severity, evidence, confidence = "medium", dimensionName = null) {
  return {
    type,
    severity,
    evidence,
    confidence,
    ...(dimensionName ? { dimension: dimensionName } : {})
  };
}

function getCooldownThresholdMs(options) {
  const minutes = Number(options?.cooldownMinutes ?? 120);
  if (Number.isFinite(minutes) && minutes > 0) return minutes * 60 * 1000;
  const milliseconds = Number(options?.cooldownThresholdMs);
  if (Number.isFinite(milliseconds) && milliseconds > 0) return milliseconds;
  return 120 * 60 * 1000;
}

function analyzeTiming(messages, options) {
  const timestamped = messages
    .map((message, index) => ({ message, index, time: message.timestamp ? Date.parse(message.timestamp) : NaN }))
    .filter((item) => Number.isFinite(item.time));

  const comparableGaps = [];
  for (let index = 1; index < messages.length; index += 1) {
    const previous = messages[index - 1];
    const current = messages[index];
    if (!previous.timestamp || !current.timestamp) continue;
    const previousTime = Date.parse(previous.timestamp);
    const currentTime = Date.parse(current.timestamp);
    if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) continue;
    const gap = currentTime - previousTime;
    if (gap >= 0) comparableGaps.push({ gap, from: previous, to: current });
  }

  const cooldownThresholdMs = getCooldownThresholdMs(options);
  const cooldownGaps = comparableGaps.filter((item) => item.gap >= cooldownThresholdMs);
  const timestamps = timestamped.map((item) => item.time);
  const duration = timestamps.length >= 2 ? Math.max(...timestamps) - Math.min(...timestamps) : null;
  const hasTiming = timestamped.length >= 2;
  const isPartial = timestamped.length > 0 && timestamped.length < messages.filter((message) => message.speaker !== "unknown").length;

  let score = null;
  let status = "unknown";
  let confidence = "low";
  if (hasTiming) {
    score = 82 - Math.min(60, cooldownGaps.length * 15);
    status = isPartial ? "partial" : "available";
    confidence = isPartial ? "low" : confidenceForSample(comparableGaps.length);
  }

  return {
    score,
    status,
    confidence,
    duration,
    durationMinutes: duration == null ? null : round(duration / 60000),
    comparableGaps,
    cooldownGaps,
    cooldownCount: hasTiming ? cooldownGaps.length : null
  };
}

function buildSuggestions({ selfShare, questionRate, consecutiveSelfCount, cooldownCount, boundarySignals, misreadDetected }) {
  const suggestions = [];
  const add = (dimensionName, title, action) => {
    if (!suggestions.some((item) => item.dimension === dimensionName)) {
      suggestions.push({ dimension: dimensionName, title, action });
    }
  };

  if (consecutiveSelfCount >= 2) {
    add("timing", "给对方一个回应窗口", "连续发送后先暂停，等对方有明确回应，再决定是否补充一句。");
  }
  if (cooldownCount > 0) {
    add("timing", "练习看见冷却间隔", "下一次先承认对方可能在忙，不把较长间隔直接解释成拒绝或冷淡。");
  }
  if (boundarySignals.length || misreadDetected) {
    add("boundaries", "先接住空间信号", "遇到“累、忙、改天”等表达时，先收住追问并给出可退出的回应。");
  }
  if (questionRate >= 0.6) {
    add("curiosity", "把问题变成好奇而非盘问", "一轮只保留一个具体问题，并先回应对方刚说的事实或感受。");
  }
  if (selfShare > 0.7) {
    add("initiative", "平衡双方投入", "发送前检查是否连续由你推动，给对方留一个自然接话点。");
  }
  if (!suggestions.length) {
    add("curiosity", "保留具体接话点", "下一轮回应一个细节，再补一个对方容易回答的轻量问题。");
  }
  return suggestions.slice(0, 4);
}

/**
 * 对已解析消息做本地、可解释的回放分析。
 * 所有时机结论都依赖有效时间戳；没有时间戳时 timing.score 和 cooldownCount 为 null。
 */
export function analyzeReplay(messages, options = {}) {
  const normalized = normalizeMessages(messages);
  const known = normalized.filter((message) => message.speaker !== "unknown");
  const selfMessages = known.filter((message) => message.speaker === "self");
  const otherMessages = known.filter((message) => message.speaker === "other");
  const totalKnown = known.length;

  const selfQuestionCount = selfMessages.reduce((sum, message) => sum + questionCount(message.text), 0);
  const otherQuestionCount = otherMessages.reduce((sum, message) => sum + questionCount(message.text), 0);
  const questionMessages = selfMessages.filter((message) => hasQuestion(message.text)).length;

  let replyCount = 0;
  normalized.forEach((message, index) => {
    if (message.speaker !== "self") return;
    const nextIndex = findNextKnown(normalized, index + 1);
    if (nextIndex >= 0 && normalized[nextIndex].speaker === "other") replyCount += 1;
  });

  let consecutiveSelfCount = 0;
  let currentSelfCount = 0;
  normalized.forEach((message) => {
    if (message.speaker === "self") {
      currentSelfCount += 1;
      consecutiveSelfCount = Math.max(consecutiveSelfCount, currentSelfCount);
    } else {
      currentSelfCount = 0;
    }
  });

  const boundarySignals = normalized
    .map((message) => ({ message, signals: detectBoundarySignals(message) }))
    .filter((item) => item.signals.length > 0)
    .map(({ message, signals }) => ({
      messageId: message.id,
      speaker: message.speaker,
      line: message.line,
      signals,
      evidence: evidenceSnippet(message.text)
    }));

  const timing = analyzeTiming(normalized, options);
  const selfShare = totalKnown ? selfMessages.length / totalKnown : null;
  const otherShare = totalKnown ? otherMessages.length / totalKnown : null;
  const replyRate = selfMessages.length ? round(replyCount / selfMessages.length, 3) : null;
  const questionRate = selfMessages.length ? round(questionMessages / selfMessages.length, 3) : null;
  const questionDensity = selfMessages.length
    ? round(selfQuestionCount / Math.max(1, selfMessages.reduce((sum, message) => sum + getMessageLength(message), 0)), 3)
    : null;

  const observations = [];
  if (selfShare != null && otherShare != null && totalKnown >= 2) {
    const shareGap = Math.abs(selfShare - otherShare);
    if (shareGap >= 0.4) {
      const dominant = selfShare > otherShare ? "你" : "对方";
      observations.push(makeObservation(
        "initiative_balance",
        shareGap >= 0.6 ? "high" : "medium",
        `已识别消息中${dominant}占比更高（${Math.round(Math.max(selfShare, otherShare) * 100)}%）；消息数量只能反映互动分布，不能直接代表投入意愿。`,
        "medium",
        "initiative"
      ));
    }
  }

  if (questionRate != null && (questionRate >= 0.6 || selfQuestionCount >= 3)) {
    observations.push(makeObservation(
      "question_density",
      questionRate >= 0.8 ? "high" : "medium",
      `你的消息中约 ${Math.round(questionRate * 100)}% 含问题，共检测到 ${selfQuestionCount} 个提问；建议结合回应，而不是连续索取信息。`,
      "medium",
      "curiosity"
    ));
  }

  if (consecutiveSelfCount >= 2) {
    observations.push(makeObservation(
      "consecutive_follow_up",
      consecutiveSelfCount >= 3 ? "high" : "medium",
      `检测到最多连续 ${consecutiveSelfCount} 条你的消息，可能提高对方接话压力；这只是节奏信号，不等于对方一定拒绝。`,
      "high",
      "timing"
    ));
  }

  if (timing.cooldownCount > 0) {
    const longestGap = Math.max(...timing.cooldownGaps.map((item) => item.gap));
    observations.push(makeObservation(
      "cooldown",
      timing.cooldownCount >= 2 ? "medium" : "low",
      `检测到 ${timing.cooldownCount} 次较长间隔，最长约 ${round(longestGap / 60000)} 分钟；间隔本身不能说明关系走向。`,
      timing.confidence,
      "timing"
    ));
  }

  if (boundarySignals.length) {
    const labels = [...new Set(boundarySignals.flatMap((item) => item.signals.map((signal) => signal.label)))];
    observations.push(makeObservation(
      "boundary_signal",
      boundarySignals.length >= 2 ? "medium" : "low",
      `对方消息出现“${labels.join("、")}”等可能需要空间的表达；这是可观察信号，不是确定意图。`,
      "medium",
      "boundaries"
    ));
  }

  let misreadDetected = false;
  boundarySignals.forEach((boundary) => {
    const boundaryIndex = normalized.findIndex((message) => message.id === boundary.messageId);
    const nextIndex = findNextKnown(normalized, boundaryIndex + 1);
    if (nextIndex < 0 || normalized[nextIndex].speaker !== "self") return;
    const nextSelf = normalized[nextIndex];
    if (hasQuestion(nextSelf.text) || PRESSURE_RE.test(nextSelf.text)) {
      misreadDetected = true;
      observations.push(makeObservation(
        "possible_misread",
        "medium",
        `对方说“${boundary.evidence}”后，你又发送了“${evidenceSnippet(nextSelf.text)}”；可能把疲惫或收尾误读成了继续推进的开放信号。`,
        "medium",
        "boundaries"
      ));
    }
  });

  const shortOtherMessages = otherMessages.filter((message) => getMessageLength(message) <= 8);
  if (shortOtherMessages.length >= 2 && otherMessages.length >= 3) {
    observations.push(makeObservation(
      "short_replies",
      "low",
      `对方有 ${shortOtherMessages.length} 条较短回复；短回复可能来自忙碌、疲惫或话题兴趣不同，不能单独判断态度。`,
      "low",
      "boundaries"
    ));
  }

  const initiativeScore = totalKnown >= 2 && selfShare != null
    ? 100 - Math.abs(selfShare - otherShare) * 100
    : null;
  const initiativeStatus = selfShare == null
    ? "unknown"
    : selfShare > 0.7
      ? "self_heavy"
      : otherShare > 0.7
        ? "other_heavy"
        : "balanced";
  const curiosityScore = selfMessages.length
    ? clamp(55 + (questionRate || 0) * 28 + (replyRate || 0) * 17 - Math.max(0, (questionRate || 0) - 0.65) * 35)
    : null;
  const boundaryScore = otherMessages.length
    ? clamp(82 - Math.min(62, boundarySignals.length * 20) - (misreadDetected ? 10 : 0))
    : null;

  const suggestions = buildSuggestions({
    selfShare: selfShare || 0,
    questionRate: questionRate || 0,
    consecutiveSelfCount,
    cooldownCount: timing.cooldownCount,
    boundarySignals,
    misreadDetected
  });

  return {
    overview: {
      totalMessages: normalized.length,
      selfMessages: selfMessages.length,
      otherMessages: otherMessages.length,
      duration: timing.duration
    },
    dimensions: {
      initiative: dimension(
        initiativeScore,
        initiativeStatus,
        totalKnown ? [`你的消息 ${selfMessages.length} 条，对方 ${otherMessages.length} 条。`] : ["没有足够的已识别消息。"],
        totalKnown,
        confidenceForSample(totalKnown)
      ),
      curiosity: dimension(
        curiosityScore,
        selfMessages.length ? "available" : "unknown",
        selfMessages.length ? [`问题消息占比约 ${Math.round((questionRate || 0) * 100)}%。`] : ["没有可识别的你的消息。"],
        selfMessages.length,
        confidenceForSample(selfMessages.length)
      ),
      boundaries: dimension(
        boundaryScore,
        boundarySignals.length ? "space_signals_present" : otherMessages.length ? "no_clear_signal" : "unknown",
        boundarySignals.length ? boundarySignals.map((item) => item.evidence) : ["未检测到明确空间信号；这不代表不存在未被规则覆盖的信号。"],
        otherMessages.length,
        boundarySignals.length ? "medium" : "low"
      ),
      timing: dimension(
        timing.score,
        timing.status,
        timing.status === "unknown"
          ? ["没有可用时间戳，不对消息时机下结论。"]
          : [`可比较的相邻时间间隔 ${timing.comparableGaps.length} 个。`],
        timing.comparableGaps.length,
        timing.confidence
      )
    },
    metrics: {
      selfInitiativeRate: selfShare,
      otherInitiativeRate: otherShare,
      selfMessageShare: selfShare,
      otherMessageShare: otherShare,
      replyRate,
      questionRate,
      questionDensity,
      selfQuestionCount,
      otherQuestionCount,
      avgSelfLength: averageLength(normalized, "self"),
      avgOtherLength: averageLength(normalized, "other"),
      cooldownCount: timing.cooldownCount,
      consecutiveSelfCount,
      boundarySignals,
      boundarySignalCount: boundarySignals.length,
      durationMinutes: timing.durationMinutes
    },
    observations,
    suggestions,
    source: "local-replay-v1"
  };
}

function formatRate(value) {
  return value == null ? "未知" : `${Math.round(value * 100)}%`;
}

function formatDuration(duration) {
  if (!Number.isFinite(Number(duration))) return "未知";
  const minutes = Math.round(Number(duration) / 60000);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

/**
 * 把结构化结果压缩为适合本地日志或用户确认后模型增强的摘要。
 * 不包含完整原始聊天内容。
 */
export function buildReplaySummary(analysis) {
  if (!analysis || typeof analysis !== "object") return "暂无可总结的回放分析。";

  const overview = analysis.overview || {};
  const metrics = analysis.metrics || {};
  const observations = Array.isArray(analysis.observations) ? analysis.observations : [];
  const suggestions = Array.isArray(analysis.suggestions) ? analysis.suggestions : [];
  const timingUnknown = analysis.dimensions?.timing?.status === "unknown" || metrics.cooldownCount == null;

  const parts = [
    `共分析 ${Number(overview.totalMessages) || 0} 条消息：你 ${Number(overview.selfMessages) || 0} 条，对方 ${Number(overview.otherMessages) || 0} 条。`,
    `你的消息占比 ${formatRate(metrics.selfInitiativeRate)}，回复率 ${formatRate(metrics.replyRate)}，问题消息占比 ${formatRate(metrics.questionRate)}。`
  ];

  if (timingUnknown) {
    parts.push("未提供可用时间戳，因此不对消息时机下结论。");
  } else {
    parts.push(`可用时间范围约 ${formatDuration(overview.duration)}，检测到 ${metrics.cooldownCount || 0} 次较长间隔。`);
  }

  if (observations.length) {
    parts.push(`主要观察：${observations.slice(0, 3).map((item) => item.evidence).join("；")}`);
  }
  if (suggestions.length) {
    parts.push(`建议先练习：${suggestions[0].action}`);
  }
  return parts.join(" ");
}
