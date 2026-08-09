import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLocalOptimizations,
  normalizeOptimizationResult,
  diffText
} from "../public/modules/training/optimizer.js";

test("local optimizer returns original, low-pressure and proactive versions", () => {
  const original = "你怎么还不回我？你是不是不高兴？";
  const result = buildLocalOptimizations(original, { stage: "隔天轻联系" });

  assert.equal(result.original, original);
  assert.notEqual(result.lowPressure.text, result.original);
  assert.notEqual(result.proactive.text, result.original);
  assert.notEqual(result.lowPressure.text, result.proactive.text);
  assert.match(result.lowPressure.reason, /压力|追问|空间/);
  assert.equal(result.lowPressure.stage, "隔天轻联系");
  assert.equal(result.lowPressure.safe, true);
  assert.equal(result.proactive.safe, true);
});

test("local versions preserve the user's topic and communication intent", () => {
  const original = "周末一起喝咖啡吗？我想听你讲讲最近看的书。";
  const result = buildLocalOptimizations(original, { topic: "最近看的书" });

  assert.equal(result.intent.type, "invite");
  assert.match(result.lowPressure.text, /咖啡|书/);
  assert.match(result.proactive.text, /咖啡|书/);
  assert.equal(result.lowPressure.intentPreserved, true);
  assert.equal(result.proactive.intentPreserved, true);
});

test("local optimizer filters risky language from generated versions", () => {
  const original = "你必须马上回我，不回就是看不起我，宝贝。";
  const result = buildLocalOptimizations(original);

  assert.equal(result.risk.filtered, true);
  assert.ok(result.risk.hits.length >= 2);
  assert.equal(result.lowPressure.risks.length, 0);
  assert.equal(result.proactive.risks.length, 0);
  assert.doesNotMatch(`${result.lowPressure.text}${result.proactive.text}`, /必须|马上|看不起我|宝贝/);
});

test("diff marks inserted and removed Chinese text", () => {
  const before = "今天忙吗";
  const after = "今天是不是有点忙？";
  const diff = diffText(before, after);

  assert.ok(diff.some((part) => part.type === "added" && part.text.includes("是不是有点")));
  assert.ok(diff.some((part) => part.type === "removed" && part.text.includes("吗")));
  assert.ok(diff.some((part) => part.type === "added" && part.text.includes("？")));
  assert.equal(diff.map((part) => part.type).join(""), "sameaddedsameremovedadded");
  assert.equal(
    diff.filter((part) => part.type !== "removed").map((part) => part.text).join(""),
    after
  );
});

test("diff handles empty and unchanged Unicode input", () => {
  assert.deepEqual(diffText("", "你好"), [{ type: "added", text: "你好" }]);
  assert.deepEqual(diffText("你好", ""), [{ type: "removed", text: "你好" }]);
  assert.deepEqual(diffText("你好，世界", "你好，世界"), [{ type: "same", text: "你好，世界" }]);
  assert.deepEqual(diffText("", ""), []);
});

test("normalizeOptimizationResult keeps original and accepts safe model versions", () => {
  const original = "我刚看到《蓝色星球》，你也喜欢纪录片吗？";
  const value = {
    original: "模型不应覆盖用户原文",
    lowPressure: {
      text: "我刚看到《蓝色星球》，你有空时也可以说说喜欢的纪录片。",
      changes: ["把问题改成可选择的表达"],
      reason: "降低即时回复压力"
    },
    proactive: {
      text: "我刚看到《蓝色星球》，如果你愿意，找个空闲时间聊聊你喜欢的纪录片？",
      changes: ["补充具体话题"],
      reason: "给出轻量的继续交流入口"
    },
    recommendation: "proactive",
    confidence: "high"
  };
  const result = normalizeOptimizationResult(value, original);

  assert.equal(result.original, original);
  assert.equal(result.source, "model");
  assert.equal(result.recommendation, "proactive");
  assert.equal(result.confidence, "high");
  assert.match(result.lowPressure.text, /蓝色星球/);
  assert.match(result.proactive.text, /纪录片/);
  assert.equal(result.lowPressure.safe, true);
  assert.equal(result.proactive.safe, true);
});

test("normalizeOptimizationResult falls back on model exceptions, duplicates and unsafe output", () => {
  const original = "最近工作有点忙，你有空再告诉我今天过得怎么样。";
  const result = normalizeOptimizationResult("not valid json", original);
  assert.equal(result.source, "local-fallback");
  assert.equal(result.original, original);
  assert.ok(result.lowPressure.text);
  assert.ok(result.proactive.text);

  const duplicateAndUnsafe = normalizeOptimizationResult({
    lowPressure: { text: original, reason: "duplicate" },
    proactive: { text: "你必须马上告诉我，不然我就拉黑你。", reason: "unsafe" }
  }, original);

  assert.equal(duplicateAndUnsafe.source, "mixed-fallback");
  assert.notEqual(duplicateAndUnsafe.lowPressure.text, original);
  assert.notEqual(duplicateAndUnsafe.proactive.text, "你必须马上告诉我，不然我就拉黑你。");
  assert.equal(duplicateAndUnsafe.lowPressure.safe, true);
  assert.equal(duplicateAndUnsafe.proactive.safe, true);
  assert.equal(duplicateAndUnsafe.proactive.risks.length, 0);
});

test("normalizeOptimizationResult rejects model output that loses the core intent", () => {
  const original = "下周一起去看展吗？";
  const result = normalizeOptimizationResult({
    lowPressure: { text: "你先忙，晚点再说。" },
    proactive: { text: "我今天吃了面。" }
  }, original);

  assert.equal(result.source, "mixed-fallback");
  assert.match(result.lowPressure.text, /展|一起|有空|下次/);
  assert.match(result.proactive.text, /展|一起|有空|下次/);
  assert.equal(result.lowPressure.intentPreserved, true);
  assert.equal(result.proactive.intentPreserved, true);
});
