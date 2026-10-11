import test from "node:test";
import assert from "node:assert/strict";
import {
  PRACTICE_PLANS,
  getPracticePlan,
  recommendPracticePlan
} from "../public/modules/training/practice-plans.js";

test("六个现实卡点都有完整、可退的准备练习和课程入口", () => {
  assert.deepEqual(PRACTICE_PLANS.map((plan) => plan.id), [
    "opportunity", "opening", "connection", "invitation", "compatibility", "uncertainty"
  ]);
  for (const plan of PRACTICE_PLANS) {
    for (const field of ["id", "label", "dimension", "goal", "exercise", "realAction", "observe", "stopCondition"]) {
      assert.equal(typeof plan[field], "string");
      assert.ok(plan[field].trim().length > 0, `${plan.id}.${field} 应有可阅读内容`);
    }
    assert.ok(["initiative", "curiosity", "boundaries", "timing"].includes(plan.dimension));
    assert.match(plan.exercise, /15分钟/);
    assert.match(plan.realAction, /没有/);
    assert.match(plan.stopCondition, /拒绝|不愿|不舒服/);
    assert.ok(plan.courseNumbers.length > 0);
    assert.ok(plan.courseNumbers.every((no) => Number.isInteger(no) && no > 0));
  }
});

test("有效 ID 精确取回卡点，未知和非法输入保持未知", () => {
  for (const plan of PRACTICE_PLANS) assert.equal(getPracticePlan(plan.id), plan);
  for (const id of [null, undefined, 0, {}, [], "", "unknown", "__proto__", "constructor", " opening "]) {
    assert.equal(getPracticePlan(id), null);
  }
});

test("行为自检对应可解释、可改选的行动建议", () => {
  const examples = [
    ["action-paralysis", "opening"],
    ["interrogation", "connection"],
    ["rationalize-emotion", "connection"],
    ["impulsive-escalation", "uncertainty"],
    ["overthinking", "uncertainty"],
    ["avoidant-withdrawal", "uncertainty"]
  ];
  for (const [pattern, expectedId] of examples) {
    const result = recommendPracticePlan({ weaknessPatterns: [pattern] });
    assert.equal(result.id, expectedId);
    assert.match(result.reason, /行为自检/);
    assert.ok(getPracticePlan(result.id));
    assert.deepEqual(Object.keys(result).sort(), ["id", "reason"]);
  }
});

test("多个行为按自检顺序采用首个已识别项，跳过空白和未知项", () => {
  const profile = { weaknessPatterns: [null, "unknown", "__proto__", "constructor", "  interrogation  ", "overthinking"] };
  const before = structuredClone(profile);
  assert.equal(recommendPracticePlan(profile).id, "connection");
  assert.deepEqual(profile, before);
  assert.equal(recommendPracticePlan({ weaknessPatterns: ["overthinking", "interrogation"] }).id, "uncertainty");
});

test("缺少行为证据和错误字段类型都不自动分流", () => {
  const invalidProfiles = [
    null, undefined, 1, "interrogation", [], {},
    { weaknessPatterns: "interrogation" },
    { weaknessPatterns: {} },
    { weaknessPatterns: [] },
    { weaknessPatterns: [false, 0, {}, "", "future-pattern"] }
  ];
  for (const profile of invalidProfiles) assert.equal(recommendPracticePlan(profile), null);
});

test("依恋标签和分布不会产生或改变训练建议", () => {
  const basedOnBehavior = recommendPracticePlan({ weaknessPatterns: ["interrogation"] });
  for (const primary of ["anxious", "secure", "avoidant"]) {
    const attachment = { primary, distribution: { anxious: 100, secure: 0, avoidant: 0 } };
    assert.equal(recommendPracticePlan({ attachment }), null);
    assert.equal(recommendPracticePlan({ attachment, weaknessPatterns: [] }), null);
    assert.deepEqual(recommendPracticePlan({ attachment, weaknessPatterns: ["interrogation"] }), basedOnBehavior);
  }
  const profile = { weaknessPatterns: ["action-paralysis"] };
  Object.defineProperty(profile, "attachment", {
    get() { throw new Error("推荐不应读取依恋字段"); }
  });
  assert.equal(recommendPracticePlan(profile).id, "opening");
});

test("训练目录不可被调用方篡改，建议返回独立结果", () => {
  assert.ok(Object.isFrozen(PRACTICE_PLANS));
  assert.ok(PRACTICE_PLANS.every((plan) => Object.isFrozen(plan) && Object.isFrozen(plan.courseNumbers)));
  const first = recommendPracticePlan({ weaknessPatterns: ["interrogation"] });
  first.id = "opportunity";
  assert.equal(recommendPracticePlan({ weaknessPatterns: ["interrogation"] }).id, "connection");
});
