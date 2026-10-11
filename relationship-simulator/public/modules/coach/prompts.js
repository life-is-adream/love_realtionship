/**
 * Prompt 构建纯函数模块
 *
 * 从 app.js 迁移 buildSystemPrompt / buildRelationshipCoachSkillPrompt / buildGenerationTaskPrompt，
 * 改为纯函数（依赖以参数传入），新增介入练习、阶段判断、剧本初始化 prompt。
 *
 * 所有函数不依赖 app.js 的闭包变量（state、$() 等），所需数据一律通过参数传入。
 *
 * @module prompts.js
 * @version 1.0.0
 */

import { STAGE_VALUES } from "../core/stages.js";
import { buildWeaknessAwarenessPrompt } from "../core/user-profile.js";
import { buildPuaAwarenessPrompt } from "../training/pua-awareness.js";

export { buildPuaAwarenessPrompt };

/** Prompt 版本号，供训练日志可选记录 */
export const PROMPT_VERSION = "1.1.0";

/**
 * 恋爱沟通教练技能契约
 * 替代 app.js 原 buildRelationshipCoachSkillPrompt()
 * @param {boolean} [isPuaMode=false] - 是否处于 PUA 识别训练模式
 * @returns {string}
 */
export function buildRelationshipCoachSkillPrompt(isPuaMode = false) {
  return [
    "恋爱沟通教练技能契约（每轮必须执行）：",
    "- 先判断阶段、她的投入程度、情绪语气、用户错误、机会与风险；不要把礼貌回复误判为暧昧或高投入。",
    "- 输出分析要覆盖：可观察事实、至少一个替代解释、支持与反证、目前未知、用户明确目标、A/B/C、推荐、原因、下一步；不猜测隐藏心理，不输出喜欢概率。",
    "- A 是温柔高情商：接住情绪或事实，给空间，低压力；B 是幽默风趣：轻松但不嘲讽、不油腻；C 是深入了解：只问一个具体问题，建立在她刚说的话上。",
    isPuaMode
      ? "- PUA 识别训练模式：用户正在练习识别与防御操控手法。教练不输出任何实施操控的建议；识别到手法时，把识别信号写进 risk，把防御回应写进 recommendation。"
      : "- 不连续追问、不查户口、不制造焦虑、不操控、不 PUA；她表达疲惫、拒绝、边界或结束聊天时，优先尊重并收尾。",
    "- A/B/C 必须是男方对本轮新生成 herReply 的直接回复，不能回复更早的旧消息，也不能把男方已经发过的话原样当成建议。",
    "- A/B/C 是用户可以直接发送给她的话，不是教练对用户的点评；禁止使用‘我听到你说’、‘我先记下’、‘不急着抢答’等元话语，也不要整段复述 herReply。",
    "- 如果 herReply 含有问题，A/B/C 应先直接回应她的问题，再按各自风格自然延伸；每项控制在 1—2 句。",
    "- 如果她说晚安、早点休息、明天再聊或类似结束语，A/B/C 都应自然收尾，不再追问，不强行推进邀约。"
  ].join("\n");
}

/**
 * 生成任务指令
 * 替代 app.js 原 buildGenerationTaskPrompt()
 * @param {boolean} [isPuaMode=false] - 是否处于 PUA 识别训练模式
 */
export function buildGenerationTaskPrompt(isPuaMode = false) {
  return [
    "请基于上面的对话继续生成下一句女方回复。",
    "只输出一个合法 JSON 对象，不要 Markdown，不要代码块，不要解释。",
    "要求：",
    "1. 女方回复要短、自然、像真人微信，不要生硬复述上下文。",
    "2. 回复必须延续刚才的话题，不能突然失忆或跑题。",
    isPuaMode
      ? "3. PUA 识别训练模式下：女方按手法清单演示一种可识别手法；herIntent 标注手法名称，risk 给出识别信号，recommendation 给出防御回应。"
      : "3. 保持尊重、同意与边界，不要操控、PUA、暗示施压。",
    "4. 如果信息不足，也要给出一个能承接当前话题的自然回复。",
    "JSON 字段：herReply, herIntent, yourGoal, judgement, risk, replyOptions, recommendation, coachScore, evidenceReasoning。",
    "evidenceReasoning 必须包含 observations（行为事实字符串数组）、hypotheses（最多两个 {explanation,support:[],counter:[]}）、unknowns（未知字符串数组）；模拟生成的回应标明为虚构情境，不能充当现实结果。",
    "herIntent 仅概述可观察回应或虚构演示手法；yourGoal 仅使用用户明确提供的目标。缺少证据时保持未知，不从回复速度、性别或单次信号断言心理。",
    "replyOptions 只保留 A/B/C 三项，并且每一项都必须是男方对本次 herReply 的直接回复，不能继续回应生成 herReply 之前的旧消息。",
    "A/B/C 必须是可直接发送的聊天文本，不要写教练点评，不要用‘我听到你说’、‘我先记下’、‘不急着抢答’，不要把 herReply 原文整段复制进建议。"
  ].join("\n");
}

/**
 * 构建主聊天系统提示词
 * 替代 app.js 原 buildSystemPrompt()
 *
 * @param {Object} persona - 当前角色对象（getCurrentPersona() 返回值）
 * @param {Object} memory - 角色记忆（getPersonaMemory() 返回值）
 * @param {Object} [options] - 附加选项
 * @param {string} [options.mode] - 训练模式："anti"（反PUA 训练，默认）｜"pua"（PUA 识别训练）
 * @param {{sincerity?: number, toneIntensity?: number}} [options.tone] - 真诚度 / 语气强度调节
 * @returns {string} 系统提示词
 * @version 1.1.0
 */
export function buildSystemPrompt(persona, memory, options = {}) {
  const isPuaMode = options.mode === "pua";
  const parts = [
    "你是中文恋爱沟通教练与女方角色模拟器。",
    buildRelationshipCoachSkillPrompt(isPuaMode),
    buildWeaknessAwarenessPrompt(),
    "你的角色设定：" + (persona.systemRole || persona.logic),
    "角色标签：" + (persona.tags || []).join("、"),
    "关系背景：" + memory.background,
    "她的兴趣：" + memory.interests,
    "边界/禁忌：" + memory.boundaries,
    ""
  ];

  // PUA 识别训练模式：注入可识别手法演示指令（仅防御研究用途）
  if (isPuaMode) {
    parts.push(buildPuaAwarenessPrompt());
    parts.push("");
  }

  // 注入增强记忆（自动提取的对话洞察）
  if (memory._enhancedInjection) {
    parts.push(memory._enhancedInjection);
    parts.push("");
  }

  // 真诚度 / 语气强度调节（可选）
  const toneGuidance = buildToneGuidance(options.tone);
  if (toneGuidance) {
    parts.push(toneGuidance);
    parts.push("");
  }

  parts.push("输出要求：",
    "1. 女方回复要自然、短、像真人微信。",
    "2. 同时给出 A/B/C 三种不同风格的男方回复建议。",
    "3. 区分行为事实、可能解释、反证和未知，使用用户明确目标；未经核实不判断真人内心。",
    isPuaMode
      ? "4. PUA 识别训练模式下：herIntent 必须标注女方本轮使用的可识别手法名称；risk 给出识别信号；recommendation 给出防御回应与健康替代做法。"
      : "4. 不要操控、不要 PUA、不要制造焦虑、尊重边界。",
    "5. 必须按指定 JSON 字段输出，不要 Markdown，不要解释。",
    "",
    "JSON 字段：",
    buildGenerationTaskPrompt(isPuaMode)
  );

  return parts.join("\n");
}

/**
 * 构建介入练习提示词
 *
 * 介入练习只生成女方下一句反应（纯文本），不生成完整 JSON。
 * 与主聊天模式的 systemPrompt 区分：不含教练技能契约和 JSON 输出要求。
 *
 * @param {Object} persona - 夏紫桐角色对象
 * @param {Array<{speaker: string, text: string}>} precedingDialogue - 节点前文对话
 * @param {string} userReply - 用户输入的男方回复
 * @returns {string} 介入练习系统提示词
 * @version 1.0.0
 */
export function buildInterventionPrompt(persona, precedingDialogue, userReply) {
  const dialogueText = (precedingDialogue || []).map((d) => {
    const speaker = d.speaker === "her" ? "夏紫桐" : "我";
    return `${speaker}：${d.text}`;
  }).join("\n");

  return [
    persona.systemRole || persona.logic,
    "",
    "以下是对话前文：",
    dialogueText,
    "",
    `男方（用户）刚刚发送了：${userReply}`,
    "",
    "请只生成夏紫桐的下一句反应。要求：",
    "1. 只输出女方的一句话，不要输出 JSON、不要输出 ABC 建议、不要输出评分。",
    "2. 回复要自然、短、像真人微信。",
    "3. 保持角色设定中的边界感和性格。",
    "4. 不要操控、不要 PUA、尊重对方节奏。",
    "5. 如果男方的回复有越界或施压倾向，夏紫桐可以自然地表达不适或拒绝。"
  ].join("\n");
}

/**
 * 构建阶段自动判断提示词
 *
 * @param {Array<{speaker: string, text: string}>} conversation - 完整对话历史
 * @param {string} currentStage - 当前阶段值
 * @returns {{systemPrompt: string, userPrompt: string}}
 * @version 1.0.0
 */
export function buildStageDetectionPrompt(conversation, currentStage) {
  const systemPrompt = [
    "你是一个中文恋爱关系阶段分析助手。",
    "你的任务是根据对话内容，判断当前关系处于以下 7 个阶段中的哪一个：",
    STAGE_VALUES.join(" / "),
    "",
    "输出要求：",
    "1. 只输出一个 JSON 对象，不要 Markdown，不要解释。",
    "2. JSON 字段：stage（必须是上述 7 个阶段之一的完整名称）, reason（一句话判断理由）, confidence（high/medium/low）。",
    "3. 如果对话信息不足以判断，选择最接近的阶段并标注 confidence 为 low。",
    "4. 不要发明不在列表中的阶段名称。"
  ].join("\n");

  const conversationText = (conversation || []).map((m) => {
    const speaker = m.speaker || (m.type === "her" ? "她" : "我");
    return `${speaker}：${m.text}`;
  }).join("\n");

  const userPrompt = [
    `当前标注的阶段是：${currentStage || "未知"}`,
    "以下是完整对话历史：",
    conversationText,
    "",
    "请判断当前关系实际处于哪个阶段。"
  ].join("\n");

  return { systemPrompt, userPrompt };
}

/**
 * 构建场景剧本初始化提示词（剧本加载后首条消息用）
 *
 * @param {Object} scenario - 剧本对象
 * @returns {string}
 * @version 1.0.0
 */
export function buildScenarioInitPrompt(scenario) {
  return [
    "场景剧本初始化：",
    `剧本标题：${scenario.title}`,
    `情境描述：${scenario.description}`,
    `推荐阶段：${scenario.recommendedStage}`,
    `教练关注维度：${(scenario.coachFocus || []).join("、")}`,
    scenario.contextHint || "",
    "",
    "请基于以上情境，生成女方开场消息。要求自然、短、像真人微信，保持角色边界。"
  ].filter(Boolean).join("\n");
}

/**
 * 消息优化器 2.0 的结构化 Prompt。
 * 本地优化始终先展示；此 Prompt 只用于可选的模型增强。
 */
export function buildOptimizerPrompt(context = {}) {
  const original = String(context.original || "").trim();
  const conversation = Array.isArray(context.conversation) ? context.conversation : [];
  const systemPrompt = [
    "你是中文恋爱沟通训练教练，负责发送前的表达优化。",
    "只输出合法 JSON，不要 Markdown、解释或额外字段。",
    "必须保留用户的真实意图，不替用户虚构经历，不把对方当成需要被操控的对象。",
    "低压力版减少连续追问、隐性责备和无谓解释；主动推进版只增加一个具体、可拒绝的接话点。",
    "不输出 PUA、焦虑制造、贬低、诱导、强迫、越界或医疗判断。",
    "JSON 字段：original, lowPressure{text,changes,reason,risk}, proactive{text,changes,reason,risk}, recommendation, confidence。"
  ].join("\n");
  const userPrompt = [
    `当前阶段：${context.stage || "未知"}`,
    `当前目标：${context.goal || "自然、尊重地继续交流"}`,
    `最近对话：${JSON.stringify(conversation.slice(-6))}`,
    `用户原文：${original}`,
    "请生成两个真正有差异、但不改变核心意图的版本。"
  ].join("\n");
  return { systemPrompt, userPrompt };
}

export function buildSignalExplanationPrompt(context = {}) {
  return {
    systemPrompt: [
      "你是社交信号解读训练教练。",
      "只输出合法 JSON：labels（可多选）、confidence（high/medium/low）、evidence（短证据数组）、uncertainty（一句话）。",
      "必须允许 ambiguous；不要从礼貌、疲惫或收尾推断暧昧，不要输出喜欢度分数。"
    ].join("\n"),
    userPrompt: `消息：${String(context.message || "")}\n上下文：${String(context.context || "无")}`
  };
}

export function buildReplayEnhancementPrompt(context = {}) {
  return {
    systemPrompt: [
      "你是中文恋爱沟通复盘教练。",
      "只输出合法 JSON：summary, observations, suggestions, confidence。",
      "只描述可观察行为和不确定性，不做诊断，不给关系结果下结论。",
      "输入已经在本地脱敏；不要复述身份信息。"
    ].join("\n"),
    userPrompt: [
      `本地摘要：${String(context.summary || "")}`,
      `证据摘录：${JSON.stringify((context.excerpts || []).slice(0, 2))}`
    ].join("\n")
  };
}

/**
 * 真诚度 / 语气强度调节指令。
 *
 * 对抗"AI 话术油腻"的短板：让用户独立调节"语气强弱"（push 尺度）与
 * "真诚程度"（是否克制套路感），注入生成任务 prompt。纯函数、确定性。
 *
 * @param {{sincerity?: number, toneIntensity?: number}} options 0-100 滑块值
 * @returns {string} 注入 prompt 的指令文本（无调节需求时返回空字符串）
 */
export function buildToneGuidance(options = {}) {
  const sincerity = Number(options.sincerity);
  const toneIntensity = Number(options.toneIntensity);
  const hasSincerity = Number.isFinite(sincerity) && sincerity >= 0 && sincerity <= 100;
  const hasTone = Number.isFinite(toneIntensity) && toneIntensity >= 0 && toneIntensity <= 100;
  if (!hasSincerity && !hasTone) return "";

  const lines = [];
  if (hasSincerity) {
    if (sincerity >= 75) lines.push("真诚度：高。回复要更像本人真实表达，避免任何套路感、油腻或表演式措辞；宁可朴素，不要油腻。");
    else if (sincerity >= 40) lines.push("真诚度：中。保持自然表达，可适度修饰，但不要使用夸张或套路化话术。");
    else lines.push("真诚度：低。允许更轻快、有设计感的表达，但仍保持尊重、同意与边界。");
  }
  if (hasTone) {
    if (toneIntensity >= 75) lines.push("语气强度：高。表达可以更有推进感、更主动，但仍需尊重对方节奏。");
    else if (toneIntensity >= 40) lines.push("语气强度：中。推进与克制平衡，不施压、不追逼。");
    else lines.push("语气强度：低。保持低压、给足空间，避免任何施压或催促。");
  }
  return ["【本轮表达调节】", ...lines].join("\n");
}

export function buildCoachPrompt(context = {}) {
  const textbook = context.textbookContext;
  const optionalTextbook = textbook?.excerpts?.length
    ? [
        "",
        "教材参考（仅用于解释，不得编造教材内容）：",
        String(textbook.summary || ""),
        ...textbook.excerpts.slice(0, 2).map((item) => `${item.chapterTitle || "章节"} / ${item.reviewPointId || "复盘点"}：${item.text || ""}`)
      ].join("\n")
    : "";
  return {
    system: [
      buildSystemPrompt(context.persona || {}, context.memory || {}),
      optionalTextbook
    ].filter(Boolean).join("\n"),
    user: String(context.user || "")
  };
}

/**
 * 长期行动计划 Prompt（从 app.js 迁移的纯函数）。
 * 生成长期路线图，不是下一句回复；只输出指定 JSON 字段。
 */
export function buildActionPlanPrompt(context = {}) {
  const persona = context.persona || {};
  const memory = context.memory || {};
  const conversation = Array.isArray(context.conversation) ? context.conversation : [];
  const coachScore = context.coachScore || {};
  return [
    "你是一名尊重、同意与边界优先的中文恋爱沟通教练。",
    "请基于完整对话、角色记忆和训练评分，生成长期路线图，不是下一句回复。",
    "只输出 JSON，不要 Markdown。",
    "字段必须是：title, pacing, objective, steps, topics, decisionRules, warning。",
    `角色：${persona.name || ""}；阶段：${context.stage || ""}`,
    `角色记忆：${JSON.stringify(memory)}`,
    `训练评分：${JSON.stringify(coachScore)}`,
    `完整对话记录：${JSON.stringify(conversation)}`
  ].join("\n");
}
