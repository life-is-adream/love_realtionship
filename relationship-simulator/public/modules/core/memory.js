/**
 * 增强记忆系统
 *
 * 在现有 personaMemory (background/interests/boundaries) 基础上，
 * 自动从对话中提取信息，维护交互历史、学习偏好和时间线。
 *
 * @module memory
 */

import { MEMORY_CONFIG, EMOTION_CONFIG } from "./config.js";
import { shanghaiDate } from "./date.js";

// ── 类型定义（仅供 IDE 提示） ─────────────────────────────────────────────────

/**
 * @typedef {Object} MemoryTimelineEvent
 * @property {string} timestamp - ISO 时间戳
 * @property {string} type - 事件类型
 * @property {string} content - 事件内容
 * @property {string} [source] - 来源
 */

/**
 * @typedef {Object} InteractionHistory
 * @property {number} totalConversations - 总对话轮次
 * @property {number} messagesExchanged - 总消息数
 * @property {string|null} lastInteractionDate - 上次互动时间
 * @property {Array<string>} commonTopics - 常见话题
 * @property {Array<string>} communicationPatterns - 沟通模式
 */

/**
 * @typedef {Object} LearnedPreferences
 * @property {string|null} responseStyle - 偏好回复风格
 * @property {Array<string>} riskAreas - 易出风险领域
 * @property {Array<string>} strengths - 优势维度
 */

/**
 * @typedef {Object} ConversationSummary
 * @property {string} date - 对话日期
 * @property {number} messageCount - 消息数
 * @property {string} summary - 摘要
 * @property {Array<string>} topics - 涉及话题
 * @property {number} avgScore - 平均评分
 */

/**
 * @typedef {Object} EnhancedMemory
 * @property {string} background - 关系背景（兼容旧版）
 * @property {string} interests - 兴趣（兼容旧版）
 * @property {string} boundaries - 边界（兼容旧版）
 * @property {InteractionHistory} interactionHistory - 交互历史
 * @property {Array<MemoryTimelineEvent>} memoryTimeline - 记忆时间线
 * @property {LearnedPreferences} learnedPreferences - 学习偏好
 * @property {Array<ConversationSummary>} conversationSummaries - 对话摘要
 * @property {string} _version - 数据结构版本
 */

// ── 默认值 ────────────────────────────────────────────────────────────────────

/** @returns {EnhancedMemory} */
export function createDefaultEnhancedMemory() {
  return {
    background: "",
    interests: "",
    boundaries: "",
    interactionHistory: {
      totalConversations: 0,
      messagesExchanged: 0,
      lastInteractionDate: null,
      commonTopics: [],
      communicationPatterns: []
    },
    memoryTimeline: [],
    learnedPreferences: {
      responseStyle: null,
      riskAreas: [],
      strengths: []
    },
    conversationSummaries: [],
    _version: "1.0.0"
  };
}

// ── 核心函数 ───────────────────────────────────────────────────────────────────

/**
 * 从对话消息中提取记忆更新
 *
 * @param {Array<{type: string, text: string, who?: string}>} messages - 对话消息
 * @param {Object} [lastAnalysis] - 最近一次分析结果（含 coachScore）
 * @returns {Object} 记忆更新 { background?, interests?, boundaries?, timelineEvents?, topics?, patterns? }
 */
export function extractMemoryFromConversation(messages, lastAnalysis = null) {
  const updates = {};
  const meMessages = messages.filter((m) => m.type === "me" && m.text);
  const herMessages = messages.filter((m) => m.type === "her" && m.text);

  if (meMessages.length === 0 && herMessages.length === 0) return updates;

  // 提取话题关键词
  const topics = extractTopics([...meMessages, ...herMessages]);
  if (topics.length > 0) updates.topics = topics;

  // 检测沟通模式
  const patterns = detectCommunicationPatterns(meMessages);
  if (patterns.length > 0) updates.patterns = patterns;

  // 根据最后一条女方消息推断兴趣/边界更新
  const lastHer = herMessages[herMessages.length - 1];
  if (lastHer) {
    const interestHint = inferInterest(lastHer.text);
    if (interestHint) updates.interestHint = interestHint;
  }

  // 从教练评分提取优势/风险
  if (lastAnalysis?.coachScore) {
    const score = lastAnalysis.coachScore;
    if (score.total >= 80) updates.positiveInteraction = true;
    if (score.boundary < 60) updates.boundaryRisk = true;
    if (score.empathy < 60) updates.empathyRisk = true;
  }

  return updates;
}

/**
 * 将提取的记忆更新合并到现有增强记忆中
 *
 * @param {EnhancedMemory} enhanced - 现有增强记忆
 * @param {Object} updates - extractMemoryFromConversation 的返回值
 * @param {Array<{type: string, text: string}>} messages - 完整消息列表
 * @param {Object} [analysis] - 本轮教练分析（取 coachScore 计入会话摘要）
 * @returns {EnhancedMemory} 更新后的增强记忆
 */
export function updateMemoryState(enhanced, updates, messages = [], analysis = null) {
  const result = { ...enhanced };
  if (!result.interactionHistory) result.interactionHistory = createDefaultEnhancedMemory().interactionHistory;
  if (!result.memoryTimeline) result.memoryTimeline = [];
  if (!result.learnedPreferences) result.learnedPreferences = createDefaultEnhancedMemory().learnedPreferences;
  if (!result.conversationSummaries) result.conversationSummaries = [];

  const history = result.interactionHistory;
  history.messagesExchanged += messages.filter((m) => m.text).length;
  history.totalConversations += 1;
  history.lastInteractionDate = new Date().toISOString();

  // 更新话题
  if (updates.topics) {
    const topicSet = new Set([...history.commonTopics, ...updates.topics]);
    history.commonTopics = Array.from(topicSet).slice(0, 20);
  }

  // 更新沟通模式
  if (updates.patterns) {
    const patternSet = new Set([...history.communicationPatterns, ...updates.patterns]);
    history.communicationPatterns = Array.from(patternSet);
  }

  // 添加时间线事件
  if (updates.topics?.length) {
    result.memoryTimeline.push({
      timestamp: new Date().toISOString(),
      type: "topics_discussed",
      content: `涉及话题：${updates.topics.join("、")}`,
      source: "auto"
    });
  }
  if (updates.positiveInteraction) {
    result.memoryTimeline.push({
      timestamp: new Date().toISOString(),
      type: "positive_interaction",
      content: "高质量互动（评分 ≥ 80）",
      source: "coach_score"
    });
  }

  // 更新学习偏好
  if (updates.boundaryRisk) {
    if (!result.learnedPreferences.riskAreas.includes("边界感")) {
      result.learnedPreferences.riskAreas.push("边界感");
    }
  }
  if (updates.empathyRisk) {
    if (!result.learnedPreferences.riskAreas.includes("共情")) {
      result.learnedPreferences.riskAreas.push("共情");
    }
  }

  // 会话摘要：关系档案面板的「对话摘要」区块由此填充。不写入就没有可看、可删的记录。
  if (Array.isArray(messages) && messages.length > 0) {
    result.conversationSummaries.push(buildConversationSummary(messages, analysis));
    if (result.conversationSummaries.length > MEMORY_CONFIG.maxConversationSummaries) {
      result.conversationSummaries = result.conversationSummaries.slice(-MEMORY_CONFIG.maxConversationSummaries);
    }
  }

  // 裁剪时间线
  if (result.memoryTimeline.length > MEMORY_CONFIG.maxTimelineEvents) {
    result.memoryTimeline = result.memoryTimeline.slice(-MEMORY_CONFIG.maxTimelineEvents);
  }

  return result;
}

/**
 * 选出真正进入角色上下文的记忆条目（最近 3 条时间线 + 最近 1 条摘要）。
 *
 * 唯一选择器：`buildMemoryInjection` 与记忆核对护栏都读这里，
 * 避免两处各自 slice，出现「面板说注入了 3 条、核对却读了别处」的分叉。
 *
 * @param {EnhancedMemory} enhanced
 * @returns {{timeline: Array<Object>, summary: Object|null}}
 */
export function selectInjectedMemoryEntries(enhanced) {
  const timeline = Array.isArray(enhanced?.memoryTimeline)
    ? enhanced.memoryTimeline.slice(-3).filter((item) => String(item?.content || "").trim())
    : [];
  const summary = Array.isArray(enhanced?.conversationSummaries)
    ? enhanced.conversationSummaries.at(-1) || null
    : null;
  return { timeline, summary };
}

/**
 * 构建要注入 system prompt 的记忆文本
 *
 * @param {EnhancedMemory} enhanced - 增强记忆
 * @returns {string} 注入文本
 */
export function buildMemoryInjection(enhanced) {
  const parts = [];
  const { timeline, summary } = selectInjectedMemoryEntries(enhanced);

  // 近期记忆时间线（最后 3 条）与最近一次会话摘要：让「关系档案」面板里可见的
  // 条目真正参与生成，用户删除某条后它就不再出现在这里（可见即生效）。
  const recent = timeline.map((item) => String(item?.content || "").trim()).filter(Boolean);
  if (recent.length) parts.push(`近期记忆：${recent.join("；")}`);

  const summaryText = String(summary?.summary || "").trim();
  if (summaryText) parts.push(`最近一次会话摘要：${summaryText}`);

  return parts.join("\n");
}

/**
 * 创建对话摘要
 *
 * @param {Array<{type: string, text: string}>} messages - 对话消息
 * @param {Object} [analysis] - 分析结果
 * @returns {ConversationSummary}
 */
export function buildConversationSummary(messages, analysis = null) {
  const meMsgs = messages.filter((m) => m.type === "me");
  const herMsgs = messages.filter((m) => m.type === "her");
  const topics = extractTopics(messages);
  const avgScore = analysis?.coachScore?.total ?? 0;

  return {
    date: shanghaiDate(),
    messageCount: messages.length,
    summary: `我发送了 ${meMsgs.length} 条，对方发送了 ${herMsgs.length} 条。${topics.length ? `涉及话题：${topics.join("、")}` : ""}`,
    topics,
    avgScore
  };
}

// ── 内部工具函数 ───────────────────────────────────────────────────────────────

/**
 * 构建对话逐句摘要文本（P2-10：自 state.js 收敛至本模块，消除与
 * buildConversationSummary 的同名冲突；函数体逐行等价迁移，行为不变）
 *
 * @param {Array<{type: string, text: string, who?: string}>} messages - 对话消息
 * @returns {string} "我：xxx；她（谁）：yyy" 形式的摘要，超 520 字符截断
 */
export function buildConversationTranscript(messages) {
  if (!messages.length) return "";
  const parts = messages.map((message) => {
    const speaker = message.type === "her" ? `她${message.who ? `（${message.who}）` : ""}` : "我";
    const snippet = String(message.text || "").replace(/\s+/g, " ").trim().slice(0, 32);
    return `${speaker}：${snippet}`;
  });
  const summary = parts.join("；");
  return summary.length > 520 ? `${summary.slice(0, 520)}…` : summary;
}

/**
 * 从消息中提取话题关键词
 * @param {Array<{text: string}>} messages
 * @returns {Array<string>}
 */
function extractTopics(messages) {
  const topicKeywords = [
    "工作", "学习", "爱好", "电影", "音乐", "美食", "旅行", "运动",
    "读书", "宠物", "游戏", "摄影", "绘画", "健身", "烹饪", "星座",
    "家庭", "朋友", "周末", "假期", "未来", "理想", "计划", "日常"
  ];
  const found = new Set();
  for (const msg of messages) {
    for (const keyword of topicKeywords) {
      if (msg.text.includes(keyword)) found.add(keyword);
    }
  }
  return Array.from(found);
}

/**
 * 检测用户沟通模式
 * @param {Array<{text: string}>} meMessages
 * @returns {Array<string>}
 */
function detectCommunicationPatterns(meMessages) {
  const patterns = [];
  const questionCount = meMessages.filter((m) => /[？?]/.test(m.text)).length;
  const longMsgCount = meMessages.filter((m) => m.text.length > 60).length;
  const total = meMessages.length || 1;

  if (questionCount / total > 0.5) patterns.push("提问偏多");
  if (longMsgCount / total > 0.3) patterns.push("表达偏长");
  if (meMessages.some((m) => /[！!]{2,}/.test(m.text))) patterns.push("情绪表达强烈");
  if (meMessages.some((m) => /哈哈|嘿嘿|笑死/.test(m.text))) patterns.push("轻松幽默");

  return patterns;
}

/**
 * 从女方消息推断兴趣
 * @param {string} text
 * @returns {string|null}
 */
function inferInterest(text) {
  const interestKeywords = [
    ["喜欢|爱|享受|感兴趣", "很有兴趣"],
    ["最近在看|在追|在玩", "正在关注"],
    ["想学|想试|想去|想了解", "有意愿尝试"]
  ];
  for (const [pattern, hint] of interestKeywords) {
    if (new RegExp(pattern).test(text)) {
      return hint;
    }
  }
  return null;
}

/**
 * 检测消息的情感标记
 *
 * @param {string} text - 消息文本
 * @returns {Array<{label: string, confidence: number}>}
 */
export function detectEmotionLabels(text) {
  const results = [];

  const rules = [
    { label: "positive", patterns: [/哈哈|嘿嘿|开心|不错|好呀|谢谢|喜欢|真好|绝了|笑死/], weight: 0.6 },
    { label: "warm", patterns: [/温暖|贴心|感动|理解|谢谢|有心了/], weight: 0.5 },
    { label: "anxious", patterns: [/担心|焦虑|紧张|不安|怕|慌|不知所措/], weight: 0.5 },
    { label: "defensive", patterns: [/不是|才没有|你别误会|不是你想的那样|我又没/], weight: 0.5 },
    { label: "distant", patterns: [/嗯嗯|哦|好吧|随便|都行|不知道/], weight: 0.4 },
    { label: "eager", patterns: [/真的吗|然后呢|还有吗|快说|想听|继续/], weight: 0.5 },
    { label: "hesitant", patterns: [/可能|也许|大概|算是|有点|不太确定/], weight: 0.4 }
  ];

  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        results.push({ label: rule.label, confidence: rule.weight });
        break;
      }
    }
  }

  // 默认 neutral
  if (results.length === 0) {
    results.push({ label: "neutral", confidence: 0.5 });
  }

  return results.filter((r) => r.confidence >= EMOTION_CONFIG.confidenceThreshold);
}

/**
 * 分析双向情感交互模式
 *
 * @param {Array<{type: string, text: string}>} messages - 消息列表
 * @returns {Object} 情感分析结果
 */
export function analyzeEmotionalFlow(messages) {
  const meLabels = messages.filter((m) => m.type === "me").map((m) => detectEmotionLabels(m.text));
  const herLabels = messages.filter((m) => m.type === "her").map((m) => detectEmotionLabels(m.text));

  return {
    myDominantEmotions: aggregateEmotionLabels(meLabels),
    herDominantEmotions: aggregateEmotionLabels(herLabels),
    interactionBalance: meLabels.length > 0 && herLabels.length > 0
      ? "互有回应"
      : "信息不足"
  };
}

/**
 * 汇总情感标记列表
 * @param {Array<Array<{label: string, confidence: number}>>} labelSets
 * @returns {Array<string>}
 */
function aggregateEmotionLabels(labelSets) {
  const freq = {};
  for (const set of labelSets) {
    for (const { label } of set) {
      freq[label] = (freq[label] || 0) + 1;
    }
  }
  const total = Object.values(freq).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(freq)
    .filter(([, count]) => count / total >= 0.2)
    .sort(([, a], [, b]) => b - a)
    .map(([label]) => label);
}

// ── 持久化 ────────────────────────────────────────────────────────────────────

const MEMORY_VERSION = "1.0.0";

/**
 * 校验增强记忆数据的完整性，缺失字段用默认值填充
 * @param {Object} raw - 原始数据
 * @returns {EnhancedMemory}
 */
export function validateEnhancedMemory(raw) {
  if (!raw || typeof raw !== "object") return createDefaultEnhancedMemory();
  const def = createDefaultEnhancedMemory();
  return {
    background: typeof raw.background === "string" ? raw.background : def.background,
    interests: typeof raw.interests === "string" ? raw.interests : def.interests,
    boundaries: typeof raw.boundaries === "string" ? raw.boundaries : def.boundaries,
    interactionHistory: {
      totalConversations: raw.interactionHistory?.totalConversations || 0,
      messagesExchanged: raw.interactionHistory?.messagesExchanged || 0,
      lastInteractionDate: raw.interactionHistory?.lastInteractionDate || null,
      commonTopics: Array.isArray(raw.interactionHistory?.commonTopics) ? raw.interactionHistory.commonTopics : [],
      communicationPatterns: Array.isArray(raw.interactionHistory?.communicationPatterns) ? raw.interactionHistory.communicationPatterns : []
    },
    memoryTimeline: Array.isArray(raw.memoryTimeline) ? raw.memoryTimeline : [],
    learnedPreferences: {
      responseStyle: typeof raw.learnedPreferences?.responseStyle === "string" ? raw.learnedPreferences.responseStyle : null,
      riskAreas: Array.isArray(raw.learnedPreferences?.riskAreas) ? raw.learnedPreferences.riskAreas : [],
      strengths: Array.isArray(raw.learnedPreferences?.strengths) ? raw.learnedPreferences.strengths : []
    },
    conversationSummaries: Array.isArray(raw.conversationSummaries) ? raw.conversationSummaries : [],
    _version: MEMORY_VERSION
  };
}

/**
 * 迁移旧版本记忆数据到当前版本
 * @param {Object} raw - 原始数据
 * @returns {EnhancedMemory}
 */
export function migrateMemory(raw) {
  if (!raw || typeof raw !== "object") return createDefaultEnhancedMemory();
  const version = raw._version || "0.0.0";
  if (version === MEMORY_VERSION) return validateEnhancedMemory(raw);

  let migrated = { ...raw };
  // v0.x → v1.0: 确保 interactionHistory 存在
  if (!migrated.interactionHistory) {
    migrated.interactionHistory = {
      totalConversations: 0, messagesExchanged: 0, lastInteractionDate: null,
      commonTopics: [], communicationPatterns: []
    };
  }
  if (!migrated.memoryTimeline) migrated.memoryTimeline = [];
  if (!migrated.learnedPreferences) {
    migrated.learnedPreferences = { responseStyle: null, riskAreas: [], strengths: [] };
  }
  if (!migrated.conversationSummaries) migrated.conversationSummaries = [];
  migrated._version = MEMORY_VERSION;
  return validateEnhancedMemory(migrated);
}

/**
 * 将增强记忆导出为 JSON 字符串
 * @param {EnhancedMemory} enhanced - 增强记忆
 * @returns {string} JSON 字符串
 */
export function exportMemory(enhanced) {
  return JSON.stringify(validateEnhancedMemory(enhanced), null, 2);
}

/**
 * 从 JSON 字符串导入增强记忆
 * @param {string} json - JSON 字符串
 * @returns {{ok: boolean, data?: EnhancedMemory, error?: string}}
 */
export function importMemory(json) {
  try {
    const parsed = JSON.parse(json);
    const validated = validateEnhancedMemory(parsed);
    return { ok: true, data: validated };
  } catch (e) {
    return { ok: false, error: `解析失败：${e.message}` };
  }
}

// ── 长期模式识别 ───────────────────────────────────────────────────────────────

/**
 * 分析多次对话的长期趋势
 * @param {EnhancedMemory} enhanced - 增强记忆
 * @returns {Object} 长期模式分析结果
 */
export function analyzeLongTermPatterns(enhanced) {
  const { interactionHistory, learnedPreferences, memoryTimeline, conversationSummaries } = enhanced;
  const patterns = {};

  // 话题趋势：统计话题出现频率
  if (interactionHistory?.commonTopics?.length) {
    patterns.topTopics = interactionHistory.commonTopics.slice(0, 10);
  }

  // 沟通模式演变
  if (interactionHistory?.communicationPatterns?.length) {
    patterns.communicationStyles = interactionHistory.communicationPatterns;
  }

  // 风险趋势
  if (learnedPreferences?.riskAreas?.length) {
    patterns.riskAreas = learnedPreferences.riskAreas;
  }
  if (learnedPreferences?.strengths?.length) {
    patterns.strengths = learnedPreferences.strengths;
  }

  // 分数趋势
  const scores = conversationSummaries
    .filter((s) => s.avgScore > 0)
    .map((s) => ({ date: s.date, score: s.avgScore }));
  if (scores.length >= 2) {
    const recent = scores.slice(-3);
    const avgRecent = recent.reduce((sum, s) => sum + s.score, 0) / recent.length;
    const older = scores.slice(0, Math.min(3, scores.length - recent.length));
    const avgOlder = older.length > 0 ? older.reduce((sum, s) => sum + s.score, 0) / older.length : 0;
    patterns.scoreTrend = {
      recentAvg: Math.round(avgRecent),
      olderAvg: Math.round(avgOlder),
      direction: avgRecent > avgOlder + 5 ? "improving" : avgRecent < avgOlder - 5 ? "declining" : "stable"
    };
  }

  // 积极/消极事件统计
  if (memoryTimeline?.length) {
    const positive = memoryTimeline.filter((e) => e.type === "positive_interaction").length;
    const risk = memoryTimeline.filter((e) => e.type === "risk_detected").length;
    patterns.eventBalance = { positive, risk, total: memoryTimeline.length };
  }

  // 互动频率
  if (interactionHistory?.lastInteractionDate) {
    const daysSinceLast = Math.floor((Date.now() - new Date(interactionHistory.lastInteractionDate).getTime()) / 86400000);
    patterns.daysSinceLastInteraction = daysSinceLast;
    patterns.interactionFrequency = interactionHistory.totalConversations > 0
      ? `${Math.round(interactionHistory.messagesExchanged / interactionHistory.totalConversations)} 条/轮`
      : "暂无数据";
  }

  return patterns;
}

/**
 * 将长期模式分析结果转换为注入文本
 * @param {Object} patterns - analyzeLongTermPatterns 的返回值
 * @returns {string} 注入文本
 */
export function buildPatternInjection(patterns) {
  const parts = [];
  if (!patterns || Object.keys(patterns).length === 0) return "";

  if (patterns.topTopics?.length) {
    parts.push(`长期关注话题：${patterns.topTopics.join("、")}`);
  }
  if (patterns.communicationStyles?.length) {
    parts.push(`沟通风格：${patterns.communicationStyles.join("、")}`);
  }
  if (patterns.scoreTrend) {
    const dir = patterns.scoreTrend.direction === "improving" ? "提升" : patterns.scoreTrend.direction === "declining" ? "下降" : "稳定";
    parts.push(`表现趋势：${dir}（近期均分 ${patterns.scoreTrend.recentAvg}，早期均分 ${patterns.scoreTrend.olderAvg}）`);
  }
  if (patterns.riskAreas?.length) {
    parts.push(`需持续关注的领域：${patterns.riskAreas.join("、")}`);
  }
  if (patterns.daysSinceLastInteraction !== undefined) {
    parts.push(`距离上次互动：${patterns.daysSinceLastInteraction} 天`);
  }

  return parts.join("\n");
}
