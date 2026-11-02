import test from "node:test";
import assert from "node:assert/strict";
import {
  INVESTMENT_LABELS,
  RETREAT_CONSTRAINT,
  estimateInvestment,
  planAction,
  buildTierPromptLine,
  normalizeRelationshipTier,
  deriveRelationshipTier,
  isValidAction
} from "../public/modules/core/investment.js";

// ── 测试夹具 ─────────────────────────────────────────────────────────────────

/** 10 条：低投入（只回答、不提问、极短） */
const LOW_MESSAGES = [
  { type: "me", text: "今天怎么样" },
  { type: "her", text: "还行" },
  { type: "me", text: "周末有安排吗" },
  { type: "her", text: "没" },
  { type: "me", text: "那要不要出去走走" },
  { type: "her", text: "看情况" },
  { type: "me", text: "最近在忙什么" },
  { type: "her", text: "上班" },
  { type: "me", text: "累不累" },
  { type: "her", text: "嗯" }
];

/** 12 条：高投入（她开启、多提问、自我披露、引用上文、共同计划、关切） */
const HIGH_MESSAGES = [
  { type: "her", text: "今天上班好累，我那个项目又改了三次" },
  { type: "me", text: "听起来挺折腾的" },
  { type: "her", text: "你上次说的那家店我去了，还不错" },
  { type: "me", text: "那家我常去" },
  { type: "her", text: "你周末有空吗？要不要一起去看展" },
  { type: "me", text: "可以啊" },
  { type: "her", text: "你怎么看？我有点纠结" },
  { type: "me", text: "看你想看哪个" },
  { type: "her", text: "对了，你之前说想学摄影，后来去了吗？" },
  { type: "me", text: "还没，一直拖着" },
  { type: "her", text: "别太累，早点睡" },
  { type: "me", text: "你也是" }
];

// ── estimateInvestment ───────────────────────────────────────────────────────

test("estimateInvestment：空数组返回 L0 且标记数据不足", () => {
  const result = estimateInvestment([]);
  assert.equal(result.level, 0);
  assert.equal(result.label, "观望");
  assert.equal(result.confidence, "low");
  assert.equal(result.sampleSize, 0);
  assert.equal(result.hasEnoughData, false);
});

test("estimateInvestment：只有自己消息时返回 L0 且不推断对方", () => {
  const result = estimateInvestment([
    { type: "me", text: "在吗" },
    { type: "me", text: "睡了吗" }
  ]);
  assert.equal(result.level, 0);
  assert.equal(result.confidence, "low");
  assert.equal(result.evidence[0].signal, "sample");
});

test("estimateInvestment：低投入对话判定为 L0–L1", () => {
  const result = estimateInvestment(LOW_MESSAGES);
  assert.ok(result.level <= 1, `预期 <=1，实际 ${result.level}`);
  assert.equal(result.sampleSize, 10);
  assert.equal(result.hasEnoughData, true);
});

test("estimateInvestment：高投入对话判定为 L3 及以上且高置信", () => {
  const result = estimateInvestment(HIGH_MESSAGES);
  assert.ok(result.level >= 3, `预期 >=3，实际 ${result.level}（score ${result.score}）`);
  assert.equal(result.confidence, "high");
});

test("estimateInvestment：高投入分数严格高于低投入", () => {
  const low = estimateInvestment(LOW_MESSAGES);
  const high = estimateInvestment(HIGH_MESSAGES);
  assert.ok(high.score > low.score + 20, `高分 ${high.score} 未显著高于低分 ${low.score}`);
});

test("estimateInvestment：样本不足时置信度降为 low 且档位被压低", () => {
  const shortSet = HIGH_MESSAGES.slice(0, 4);
  const short = estimateInvestment(shortSet);
  const full = estimateInvestment(HIGH_MESSAGES);

  assert.equal(short.confidence, "low");
  assert.equal(short.hasEnoughData, false);
  assert.ok(
    short.level < full.level,
    `样本不足应比同信号全样本低档：short=${short.level} full=${full.level}`
  );
});

test("estimateInvestment：证据只描述行为，不出现心理推断词", () => {
  const result = estimateInvestment(HIGH_MESSAGES);
  const joined = result.evidence.map((item) => item.text).join("");
  for (const word of ["喜欢", "好感", "心动", "爱", "在意你"]) {
    assert.ok(!joined.includes(word), `证据中不应出现心理推断词「${word}」`);
  }
  assert.ok(result.evidence.every((item) => typeof item.signal === "string" && item.text.length > 0));
});

test("estimateInvestment：忽略无文本消息", () => {
  const withNoise = [...LOW_MESSAGES, { type: "her", text: "   " }, { type: "her" }];
  assert.equal(estimateInvestment(withNoise).sampleSize, 10);
});

// ── planAction ───────────────────────────────────────────────────────────────

test("planAction：前期低投入只观察", () => {
  assert.equal(planAction("刚加微信后的第一晚", 0), "observe");
  assert.equal(planAction("隔天轻联系", 1), "observe");
});

test("planAction：中期低投入应后退", () => {
  assert.equal(planAction("第一次邀约", 0), "retreat");
  assert.equal(planAction("第一次约会后", 1), "retreat");
});

test("planAction：后期低投入后退、中投入观察", () => {
  assert.equal(planAction("暧昧推进", 1), "retreat");
  assert.equal(planAction("暧昧推进", 2), "observe");
  assert.equal(planAction("确定关系", 2), "observe");
});

test("planAction：L2 前期维持、L3+ 一律推进", () => {
  assert.equal(planAction("隔天轻联系", 2), "hold");
  assert.equal(planAction("第一次邀约", 2), "hold");
  assert.equal(planAction("第一次邀约", 3), "advance");
  assert.equal(planAction("确定关系", 4), "advance");
});

test("planAction：未知阶段按前期处理，越界 level 收敛", () => {
  assert.equal(planAction("不存在的阶段", 0), "observe");
  assert.equal(planAction(undefined, 99), "advance");
  assert.equal(planAction("", -5), "observe");
});

test("isValidAction：只接受四种动作", () => {
  for (const action of ["observe", "hold", "advance", "retreat"]) {
    assert.equal(isValidAction(action), true);
  }
  assert.equal(isValidAction("push"), false);
  assert.equal(isValidAction(null), false);
});

// ── buildTierPromptLine ──────────────────────────────────────────────────────

test("buildTierPromptLine：无样本时返回空串", () => {
  assert.equal(buildTierPromptLine(normalizeRelationshipTier(null), "隔天轻联系"), "");
});

test("buildTierPromptLine：包含档位、策略与反心理推断约束", () => {
  const tier = deriveRelationshipTier(HIGH_MESSAGES);
  const line = buildTierPromptLine(tier, "第一次邀约");
  assert.match(line, /投入度：L\d/);
  assert.match(line, /本轮策略/);
  assert.match(line, /不得据此推断她的内心/);
});

test("buildTierPromptLine：retreat 时追加硬约束", () => {
  const tier = normalizeRelationshipTier({ level: 0, confidence: "high", sampleSize: 12, evidence: [], score: 0 });
  const line = buildTierPromptLine(tier, "暧昧推进");
  assert.ok(line.includes(RETREAT_CONSTRAINT), "retreat 策略必须附带邀约禁令");
});

test("buildTierPromptLine：advance 时不出现 retreat 约束", () => {
  const tier = normalizeRelationshipTier({ level: 4, confidence: "high", sampleSize: 12, evidence: [], score: 80 });
  assert.ok(!buildTierPromptLine(tier, "暧昧推进").includes(RETREAT_CONSTRAINT));
});

// ── normalizeRelationshipTier ────────────────────────────────────────────────

test("normalizeRelationshipTier：null 收敛到合法默认值", () => {
  const tier = normalizeRelationshipTier(null);
  assert.equal(tier.level, 0);
  assert.equal(tier.label, "观望");
  assert.equal(tier.confidence, "low");
  assert.equal(tier.score, 0);
  assert.deepEqual(tier.evidence, []);
  assert.equal(tier.sampleSize, 0);
  assert.equal(tier.updatedAt, null);
});

test("normalizeRelationshipTier：脏数据被裁剪", () => {
  const tier = normalizeRelationshipTier({
    level: 99,
    confidence: "definitely",
    score: 120,
    sampleSize: -3,
    evidence: [{ signal: "x", text: "有效证据" }, { bad: true }, "字符串"],
    updatedAt: 12345
  });
  assert.equal(tier.level, 4);
  assert.equal(tier.confidence, "low");
  assert.equal(tier.score, 100);
  assert.equal(tier.sampleSize, 0);
  assert.equal(tier.evidence.length, 1);
  assert.equal(tier.updatedAt, null);
  assert.equal(tier.label, INVESTMENT_LABELS[4]);
});

// ── deriveRelationshipTier ───────────────────────────────────────────────────

test("deriveRelationshipTier：首次派生写入时间戳", () => {
  const tier = deriveRelationshipTier(HIGH_MESSAGES, null, () => "2026-01-01T00:00:00.000Z");
  assert.equal(tier.updatedAt, "2026-01-01T00:00:00.000Z");
  assert.ok(tier.updatedAt.length >= 10);
});

test("deriveRelationshipTier：结果未变化时保留原时间戳", () => {
  const first = deriveRelationshipTier(HIGH_MESSAGES, null, () => "2026-01-01T00:00:00.000Z");
  const second = deriveRelationshipTier(HIGH_MESSAGES, first, () => "2026-02-02T00:00:00.000Z");
  assert.equal(second.updatedAt, first.updatedAt);
});

test("deriveRelationshipTier：投入度变化时刷新时间戳", () => {
  const first = deriveRelationshipTier(LOW_MESSAGES, null, () => "2026-01-01T00:00:00.000Z");
  const second = deriveRelationshipTier(HIGH_MESSAGES, first, () => "2026-02-02T00:00:00.000Z");
  assert.equal(second.updatedAt, "2026-02-02T00:00:00.000Z");
  assert.ok(second.level > first.level);
});
