/**
 * Shared, dependency-free result contract for local and model-assisted analysis.
 *
 * The module deliberately does not know about the DOM or the application state.
 * That keeps model responses and local fallbacks interchangeable in later phases.
 */

export const ANALYSIS_SCORE_KEYS = Object.freeze([
  "naturalness",
  "empathy",
  "boundary",
  "momentum",
  "timing"
]);

const VALID_SOURCES = new Set(["local", "model", "mixed"]);
const VALID_CONFIDENCES = new Set(["high", "medium", "low"]);

/**
 * Create a complete AnalysisResult from untrusted or partial input.
 * @param {object|null|undefined} input
 * @returns {object}
 */
export function createAnalysisResult(input = {}) {
  const value = isRecord(input) ? input : {};

  return {
    source: normalizeSource(value.source),
    confidence: normalizeConfidence(value.confidence),
    summary: normalizeText(value.summary),
    evidence: normalizeEvidence(value.evidence),
    risks: normalizeList(value.risks),
    suggestions: normalizeList(value.suggestions),
    scores: Object.fromEntries(
      ANALYSIS_SCORE_KEYS.map((key) => [key, clampScore(value.scores?.[key])])
    )
  };
}

/**
 * Normalize a model response and use a local result when the response has no
 * meaningful analysis content. JSON strings are accepted for model adapters.
 * @param {object|string|null|undefined} value
 * @param {object} fallback
 * @returns {object}
 */
export function normalizeAnalysisResult(value, fallback = {}) {
  const parsed = parseObject(value);
  const normalized = createAnalysisResult(parsed);

  if (hasMeaningfulContent(parsed, normalized)) return normalized;
  return createAnalysisResult({
    ...(isRecord(fallback) ? fallback : {}),
    source: "local"
  });
}

/** Clamp an analysis score to the public 0..100 contract. */
export function clampAnalysisScore(value) {
  return clampScore(value);
}

function normalizeSource(value) {
  const source = String(value ?? "").trim();
  return VALID_SOURCES.has(source) ? source : "local";
}

function normalizeConfidence(value) {
  const confidence = String(value ?? "").trim();
  return VALID_CONFIDENCES.has(confidence) ? confidence : "low";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function normalizeEvidence(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === "string") {
        const text = item.trim();
        return text ? { type: "message", text } : null;
      }
      if (!isRecord(item)) return null;

      const text = normalizeText(item.text);
      if (!text) return null;
      return {
        type: normalizeText(item.type) || "message",
        text
      };
    })
    .filter(Boolean);
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === "string") {
        const text = item.trim();
        return text || null;
      }
      if (!isRecord(item)) return null;
      const copy = { ...item };
      if (typeof copy.text === "string") copy.text = copy.text.trim();
      return Object.keys(copy).length > 0 ? copy : null;
    })
    .filter(Boolean);
}

function clampScore(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.min(100, Math.round(number)))
    : 0;
}

function parseObject(value) {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};

  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function hasMeaningfulContent(raw, normalized) {
  if (normalized.summary || normalized.evidence.length || normalized.risks.length || normalized.suggestions.length) {
    return true;
  }

  return ANALYSIS_SCORE_KEYS.some((key) => Number.isFinite(Number(raw?.scores?.[key])));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
