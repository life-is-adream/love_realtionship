/**
 * 对方投入度估计（investment tier）
 *
 * 设计契约：
 * 1. **只测量可观测行为，不推断心理**。输出 evidence 是行为事实字符串，
 *    不产出「她喜欢你」「好感度 72%」这类不可验证的结论。
 * 2. 纯函数，无副作用，不读 localStorage / 不读全局 state，便于单测。
 *    （唯一依赖是同为纯函数的 core/number.js 数值收口）
 * 3. 置信度不足时**一律降一档**（宁可低估，不可高估），对应
 *    `coach/prompts.js` 中「不要把礼貌回复误判为暧昧或高投入」的既有约束。
 *
 * 与 `core/stages.js` 的关系：stage 描述「关系走到哪」（一维），
 * investment 描述「对方投入多少」（另一维）。同阶段下两者组合决定策略。
 *
 * @module investment
 */

import { clampScore } from "./number.js";

// ── 常量 ─────────────────────────────────────────────────────────────────────

/** 五档投入度标签（索引即 level） */
export const INVESTMENT_LABELS = Object.freeze(["观望", "回应", "参与", "主动", "共建"]);

/** 合法的策略动作 */
export const ACTION_LABELS = Object.freeze({
  observe: "观察：只做承接，不推进",
  hold: "维持：正常互动，不加码",
  advance: "推进：可小步升级",
  retreat: "后退：停止追加投入并降低要求"
});

/** 策略为 retreat 时必须施加给 A/B/C 的硬约束 */
export const RETREAT_CONSTRAINT = "A/B/C 均不得包含邀约、追问或情绪索取。";

/** 计算阈值：低于此值一律 confidence=low */
export const MIN_MESSAGES_FOR_ESTIMATE = 10;

const QUESTION_RE = /[?？]/;
const REFERENCE_RE = /(上次|上回|之前|你说过|你提到|你说要|你上次)/;
const FUTURE_RE = /(见面|一起|下次|周末|有空|约个|约你)/;
const CARE_RE = /(累不累|还好吗|注意休息|别太累|早点睡|辛苦|担心你|照顾好自己)/;
const DISCLOSURE_MIN_LENGTH = 12;

const SCORE_WEIGHTS = Object.freeze({
  question: 30,
  length: 15,
  initiate: 10,
  disclosure: 20,
  reference: 10,
  future: 10,
  care: 5
});

const LEVEL_THRESHOLDS = Object.freeze([70, 50, 30, 12]);

/** 阶段分组：前期 / 中期 / 后期 */
const STAGE_BUCKETS = Object.freeze({
  刚加微信后的第一晚: "early",
  隔天轻联系: "early",
  第一次邀约: "middle",
  第一次约会后: "middle",
  暧昧推进: "late",
  表达好感: "late",
  确定关系: "late"
});

const ACTION_MATRIX = Object.freeze({
  early: ["observe", "observe", "hold", "advance", "advance"],
  middle: ["retreat", "retreat", "hold", "advance", "advance"],
  late: ["retreat", "retreat", "observe", "advance", "advance"]
});

const VALID_CONFIDENCES = new Set(["high", "medium", "low"]);
const VALID_ACTIONS = new Set(["observe", "hold", "advance", "retreat"]);

// ── 主函数 ───────────────────────────────────────────────────────────────────

/**
 * 估计对方投入度。
 *
 * @param {Array<{type: string, text: string}>} messages - 对话消息（type 为 "me" | "her"）
 * @returns {{
 *   level: number, label: string, score: number,
 *   confidence: "high"|"medium"|"low",
 *   evidence: Array<{signal: string, text: string}>,
 *   sampleSize: number,
 *   hasEnoughData: boolean
 * }}
 */
export function estimateInvestment(messages) {
  const list = (Array.isArray(messages) ? messages : []).filter(
    (message) => message && typeof message.text === "string" && message.text.trim()
  );
  const herMessages = list.filter((message) => message.type === "her");
  const sampleSize = list.length;

  if (herMessages.length === 0) {
    return {
      level: 0,
      label: INVESTMENT_LABELS[0],
      score: 0,
      confidence: "low",
      evidence: [{ signal: "sample", text: "尚无对方消息，无法估计投入度。" }],
      sampleSize,
      hasEnoughData: false
    };
  }

  const signals = collectSignals(list, herMessages);
  const score = scoreSignals(signals);
  const rawLevel = levelFromScore(score);
  const evidence = buildEvidence(signals);
  const confidence = gradeConfidence(sampleSize, herMessages.length, evidence.length);

  // 低估优先：置信度不足时降一档，且不低于 0。
  const level = confidence === "low" ? Math.max(0, rawLevel - 1) : rawLevel;

  return {
    level,
    label: INVESTMENT_LABELS[level],
    score,
    confidence,
    evidence,
    sampleSize,
    hasEnoughData: sampleSize >= MIN_MESSAGES_FOR_ESTIMATE
  };
}

/**
 * 依据关系阶段与投入度决定本轮策略。
 *
 * @param {string} stage - core/stages.js 中的阶段值
 * @param {number} level - 0..4
 * @returns {"observe"|"hold"|"advance"|"retreat"}
 */
export function planAction(stage, level) {
  const bucket = STAGE_BUCKETS[String(stage || "").trim()] || "early";
  const index = clampLevel(level);
  return ACTION_MATRIX[bucket][index];
}

/**
 * 生成注入 system prompt 的策略行。
 *
 * @param {ReturnType<typeof estimateInvestment>} tier
 * @param {string} stage
 * @returns {string} 两行文本；无数据时返回空串
 */
export function buildTierPromptLine(tier, stage) {
  const safe = normalizeRelationshipTier(tier);
  if (safe.sampleSize === 0) return "";

  const action = planAction(stage, safe.level);
  const topEvidence = safe.evidence
    .slice(0, 3)
    .map((item) => item.text)
    .filter(Boolean)
    .join("；");

  const lines = [
    `- 对方投入度：L${safe.level} ${INVESTMENT_LABELS[safe.level]}（置信度 ${safe.confidence}，样本 ${safe.sampleSize} 条）。本轮策略：${ACTION_LABELS[action]}。`,
    `- 依据仅为可观察行为${topEvidence ? `（${topEvidence}）` : ""}，不得据此推断她的内心或给出好感概率。`
  ];
  if (action === "retreat") lines.push(`- ${RETREAT_CONSTRAINT}`);
  return lines.join("\n");
}

/**
 * 容错归一化：任何脏数据都收敛到合法 tier 结构。
 *
 * @param {unknown} value
 * @returns {{
 *   level: number, label: string, score: number,
 *   confidence: "high"|"medium"|"low",
 *   evidence: Array<{signal: string, text: string}>,
 *   sampleSize: number, updatedAt: string|null
 * }}
 */
export function normalizeRelationshipTier(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const level = clampLevel(source.level);
  const confidence = VALID_CONFIDENCES.has(source.confidence) ? source.confidence : "low";
  const evidence = (Array.isArray(source.evidence) ? source.evidence : [])
    .filter((item) => item && typeof item === "object" && typeof item.text === "string")
    .slice(0, 8)
    .map((item) => ({
      signal: String(item.signal || "behavior").slice(0, 40),
      text: String(item.text).slice(0, 120)
    }));

  return {
    level,
    label: INVESTMENT_LABELS[level],
    score: clampScore(source.score),
    confidence,
    evidence,
    sampleSize: Number.isFinite(Number(source.sampleSize)) ? Math.max(0, Math.round(Number(source.sampleSize))) : 0,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : null
  };
}

/**
 * 从消息派生并落时间戳，供持久化路径调用。
 *
 * @param {Array<{type: string, text: string}>} messages
 * @param {unknown} [previous] - 上一次的 tier（用于判断是否需要更新时间戳）
 * @param {() => string} [now] - 时钟注入，便于单测
 * @returns {ReturnType<typeof normalizeRelationshipTier>}
 */
export function deriveRelationshipTier(messages, previous = null, now = () => new Date().toISOString()) {
  const estimate = estimateInvestment(messages);
  const prior = previous && typeof previous === "object" ? previous : null;
  const unchanged =
    prior &&
    prior.level === estimate.level &&
    prior.score === estimate.score &&
    prior.confidence === estimate.confidence &&
    prior.sampleSize === estimate.sampleSize &&
    typeof prior.updatedAt === "string";

  return normalizeRelationshipTier({
    ...estimate,
    updatedAt: unchanged ? prior.updatedAt : now()
  });
}

/** 判断动作是否合法（供调用方校验） */
export function isValidAction(value) {
  return VALID_ACTIONS.has(String(value || ""));
}

// ── 内部实现 ─────────────────────────────────────────────────────────────────

function collectSignals(list, herMessages) {
  const herCount = herMessages.length;
  const texts = herMessages.map((message) => String(message.text).trim());

  const questionCount = texts.filter((text) => QUESTION_RE.test(text)).length;
  const avgLength = texts.reduce((sum, text) => sum + text.length, 0) / herCount;
  const disclosureCount = texts.filter(
    (text) => text.length >= DISCLOSURE_MIN_LENGTH && text.includes("我")
  ).length;
  const referenceCount = texts.filter((text) => REFERENCE_RE.test(text)).length;
  const futureCount = texts.filter((text) => FUTURE_RE.test(text)).length;
  const careCount = texts.filter((text) => CARE_RE.test(text)).length;
  const initiates = list[0]?.type === "her";

  return {
    herCount,
    questionCount,
    questionRatio: questionCount / herCount,
    avgLength,
    disclosureCount,
    disclosureRatio: disclosureCount / herCount,
    referenceCount,
    futureCount,
    careCount,
    initiates
  };
}

function scoreSignals(signals) {
  const raw =
    signals.questionRatio * SCORE_WEIGHTS.question +
    Math.min(signals.avgLength / 40, 1) * SCORE_WEIGHTS.length +
    (signals.initiates ? SCORE_WEIGHTS.initiate : 0) +
    signals.disclosureRatio * SCORE_WEIGHTS.disclosure +
    (signals.referenceCount > 0 ? SCORE_WEIGHTS.reference : 0) +
    (signals.futureCount > 0 ? SCORE_WEIGHTS.future : 0) +
    (signals.careCount > 0 ? SCORE_WEIGHTS.care : 0);

  return clampScore(raw);
}

function levelFromScore(score) {
  for (let index = 0; index < LEVEL_THRESHOLDS.length; index += 1) {
    if (score >= LEVEL_THRESHOLDS[index]) return 4 - index;
  }
  return 0;
}

function buildEvidence(signals) {
  const evidence = [];
  const { herCount } = signals;

  evidence.push({
    signal: "sample",
    text: `对方共 ${herCount} 条消息`
  });

  evidence.push({
    signal: "questionRatio",
    text: `提问 ${signals.questionCount}/${herCount} 条`
  });

  evidence.push({
    signal: "length",
    text: `平均长度 ${Math.round(signals.avgLength)} 字`
  });

  if (signals.initiates) {
    evidence.push({ signal: "initiate", text: "本轮由她开启话题" });
  }

  if (signals.disclosureCount > 0) {
    evidence.push({
      signal: "disclosure",
      text: `${signals.disclosureCount} 条含自我披露`
    });
  }

  if (signals.referenceCount > 0) {
    evidence.push({ signal: "reference", text: `引用上文 ${signals.referenceCount} 次` });
  }

  if (signals.futureCount > 0) {
    evidence.push({ signal: "future", text: `含共同计划表述 ${signals.futureCount} 次` });
  }

  if (signals.careCount > 0) {
    evidence.push({ signal: "care", text: `关切表述 ${signals.careCount} 次` });
  }

  return evidence;
}

function gradeConfidence(sampleSize, herCount, evidenceCount) {
  if (sampleSize < MIN_MESSAGES_FOR_ESTIMATE) return "low";
  if (herCount >= 6 && evidenceCount >= 5) return "high";
  if (herCount >= 3 && evidenceCount >= 3) return "medium";
  return "low";
}

function clampLevel(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(4, number));
}
