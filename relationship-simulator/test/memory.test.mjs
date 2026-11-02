import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultEnhancedMemory,
  extractMemoryFromConversation,
  updateMemoryState,
  buildMemoryInjection,
  buildConversationSummary,
  detectEmotionLabels,
  analyzeEmotionalFlow,
  validateEnhancedMemory,
  migrateMemory,
  exportMemory,
  importMemory,
  analyzeLongTermPatterns,
  buildPatternInjection
} from "../public/modules/core/memory.js";

// ── createDefaultEnhancedMemory ───────────────────────────────────────────────

test("createDefaultEnhancedMemory 返回完整结构", () => {
  const mem = createDefaultEnhancedMemory();
  assert.equal(typeof mem.background, "string");
  assert.equal(typeof mem.interests, "string");
  assert.equal(typeof mem.boundaries, "string");
  assert.ok(mem.interactionHistory);
  assert.equal(mem.interactionHistory.totalConversations, 0);
  assert.equal(mem.interactionHistory.messagesExchanged, 0);
  assert.ok(Array.isArray(mem.memoryTimeline));
  assert.ok(mem.learnedPreferences);
  assert.ok(Array.isArray(mem.conversationSummaries));
  assert.equal(mem._version, "1.0.0");
});

// ── extractMemoryFromConversation ─────────────────────────────────────────────

test("extractMemoryFromConversation 空消息返回空对象", () => {
  assert.deepEqual(extractMemoryFromConversation([]), {});
});

test("extractMemoryFromConversation 提取话题", () => {
  const messages = [
    { type: "me", text: "你平时喜欢看电影吗" },
    { type: "her", text: "喜欢啊，最近在看科幻片" }
  ];
  const result = extractMemoryFromConversation(messages);
  assert.ok(result.topics);
  assert.ok(result.topics.includes("电影"));
});

test("extractMemoryFromConversation 检测沟通模式", () => {
  const messages = [
    { type: "me", text: "你平时喜欢做什么？" },
    { type: "me", text: "周末有什么安排吗？" },
    { type: "me", text: "你喜欢看电影吗？" }
  ];
  const result = extractMemoryFromConversation(messages);
  assert.ok(result.patterns);
});

test("extractMemoryFromConversation 从教练评分提取风险", () => {
  const messages = [{ type: "me", text: "你好" }, { type: "her", text: "嗨" }];
  const analysis = {
    coachScore: { total: 55, boundary: 50, empathy: 45, naturalness: 60, momentum: 55 }
  };
  const result = extractMemoryFromConversation(messages, analysis);
  assert.ok(result.boundaryRisk);
  assert.ok(result.empathyRisk);
});

test("extractMemoryFromConversation 高质量互动标记", () => {
  const messages = [{ type: "me", text: "你好" }, { type: "her", text: "嗨" }];
  const analysis = {
    coachScore: { total: 85, boundary: 80, empathy: 80, naturalness: 85, momentum: 75 }
  };
  const result = extractMemoryFromConversation(messages, analysis);
  assert.ok(result.positiveInteraction);
});

// ── updateMemoryState ─────────────────────────────────────────────────────────

test("updateMemoryState 初始化空增强记忆", () => {
  const result = updateMemoryState({}, { topics: ["电影", "美食"] }, [{ type: "me", text: "你好" }]);
  assert.ok(result.interactionHistory);
  assert.equal(result.interactionHistory.messagesExchanged, 1);
  assert.equal(result.interactionHistory.totalConversations, 1);
  assert.ok(result.memoryTimeline.length > 0);
});

test("updateMemoryState 累加话题", () => {
  const base = createDefaultEnhancedMemory();
  const result = updateMemoryState(base, { topics: ["电影"] }, [{ type: "me", text: "hi" }]);
  assert.ok(result.interactionHistory.commonTopics.includes("电影"));
});

test("updateMemoryState 合并风险区域", () => {
  const base = createDefaultEnhancedMemory();
  const result = updateMemoryState(base, { boundaryRisk: true }, [{ type: "me", text: "hi" }]);
  assert.ok(result.learnedPreferences.riskAreas.includes("边界感"));
});

test("updateMemoryState：写入会话摘要，关系档案面板才有可看可删的记录", () => {
  const base = createDefaultEnhancedMemory();
  const messages = [
    { type: "me", text: "周末想去看展吗" },
    { type: "her", text: "好呀，周六下午" }
  ];
  const result = updateMemoryState(base, { topics: ["看展"] }, messages, { coachScore: { total: 78 } });
  assert.equal(result.conversationSummaries.length, 1);
  const summary = result.conversationSummaries[0];
  assert.equal(summary.messageCount, 2);
  assert.equal(summary.avgScore, 78, "教练评分应进入摘要");
  assert.match(summary.summary, /我发送了 1 条/);
});

test("updateMemoryState：空消息不产生摘要", () => {
  const base = createDefaultEnhancedMemory();
  const result = updateMemoryState(base, { topics: ["电影"] }, []);
  assert.equal(result.conversationSummaries.length, 0);
});

test("updateMemoryState：摘要按 maxConversationSummaries 裁剪", () => {
  let mem = createDefaultEnhancedMemory();
  for (let i = 0; i < 25; i += 1) {
    // 每轮消息条数递增，用来识别裁剪后保留的是哪几轮
    const messages = Array.from({ length: i + 1 }, (_, n) => ({ type: "me", text: `m${n}` }));
    mem = updateMemoryState(mem, {}, messages);
  }
  assert.equal(mem.conversationSummaries.length, 20, "上限应取自 MEMORY_CONFIG.maxConversationSummaries");
  assert.equal(mem.conversationSummaries[0].messageCount, 6, "最早的 5 轮应被裁掉");
  assert.equal(mem.conversationSummaries.at(-1).messageCount, 25, "保留最近的，裁掉最早的");
});

// ── buildMemoryInjection ──────────────────────────────────────────────────────

test("buildMemoryInjection 空记忆返回空字符串", () => {
  const result = buildMemoryInjection(createDefaultEnhancedMemory());
  assert.equal(result, "");
});

test("buildMemoryInjection 包含基础记忆", () => {
  const mem = createDefaultEnhancedMemory();
  mem.background = "熟悉阶段";
  mem.interests = "电影";
  const result = buildMemoryInjection(mem);
  assert.ok(result.includes("关系背景"));
  assert.ok(result.includes("熟悉阶段"));
  assert.ok(result.includes("她的兴趣"));
  assert.ok(result.includes("电影"));
});

test("buildMemoryInjection 包含增强记忆", () => {
  const mem = createDefaultEnhancedMemory();
  mem.interactionHistory.commonTopics = ["电影", "美食", "旅行", "音乐", "运动"];
  mem.learnedPreferences.riskAreas = ["边界感"];
  const result = buildMemoryInjection(mem);
  assert.ok(result.includes("常见话题"));
  assert.ok(result.includes("需注意的维度"));
});

test("buildMemoryInjection：最近一次会话摘要进入上下文（可见即生效）", () => {
  const mem = createDefaultEnhancedMemory();
  mem.conversationSummaries = [
    { date: "2026-10-20", messageCount: 2, summary: "第一轮摘要", topics: [], avgScore: 0 },
    { date: "2026-10-21", messageCount: 3, summary: "第二轮摘要", topics: [], avgScore: 80 }
  ];
  const result = buildMemoryInjection(mem);
  assert.ok(result.includes("最近一次会话摘要：第二轮摘要"), result);
  assert.ok(!result.includes("第一轮摘要"), "只进最近一次，避免上下文膨胀");
});

// ── buildConversationSummary ──────────────────────────────────────────────────

test("buildConversationSummary 生成对话摘要", () => {
  const messages = [
    { type: "me", text: "你好" },
    { type: "her", text: "嗨，今天过得怎样" },
    { type: "me", text: "还不错，刚看完一部电影" }
  ];
  const summary = buildConversationSummary(messages);
  assert.equal(summary.messageCount, 3);
  assert.ok(summary.topics.length > 0);
  assert.ok(summary.date);
});

test("buildConversationSummary 包含评分", () => {
  const messages = [{ type: "me", text: "hi" }];
  const analysis = { coachScore: { total: 78 } };
  const summary = buildConversationSummary(messages, analysis);
  assert.equal(summary.avgScore, 78);
});

// ── detectEmotionLabels ───────────────────────────────────────────────────────

test("detectEmotionLabels 检测积极情绪", () => {
  const labels = detectEmotionLabels("哈哈，今天真开心");
  assert.ok(labels.some((l) => l.label === "positive"));
});

test("detectEmotionLabels 检测防御情绪", () => {
  const labels = detectEmotionLabels("不是你想的那样，你别误会");
  assert.ok(labels.some((l) => l.label === "defensive"));
});

test("detectEmotionLabels 检测疏离情绪", () => {
  const labels = detectEmotionLabels("嗯嗯，好吧，随便");
  assert.ok(labels.some((l) => l.label === "distant"));
});

test("detectEmotionLabels 中性文本返回 neutral", () => {
  const labels = detectEmotionLabels("今天星期四");
  assert.ok(labels.some((l) => l.label === "neutral"));
});

test("detectEmotionLabels 置信度过滤", () => {
  const labels = detectEmotionLabels("嗯");
  // 只有置信度 >= 0.4 的标签会被返回
  assert.ok(labels.length > 0);
});

// ── analyzeEmotionalFlow ──────────────────────────────────────────────────────

test("analyzeEmotionalFlow 分析双方情绪", () => {
  const messages = [
    { type: "me", text: "哈哈，今天聊得真开心" },
    { type: "her", text: "嗯嗯，好的" }
  ];
  const result = analyzeEmotionalFlow(messages);
  assert.ok(Array.isArray(result.myDominantEmotions));
  assert.ok(Array.isArray(result.herDominantEmotions));
  assert.equal(result.interactionBalance, "互有回应");
});

test("analyzeEmotionalFlow 空消息返回信息不足", () => {
  const result = analyzeEmotionalFlow([]);
  assert.equal(result.interactionBalance, "信息不足");
});

// ── validateEnhancedMemory ────────────────────────────────────────────────────

test("validateEnhancedMemory null 返回默认值", () => {
  const result = validateEnhancedMemory(null);
  assert.equal(result._version, "1.0.0");
  assert.equal(result.interactionHistory.totalConversations, 0);
});

test("validateEnhancedMemory 部分数据填充默认值", () => {
  const result = validateEnhancedMemory({ background: "测试" });
  assert.equal(result.background, "测试");
  assert.ok(Array.isArray(result.memoryTimeline));
  assert.equal(result.interactionHistory.totalConversations, 0);
});

// ── migrateMemory ─────────────────────────────────────────────────────────────

test("migrateMemory 空数据返回默认值", () => {
  const result = migrateMemory(null);
  assert.equal(result._version, "1.0.0");
});

test("migrateMemory 当前版本直接校验", () => {
  const mem = createDefaultEnhancedMemory();
  const result = migrateMemory(mem);
  assert.equal(result._version, "1.0.0");
});

test("migrateMemory 旧版本补全缺失字段", () => {
  const result = migrateMemory({ _version: "0.0.0", background: "旧数据" });
  assert.equal(result.background, "旧数据");
  assert.ok(result.interactionHistory);
  assert.ok(Array.isArray(result.memoryTimeline));
  assert.ok(result.learnedPreferences);
  assert.equal(result._version, "1.0.0");
});

// ── exportMemory / importMemory ───────────────────────────────────────────────

test("exportMemory 导出可导入", () => {
  const mem = createDefaultEnhancedMemory();
  mem.background = "导出测试";
  const json = exportMemory(mem);
  const result = importMemory(json);
  assert.ok(result.ok);
  assert.equal(result.data.background, "导出测试");
});

test("importMemory 非法 JSON 返回错误", () => {
  const result = importMemory("不是 JSON");
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

// ── analyzeLongTermPatterns ───────────────────────────────────────────────────

test("analyzeLongTermPatterns 空记忆返回空对象", () => {
  const result = analyzeLongTermPatterns(createDefaultEnhancedMemory());
  assert.equal(Object.keys(result).length, 0);
});

test("analyzeLongTermPatterns 提取话题趋势", () => {
  const mem = createDefaultEnhancedMemory();
  mem.interactionHistory.commonTopics = ["电影", "美食", "旅行", "电影", "运动"];
  const result = analyzeLongTermPatterns(mem);
  assert.ok(result.topTopics.includes("电影"));
});

test("analyzeLongTermPatterns 分数趋势", () => {
  const mem = createDefaultEnhancedMemory();
  mem.conversationSummaries = [
    { date: "2026-01-01", avgScore: 60 },
    { date: "2026-01-02", avgScore: 70 },
    { date: "2026-01-03", avgScore: 80 },
    { date: "2026-01-04", avgScore: 85 }
  ];
  const result = analyzeLongTermPatterns(mem);
  assert.ok(result.scoreTrend);
  assert.equal(result.scoreTrend.direction, "improving");
});

test("analyzeLongTermPatterns 互动频率", () => {
  const mem = createDefaultEnhancedMemory();
  mem.interactionHistory.totalConversations = 5;
  mem.interactionHistory.messagesExchanged = 20;
  mem.interactionHistory.lastInteractionDate = new Date().toISOString();
  const result = analyzeLongTermPatterns(mem);
  assert.ok(result.interactionFrequency);
  assert.ok(result.interactionFrequency.includes("条/轮"));
});

// ── buildPatternInjection ─────────────────────────────────────────────────────

test("buildPatternInjection 空模式返回空字符串", () => {
  assert.equal(buildPatternInjection({}), "");
});

test("buildPatternInjection 包含话题和趋势", () => {
  const patterns = {
    topTopics: ["电影", "美食"],
    scoreTrend: { direction: "improving", recentAvg: 80, olderAvg: 60 },
    communicationStyles: ["提问偏多"]
  };
  const result = buildPatternInjection(patterns);
  assert.ok(result.includes("电影"));
  assert.ok(result.includes("提升"));
  assert.ok(result.includes("80"));
});