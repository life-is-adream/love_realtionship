import test from "node:test";
import assert from "node:assert/strict";
import {
  ANALYSIS_SCORE_KEYS,
  createAnalysisResult,
  normalizeAnalysisResult
} from "../public/modules/coach/analysis-result.js";

test("analysis result follows the shared five-score contract", () => {
  const result = createAnalysisResult({ source: "local", summary: "测试" });

  assert.equal(result.source, "local");
  assert.equal(result.confidence, "low");
  assert.equal(result.summary, "测试");
  assert.deepEqual(result.evidence, []);
  assert.deepEqual(result.risks, []);
  assert.deepEqual(result.suggestions, []);
  assert.deepEqual(Object.keys(result.scores), ANALYSIS_SCORE_KEYS);
  assert.deepEqual(result.scores, {
    naturalness: 0,
    empathy: 0,
    boundary: 0,
    momentum: 0,
    timing: 0
  });
});

test("normalization clamps scores and canonicalizes evidence", () => {
  const result = createAnalysisResult({
    source: "mixed",
    confidence: "high",
    evidence: [
      "一句证据",
      { type: "timing", text: "时间证据" },
      { type: "", text: "缺少类型仍应保留" },
      null,
      { text: "" }
    ],
    scores: {
      naturalness: -10,
      empathy: 51.6,
      boundary: 140,
      momentum: "72",
      timing: "not-a-number"
    }
  });

  assert.deepEqual(result.scores, {
    naturalness: 0,
    empathy: 52,
    boundary: 100,
    momentum: 72,
    timing: 0
  });
  assert.deepEqual(result.evidence, [
    { type: "message", text: "一句证据" },
    { type: "timing", text: "时间证据" },
    { type: "message", text: "缺少类型仍应保留" }
  ]);
});

test("malformed model result falls back without throwing", () => {
  const result = normalizeAnalysisResult(
    { source: "wrong", scores: { boundary: "bad" } },
    { summary: "fallback", confidence: "medium", evidence: ["本地证据"] }
  );

  assert.equal(result.source, "local");
  assert.equal(result.summary, "fallback");
  assert.equal(result.confidence, "medium");
  assert.deepEqual(result.evidence, [{ type: "message", text: "本地证据" }]);
  assert.equal(result.scores.boundary, 0);
});

test("normalization does not mutate the caller's input", () => {
  const input = {
    scores: { empathy: 80 },
    evidence: [{ type: "message", text: "原始证据" }]
  };
  const snapshot = structuredClone(input);

  createAnalysisResult(input);

  assert.deepEqual(input, snapshot);
});
