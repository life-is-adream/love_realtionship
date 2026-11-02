import { clampScoreOrNull } from "./number.js";

const SCORE_KEYS = ["naturalness", "empathy", "boundary", "momentum", "timing"];
const COACH_TYPES = new Set(["coach-score", "mistake-rewrite"]);
const finiteScore = (value) => clampScoreOrNull(value);

/** Reply total is retained for display, never assigned to a single ability. */
export function createCoachLearningEvent(scores = {}, options = {}) {
  const clean = Object.fromEntries(SCORE_KEYS.map(key => [key, finiteScore(scores?.[key])]));
  return {
    ...options, dimension: null, score: null,
    metadata: { ...options.metadata, scoreContract: "coach-dimensions-v1", scores: clean,
      total: finiteScore(scores?.total), weakestDim: scores?.weakestDim ?? null }
  };
}

/** Historical totals remain inspectable; only explicit dimension evidence is reused. */
export function correctLegacyCoachEvent(event) {
  if (!COACH_TYPES.has(event?.type) || event.metadata?.scoreContract === "coach-dimensions-v1") return event;
  const metadata = event.metadata || {};
  const old = metadata.scores || (event.type === "mistake-rewrite"
    ? { ...metadata.afterDims, momentum: metadata.afterDims?.drive }
    : metadata);
  return createCoachLearningEvent({ ...old, total: metadata.total ?? event.score, weakestDim: metadata.weakestDim }, {
    ...event, metadata: { ...metadata, legacyDimension: event.dimension ?? null, legacyTotal: event.score ?? null }
  });
}

/** Same bridge used by learning summaries; missing timing always remains unknown. */
export function trainingScoresFromEvent(event) {
  const result = {};
  const scores = event?.metadata?.scores;
  if (scores && typeof scores === "object") {
    const naturalness = finiteScore(scores.naturalness), momentum = finiteScore(scores.momentum);
    const empathy = finiteScore(scores.empathy), boundary = finiteScore(scores.boundary), timing = finiteScore(scores.timing);
    const initiative = momentum !== null && naturalness !== null ? Math.round(momentum * .7 + naturalness * .3) : momentum ?? naturalness;
    if (initiative !== null) result.initiative = initiative;
    if (empathy !== null) result.curiosity = empathy;
    if (boundary !== null) result.boundaries = boundary;
    if (timing !== null) result.timing = timing;
  }
  const direct = finiteScore(event?.score);
  if (event?.dimension && direct !== null) result[event.dimension] = direct;
  return result;
}
