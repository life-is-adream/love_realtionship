import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSystemPrompt,
  buildRelationshipCoachSkillPrompt,
  buildGenerationTaskPrompt,
  buildInterventionPrompt,
  buildStageDetectionPrompt,
  buildScenarioInitPrompt,
  buildOptimizerPrompt,
  buildReplayEnhancementPrompt,
  buildCoachPrompt,
  buildActionPlanPrompt,
  buildToneGuidance,
  PROMPT_VERSION
} from "../public/modules/coach/prompts.js";

/**
 * Prompt 字符串快照对照测试
 *
 * 验证 prompts.js 迁移后的纯函数输出与预期格式一致。
 * 确保"同对话历史，抽离前后 prompt 完全相等"。
 */

// ── 固定 fixture ──────────────────────────────────────────────────────────────

const fixturePersona = {
  id: "lin",
  name: "林知夏",
  avatar: "林",
  systemRole: "女方叫林知夏，23 岁，研一，慢热知性型。她边界感强，喜欢自然、稳定、有生活内容的交流，讨厌油腻、施压和过早暧昧。",
  tags: ["边界感强", "慢热", "志愿活动", "讨厌油腻"],
  logic: "她不会因一句话上头。她持续观察：你是否自然、稳定、有分寸、有生活内容。"
};

const fixtureMemory = {
  background: "当前和林知夏处于初步熟悉阶段，聊天目标是自然建立了解。",
  interests: "阅读、徒步、电影、志愿活动",
  boundaries: "避免操控、施压、过早暧昧、查户口式连续追问；尊重对方节奏。"
};

// 这是 prompt 抽离前 app.js 中的纯拼接逻辑快照，用来验证迁移没有改变请求文本。
function buildPreExtractionSystemPrompt(persona, memory) {
  const skill = [
    "恋爱沟通教练技能契约（每轮必须执行）：",
    "- 先判断阶段、她的投入程度、情绪语气、用户错误、机会与风险；不要把礼貌回复误判为暧昧或高投入。",
    "- 输出分析要覆盖：场景、她的隐藏意图、你的隐藏目标、A/B/C、推荐、原因、下一步。",
    "- A 是温柔高情商：接住情绪或事实，给空间，低压力；B 是幽默风趣：轻松但不嘲讽、不油腻；C 是深入了解：只问一个具体问题，建立在她刚说的话上。",
    "- 不连续追问、不查户口、不制造焦虑、不操控、不 PUA；她表达疲惫、拒绝、边界或结束聊天时，优先尊重并收尾。",
    "- A/B/C 必须是男方对本轮新生成 herReply 的直接回复，不能回复更早的旧消息，也不能把男方已经发过的话原样当成建议。",
    "- A/B/C 是用户可以直接发送给她的话，不是教练对用户的点评；禁止使用‘我听到你说’、‘我先记下’、‘不急着抢答’等元话语，也不要整段复述 herReply。",
    "- 如果 herReply 含有问题，A/B/C 应先直接回应她的问题，再按各自风格自然延伸；每项控制在 1—2 句。",
    "- 如果她说晚安、早点休息、明天再聊或类似结束语，A/B/C 都应自然收尾，不再追问，不强行推进邀约。"
  ].join("\n");
  const task = [
    "请基于上面的对话继续生成下一句女方回复。",
    "只输出一个合法 JSON 对象，不要 Markdown，不要代码块，不要解释。",
    "要求：",
    "1. 女方回复要短、自然、像真人微信，不要生硬复述上下文。",
    "2. 回复必须延续刚才的话题，不能突然失忆或跑题。",
    "3. 保持尊重、同意与边界，不要操控、PUA、暗示施压。",
    "4. 如果信息不足，也要给出一个能承接当前话题的自然回复。",
    "JSON 字段：herReply, herIntent, yourGoal, judgement, risk, replyOptions, recommendation, coachScore。",
    "replyOptions 只保留 A/B/C 三项，并且每一项都必须是男方对本次 herReply 的直接回复，不能继续回应生成 herReply 之前的旧消息。",
    "A/B/C 必须是可直接发送的聊天文本，不要写教练点评，不要用‘我听到你说’、‘我先记下’、‘不急着抢答’，不要把 herReply 原文整段复制进建议。"
  ].join("\n");
  const weakness = [
    "",
    "【用户个人弱点校准——每轮重点关注】",
    "该用户自述有三个模式化弱点，请在分析和 A/B/C 建议中主动防范：",
    "1. 查户口式追问：容易连续提问、缺乏自我暴露。如果用户本轮又连续问了两个以上问题，在 judgement 里直接指出，A/B/C 中至少有一项示范'先回应再分享再问'的节奏。",
    "2. 过度分析/犹豫：容易解释太多、替对方分析心理、不敢推进。如果用户本轮出现反复澄清或过长犹豫式表达，在 judgement 里点名，A/B/C 示范简洁直接的表达。",
    "3. 理性回应情绪：对方分享情绪时容易给分析/建议而非先接住感受。如果 herReply 含情绪表达，A/B/C 中至少有一项示范'先回应感受，不给建议'。",
    "注意：这三条是用户自己要求被提醒的，语气可以直接、具体，不需要委婉。",
  ].join("\n");
  return [
    "你是中文恋爱沟通教练与女方角色模拟器。",
    skill,
    weakness,
    "你的角色设定：" + (persona.systemRole || persona.logic),
    "角色标签：" + (persona.tags || []).join("、"),
    "关系背景：" + memory.background,
    "她的兴趣：" + memory.interests,
    "边界/禁忌：" + memory.boundaries,
    "",
    "输出要求：",
    "1. 女方回复要自然、短、像真人微信。",
    "2. 同时给出 A/B/C 三种不同风格的男方回复建议。",
    "3. 分析女方的隐藏意图、男方的目标、当前判断、风险提醒。",
    "4. 不要操控、不要 PUA、不要制造焦虑、尊重边界。",
    "5. 必须按指定 JSON 字段输出，不要 Markdown，不要解释。",
    "",
    "JSON 字段：",
    task
  ].join("\n");
}

// ── 主聊天系统提示词 ──────────────────────────────────────────────────────────

test("buildSystemPrompt 输出包含所有必要组件", () => {
  const prompt = buildSystemPrompt(fixturePersona, fixtureMemory);

  // 核心角色声明
  assert.match(prompt, /中文恋爱沟通教练与女方角色模拟器/);
  // 教练技能契约
  assert.match(prompt, /恋爱沟通教练技能契约/);
  // 角色设定
  assert.match(prompt, /林知夏/);
  assert.match(prompt, /慢热知性型/);
  // 角色标签
  assert.match(prompt, /边界感强/);
  assert.match(prompt, /讨厌油腻/);
  // 记忆字段
  assert.match(prompt, /关系背景/);
  assert.match(prompt, /初步熟悉阶段/);
  assert.match(prompt, /她的兴趣/);
  assert.match(prompt, /阅读、徒步/);
  assert.match(prompt, /边界\/禁忌/);
  assert.match(prompt, /避免操控/);
  // 输出要求
  assert.match(prompt, /JSON/);
  assert.match(prompt, /herReply/);
  assert.match(prompt, /replyOptions/);
  assert.match(prompt, /coachScore/);
});

test("buildSystemPrompt 是纯函数：相同输入产生相同输出", () => {
  const prompt1 = buildSystemPrompt(fixturePersona, fixtureMemory);
  const prompt2 = buildSystemPrompt(fixturePersona, fixtureMemory);
  assert.equal(prompt1, prompt2);
});

test("prompt 抽离前后输出完全一致", () => {
  assert.equal(
    buildSystemPrompt(fixturePersona, fixtureMemory),
    buildPreExtractionSystemPrompt(fixturePersona, fixtureMemory)
  );
});

test("buildSystemPrompt 不依赖闭包（接受参数）", () => {
  const ziPersona = {
    id: "zi",
    name: "夏紫桐",
    systemRole: "女方叫夏紫桐，观察力细。",
    tags: ["观察力细"],
    logic: "她观察力细。"
  };
  const ziMemory = {
    background: "重新联系阶段",
    interests: "散文、访谈",
    boundaries: "不连续追问"
  };
  const prompt = buildSystemPrompt(ziPersona, ziMemory);
  assert.match(prompt, /夏紫桐/);
  assert.match(prompt, /重新联系阶段/);
  assert.doesNotMatch(prompt, /林知夏/);
});

// ── 教练技能契约 ──────────────────────────────────────────────────────────────

test("buildRelationshipCoachSkillPrompt 包含核心规则", () => {
  const prompt = buildRelationshipCoachSkillPrompt();
  assert.match(prompt, /恋爱沟通教练技能契约/);
  assert.match(prompt, /不连续追问/);
  assert.match(prompt, /不查户口/);
  assert.match(prompt, /不操控/);
  assert.match(prompt, /不 PUA/);
  assert.match(prompt, /A\/B\/C/);
});

test("buildRelationshipCoachSkillPrompt 是纯函数", () => {
  assert.equal(buildRelationshipCoachSkillPrompt(), buildRelationshipCoachSkillPrompt());
});

// ── 生成任务指令 ──────────────────────────────────────────────────────────────

test("buildGenerationTaskPrompt 包含 JSON 字段说明", () => {
  const prompt = buildGenerationTaskPrompt();
  assert.match(prompt, /herReply/);
  assert.match(prompt, /replyOptions/);
  assert.match(prompt, /coachScore/);
  assert.match(prompt, /A\/B\/C/);
  assert.match(prompt, /不要 Markdown/);
});

test("buildGenerationTaskPrompt 是纯函数", () => {
  assert.equal(buildGenerationTaskPrompt(), buildGenerationTaskPrompt());
});

// ── 介入练习提示词 ────────────────────────────────────────────────────────────

test("buildInterventionPrompt 只生成女方反应（不生成 JSON）", () => {
  const persona = { systemRole: "女方叫夏紫桐。", logic: "她观察力细。" };
  const dialogue = [
    { speaker: "her", text: "好久不见。" },
    { speaker: "me", text: "最近怎么样？" }
  ];
  const prompt = buildInterventionPrompt(persona, dialogue, "我想你了");

  // 包含角色设定
  assert.match(prompt, /夏紫桐/);
  // 包含前文上下文
  assert.match(prompt, /好久不见/);
  assert.match(prompt, /最近怎么样/);
  // 包含用户回复
  assert.match(prompt, /我想你了/);
  // 明确只生成女方反应
  assert.match(prompt, /只.*生成.*反应/);
  // 不包含 JSON 输出要求
  assert.doesNotMatch(prompt, /herReply.*herIntent.*yourGoal/);
  assert.doesNotMatch(prompt, /replyOptions/);
  assert.doesNotMatch(prompt, /coachScore/);
});

test("buildInterventionPrompt 是纯函数", () => {
  const persona = { systemRole: "测试", logic: "测试" };
  const dialogue = [{ speaker: "her", text: "你好" }];
  const prompt1 = buildInterventionPrompt(persona, dialogue, "在吗");
  const prompt2 = buildInterventionPrompt(persona, dialogue, "在吗");
  assert.equal(prompt1, prompt2);
});

// ── 阶段判断提示词 ────────────────────────────────────────────────────────────

test("buildStageDetectionPrompt 返回 systemPrompt 和 userPrompt", () => {
  const conversation = [
    { speaker: "我", text: "你好" },
    { speaker: "她", text: "你好呀" }
  ];
  const result = buildStageDetectionPrompt(conversation, "刚加微信后的第一晚");

  assert.ok(typeof result.systemPrompt === "string");
  assert.ok(typeof result.userPrompt === "string");

  // systemPrompt 包含 7 阶段枚举
  assert.match(result.systemPrompt, /刚加微信后的第一晚/);
  assert.match(result.systemPrompt, /确定关系/);
  assert.match(result.systemPrompt, /stage/);
  assert.match(result.systemPrompt, /reason/);
  assert.match(result.systemPrompt, /confidence/);

  // userPrompt 包含对话历史和当前阶段
  assert.match(result.userPrompt, /刚加微信后的第一晚/);
  assert.match(result.userPrompt, /你好/);
});

test("buildStageDetectionPrompt 是纯函数", () => {
  const conversation = [{ speaker: "我", text: "测试" }];
  const r1 = buildStageDetectionPrompt(conversation, "暧昧推进");
  const r2 = buildStageDetectionPrompt(conversation, "暧昧推进");
  assert.deepEqual(r1, r2);
});

// ── 场景剧本初始化提示词 ──────────────────────────────────────────────────────

test("buildScenarioInitPrompt 包含剧本信息", () => {
  const scenario = {
    title: "她突然冷淡",
    description: "她最近回复变短",
    recommendedStage: "暧昧推进",
    coachFocus: ["boundary", "empathy"],
    contextHint: "不要连续追问"
  };
  const prompt = buildScenarioInitPrompt(scenario);
  assert.match(prompt, /她突然冷淡/);
  assert.match(prompt, /暧昧推进/);
  assert.match(prompt, /boundary/);
});

test("new optional prompts are pure and keep sensitive context bounded", () => {
  const optimizer = buildOptimizerPrompt({ original: "你怎么还不回我？", stage: "隔天轻联系", conversation: [{ speaker: "她", text: "最近有点忙" }] });
  assert.match(optimizer.systemPrompt, /合法 JSON/);
  assert.match(optimizer.userPrompt, /隔天轻联系/);
  assert.equal(buildOptimizerPrompt({ original: "x" }).systemPrompt, buildOptimizerPrompt({ original: "x" }).systemPrompt);

  const replay = buildReplayEnhancementPrompt({ summary: "可能需要空间", excerpts: [{ text: "先休息" }, { text: "不连续追问" }] });
  assert.match(replay.systemPrompt, /不做诊断/);
  assert.doesNotMatch(replay.userPrompt, /rawReplay/);

  const coach = buildCoachPrompt({ persona: { systemRole: "测试角色" }, memory: { background: "背景", interests: "兴趣", boundaries: "边界" }, user: "继续", textbookContext: { summary: "只看摘要", excerpts: [{ chapterTitle: "第1章", reviewPointId: "1-r1", text: "短摘录" }] } });
  assert.match(coach.system, /教材参考/);
  assert.match(coach.system, /短摘录/);
});

test("buildActionPlanPrompt 输出指定 JSON 字段并包含完整对话", () => {
  const persona = { name: "林知夏" };
  const memory = { background: "初步熟悉", interests: "阅读", boundaries: "不连续追问" };
  const conversation = [{ speaker: "我", text: "你好" }, { speaker: "她", text: "你好呀" }];
  const prompt = buildActionPlanPrompt({ persona, memory, coachScore: { total: 72 }, stage: "暧昧推进", conversation });

  assert.match(prompt, /title, pacing, objective, steps, topics, decisionRules, warning/);
  assert.match(prompt, /林知夏/);
  assert.match(prompt, /暧昧推进/);
  assert.match(prompt, /你好呀/);
  assert.match(prompt, /72/);
});

test("buildActionPlanPrompt 是纯函数", () => {
  const context = { persona: { name: "x" }, memory: {}, conversation: [{ speaker: "我", text: "hi" }] };
  assert.equal(buildActionPlanPrompt(context), buildActionPlanPrompt(context));
});

test("buildToneGuidance 无滑块时不输出指令", () => {
  assert.equal(buildToneGuidance(), "");
  assert.equal(buildToneGuidance({ sincerity: NaN }), "");
  assert.equal(buildToneGuidance({ toneIntensity: 200 }), "");
});

test("buildToneGuidance 高真诚度输出克制套路指令", () => {
  const guidance = buildToneGuidance({ sincerity: 85, toneIntensity: 30 });
  assert.match(guidance, /真诚度：高/);
  assert.match(guidance, /不要油腻/);
  assert.match(guidance, /语气强度：低/);
  assert.match(guidance, /给足空间/);
});

test("buildToneGuidance 是纯函数", () => {
  assert.equal(buildToneGuidance({ sincerity: 60, toneIntensity: 40 }), buildToneGuidance({ sincerity: 60, toneIntensity: 40 }));
});

test("buildSystemPrompt 注入真诚度调节指令", () => {
  const prompt = buildSystemPrompt(fixturePersona, fixtureMemory, { tone: { sincerity: 90, toneIntensity: 20 } });
  assert.match(prompt, /本轮表达调节/);
  assert.match(prompt, /真诚度：高/);
  assert.match(prompt, /语气强度：低/);
});

// ── PROMPT_VERSION ────────────────────────────────────────────────────────────

test("PROMPT_VERSION 已导出且为字符串", () => {
  assert.ok(typeof PROMPT_VERSION === "string");
  assert.equal(PROMPT_VERSION, "1.0.0");
});
