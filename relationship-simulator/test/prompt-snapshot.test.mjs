import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHerSystemPrompt,
  buildHerTaskPrompt,
  buildCoachSystemPrompt,
  buildCoachTaskPrompt,
  buildRelationshipCoachSkillPrompt,
  buildInterventionPrompt,
  buildStageDetectionPrompt,
  buildScenarioInitPrompt,
  buildOptimizerPrompt,
  buildReplayEnhancementPrompt,
  buildActionPlanPrompt,
  buildToneGuidance,
  PROMPT_VERSION
} from "../public/modules/coach/prompts.js";
import { buildCoachMessages } from "../public/modules/core/api-client.js";

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

// ── 双通道系统提示词（她 / 教练） ──────────────────────────────────────────────

test("buildHerSystemPrompt 输出人设与记忆，且不含任何教练腔", () => {
  const prompt = buildHerSystemPrompt(fixturePersona, fixtureMemory);

  assert.match(prompt, /本轮你是她本人/);
  assert.match(prompt, /女方叫林知夏/);
  assert.match(prompt, /慢热知性型/);
  assert.match(prompt, /边界感强/);
  assert.match(prompt, /讨厌油腻/);
  assert.match(prompt, /关系背景/);
  assert.match(prompt, /初步熟悉阶段/);
  assert.match(prompt, /她的兴趣/);
  assert.match(prompt, /阅读、徒步/);
  assert.match(prompt, /边界\/禁忌/);
  assert.match(prompt, /避免操控/);

  // 她的通道只做演出：教练技能契约与 JSON 字段一旦漏进来，她的回复就会带分析口吻。
  assert.doesNotMatch(prompt, /恋爱沟通教练技能契约/);
  assert.doesNotMatch(prompt, /replyOptions|coachScore|evidenceReasoning/);
  assert.doesNotMatch(prompt, /JSON/);
});

test("buildHerSystemPrompt 是纯函数且不依赖闭包", () => {
  assert.equal(buildHerSystemPrompt(fixturePersona, fixtureMemory), buildHerSystemPrompt(fixturePersona, fixtureMemory));

  const ziPersona = { id: "zi", name: "夏紫桐", systemRole: "女方叫夏紫桐，观察力细。", tags: ["观察力细"], logic: "她观察力细。" };
  const ziMemory = { background: "重新联系阶段", interests: "散文、访谈", boundaries: "不连续追问" };
  const prompt = buildHerSystemPrompt(ziPersona, ziMemory);
  assert.match(prompt, /夏紫桐/);
  assert.match(prompt, /重新联系阶段/);
  assert.doesNotMatch(prompt, /林知夏/);
});

test("buildHerSystemPrompt 把易变记忆排在稳定人设之后（前缀缓存友好顺序）", () => {
  const withInjection = buildHerSystemPrompt(fixturePersona, { ...fixtureMemory, _tierInjection: "【投入度分层】她本轮主动提问" });
  const performanceRuleAt = withInjection.indexOf("【本轮你是她本人】");
  const roleAt = withInjection.indexOf("你的角色设定：");
  const tierAt = withInjection.indexOf("【投入度分层】");

  assert.ok(performanceRuleAt >= 0 && roleAt > performanceRuleAt, "演出规则必须最前，人设紧随其后");
  assert.ok(tierAt > roleAt, "每轮可变的注入必须落在稳定前缀之后，否则缓存前缀会被打散");
});

test("buildHerTaskPrompt 明确禁止 JSON 与多条候选", () => {
  const prompt = buildHerTaskPrompt();
  assert.match(prompt, /只输出她接下来发出的微信消息/);
  assert.match(prompt, /不要输出 JSON/);
  assert.match(prompt, /不要输出多条候选/);
  assert.equal(buildHerTaskPrompt(), buildHerTaskPrompt());
});

test("buildCoachSystemPrompt 带技能契约与证据契约，但不要求她说话", () => {
  const prompt = buildCoachSystemPrompt(fixturePersona, fixtureMemory);

  assert.match(prompt, /中文恋爱沟通教练/);
  assert.match(prompt, /恋爱沟通教练技能契约/);
  assert.match(prompt, /本轮女方回复已由系统给出/);
  assert.match(prompt, /evidenceReasoning/);
  assert.match(prompt, /反证和未知|支持与反证/);
  assert.match(prompt, /模拟生成的回应.*不能充当现实结果/);
  assert.match(prompt, /replyOptions/);
  assert.match(prompt, /coachScore/);

  // 读心式旧措辞不能回来。
  assert.doesNotMatch(prompt, /隐藏意图|隐藏目标/);
  // 教练通道不许再生成她的回复：那是角色通道的产物，重新生成会和她已发出的那条冲突。
  assert.doesNotMatch(prompt, /herReply[,，]|生成.*女方回复|下一句女方回复/);
});

test("buildCoachSystemPrompt 是纯函数且不依赖闭包", () => {
  assert.equal(buildCoachSystemPrompt(fixturePersona, fixtureMemory), buildCoachSystemPrompt(fixturePersona, fixtureMemory));
  const ziPersona = { name: "夏紫桐", systemRole: "女方叫夏紫桐，观察力细。", tags: [], logic: "" };
  const prompt = buildCoachSystemPrompt(ziPersona, { background: "重新联系阶段" });
  assert.match(prompt, /夏紫桐/);
  assert.doesNotMatch(prompt, /林知夏/);
});

test("buildCoachSystemPrompt 注入真诚度调节指令（语气滑块属于教练侧，不进她的演出）", () => {
  const prompt = buildCoachSystemPrompt(fixturePersona, fixtureMemory, { tone: { sincerity: 90, toneIntensity: 20 } });
  assert.match(prompt, /本轮表达调节/);
  assert.match(prompt, /真诚度：高/);
  assert.match(prompt, /语气强度：低/);
  assert.doesNotMatch(buildHerSystemPrompt(fixturePersona, fixtureMemory, { tone: { sincerity: 90, toneIntensity: 20 } }), /本轮表达调节/);
});

test("PUA 识别训练模式只改变教练的防御指令，不让她自曝手法", () => {
  const coach = buildCoachSystemPrompt(fixturePersona, fixtureMemory, { mode: "pua" });
  const her = buildHerSystemPrompt(fixturePersona, fixtureMemory, { mode: "pua" });
  assert.match(coach, /PUA 识别训练模式/);
  assert.match(her, /不要自曝手法名称/);
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

// ── 教练任务指令（A/B/C 契约） ────────────────────────────────────────────────

test("buildCoachTaskPrompt 规定 A/B/C 是三个互不相同的沟通动作", () => {
  const prompt = buildCoachTaskPrompt();
  assert.match(prompt, /replyOptions 只保留 A\/B\/C 三项/);
  // 行为评测实测 abc_distinct 只有 2/5，裁判反复指出「A 和 B 是同一动作两种说法」。
  // 这三行是把该结论写回契约，删掉任何一条都会让指标回到旧状态。
  assert.match(prompt, /三个互不相同的沟通动作/);
  assert.match(prompt, /尽量只有一条以问句结尾/);
  assert.match(prompt, /同一个意思，就视为不合格/);
  assert.match(prompt, /A 必须先把那个问题答掉/);
  assert.match(prompt, /A\/B\/C/);
  assert.match(prompt, /不要 Markdown/);
  assert.equal(buildCoachTaskPrompt(), buildCoachTaskPrompt());
});

test("教练任务指令不再要求模型生成 herReply", () => {
  // 双角色拆分后 herReply 是已知输入；契约里复现这个字段会让教练替她说话。
  const fields = buildCoachTaskPrompt().match(/JSON 字段：([^\n]+)/)?.[1] || "";
  assert.ok(fields, "JSON 字段清单必须存在");
  assert.doesNotMatch(fields, /herReply/);
  for (const field of ["herIntent", "yourGoal", "judgement", "risk", "replyOptions", "recommendation", "coachScore", "evidenceReasoning"]) {
    assert.ok(fields.includes(field), `字段清单缺少 ${field}`);
  }
});

test("PUA 模式下的教练任务指令给出防御而非操控", () => {
  const prompt = buildCoachTaskPrompt(true);
  assert.match(prompt, /手法写进 herIntent/);
  assert.match(prompt, /防御回应写进 recommendation/);
  assert.doesNotMatch(buildCoachTaskPrompt(false), /手法写进 herIntent/);
});

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

  // 教材注入现在活在教练通道真实使用的 buildCoachMessages 里（旧的合并式教练 prompt 已整条删除）。
  const coach = buildCoachMessages({
    persona: { name: "测试角色", systemRole: "测试角色" },
    memory: { background: "背景", interests: "兴趣", boundaries: "边界" },
    messages: [{ type: "me", text: "继续", who: "我" }],
    herReply: "嗯",
    uiValues: { textbookContext: { summary: "只看摘要", excerpts: [{ chapterTitle: "第1章", reviewPointId: "1-r1", text: "短摘录" }] } }
  });
  const textbookTurn = coach.map((item) => item.content).join("\n");
  assert.match(textbookTurn, /教材参考/);
  assert.match(textbookTurn, /短摘录/);
  // 缺教材时这条指令必须整段消失，不能留下 undefined。
  const withoutTextbook = buildCoachMessages({ persona: { name: "x", systemRole: "x" }, memory: {}, messages: [], herReply: "嗯", uiValues: {} });
  assert.doesNotMatch(withoutTextbook.map((item) => item.content).join("\n"), /教材参考|undefined/);
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

// ── PROMPT_VERSION ────────────────────────────────────────────────────────────

test("PROMPT_VERSION 已导出且为字符串", () => {
  assert.ok(typeof PROMPT_VERSION === "string");
  assert.equal(PROMPT_VERSION, "1.4.0");
});

// P1 事实约束必须留在教练任务指令里：审计只拦得住词面可辨的捏造，
// 提示词是那一半「让模型一开始就别这么写」的职责，删掉它等于把负担全压到降级路径上。
test("教练任务指令包含既成事实约束与提议/断言区分", () => {
  const prompt = buildCoachTaskPrompt(false);
  assert.ok(prompt.includes("【事实约束】"), prompt);
  assert.ok(prompt.includes("上次说好的"), prompt);
  assert.ok(prompt.includes("不能写成既定事实"), prompt);
  assert.ok(prompt.includes("【时间待确认】"), prompt);
});
