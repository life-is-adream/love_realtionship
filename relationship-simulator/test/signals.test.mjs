import test from "node:test";
import assert from "node:assert/strict";
import {
  SOCIAL_SIGNAL_LABELS,
  buildSignalExercise,
  classifySocialSignals,
  evaluateSignalGuess
} from "../public/modules/training/signals.js";

test("exports the six supported social signal labels", () => {
  assert.deepEqual(SOCIAL_SIGNAL_LABELS, [
    "positive",
    "polite",
    "lowEnergy",
    "boundary",
    "closing",
    "ambiguous"
  ]);
  assert.ok(Object.isFrozen(SOCIAL_SIGNAL_LABELS));
});

test("classifies a warm concrete reply as positive without overclaiming", () => {
  const result = classifySocialSignals("好呀，下次一起去看展，你呢？");

  assert.ok(result.labels.includes("positive"));
  assert.doesNotMatch(result.labels.join(","), /ambiguous/);
  assert.ok(result.evidence.some((item) => /好呀|下次|一起|你呢/.test(item)));
  assert.match(result.uncertainty, /不等于暧昧/);
});

test("supports multiple labels for low energy and closing", () => {
  const result = classifySocialSignals("今天有点累，明天再聊吧");

  assert.deepEqual(result.labels, ["closing", "lowEnergy"]);
  assert.equal(result.confidence, "medium");
  assert.match(result.recommendedDirection, /收尾|休息/);
});

test("早点休息 is closing, not romantic escalation", () => {
  const result = classifySocialSignals("早点休息");

  assert.ok(result.labels.includes("closing"));
  assert.ok(!result.labels.includes("positive"));
  assert.doesNotMatch(result.recommendedDirection, /推进|暧昧/);
  assert.match(result.evidence.join("、"), /早点休息/);
});

test("哈哈还好吧 is polite and low-confidence, not positive", () => {
  const result = classifySocialSignals("哈哈还好吧");

  assert.ok(result.labels.includes("polite"));
  assert.ok(result.labels.includes("ambiguous"));
  assert.ok(!result.labels.includes("positive"));
  assert.equal(result.confidence, "low");
  assert.match(result.uncertainty, /信息不足|不能|无法/);
});

test("我现在不想聊 is a boundary and closing signal", () => {
  const result = classifySocialSignals("我现在不想聊");

  assert.ok(result.labels.includes("boundary"));
  assert.ok(result.labels.includes("closing"));
  assert.ok(!result.labels.includes("positive"));
  assert.equal(result.confidence, "high");
  assert.match(result.recommendedDirection, /尊重|不要追问/);
});

test("short neutral replies remain ambiguous instead of being treated as interest", () => {
  const result = classifySocialSignals("嗯");

  assert.ok(result.labels.includes("ambiguous"));
  assert.equal(result.confidence, "low");
  assert.doesNotMatch(result.labels.join(","), /positive/);
});

test("signal exercises use a deterministic seeded option order", () => {
  const first = buildSignalExercise("好呀，下次一起喝咖啡，你呢？", "demo-seed");
  const second = buildSignalExercise("好呀，下次一起喝咖啡，你呢？", "demo-seed");

  assert.deepEqual(second, first);
  assert.equal(first.answerVisible, false);
  assert.deepEqual(first.options.map((item) => item.key).sort(), [...SOCIAL_SIGNAL_LABELS].sort());
  assert.ok(first.id.startsWith("signal-"));
});

test("different seeds can produce different deterministic exercise orders", () => {
  const first = buildSignalExercise("你最近怎么样？", "seed-a");
  const second = buildSignalExercise("你最近怎么样？", "seed-b");

  assert.notDeepEqual(
    first.options.map((item) => item.key),
    second.options.map((item) => item.key)
  );
});

test("evaluates exact, partial and incorrect multi-label guesses", () => {
  const expected = classifySocialSignals("今天有点累，明天再聊吧");
  const exact = evaluateSignalGuess(expected, ["closing", "lowEnergy"]);
  const partial = evaluateSignalGuess(expected, ["lowEnergy"]);
  const incorrect = evaluateSignalGuess(expected, ["positive"]);

  assert.equal(exact.correct, true);
  assert.equal(exact.partial, false);
  assert.equal(exact.score, 1);

  assert.equal(partial.correct, false);
  assert.equal(partial.partial, true);
  assert.ok(partial.score > 0 && partial.score < 1);
  assert.match(partial.explanation, /部分正确|收尾/);

  assert.equal(incorrect.correct, false);
  assert.equal(incorrect.partial, false);
  assert.equal(incorrect.score, 0);
  assert.match(incorrect.explanation, /没有命中|核心信号/);
});

test("ambiguous is accepted as the exact answer for low-confidence input", () => {
  const result = evaluateSignalGuess({ labels: ["ambiguous"], confidence: "low" }, "ambiguous");

  assert.equal(result.correct, true);
  assert.equal(result.partial, false);
  assert.equal(result.score, 1);
});

