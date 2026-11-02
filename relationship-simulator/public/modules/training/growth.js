/**
 * Growth aggregation for the four observable training dimensions.
 *
 * This module is deliberately pure: it does not read the DOM, localStorage,
 * or a model response. It accepts both phase-1 direct training events and the
 * five-score AnalysisResult shape, then keeps the provenance of every point.
 */
import { clampScore } from "../core/number.js";

import { shanghaiDate } from "../core/date.js";

export const GROWTH_DIMENSIONS = Object.freeze([
  "initiative",
  "curiosity",
  "boundaries",
  "timing"
]);

export const GROWTH_DIMENSION_LABELS = Object.freeze({
  initiative: "主动性",
  curiosity: "好奇与共情",
  boundaries: "边界感",
  timing: "时机感"
});

/**
 * Explicit bridge from the phase-1 five-score contract to the four training
 * dimensions. Question evidence is optional in old AnalysisResult records;
 * when absent, curiosity uses empathy alone rather than inventing a score.
 */
export const FIVE_SCORE_MAPPING = Object.freeze({
  initiative: Object.freeze({ momentum: 0.7, naturalness: 0.3 }),
  curiosity: Object.freeze({ empathy: 0.7, questionEvidence: 0.3 }),
  boundaries: Object.freeze({ boundary: 1 }),
  timing: Object.freeze({ timing: 1 })
});

const SCORE_KEYS = Object.freeze([
  "naturalness",
  "empathy",
  "boundary",
  "momentum",
  "timing"
]);

const DIMENSION_ALIASES = Object.freeze({
  initiative: "initiative",
  momentum: "initiative",
  curiosity: "curiosity",
  empathy: "curiosity",
  boundaries: "boundaries",
  boundary: "boundaries",
  timing: "timing"
});

const SOURCE_FALLBACK = "unknown";
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MEDIUM_SAMPLE = 3;
const MIN_HIGH_SAMPLE = 5;

/**
 * Aggregate dated events into a recent-window score and an earliest baseline.
 *
 * `score` is the latest comparable observation in the requested recent
 * window. `baseline` is the earliest comparable observation available for the
 * same dimension, including observations before that window. An undated event
 * is not used because its date cannot be safely inferred.
 *
 * @param {Array<object>} events
 * @param {{windowDays?: number, now?: Date|string|number}} options
 * @returns {object}
 */
export function aggregateGrowth(events, { windowDays = 30, now = Date.now() } = {}) {
  const normalizedWindowDays = normalizeWindowDays(windowDays);
  const nowTime = toTime(now);
  const effectiveNow = nowTime === null ? Date.now() : nowTime;
  const windowStart = effectiveNow - normalizedWindowDays * DAY_MS;
  const contributions = extractContributions(events);
  const recentContributions = contributions.filter(
    (item) => item.time >= windowStart && item.time <= effectiveNow
  );

  const dimensions = Object.fromEntries(
    GROWTH_DIMENSIONS.map((dimension) => {
      const all = contributions.filter((item) => item.dimension === dimension);
      const recent = recentContributions.filter((item) => item.dimension === dimension);
      const baselinePoint = all[0] || null;
      // The current profile point is the latest comparable observation in the
      // selected window. Keeping the latest point avoids blending a baseline
      // into the current score and makes the change explainable in the trend.
      const score = recent.length > 0 ? recent[recent.length - 1].score : null;
      const baseline = baselinePoint?.score ?? null;

      return [dimension, {
        score,
        baseline,
        change: score === null || baseline === null ? null : score - baseline,
        sampleSize: recent.length,
        confidence: confidenceFor(recent.length),
        source: recent[recent.length - 1]?.source ?? null,
        sources: sourceSummary(recent),
        baselineSource: baselinePoint?.source ?? null,
        sourceCount: new Set(recent.map((item) => item.source)).size,
        typeCount: new Set(recent.map((item) => item.type).filter(Boolean)).size
      }];
    })
  );

  const trend = recentContributions
    .slice()
    .sort((a, b) => a.time - b.time || a.order - b.order)
    .map((item) => ({
      date: item.date,
      dimension: item.dimension,
      score: item.score,
      source: item.source
    }));

  return {
    windowDays: normalizedWindowDays,
    windowStart: new Date(windowStart).toISOString(),
    asOf: new Date(effectiveNow).toISOString(),
    dimensions,
    trend,
    empty: contributions.length === 0,
    recentEmpty: recentContributions.length === 0
  };
}

/**
 * Convert a growth summary into a stable, accessible radar data contract.
 * A missing current score remains null; zero is a real score, not an empty
 * state.
 */
export function buildRadarData(summary) {
  return GROWTH_DIMENSIONS.map((key) => {
    const dimension = isRecord(summary?.dimensions?.[key])
      ? summary.dimensions[key]
      : {};
    return {
      key,
      label: GROWTH_DIMENSION_LABELS[key],
      value: finiteScoreOrNull(dimension.score),
      baseline: finiteScoreOrNull(dimension.baseline),
      confidence: normalizeConfidence(dimension.confidence, "low")
    };
  });
}

/**
 * Translate an observable score into a conservative mastery state. The state
 * describes practice evidence only; it is never a personality or diagnosis
 * label.
 */
export function getMastery(summary, dimension) {
  const key = canonicalDimension(dimension);
  const item = key && isRecord(summary?.dimensions?.[key])
    ? summary.dimensions[key]
    : {};
  const score = finiteScoreOrNull(item.score);
  const sampleSize = normalizeCount(item.sampleSize);
  const confidence = normalizeConfidence(item.confidence, confidenceFor(sampleSize));
  const progress = score ?? 0;
  const sourceCount = normalizeCount(item.sourceCount);
  const typeCount = normalizeCount(item.typeCount);
  const windowDays = normalizeWindowDays(summary?.windowDays ?? 30);

  if (!key || score === null || sampleSize === 0) {
    return {
      level: "starting",
      label: "起步",
      progress: 0,
      explanation: "还没有可用于近期趋势的练习记录，完成一次练习后这里会出现进度。"
    };
  }

  let level = "practicing";
  let label = "练习中";

  if (score >= 80 && sampleSize >= MIN_HIGH_SAMPLE && confidence === "high" && (sourceCount >= 2 || typeCount >= 2)) {
    level = "transferable";
    label = "练习较熟练";
  } else if (score >= 70 && sampleSize >= MIN_MEDIUM_SAMPLE) {
    level = "stable";
    label = "较稳定";
  } else if (score < 60) {
    level = "starting";
    label = "起步";
  }

  const sampleNote = sampleSize < MIN_MEDIUM_SAMPLE
    ? `目前只有 ${sampleSize} 次可用记录，样本较少。`
    : `近${windowDays}日有 ${sampleSize} 次可用记录。`;
  const confidenceNote = confidence === "high"
    ? "当前趋势的证据较充分。"
    : "继续积累不同练习场景，趋势会更可靠。";

  return {
    level,
    label,
    progress,
    explanation: `${sampleNote}最近一次练习分 ${score}，${confidenceNote}这里只描述练习记录，现实迁移仍需单独观察。`
  };
}

/**
 * Build a compact coaching summary from the same observable evidence used by
 * the radar. It intentionally recommends actions rather than ranking the user
 * or making claims about personality or relationship outcomes.
 */
export function buildGrowthSummary(summary) {
  const points = GROWTH_DIMENSIONS
    .map((dimension) => {
      const item = isRecord(summary?.dimensions?.[dimension])
        ? summary.dimensions[dimension]
        : {};
      const score = finiteScoreOrNull(item.score);
      return {
        dimension,
        label: GROWTH_DIMENSION_LABELS[dimension],
        score,
        change: finiteNumberOrNull(item.change),
        sampleSize: normalizeCount(item.sampleSize),
        confidence: normalizeConfidence(item.confidence, "low")
      };
    })
    .filter((item) => item.score !== null);

  if (points.length === 0) {
    return {
      headline: "完成一次练习后，这里会出现你的成长趋势。",
      strengths: [],
      focus: null,
      actions: []
    };
  }

  const ranked = points.slice().sort((a, b) => b.score - a.score || b.sampleSize - a.sampleSize);
  const strengths = ranked
    .filter((item) => item.score >= 70)
    .slice(0, 2)
    .map(({ dimension, label, score, confidence }) => ({ dimension, label, score, confidence }));

  const focus = points
    .slice()
    .sort((a, b) => {
      const aChange = a.change ?? 0;
      const bChange = b.change ?? 0;
      return a.score - b.score || aChange - bChange;
    })[0];
  const focusMastery = getMastery(summary, focus.dimension);
  const actions = [focus.dimension, ...GROWTH_DIMENSIONS]
    .filter((dimension, index, list) => list.indexOf(dimension) === index)
    .slice(0, 2)
    .map((dimension) => ({
      dimension,
      label: GROWTH_DIMENSION_LABELS[dimension],
      action: actionFor(dimension)
    }));

  const headline = strengths.length > 0
    ? `目前${strengths.map((item) => item.label).join("、")}的练习表现较好，继续用小步练习巩固。`
    : "已经有练习记录，先围绕一个维度持续做小步练习。";

  return {
    headline,
    strengths,
    focus: {
      dimension: focus.dimension,
      label: focus.label,
      score: focus.score,
      level: focusMastery.level,
      reason: focusMastery.explanation
    },
    actions
  };
}

function extractContributions(events) {
  const sourceEvents = Array.isArray(events) ? events : [];
  const direct = [];
  const derived = [];

  sourceEvents.forEach((event, order) => {
    if (!isRecord(event)) return;
    const dateInfo = eventDate(event);
    if (!dateInfo) return;

    const source = eventSource(event);
    const directDimension = canonicalDimension(event.dimension ?? event.targetDimension);
    const directScore = scoreFrom(event.score ?? event.value);
    if (directDimension && directScore !== null) {
      direct.push(makeContribution({
        dimension: directDimension,
        score: directScore,
        source,
        dateInfo,
        event,
        order,
        isDirect: true
      }));
    }

    const scores = findFiveScores(event);
    if (scores) {
      const mapped = mapFiveScores(scores, event);
      for (const [dimension, score] of Object.entries(mapped)) {
        if (score === null) continue;
        derived.push(makeContribution({
          dimension,
          score,
          source,
          dateInfo,
          event,
          order,
          isDirect: false
        }));
      }
    }
  });

  const directSlots = new Set(
    direct
      .filter((item) => item.date)
      .map((item) => `${item.dimension}|${item.date}`)
  );
  const filteredDerived = derived.filter(
    (item) => !directSlots.has(`${item.dimension}|${item.date}`)
  );

  return [...direct, ...filteredDerived]
    .filter((item) => item.time !== null)
    .sort((a, b) => a.time - b.time || a.order - b.order);
}

function makeContribution({ dimension, score, source, dateInfo, event, order, isDirect }) {
  return {
    dimension,
    score,
    source,
    date: dateInfo.date,
    time: dateInfo.time,
    type: String(event.type ?? (isDirect ? "direct" : "analysis")).trim(),
    order,
    isDirect
  };
}

function findFiveScores(event) {
  const candidates = [
    event.scores,
    event.analysisResult?.scores,
    event.analysis?.scores,
    event.result?.scores,
    event.payload?.scores,
    event.metadata?.scores,
    event
  ];
  return candidates.find((candidate) => {
    if (!isRecord(candidate)) return false;
    return SCORE_KEYS.some((key) => scoreFrom(candidate[key]) !== null);
  }) || null;
}

function mapFiveScores(scores, event) {
  const momentum = scoreFrom(scores.momentum);
  const naturalness = scoreFrom(scores.naturalness);
  const empathy = scoreFrom(scores.empathy);
  const boundary = scoreFrom(scores.boundary);
  const timing = scoreFrom(scores.timing);
  const questionEvidence = getQuestionEvidence(event, scores);

  return {
    initiative: weightedAvailable([
      [momentum, FIVE_SCORE_MAPPING.initiative.momentum],
      [naturalness, FIVE_SCORE_MAPPING.initiative.naturalness]
    ]),
    curiosity: questionEvidence === null
      ? empathy
      : weightedAvailable([
        [empathy, FIVE_SCORE_MAPPING.curiosity.empathy],
        [questionEvidence, FIVE_SCORE_MAPPING.curiosity.questionEvidence]
      ]),
    boundaries: boundary,
    timing
  };
}

function getQuestionEvidence(event, scores) {
  const candidates = [
    event.questionScore,
    event.questionEvidence,
    event.metadata?.questionScore,
    event.metadata?.questionEvidence,
    event.metrics?.questionScore,
    event.metrics?.questionEvidence,
    event.analysisResult?.questionScore,
    event.analysis?.questionScore
  ];
  for (const candidate of candidates) {
    const number = Number(candidate);
    if (!Number.isFinite(number)) continue;
    return number <= 1 ? number * 100 : clampScore(number);
  }

  const rates = [
    event.questionRate,
    event.metadata?.questionRate,
    event.metrics?.questionRate,
    event.analysisResult?.questionRate,
    event.analysis?.questionRate
  ];
  for (const candidate of rates) {
    const number = Number(candidate);
    if (!Number.isFinite(number)) continue;
    return number <= 1 ? number * 100 : clampScore(number);
  }

  // Some replay/coach adapters provide a bounded question count and message
  // count instead of a rate. This is still explicit evidence, not a guess.
  const questionCount = Number(event.questionCount ?? event.metrics?.questionCount);
  const messageCount = Number(event.messageCount ?? event.metrics?.messageCount);
  if (Number.isFinite(questionCount) && Number.isFinite(messageCount) && messageCount > 0) {
    return clampScore((questionCount / messageCount) * 100);
  }

  // `scores` is accepted as a parameter to make the mapping signature
  // explicit; the five-score contract itself does not contain question data.
  void scores;
  return null;
}

function weightedAvailable(items) {
  const valid = items.filter(([value, weight]) => value !== null && weight > 0);
  if (valid.length === 0) return null;
  const weight = valid.reduce((sum, [, itemWeight]) => sum + itemWeight, 0);
  return clampScore(valid.reduce((sum, [value, itemWeight]) => sum + value * itemWeight, 0) / weight);
}

function eventDate(event) {
  const raw = event.createdAt ?? event.date ?? event.time ?? event.timestamp;
  const time = toTime(raw);
  if (time === null) return null;
  return { time, date: toDateKey(time) };
}

function eventSource(event) {
  const nested = event.analysisResult ?? event.analysis ?? event.result ?? {};
  const source = String(event.source ?? nested.source ?? "").trim();
  return source || SOURCE_FALLBACK;
}

function sourceSummary(items) {
  const sources = [...new Set(items.map((item) => item.source))];
  if (sources.length === 0) return null;
  return sources.length === 1 ? sources[0] : sources;
}

function canonicalDimension(value) {
  const key = String(value ?? "").trim().toLowerCase();
  return DIMENSION_ALIASES[key] || null;
}

function scoreFrom(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? clampScore(number) : null;
}

function finiteScoreOrNull(value) {
  return scoreFrom(value);
}

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function confidenceFor(sampleSize) {
  if (sampleSize >= MIN_HIGH_SAMPLE) return "high";
  if (sampleSize >= MIN_MEDIUM_SAMPLE) return "medium";
  return "low";
}

function normalizeConfidence(value, fallback = "low") {
  const confidence = String(value ?? "").trim().toLowerCase();
  return ["low", "medium", "high"].includes(confidence) ? confidence : fallback;
}

function normalizeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function normalizeWindowDays(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.max(1, Math.floor(number)) : 30;
}

function toTime(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function toDateKey(time) {
  return shanghaiDate(time);
}

function actionFor(dimension) {
  const actions = {
    initiative: "下一次练习把对方刚提到的一个具体细节接进回复，再给一个可自由回答的接话点。",
    curiosity: "先回应对方的一个细节或感受，再只问一个容易回答的问题。",
    boundaries: "把推进改写成具体、低压力、可以拒绝或改期的选择。",
    timing: "发送前检查是否已有未回应消息；如果对方在收尾或疲惫，先留出空间。"
  };
  return actions[dimension] || "完成一次对应维度的五分钟练习，并记录可观察的改动。";
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
