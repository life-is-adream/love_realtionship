/**
 * 个人校准模块
 *
 * 针对用户自述的三个模式化弱点做增强检测和定向反馈：
 * 1. interrogation — 连续追问 / 查户口
 * 2. overthinking — 过度分析 / 犹豫 / 解释过多
 * 3. rationalize-emotion — 用理性分析回应对方情绪
 *
 * 设计原则：
 * - 不改变四维评分的基础逻辑，只在检测到个人弱点时追加扣分和定向反馈
 * - 反馈直接点名模式（"你又查户口了"），而非泛化建议
 * - 导出 prompt 片段供 AI 教练同步关注这些模式
 *
 * @module user-profile.js
 */

/** 用户弱点配置（可按需扩展） */
export const USER_WEAKNESS_PATTERNS = [
  {
    id: "interrogation",
    label: "查户口式追问",
    description: "连续提问、缺乏自我暴露和情绪回应，像在填问卷",
    weight: 1.4, // 该模式触发时，对应维度扣分 ×1.4
    affectsDim: ["naturalness", "empathy"],
  },
  {
    id: "overthinking",
    label: "过度分析/犹豫",
    description: "解释太多、反复修正、怕被误解，不敢推进",
    weight: 1.3,
    affectsDim: ["naturalness", "momentum"],
  },
  {
    id: "rationalize-emotion",
    label: "理性回应情绪",
    description: "对方分享感受时给分析/建议/解决方案，而不是先接住情绪",
    weight: 1.5,
    affectsDim: ["empathy"],
  },
];

/**
 * 检测用户回复中触发了哪些个人弱点模式
 * @param {string} text - 用户回复
 * @param {Object} context - 上下文（可选，含 herLastMessage 等）
 * @returns {Array<{id, label, evidence, feedback, practice}>} 触发的模式列表
 */
export function detectWeaknessPatterns(text, context = {}) {
  const reply = String(text || "").trim();
  if (!reply) return [];

  const triggered = [];
  const questionCount = (reply.match(/[？?]/g) || []).length;
  const herLast = String(context.herLastMessage || "");

  // --- 1. 查户口式追问 ---
  const hasMultipleQuestions = questionCount >= 2;
  const hasGenericQuestions = /你平时|你一般|你经常|你喜欢|你会不会|你有没有|你是哪里|你多大|你做什么/.test(reply);
  const lacksSelfDisclosure = !/我[觉认感]|我上次|我之前|我也|我最近|我昨天|我刚才/.test(reply);
  const lacksEmotionAck = !/辛苦|累|开心|难过|生气|理解|懂|确实|哈哈|挺好|不错/.test(reply);

  if ((hasMultipleQuestions || hasGenericQuestions) && lacksSelfDisclosure && lacksEmotionAck) {
    triggered.push({
      id: "interrogation",
      label: "查户口式追问",
      evidence: hasMultipleQuestions
        ? `一条消息里问了 ${questionCount} 个问题，且没有分享自己的经历或回应她的情绪`
        : "问题太通用（你平时/你喜欢），没有先回应她刚说的内容",
      feedback: "你又查户口了。连续提问会让对方觉得在被审问，而不是在聊天。",
      practice: "下一轮规则：先回应她刚说的一个点（一句话），再分享一个你自己的相关经历（一句话），最后最多补一个问题。",
    });
  }

  // --- 2. 过度分析/犹豫 ---
  const explanationPhrases = (reply.match(/我意思是|不是说你|其实我就是|就是说|我的意思是|不是那个意思|我不是说|怎么说呢|可能我表达|你理解吗|我怕你误会|我不是那个意思/g) || []);
  const hasHedging = explanationPhrases.length >= 2;
  const hasExcessiveLength = reply.length > 80 && questionCount === 0;
  const hasSelfDoubt = /你觉得呢|是不是不太好|我是不是|会不会太|我怕|我不确定这样/.test(reply);
  const hasOverAnalysis = /我觉得你可能|你是不是觉得|我猜你大概|从你的角度|你可能在想/.test(reply);

  if (hasHedging || (hasExcessiveLength && hasSelfDoubt) || hasOverAnalysis) {
    triggered.push({
      id: "overthinking",
      label: "过度分析/犹豫",
      evidence: hasHedging
        ? `用了 ${explanationPhrases.length} 处解释性短语，像在反复澄清怕被误解`
        : hasOverAnalysis
          ? "在替对方分析心理（'我觉得你可能...'），而不是直接表达自己"
          : "写了一大段但没有问题也没有推进，像在自言自语式犹豫",
      feedback: "你又过度解释了。对方大概率没有你想的那么在意措辞，解释越多越显得不自信。",
      practice: "下一轮规则：把想说的话压缩到一句，不解释动机，不加'我不是那个意思'。说完就说完，不需要对方批准。",
    });
  }

  // --- 3. 理性回应情绪 ---
  // 判断条件：她上一条含情绪词，但你的回复是分析/建议/解决方案
  const herHasEmotion = /累|烦|难过|生气|不开心|焦虑|压力|崩溃|受不了|好烦|心情不好|委屈|害怕|紧张|担心/.test(herLast);
  const userGivesSolution = /你应该|你可以|建议你|不如|试试|我觉得你|你要|你得|其实这件事|从客观|理性来说|换个角度|往好处想/.test(reply);
  const userAnalyzes = /原因是|因为.*所以|本质上|根本问题|逻辑上|客观来说|分析/.test(reply);
  const userAckEmotion = /辛苦|理解|懂|确实|我懂|明白|难受|不容易|抱抱|累了|听着就/.test(reply);

  if (herHasEmotion && (userGivesSolution || userAnalyzes) && !userAckEmotion) {
    triggered.push({
      id: "rationalize-emotion",
      label: "理性回应情绪",
      evidence: "她在表达情绪（累/烦/难过），你直接给了分析或建议，没有先接住她的感受",
      feedback: "她又不是在找你解决问题。她分享情绪时，第一反应应该是'接住'，不是'分析'。",
      practice: "下一轮规则：她表达情绪时，第一句永远是回应感受（'听起来确实挺累的'），然后闭嘴等她继续。不要给建议，除非她明确问'你觉得我该怎么办'。",
    });
  }

  return triggered;
}

/**
 * 计算个人校准的额外扣分
 * @param {Array} triggeredPatterns - detectWeaknessPatterns 的返回值
 * @param {Object} baseScores - { naturalness, empathy, boundary, momentum }
 * @returns {Object} 调整后的分数 { naturalness, empathy, boundary, momentum, adjustments }
 */
export function applyCalibration(triggeredPatterns, baseScores) {
  if (!triggeredPatterns.length) return { ...baseScores, adjustments: [] };

  const adjustments = [];
  const adjusted = { ...baseScores };

  for (const pattern of triggeredPatterns) {
    const config = USER_WEAKNESS_PATTERNS.find((p) => p.id === pattern.id);
    if (!config) continue;

    for (const dim of config.affectsDim) {
      const original = adjusted[dim];
      // 额外扣分 = (70 - 原始分) 的一部分，用 weight 放大
      // 如果原始分已经很低（<50），不再追加太多，避免分数崩塌
      const extraPenalty = original > 50
        ? Math.round((70 - original) * (config.weight - 1) * 0.5)
        : Math.round((60 - original) * (config.weight - 1) * 0.3);
      const penalty = Math.max(2, Math.min(extraPenalty, 12)); // 至少扣2分，最多扣12分
      adjusted[dim] = Math.max(20, original - penalty);
      adjustments.push({ pattern: pattern.id, dim, penalty });
    }
  }

  return { ...adjusted, adjustments };
}

/**
 * 生成个人校准反馈（覆盖通用反馈中的 shortcoming 和 nextPractice）
 * @param {Array} triggeredPatterns - detectWeaknessPatterns 的返回值
 * @returns {{ shortcoming: string, nextPractice: string } | null}
 */
export function buildCalibrationFeedback(triggeredPatterns) {
  if (!triggeredPatterns.length) return null;

  // 取第一个触发的模式作为主要反馈（避免信息过载）
  const primary = triggeredPatterns[0];
  return {
    shortcoming: primary.feedback,
    nextPractice: primary.practice,
  };
}

/**
 * 生成注入 AI 教练 system prompt 的个人弱点提醒片段
 * @returns {string} prompt 片段
 */
export function buildWeaknessAwarenessPrompt() {
  return [
    "",
    "【用户个人弱点校准——每轮重点关注】",
    "该用户自述有三个模式化弱点，请在分析和 A/B/C 建议中主动防范：",
    "1. 查户口式追问：容易连续提问、缺乏自我暴露。如果用户本轮又连续问了两个以上问题，在 judgement 里直接指出，A/B/C 中至少有一项示范'先回应再分享再问'的节奏。",
    "2. 过度分析/犹豫：容易解释太多、替对方分析心理、不敢推进。如果用户本轮出现反复澄清或过长犹豫式表达，在 judgement 里点名，A/B/C 示范简洁直接的表达。",
    "3. 理性回应情绪：对方分享情绪时容易给分析/建议而非先接住感受。如果 herReply 含情绪表达，A/B/C 中至少有一项示范'先回应感受，不给建议'。",
    "注意：这三条是用户自己要求被提醒的，语气可以直接、具体，不需要委婉。",
  ].join("\n");
}
