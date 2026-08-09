import { detectWeaknessPatterns, applyCalibration, buildCalibrationFeedback } from "../core/user-profile.js";

/**
 * @typedef {Object} CoachScore
 * @property {number} total - 总分 0-100
 * @property {number} naturalness - 自然度
 * @property {number} empathy - 共情
 * @property {number} boundary - 边界感
 * @property {number} momentum - 推进力
 * @property {string} weakestDim - 最弱维度 key
 * @property {string} strongestDim - 最强维度 key
 * @property {string} strength - 亮点
 * @property {string} shortcoming - 短板
 * @property {string} nextPractice - 下一步练习
 * @property {string} summary - 总结
 */

/**
 * 将分数限制在 0-100 范围内
 * @param {number} value - 原始分数
 * @returns {number}
 */
export function clampScore(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 70;
  return Math.max(0, Math.min(100, Math.round(num)));
}

/**
 * 四维教练评分引擎
 * @param {string} text - 用户回复
 * @param {Object} [context] - 上下文
 * @param {string} [context.risk] - 边界风险提示
 * @param {string} [context.judgement] - 关系判断
 * @param {string} [context.herLastMessage] - 女方上一条消息
 * @returns {CoachScore}
 */
export function buildCoachScore(text, context = {}) {
  const reply = String(text || "").trim();
  const length = reply.length;
  const questionCount = (reply.match(/[？?]/g) || []).length;
  const hasQuestion = questionCount > 0;
  const tooManyQuestions = questionCount >= 2;

  const signals = {
    hasSpecific: /今天|这次|刚才|之前|你提到|你说|那部|那个|这种|这类|这里/.test(reply),
    hasEmpathy: /辛苦|谢谢|理解|舒服|放松|挺好|不错|稳|自然|同感|我懂|确实|知道|明白|累|生气|难过|担心|感受|选择|空间/.test(reply),
    hasPressure: /喜欢|爱|必须|一定|马上|宝贝|约吗|出来[吗吧见玩坐吃]|确定关系|做我|能不能|男朋友|女朋友|单身|前任/.test(reply),
    hasBoundaryRisk: /性感|身材|睡|酒店|亲密|撩爆|抱抱|想你了/.test(reply),
    genericQuestion: /你平时.*?(?:也|会|喜欢|经常).*?(?:吗|么|嘛)[？?]?$/.test(reply),
    selfCentered: (reply.match(/我/g) || []).length >= 3 && questionCount === 0,
    oneWord: length <= 6,
    tooLong: length > 90,
    hasStatement: /[。！!]/.test(reply),
    hasPause: /……|\.\.\.|～|~/.test(reply),
    // 校准新增信号：过度解释检测（连续使用解释性短语）
    hasOverthinking: ((reply.match(/我意思是|不是说你|其实我就是|就是说|我的意思是|不是那个意思|我不是说/g) || []).length >= 2),
    // 校准新增信号：引用对方具体原话（而非泛化"你说的"）；覆盖弯引号“”、直角引号「」『』和 ASCII "
    hasSpecificReference: /你刚才说的|你提到的/.test(reply) || /[“「『"][^“”「」『』"']{1,40}[”」』"]/.test(reply),
    // 校准新增信号：模糊情绪暗示（把解释工作推给对方）
    hasVagueImplication: /真正重要的.*反而|你可能不知道|我不是说.*但是/.test(reply),
    // 校准新增信号：居高临下评价（替对方打分）
    hasPatronizing: /已经很厉害|你做得不错|值得鼓励|值得表扬|你比以前/.test(reply),
    // 校准新增信号：自我修正（承认不当表达并及时收回）
    hasSelfCorrection: /抱歉，|收回推理|收回结论|我又把|刚才又一点/.test(reply),
    // 校准新增信号：接受拒绝（尊重对方说"不"）
    hasAcceptance: /好，?那就不|好，?不语音|好，?那就/.test(reply),
    // 校准新增信号：边界尊重（主动给对方选择权和空间）
    hasBoundaryRespect: /你愿意.*就说|不用.*承担|不替你接管|选择权|你不用因为/.test(reply),
    // 校准新增信号：共情式声明（主动表达理解而非评价）
    hasEmpatheticStatement: /我知道|我听到|我明白|我能理解|我听到你|不用.*承担/.test(reply),
    // 校准新增信号：留门表达（给对方未来回复的空间）
    hasOpenDoor: /想说的时候|有空.*再说|不用.*报备|想发.*就发/.test(reply),
    // 校准新增信号：创意比喻（用比喻让表达更生动）
    hasCreativeMetaphor: /像一只|像一场|像刚开完|像被/.test(reply),
    // 校准新增信号：情绪检查（追问对方情绪状态）
    hasEmotionalCheck: /是不是.*(?:高兴|心情|生气|开心|难受|不舒服|不高兴)/.test(reply),
    // 校准新增信号：否认/轻描淡写
    hasDismissive: /只是随便/.test(reply)
  };

  // 维度计算：校准后基准分与权重
  const naturalness = clampScore(
    54
    + Math.min(length, 36) * 0.6
    + (signals.hasSpecific ? 12 : 0)
    + (signals.hasCreativeMetaphor ? 8 : 0)
    - (signals.tooLong ? 14 : 0)
    - (signals.oneWord ? 18 : 0)
    - (signals.genericQuestion ? 8 : 0)
    - (tooManyQuestions ? 10 : 0)
    - (signals.hasOverthinking ? 8 : 0)
  );

  const empathy = clampScore(
    54
    + (signals.hasEmpathy ? 14 : 0)
    + (signals.hasSpecific ? 8 : 0)
    + (signals.hasPause ? 5 : 0)
    + (signals.hasSpecificReference ? 6 : 0)
    + (signals.hasEmpatheticStatement ? 8 : 0)
    + (signals.hasBoundaryRespect ? 5 : 0)
    - (signals.hasPressure ? 14 : 0)
    - (signals.selfCentered ? 12 : 0)
    - (signals.hasPatronizing ? 8 : 0)
  );

  const boundary = clampScore(
    70
    - (signals.hasPressure ? 16 : 0)
    - (signals.hasBoundaryRisk ? 36 : 0)
    - (tooManyQuestions ? 8 : 0)
    - (signals.hasPressure && signals.hasQuestion ? 10 : 0)
    - (signals.hasOverthinking ? 6 : 0)
    - (signals.hasVagueImplication ? 8 : 0)
    - (signals.hasEmotionalCheck ? 8 : 0)
    - (signals.hasDismissive ? 6 : 0)
    + (signals.hasSelfCorrection ? 5 : 0)
    + (signals.hasAcceptance ? 5 : 0)
    + (signals.hasBoundaryRespect ? 5 : 0)
  );

  const momentum = clampScore(
    52
    + (hasQuestion ? 15 : 0)
    + (signals.hasSpecific ? 10 : 0)
    + (signals.hasSpecificReference ? 5 : 0)
    + (signals.hasOpenDoor ? 10 : 0)
    - (!reply ? 20 : 0)
    - (signals.oneWord ? 14 : 0)
    - (signals.genericQuestion ? 6 : 0)
  );

  // --- 个人校准层：检测用户弱点模式并追加扣分 ---
  const triggeredPatterns = detectWeaknessPatterns(reply, context);
  const calibrated = applyCalibration(triggeredPatterns, { naturalness, empathy, boundary, momentum });
  const calNaturalness = calibrated.naturalness;
  const calEmpathy = calibrated.empathy;
  const calBoundary = calibrated.boundary;
  const calMomentum = calibrated.momentum;

  const total = clampScore(
    Math.round(
      calNaturalness * 0.26
      + calEmpathy * 0.24
      + calBoundary * 0.26
      + calMomentum * 0.24
    )
  );

  const dims = [
    { key: "naturalness", label: "自然度", value: calNaturalness },
    { key: "empathy", label: "共情", value: calEmpathy },
    { key: "boundary", label: "边界感", value: calBoundary },
    { key: "momentum", label: "推进力", value: calMomentum }
  ];
  const weakest = dims.slice().sort((a, b) => a.value - b.value)[0];
  // When all dims tie, the strongest would equal the weakest — force a distinct
  // dimension so the "亮点 / 短板" labels never point at the same thing.
  const strongestCandidates = dims.slice().sort((a, b) => b.value - a.value);
  const strongest = strongestCandidates.find((d) => d.key !== weakest.key) || strongestCandidates[0];

  const feedback = buildFeedback({ reply, length, questionCount, hasQuestion, tooManyQuestions, signals, weakest, strongest, context });

  // 个人校准反馈：触发弱点模式时，用定向反馈覆盖通用建议
  const calibrationFeedback = buildCalibrationFeedback(triggeredPatterns);
  if (calibrationFeedback) {
    feedback.shortcoming = calibrationFeedback.shortcoming;
    feedback.nextPractice = calibrationFeedback.nextPractice;
  }

  return {
    total,
    naturalness: calNaturalness,
    empathy: calEmpathy,
    boundary: calBoundary,
    momentum: calMomentum,
    weakestDim: weakest.key,
    strongestDim: strongest.key,
    triggeredPatterns: triggeredPatterns.map((p) => p.id),
    strength: feedback.strength,
    shortcoming: feedback.shortcoming,
    nextPractice: feedback.nextPractice,
    summary: feedback.summary
  };
}

function hashReply(reply) {
  let h = 0;
  for (let i = 0; i < reply.length; i++) {
    h = ((h << 5) - h) + reply.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function pickFromPool(reply, pool) {
  if (!pool || pool.length === 0) return "";
  return pool[hashReply(reply) % pool.length];
}

function buildFeedback({ reply, length, questionCount, hasQuestion, tooManyQuestions, signals, weakest, strongest, context }) {
  const riskNote = context.risk && /风险|施压|严格|越界/.test(context.risk)
    ? "本轮要重点控制需求感和边界。"
    : "";

  // 1. 先根据最强维度生成本轮亮点
  const strength = pickStrength({ reply, signals, strongest, hasQuestion, length });

  // 2. 根据最弱维度 + 具体信号生成本轮短板
  const shortcoming = pickShortcoming({ reply, signals, weakest, hasQuestion, tooManyQuestions, length, questionCount });

  // 3. 根据最弱维度给出下一步训练动作
  const nextPractice = pickNextPractice({ reply, weakest, signals, hasQuestion, tooManyQuestions, length });

  // 4. 总结：把风险提醒和整体评价拼起来
  const summary = buildSummary({ signals, weakest, riskNote, reply });

  return { strength, shortcoming, nextPractice, summary };
}

function pickStrength({ reply, signals, strongest, hasQuestion, length }) {
  const pools = {
    naturalness: [
      "表达自然，没有把对话变成‘面试’或‘演讲’。",
      "节奏舒服，字数控制得当，像日常微信聊天。"
    ],
    empathy: [
      "能回应对方的情绪或细节，让对方感到被接住。",
      "语气友好、克制，没有讨好感。"
    ],
    boundary: [
      "表达有分寸，没有越界或施压的措辞。",
      "懂得给对方留空间，没有急着推进关系。"
    ],
    momentum: [
      "用问题或具体话题给下一轮留了接话点。",
      "能承接上文并延续对话方向。"
    ]
  };

  // 如果同时满足某些正向组合，给出更具体的亮点
  if (signals.hasSpecific && hasQuestion) {
    return "能把对方的具体细节接进自己的问题里，既自然又有延续性。";
  }
  if (signals.hasEmpathy && signals.hasSpecific) {
    return "回应了对方的情绪，同时落到了具体细节上，不生硬。";
  }
  if (length >= 20 && length <= 60 && !signals.tooLong) {
    return "长度刚好，既表达了意思，又不显得用力。";
  }
  if (signals.hasPause && signals.hasEmpathy) {
    return "语气和停顿到位，有真实对话感。";
  }

  const base = pools[strongest.key] || pools.naturalness;
  return pickFromPool(reply, base);
}

function pickShortcoming({ reply, signals, weakest, hasQuestion, tooManyQuestions, length, questionCount }) {
  // 越界风险优先级最高
  if (signals.hasBoundaryRisk) {
    return "出现明显越界词汇，容易让对方产生不安全感。建议先删掉这类词，回到普通朋友语气。";
  }
  if (signals.hasPressure && hasQuestion) {
    return "问题里带有催促或暧昧压力，容易让对方为难。把问题改成可自由回答的开放题。";
  }
  if (tooManyQuestions) {
    return `连续提了 ${questionCount} 个问题，容易像查户口。下一轮先回应对方，再最多补一个开放问题。`;
  }
  if (signals.genericQuestion && !signals.hasSpecific) {
    return "问题太通用，像固定模板。下一轮结合她刚提到的具体细节来提问。";
  }
  if (signals.selfCentered) {
    return "表达里‘我’太多，容易变成自我展示。下一轮先关注她的内容，再带一点自己的经历。";
  }
  if (signals.tooLong) {
    return "句子偏长，微信初聊容易显得用力。下一轮压缩到一两句，把最想说的先说。";
  }
  if (signals.oneWord) {
    return "回复太短，对方很难接。下一轮至少给出一个具体回应 + 一个轻量问题。";
  }

  const pools = {
    naturalness: [
      "表达略生硬或偏模板，试着用更像你平时说话的词。",
      "缺少具体情境，对方可能觉得这句对谁都适用。"
    ],
    empathy: [
      "回应偏理性，少了对她情绪或细节的承接。",
      "可以先用一句话接住她的话，再表达自己的想法。"
    ],
    boundary: [
      "措辞里有轻微推进感，当前阶段可以再慢一点。",
      "关系还没到可以暧昧的程度，建议保持普通朋友语气。"
    ],
    momentum: [
      "没有给下一轮留‘钩子’，对话容易在这里断掉。",
      "这一轮以陈述结尾，对方接话的成本会变高。"
    ]
  };

  const base = pools[weakest.key] || pools.naturalness;
  return pickFromPool(reply, base);
}

function pickNextPractice({ reply, weakest, signals, hasQuestion, tooManyQuestions, length }) {
  const practices = {
    naturalness: [
      "下一轮先把她刚说的话用你自己的语言复述一句，再补一个相关问题。",
      "下一轮尝试引用她刚提到的一个具体词，让她感觉你在认真听。"
    ],
    empathy: [
      "下一轮先回应她的感受或细节，再说你自己的事，顺序很重要。",
      "下一轮在她的话里找一个情绪词（累/开心/无聊），先接一句再说别的。"
    ],
    boundary: [
      "下一轮去掉催促、评价、暧昧词，改成可退一步的普通朋友表达。",
      "下一轮把注意力放在话题本身，而不是推进关系上。"
    ],
    momentum: [
      "下一轮在结尾补一个和当前话题相关的轻量问题，例如‘你怎么看？’或‘你更喜欢哪种？’。",
      "下一轮先回应她，再问一个让她愿意多打两行字的问题。"
    ]
  };

  if (tooManyQuestions) return "下一轮只保留一个问题，并先回应她刚说的内容。";
  if (signals.genericQuestion) return "下一轮把‘你平时也…吗’改成基于她刚才具体细节的提问。";
  if (!hasQuestion && length < 30) return "下一轮太短了，先回应她的点，再加一个让她能接的问题。";
  if (!hasQuestion) return "下一轮在表达结尾加一个开放问题，给对方留接话空间。";
  if (signals.tooLong) return "下一轮把回复压缩到两句以内，去掉修饰和解释。";

  const base = practices[weakest.key] || practices.naturalness;
  return pickFromPool(reply, base);
}

function buildSummary({ signals, weakest, riskNote, reply }) {
  if (!reply) return "还没有可评分的回复。";
  if (riskNote) return riskNote;

  if (signals.hasBoundaryRisk) return "本轮存在越界风险，优先修正措辞。";
  if (signals.hasPressure) return "本轮推进感偏强，建议放慢节奏。";
  if (weakest.value >= 72) return "本轮整体均衡，继续保持当前节奏。";

  const dimLabels = {
    naturalness: "自然度",
    empathy: "共情",
    boundary: "边界感",
    momentum: "推进力"
  };

  return `本轮短板在${dimLabels[weakest.key]}，针对性练习这一项即可。`;
}

/**
 * 检测回复中的风险信号
 * @param {string} text - 用户回复
 * @param {Object} [memory] - 角色记忆
 * @returns {Object} 检测结果
 */
export function detectReplyFlags(text, memory = {}) {
  const reply = String(text || "");
  // 上下文感知匹配：每个风险词附带排除短语，避免"没看出来"触发"出来"等误报
  const riskyPatterns = [
    { word: "必须", exclude: [] },
    { word: "一定", exclude: ["不一定", "不一定"] },
    { word: "马上", exclude: [] },
    { word: "宝贝", exclude: [] },
    { word: "亲", exclude: ["亲切", "亲近", "亲自", "亲身", "亲戚", "亲爱"] },
    { word: "性感", exclude: [] },
    { word: "身材", exclude: [] },
    { word: "酒店", exclude: [] },
    { word: "睡", exclude: ["睡不着", "睡了", "午睡", "早睡", "晚安睡"] },
    { word: "出来", exclude: ["没看出来", "看不出来", "说出来", "表达出来", "表现出来", "看出来", "听出来", "感觉出来", "体会出来"] },
    { word: "约吗", exclude: [] },
  ];
  const hit = riskyPatterns.filter(({ word, exclude }) => {
    if (!reply.includes(word)) return false;
    // 如果命中词被排除短语覆盖，则不算风险
    return !exclude.some((ex) => reply.includes(ex));
  }).map(({ word }) => word);
  const tooLong = reply.length > 90;
  const tooManyQuestions = (reply.match(/[？?]/g) || []).length >= 2;

  if (hit.length) {
    return { level: "high", warning: `有明显越界或施压词：${hit.join("、")}。先删掉，再改成低压力表达。` };
  }
  if (tooManyQuestions) {
    return { level: "medium", warning: "问题偏多，容易像审问。保留一个开放问题即可。" };
  }
  if (tooLong) {
    return { level: "medium", warning: "句子偏长，微信初聊容易显得用力。压缩到一到两句。" };
  }
  if (memory.boundaries && /过早|施压|查户口/.test(memory.boundaries)) {
    return { level: "low", warning: "当前角色重视边界，保持轻松、具体、可退一步的表达。" };
  }
  return { level: "low", warning: "没有明显硬伤，可以发送；如果要更好，加一点具体生活细节。" };
}

/**
 * 生成更安全的回复改写
 * @param {string} text - 原始回复文本
 * @param {string} persona - 角色人设
 * @param {Object} flags - 检测结果标记
 * @param {string} flags.level - 风险等级 ("high"|"medium"|"low")
 * @param {string} flags.warning - 风险提示信息
 * @returns {string} 改写后的安全回复
 */
export function buildSaferRewrite(text, persona, flags) {
  const clean = String(text || "")
    .replace(/宝贝|亲|性感|身材|酒店|睡|必须|一定|马上/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (flags.level === "high") {
    return "今天和你聊得挺自然的，我还挺想听听你平时喜欢怎么放松。";
  }
  if ((clean.match(/[？?]/g) || []).length >= 2) {
    return clean.replace(/[？?].*?[？?]/, "？");
  }
  if (clean.length > 90) {
    return `${clean.slice(0, 56)}。你平时也会这样想吗？`;
  }
  const genericQuestion = /你平时也会参加这种活动吗[？?]?$/;
  if (genericQuestion.test(clean)) {
    const context = clean.replace(genericQuestion, "").replace(/[。！!，,]+$/, "").trim();
    if (/蓝色星球|纪录片|电影|视频|看了|看过|观看/.test(context)) {
      return `${context}。你平时也会看这类纪录片吗？`;
    }
    if (/志愿|活动|社团|比赛|项目/.test(context)) {
      return `${context}。你平时也会参加类似的活动吗？`;
    }
    return `${context}。你是怎么对这个产生兴趣的？`;
  }
  if (!/[？?]/.test(clean)) {
    return `${clean}。你是怎么对这个产生兴趣的？`;
  }

  const question = clean.match(/([^。！？!?]*[？?])$/)?.[1] || "";
  const body = question ? clean.slice(0, -question.length).replace(/[。！!，,]+$/, "").trim() : clean;
  if (body && /平时|参加这种|这类活动/.test(question)) {
    return `${body}。你平时会接触类似的内容吗？`;
  }
  return clean;
}
