import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AI_IDENTITY_REPLY,
  isAiIdentityQuestion,
  isPersonalFactRecall,
  resolveDeterministicReply,
  resolveMemoryRecall
} from "../public/modules/core/api-client.js";
import { createDefaultEnhancedMemory, buildMemoryInjection, selectInjectedMemoryEntries } from "../public/modules/core/memory.js";

/**
 * 同一组合成场景。所有输入都是虚构的，不含任何真实聊天记录。
 *
 * 覆盖：无记忆 / 有明确依据 / 删除或撤销授权 / 否定事实 / 身份误触发 /
 * 非城市类追问 / 隐藏字段 / 真实调用路径。
 */

const CITY_QUESTION = "我上周去了哪个城市？";
const CITY_FACT = "我上周去了杭州，西湖边人很多。";
const NO_RECORD = "我这边没有可靠记录，你愿意再告诉我一次吗？";

const ask = (question, history = []) => resolveMemoryRecall(question, [...history, { type: "me", text: question }], {});
const askWithMemory = (question, enhanced, history = []) =>
  resolveMemoryRecall(question, [...history, { type: "me", text: question }], { _enhanced: enhanced });

function enhancedWith(entries, summaries = []) {
  const memory = createDefaultEnhancedMemory();
  memory.memoryTimeline = entries.map((content) => ({ content, type: "test", timestamp: "2026-11-01T00:00:00.000Z" }));
  memory.conversationSummaries = summaries.map((summary) => ({ date: "2026-11-01", summary }));
  return memory;
}

// ── 1. 无记忆 ────────────────────────────────────────────────────────────────

test("没有依据时不猜：城市追问返回无记录，且不再声称「不确定」", () => {
  assert.equal(ask(CITY_QUESTION), NO_RECORD);
  assert.equal(askWithMemory(CITY_QUESTION, enhancedWith([])), NO_RECORD);
});

// ── 2. 有明确依据 ────────────────────────────────────────────────────────────

test("当前对话里有原话时，引用原话而不是改写事实", () => {
  const reply = ask(CITY_QUESTION, [{ type: "me", text: CITY_FACT }]);
  assert.match(reply, /你之前说过/);
  assert.match(reply, /杭州/);
  assert.match(reply, /「/);
});

test("授权且会注入的记忆条目可以作证；来源措辞标明是「保存的记录」", () => {
  const reply = askWithMemory(CITY_QUESTION, enhancedWith([CITY_FACT]));
  assert.match(reply, /我这边找到的相关记录/);
  assert.match(reply, /杭州/);
});

test("多条相关记录并列引用，不替用户选一条", () => {
  const reply = ask(CITY_QUESTION, [{ type: "me", text: CITY_FACT }, { type: "me", text: "我上周还去了苏州。" }]);
  assert.match(reply, /几条相关的话/);
  assert.match(reply, /杭州/);
  assert.match(reply, /苏州/);
});

// ── 3. 删除 / 撤销授权 ───────────────────────────────────────────────────────

test("删除记忆条目后同一问题回到无记录", () => {
  const memory = enhancedWith([CITY_FACT]);
  assert.match(askWithMemory(CITY_QUESTION, memory), /杭州/);
  memory.memoryTimeline = [];
  assert.equal(askWithMemory(CITY_QUESTION, memory), NO_RECORD);
});

test("撤销授权（没有 _enhanced）后不使用任何长期记忆", () => {
  assert.equal(askWithMemory(CITY_QUESTION, null), NO_RECORD);
  assert.equal(resolveMemoryRecall(CITY_QUESTION, [{ type: "me", text: CITY_QUESTION }], {}), NO_RECORD);
});

test("不回读隐藏字段：_enhancedInjection、_tierInjection、统计字段都不算证据", () => {
  const withInjection = {
    _enhancedInjection: "近期记忆：上周去了成都",
    _tierInjection: "投入度：高",
    background: "她和我上周去了成都"
  };
  assert.equal(resolveMemoryRecall(CITY_QUESTION, [{ type: "me", text: CITY_QUESTION }], withInjection), NO_RECORD);

  const statsOnly = createDefaultEnhancedMemory();
  statsOnly.interactionHistory.commonTopics = ["成都", "杭州"];
  statsOnly.learnedPreferences.strengths = ["上周去了成都"];
  assert.equal(askWithMemory(CITY_QUESTION, statsOnly), NO_RECORD, "未展示、不可编辑的统计字段不能变成用户事实");
});

test("记忆核对与注入使用同一批条目：只有最近 3 条时间线和最近 1 条摘要", () => {
  const memory = enhancedWith(["第一条", "第二条", "第三条", "我上周去了杭州"]);
  const { timeline, summary } = selectInjectedMemoryEntries(memory);
  assert.equal(timeline.length, 3);
  assert.equal(timeline.at(-1).content, "我上周去了杭州");
  assert.equal(summary, null);
  assert.doesNotMatch(buildMemoryInjection(memory), /第一条/);
  assert.match(buildMemoryInjection(memory), /我上周去了杭州/);
});

// ── 4. 否定事实 ──────────────────────────────────────────────────────────────

test("否定事实不会被说反：只引用「没去杭州」，不生成「去了杭州」", () => {
  const reply = ask(CITY_QUESTION, [{ type: "me", text: "我上周没去杭州。" }]);
  assert.ok(!reply.includes("去了杭州"), `否定被改写成了肯定：${reply}`);
  assert.match(reply, /没去杭州/);
  assert.match(reply, /只看到你说过/);
});

test("前后说法冲突时并列呈现，判定「记录有出入」", () => {
  const reply = ask(CITY_QUESTION, [{ type: "me", text: CITY_FACT }, { type: "me", text: "我上周没去杭州。" }]);
  assert.match(reply, /记录有出入/);
  assert.match(reply, /去了杭州/);
  assert.match(reply, /没去杭州/);
});

test("不确定表达保留不确定，不升级成事实", () => {
  const reply = ask(CITY_QUESTION, [{ type: "me", text: "我上周可能去杭州。" }]);
  assert.match(reply, /没有确定下来/);
  assert.match(reply, /可能去杭州/);
});

// ── 5. 覆盖范围：不再局限于城市 ──────────────────────────────────────────────

test("任意「我 + 时间锚 + 疑问」都能核对，不再依赖城市白名单", () => {
  const cases = [
    ["你还记得我上周买了什么吗？", "我上周买了台咖啡机。", /咖啡机/],
    ["我上个月去了哪家店？", "我上个月去了那家新开的书店。", /书店/],
    ["我昨天见了谁？", "我昨天见了大学室友。", /室友/],
    ["你记得我昨天见了谁吗？", "我昨天见了大学室友。", /室友/]
  ];
  for (const [question, fact, expected] of cases) {
    const reply = ask(question, [{ type: "me", text: fact }]);
    assert.match(reply, expected, `${question} → ${reply}`);
  }
});

test("时间锚不一致时不串台：问上周不会拿上个月的事当答案", () => {
  assert.equal(ask(CITY_QUESTION, [{ type: "me", text: "我上个月去了成都。" }]), NO_RECORD);
});

test("主语是他人的经历不作为用户事实引用", () => {
  assert.equal(ask(CITY_QUESTION, [{ type: "me", text: "我朋友上周去了杭州。" }]), NO_RECORD);
});

test("她的回复与当前提问本身都不能成为证据", () => {
  const withHer = [
    { type: "her", text: "你上周去了成都吧。" },
    { type: "me", text: CITY_QUESTION },
    { type: "me", text: CITY_QUESTION }
  ];
  assert.equal(resolveMemoryRecall(CITY_QUESTION, withHer, {}), NO_RECORD);
});

// ── 6. 不劫持普通聊天 ────────────────────────────────────────────────────────

test("非回忆类问题返回 null，交回模型与提示词约束", () => {
  const ordinary = [
    "今天天气怎么样？",
    "我上周去了杭州，你觉得怎么样？",
    "我朋友上周去了杭州，那边好玩吗？",
    "我昨天买了个礼物，你觉得好看么？",
    "你现在忙吗？"
  ];
  for (const message of ordinary) {
    assert.equal(isPersonalFactRecall(message), false, message);
    assert.equal(resolveMemoryRecall(message, [{ type: "me", text: message }], {}), null, message);
  }
});

test("自由生成仍无法被规则完全保证：这一层只承诺回忆类问题不编造", () => {
  // 明确记录边界：普通寒暄里模型是否编造用户事实，由提示词约束，不由本函数拦截。
  assert.equal(resolveMemoryRecall("随便聊聊吧", [], {}), null);
  assert.equal(isPersonalFactRecall("你猜我上周干了什么"), false, "「你猜」是在玩，不是在要事实核对");
  // 开放式「我说过什么」没有具体可核对的事实：交回模型，不用「没有记录」否认已有的记忆条目。
  assert.equal(resolveMemoryRecall("我之前说过什么来着？", [{ type: "me", text: "我之前说过想学潜水。" }], {}), null);
});

// ── 7. 身份识别：一套实现 ────────────────────────────────────────────────────

test("身份直问识别严格，AI 出现在普通句子里不误判", () => {
  const positives = ["你是真人吗？", "你是 AI 吗？", "你是人工智能还是人？", "你到底是不是人类", "你是机器人吗", "你是 AI 模拟角色吗？", "请问你是AI吗", "你是真人吗？还是AI？"];
  for (const question of positives) assert.equal(isAiIdentityQuestion(question), true, question);

  const negatives = ["今天你过得怎么样", "你是林知夏吗？", "我认识一个机器人", "我在看 AI 电影，你觉得怎么样？", "我朋友是真人，聊天很有趣吗？", "你是人工智能专业吗？", "我是AI吗"];
  for (const message of negatives) assert.equal(isAiIdentityQuestion(message), false, message);
});

test("真实调用路径：身份与记忆核对走同一个入口，来源标签正确", () => {
  const identity = resolveDeterministicReply("你是真人还是AI？", [], {});
  assert.deepEqual(identity, { text: AI_IDENTITY_REPLY, source: "identity" });

  const recall = resolveDeterministicReply(CITY_QUESTION, [{ type: "me", text: CITY_FACT }], {});
  assert.equal(recall.source, "memory-guard");
  assert.match(recall.text, /杭州/);

  assert.equal(resolveDeterministicReply("今天好累", [], {}), null);
});

test("app.js 不再保留第二份身份识别实现", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /function isAiIdentityQuestion/, "app.js 不应再定义身份识别正则");
  assert.match(source, /resolveDeterministicReply/, "app.js 必须走统一护栏入口");
});
