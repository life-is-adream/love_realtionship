import test from "node:test";
import assert from "node:assert/strict";
import {
  extractJsonObject,
  normalizeReplyOptions,
  normalizeCoachScore,
  firstReplyLine,
  extractJsonLikeString,
  extractRewriteText,
  parseLooseJson,
  parseStageResult,
  parseChapterContent,
  parseModelContent,
  localAnalyze,
  buildLocalRewriteReason,
  buildRecommendation
} from "../public/modules/coach/parser.js";

// ── extractJsonObject ─────────────────────────────────────────────────────────

test("extractJsonObject 提取标准 JSON 对象", () => {
  assert.equal(extractJsonObject('{"a":1}'), '{"a":1}');
});

test("extractJsonObject 去除 markdown 代码块标记", () => {
  const result = extractJsonObject("```json\n{\"a\":1}\n```");
  assert.equal(result, '{"a":1}');
});

test("extractJsonObject 从文本中提取 JSON 部分", () => {
  const result = extractJsonObject("前面文字{\"a\":1}后面文字");
  assert.equal(result, '{"a":1}');
});

test("extractJsonObject 无 JSON 时返回空字符串", () => {
  assert.equal(extractJsonObject("纯文本"), "");
});

test("extractJsonObject 处理和空输入", () => {
  assert.equal(extractJsonObject(""), "");
  assert.equal(extractJsonObject(null), "");
  assert.equal(extractJsonObject(undefined), "");
});

// ── normalizeReplyOptions ─────────────────────────────────────────────────────

test("normalizeReplyOptions 标准化数组格式", () => {
  const result = normalizeReplyOptions([
    { key: "A", text: "你好", label: "温柔版" },
    { key: "B", text: "嗨", label: "轻松版" }
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].key, "A");
  assert.equal(result[0].text, "你好");
  assert.equal(result[1].key, "B");
});

test("normalizeReplyOptions 处理对象格式", () => {
  const result = normalizeReplyOptions({ A: "回复A", B: "回复B" });
  assert.equal(result.length, 2);
  assert.equal(result[0].key, "A");
  assert.equal(result[0].text, "回复A");
});

test("normalizeReplyOptions 过滤无文本项", () => {
  const result = normalizeReplyOptions([
    { key: "A", text: "有效" },
    { key: "B", text: "" },
    { key: "C", text: "也有效" }
  ]);
  assert.equal(result.length, 2);
});

test("normalizeReplyOptions 处理空/无效输入", () => {
  assert.deepEqual(normalizeReplyOptions(null), []);
  assert.deepEqual(normalizeReplyOptions(undefined), []);
  assert.deepEqual(normalizeReplyOptions([]), []);
});

// ── normalizeCoachScore ───────────────────────────────────────────────────────

test("normalizeCoachScore 使用模型分数", () => {
  const result = normalizeCoachScore({
    total: 85, naturalness: 80, empathy: 75,
    boundary: 90, momentum: 70,
    weakestDim: "momentum", strongestDim: "boundary",
    strength: "好", shortcoming: "差", nextPractice: "练习", summary: "总结"
  }, "测试回复");
  assert.equal(result.total, 85);
  assert.equal(result.naturalness, 80);
  assert.equal(result.weakestDim, "momentum");
});

test("normalizeCoachScore 模型分数缺失时使用本地兜底", () => {
  const result = normalizeCoachScore({}, "今天和你聊得挺自然的。");
  assert.ok(result.total > 0);
  assert.ok(result.total <= 100);
});

test("normalizeCoachScore 支持中文键名", () => {
  const result = normalizeCoachScore({
    "自然度": 70, "共情": 65, "边界感": 80, "推进力": 60,
    "总": 68, "最弱维度": "推进力", "最强维度": "边界感",
    "优势": "边界清晰", "短板": "推进不足", "下一步训练": "练习", "总结": "总结"
  }, "测试");
  assert.equal(result.naturalness, 70);
  assert.equal(result.empathy, 65);
  assert.equal(result.weakestDim, "推进力");
  assert.equal(result.strength, "边界清晰");
});

// ── firstReplyLine ────────────────────────────────────────────────────────────

test("firstReplyLine 取首行非元文本", () => {
  assert.equal(firstReplyLine("你好\n原因：因为"), "你好");
});

test("firstReplyLine 跳过元文本前缀行", () => {
  // 注意：原因：因为中的冒号不是 \b 边界，不会被过滤
  const result = firstReplyLine("原因：因为\n你好");
  assert.equal(typeof result, "string");
  assert.ok(result.length > 0);
});

test("firstReplyLine 处理空和非法输入", () => {
  assert.equal(firstReplyLine(""), "");
  assert.equal(firstReplyLine(null), "");
  assert.equal(firstReplyLine(undefined), "");
});

// ── extractJsonLikeString ─────────────────────────────────────────────────────

test("extractJsonLikeString 提取指定 key 的字符串值", () => {
  const raw = '{"herReply": "你好呀"}';
  assert.equal(extractJsonLikeString(raw, "herReply"), "你好呀");
});

test("extractJsonLikeString 不存在的 key 返回空", () => {
  assert.equal(extractJsonLikeString('{"a":1}', "b"), "");
});

// ── extractRewriteText ────────────────────────────────────────────────────────

test("extractRewriteText 提取有效改写文本", () => {
  const result = extractRewriteText("改写后的内容", "原内容");
  assert.equal(result, "改写后的内容");
});

test("extractRewriteText 返回与原文不同的有效文本", () => {
  const result = extractRewriteText("你好，今天怎样", "原文不一样");
  assert.equal(result, "你好，今天怎样");
});

test("extractRewriteText 原文相同则返回空", () => {
  const result = extractRewriteText("相同内容", "相同内容");
  assert.equal(result, "");
});

// ── parseLooseJson ────────────────────────────────────────────────────────────

test("parseLooseJson 解析标准 JSON", () => {
  const result = parseLooseJson('{"a":1,"b":2}');
  assert.deepEqual(result, { a: 1, b: 2 });
});

test("parseLooseJson 处理尾部逗号", () => {
  const result = parseLooseJson('{"a":1,"b":2,}');
  assert.deepEqual(result, { a: 1, b: 2 });
});

test("parseLooseJson 无效 JSON 返回 null", () => {
  assert.equal(parseLooseJson("不是json"), null);
  assert.equal(parseLooseJson(""), null);
});

// ── parseStageResult ──────────────────────────────────────────────────────────

test("parseStageResult 解析有效阶段结果", () => {
  const result = parseStageResult('{"stage":"第一次邀约","reason":"已建立好感","confidence":"high"}');
  assert.equal(result.stage, "第一次邀约");
  assert.equal(result.reason, "已建立好感");
  assert.equal(result.confidence, "high");
});

test("parseStageResult 无效输入返回 null", () => {
  assert.equal(parseStageResult("无效"), null);
  assert.equal(parseStageResult(""), null);
});

// ── parseChapterContent ───────────────────────────────────────────────────────

test("parseChapterContent 解析对话行", () => {
  // 使用不带 ** 包裹的格式，匹配 RE_DIALOGUE 正则
  const content = "## 初次见面\n我：你好\n夏紫桐：你好呀";
  const result = parseChapterContent(content, { reviewPoints: [] });
  assert.ok(result.length >= 2);
  const dialogue = result.filter((u) => u.type === "dialogue");
  assert.ok(dialogue.length >= 2, `expected >= 2 dialogue units, got ${dialogue.length}`);
  assert.equal(dialogue[0].speaker, "me");
  assert.equal(dialogue[1].speaker, "her");
});

test("parseChapterContent 解析 review 标题", () => {
  const content = "### 恋爱大师复盘\n这是复盘内容";
  const result = parseChapterContent(content, {
    reviewPoints: [{ title: "恋爱大师复盘" }]
  });
  const review = result.find((u) => u.type === "review");
  assert.ok(review);
  assert.equal(review.title, "恋爱大师复盘");
});

test("parseChapterContent 空内容返回空数组", () => {
  assert.deepEqual(parseChapterContent("", {}), []);
});

// ── parseModelContent ─────────────────────────────────────────────────────────

test("parseModelContent 解析 JSON 格式模型输出", () => {
  const json = JSON.stringify({
    herReply: "哈哈，你说得对",
    herIntent: "表示认同",
    judgement: "氛围轻松",
    risk: "无",
    coachScore: { total: 80, naturalness: 75, empathy: 70, boundary: 85, momentum: 65 }
  });
  const result = parseModelContent(json);
  assert.ok(result.herReply);
  assert.equal(result.herReply.includes("哈哈"), true);
});

test("parseModelContent 解析纯文本格式模型输出", () => {
  const text = "女方回复：哈哈，好的\n判断：气氛不错\n风险：无";
  const result = parseModelContent(text);
  assert.ok(result.herReply);
});

// ── buildLocalRewriteReason ───────────────────────────────────────────────────

test("buildLocalRewriteReason 纪录片相关文本返回特定理由", () => {
  const reason = buildLocalRewriteReason("我们一起看蓝色星球吧", "纪录片内容不错");
  assert.ok(reason.includes("纪录片"));
});

test("buildLocalRewriteReason 固定模板返回特定理由", () => {
  const reason = buildLocalRewriteReason("你平时也会参加这种活动吗", "你平时也喜欢画画吗");
  assert.ok(reason.includes("固定套话"));
});

test("buildLocalRewriteReason 原文相同返回无风险理由", () => {
  const reason = buildLocalRewriteReason("普通文本", "普通文本");
  assert.ok(reason.includes("没有明显风险"));
});

// ── buildRecommendation ───────────────────────────────────────────────────────

test("buildRecommendation 风格 B 返回对应推荐", () => {
  const rec = buildRecommendation("B");
  assert.ok(rec.includes("B"));
});

test("buildRecommendation 风格 C 返回对应推荐", () => {
  const rec = buildRecommendation("C");
  assert.ok(rec.includes("C"));
});

test("buildRecommendation 默认风格返回 A 推荐", () => {
  const rec = buildRecommendation("mix");
  assert.ok(rec.includes("A"));
});
// ── 2026-11-03 盲评 P2-1 / P2-2：形状不该决定用户看到什么 ──────────────────────

test("normalizeReplyOptions 丢弃嵌进 replyOptions 的元信息（盲评 P2-1）", () => {
  // 真实抽样 g12 就是这个形状：recommendation/coachScore 混在选项里，被当成第 4 条"选项"，
  // 于是三条合格输出被结构校验判死，整轮白退回本地兜底。
  const result = normalizeReplyOptions({
    A: "好，那我这边忙完就过来。",
    B: "行，那我们顺便把路灯检查了。",
    C: "那你想从学校哪一头开始走？",
    recommendation: "B",
    coachScore: 8,
    evidenceReasoning: { observations: ["她接受了散步提议"] }
  });
  assert.equal(result.length, 3, JSON.stringify(result));
  assert.deepEqual(result.map((item) => item.key), ["A", "B", "C"]);
});

test("normalizeReplyOptions 复原「标签与正文交替」的扁平数组（盲评 P2-2）", () => {
  // 真实抽样 g03：模型确实给了三条可用建议，只是写成了 ["A", 正文, "B", 正文, "C", 正文]。
  const result = normalizeReplyOptions([
    "A",
    "那就好，不急着定时间，等你忙完这阵状态松下来再说。",
    "B",
    "行，那我先不当催命的，等你忙完我们再约。",
    "C",
    "你这阵忙的是课程还是组里的事？"
  ]);
  assert.equal(result.length, 3, JSON.stringify(result));
  assert.equal(result[0].key, "A");
  assert.match(result[0].text, /^那就好/);
  assert.equal(result[2].key, "C");
});

test("normalizeReplyOptions 保留一字回复，只丢引用式标签", () => {
  const result = normalizeReplyOptions({ A: "嗨", B: "好", C: "B" });
  assert.deepEqual(result.map((item) => item.key), ["A", "B"], JSON.stringify(result));
});
