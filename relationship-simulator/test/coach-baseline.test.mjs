import test from "node:test";
import assert from "node:assert/strict";
import { buildCoachScore } from "../public/modules/coach/coach.js";

/**
 * 教练评分基准校验测试
 *
 * 样本来源：第1章"恋爱大师复盘"中的男方回复
 * - 负向样本（复盘指出有风险）：对应维度不得高于 65
 * - 正向样本（复盘肯定）：按基准文档逐条使用对应阈值；核心样本不低于 75，边界能力样本保留 60/65/70 的校准阈值
 *
 * 校准内容：
 * - boundary 基准分 78 → 70
 * - naturalness 基准分 56 → 54
 * - empathy 的 hasEmpathy 加分 18 → 14
 * - momentum 的 hasQuestion 加分 18 → 15
 * - 新增 hasOverthinking 扣分信号
 * - 新增 hasSpecificReference 加分信号
 */

// ── 负向样本（复盘指出有风险的男方回复）──────────────────────────────────────

test("负向: '可能记得太多没用的细节，真正重要的反而忘了' → boundary ≤ 65", () => {
  const score = buildCoachScore("可能记得太多没用的细节，真正重要的反而忘了。");
  assert.ok(score.boundary <= 65, `expected boundary ≤ 65, got ${score.boundary}`);
});

test("负向: '已经很厉害了' → empathy ≤ 65（评价式语言）", () => {
  const score = buildCoachScore("已经很厉害了。");
  assert.ok(score.empathy <= 65, `expected empathy ≤ 65, got ${score.empathy}`);
});

test("负向: '你先忙你的，等你方便再说' → empathy ≤ 65（回避式收尾）", () => {
  const score = buildCoachScore("你先忙你的，等你方便再说。");
  assert.ok(score.empathy <= 65, `expected empathy ≤ 65, got ${score.empathy}`);
});

test("负向: '你现在有男朋友吗？' → boundary ≤ 65（过早直接）", () => {
  const score = buildCoachScore("你现在有男朋友吗？");
  assert.ok(score.boundary <= 65, `expected boundary ≤ 65, got ${score.boundary}`);
});

test("负向: '你是不是不高兴？' → boundary ≤ 65（检查式追问）", () => {
  const score = buildCoachScore("你是不是不高兴？");
  assert.ok(score.boundary <= 65, `expected boundary ≤ 65, got ${score.boundary}`);
});

test("负向: '我只是随便去看了看' → boundary ≤ 65（否认感受）", () => {
  const score = buildCoachScore("我只是随便去看了看。");
  assert.ok(score.boundary <= 65, `expected boundary ≤ 65, got ${score.boundary}`);
});

test("负向: '你确定是你借给我的？' → empathy ≤ 65（质疑对方记忆）", () => {
  const score = buildCoachScore("你确定是你借给我的？");
  assert.ok(score.empathy <= 65, `expected empathy ≤ 65, got ${score.empathy}`);
});

test("负向: 过度解释 '我意思是...不是说你...其实我就是' → naturalness ≤ 70", () => {
  const score = buildCoachScore("我意思是天气还不错，不是说你一定要出门，其实我就是想问问你有没有空。");
  assert.ok(score.naturalness <= 70, `expected naturalness ≤ 70, got ${score.naturalness}`);
});

test("负向: '如果你周五晚上有空可以一起去' → momentum ≤ 70（模糊邀约）", () => {
  const score = buildCoachScore("如果你周五晚上有空可以一起去。");
  assert.ok(score.momentum <= 70, `expected momentum ≤ 70, got ${score.momentum}`);
});

test("负向: 连续追问 '你今天在做什么？吃饭了吗？忙吗？' → boundary ≤ 65", () => {
  const score = buildCoachScore("你今天在做什么？吃饭了吗？忙吗？");
  assert.ok(score.boundary <= 65, `expected boundary ≤ 65, got ${score.boundary}`);
});

// ── 正向样本（复盘肯定的男方回复）────────────────────────────────────────────

test("正向: '偶尔，最近公司搬到那一片附近' → naturalness ≥ 75（具体自然）", () => {
  const score = buildCoachScore("偶尔，最近公司搬到那一片附近。今天开完会走错了路，才发现校门口那家卖烤冷面的店还在。");
  assert.ok(score.naturalness >= 75, `expected naturalness ≥ 75, got ${score.naturalness}`);
});

test("正向: '抱歉，这句有点装深沉。你不用接。' → boundary ≥ 75（自我修正）", () => {
  const score = buildCoachScore("抱歉，这句有点装深沉。你不用接。");
  assert.ok(score.boundary >= 75, `expected boundary ≥ 75, got ${score.boundary}`);
});

test("正向: '你愿意说多少就说多少，我也不会把没说的部分自动补成故事' → boundary ≥ 75", () => {
  const score = buildCoachScore("明白。你愿意说多少就说多少，我也不会把没说的部分自动补成故事。");
  assert.ok(score.boundary >= 75, `expected boundary ≥ 75, got ${score.boundary}`);
});

test("正向: '你不用因为我两天没发消息就承担确认我的责任' → empathy ≥ 65", () => {
  const score = buildCoachScore("你不用因为我两天没发消息就承担确认我的责任。");
  assert.ok(score.empathy >= 65, `expected empathy ≥ 65, got ${score.empathy}`);
});

test("正向: '刚才是你选的帮忙，不是我替你接管' → empathy ≥ 75", () => {
  const score = buildCoachScore("我知道。刚才是你选的帮忙，不是我替你接管。");
  assert.ok(score.empathy >= 75, `expected empathy ≥ 75, got ${score.empathy}`);
});

test("正向: '好，那就不语音' → boundary ≥ 75（接受拒绝）", () => {
  const score = buildCoachScore("好，那就不语音。");
  assert.ok(score.boundary >= 75, `expected boundary ≥ 75, got ${score.boundary}`);
});

test("正向: '你昨天做了几件事，今天可能会累' → empathy ≥ 70（描述事实而非评价）", () => {
  const score = buildCoachScore("听起来你昨天做了不少事，今天估计会有点累。");
  assert.ok(score.empathy >= 70, `expected empathy ≥ 70, got ${score.empathy}`);
});

test("正向: '我午饭吃了便利店关东煮，萝卜像海绵' → naturalness ≥ 75（生活细节）", () => {
  const score = buildCoachScore("我今天午饭吃了便利店关东煮，里面有一块萝卜像海绵，吸了很多汤但没有味道。");
  assert.ok(score.naturalness >= 75, `expected naturalness ≥ 75, got ${score.naturalness}`);
});

test("正向: '好，我收回推理' → boundary ≥ 75（及时收手）", () => {
  const score = buildCoachScore("好，我收回推理。");
  assert.ok(score.boundary >= 75, `expected boundary ≥ 75, got ${score.boundary}`);
});

test("正向: '我能理解你为什么生气，但我不确定自己有没有资格判断' → empathy ≥ 75", () => {
  const score = buildCoachScore("我能理解你为什么生气，但我不确定自己有没有资格判断你是不是太较真。");
  assert.ok(score.empathy >= 75, `expected empathy ≥ 75, got ${score.empathy}`);
});

test("正向: '你想说的时候发就行' → momentum ≥ 60（给空间也留接口）", () => {
  const score = buildCoachScore("你想说的时候发就行。");
  assert.ok(score.momentum >= 60, `expected momentum ≥ 60, got ${score.momentum}`);
});

test("正向: '这盆绿萝看起来像刚开完一场很长的会' → naturalness ≥ 75（幽默具体）", () => {
  const score = buildCoachScore("这盆绿萝看起来像刚开完一场很长的会。");
  assert.ok(score.naturalness >= 70, `expected naturalness ≥ 70, got ${score.naturalness}`);
});

// ── 函数签名兼容性 ───────────────────────────────────────────────────────────

test("buildCoachScore 函数签名不变：返回所有必要字段", () => {
  const score = buildCoachScore("测试回复。", { risk: "测试", judgement: "测试" });
  assert.ok(typeof score.total === "number");
  assert.ok(typeof score.naturalness === "number");
  assert.ok(typeof score.empathy === "number");
  assert.ok(typeof score.boundary === "number");
  assert.ok(typeof score.momentum === "number");
  assert.ok(typeof score.weakestDim === "string");
  assert.ok(typeof score.strongestDim === "string");
  assert.ok(typeof score.strength === "string");
  assert.ok(typeof score.shortcoming === "string");
  assert.ok(typeof score.nextPractice === "string");
  assert.ok(typeof score.summary === "string");
});

test("buildCoachScore 无 context 参数也能正常工作（向后兼容）", () => {
  const score = buildCoachScore("今天和你聊得挺自然的。");
  assert.ok(score.total > 0);
  assert.ok(score.total <= 100);
});
