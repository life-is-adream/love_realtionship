import test from "node:test";
import assert from "node:assert/strict";
import cases from "./fixtures/chat-style-cases.json" with { type: "json" };
import { buildHerMessages, buildCoachMessages, resolveMemoryRecall } from "../public/modules/core/api-client.js";
import { createDefaultEnhancedMemory, buildMemoryInjection } from "../public/modules/core/memory.js";
import { normalizeState } from "../public/modules/core/state.js";

const persona = { name: "合成角色", systemRole: "只包含合成设定。", tags: [] };
const styles = ["daily", "humorous", "gentle"];

test("同一组合成场景覆盖每个角色风格及隐私/身份约束", () => {
  assert.equal(cases.length, 7);
  for (const style of styles) {
    for (const scenario of cases) {
      const history = [{ type: "me", text: scenario.input }];
      const her = buildHerMessages(persona, {}, history, { chatStyle: style });
      const system = her[0].content;
      assert.match(system, /先回应用户最近一条消息/);
      assert.match(system, /未知的用户个人事实必须承认不知道/);
      assert.match(system, /我是 AI 模拟角色/);
      // 陈述句不必被接成追问、不得用后台视角谈记忆：三种风格共用同一约束。
      assert.match(system, /问句不是默认接法/);
      assert.match(system, /一条回复最多一个问句/);
      assert.match(system, /不要用后台视角/);
      assert.match(her.at(-1).content, /不要输出 JSON/);
      const coach = buildCoachMessages({ persona, memory: {}, messages: history, herReply: "合成回复", uiValues: { chatStyle: style } });
      assert.doesNotMatch(coach.map((m) => m.content).join("\n"), /【本轮对话风格】/);
      assert.ok(scenario.expect.length > 0);
    }
  }
});

test("增强记忆编辑/删除直接影响下一轮角色注入", () => {
  const memory = createDefaultEnhancedMemory();
  memory.memoryTimeline = [{ content: "合成记忆：喜欢看展" }];
  memory.conversationSummaries = [{ summary: "合成摘要：上周去了杭州" }];
  assert.match(buildMemoryInjection(memory), /喜欢看展/);
  assert.match(buildMemoryInjection(memory), /上周去了杭州/);
  memory.memoryTimeline = [];
  memory.conversationSummaries = [];
  assert.doesNotMatch(buildMemoryInjection(memory), /杭州|看展/);
});

test("相同城市回忆场景在三种风格及授权/撤销后采用同一事实保护", () => {
  const query = "你还记得我上周去了哪个城市吗？";
  const empty = "我这边没有可靠记录，你愿意再告诉我一次吗？";
  for (const style of styles) {
    const prompt = buildHerMessages(persona, {}, [{ type: "me", text: query }], { chatStyle: style });
    assert.match(prompt[0].content, /未知的用户个人事实必须承认不知道/);
    assert.equal(resolveMemoryRecall(query, [{ type: "me", text: query }], {}), empty);
    const history = [{ type: "me", text: "我上周去了成都。" }, { type: "me", text: query }];
    assert.match(resolveMemoryRecall(query, history, {}), /你之前说过：「我上周去了成都/);
    const revokedMemory = {};
    assert.equal(resolveMemoryRecall(query, [{ type: "me", text: query }], revokedMemory), empty);
  }
});

test("风格状态缺省、非法值和持久化旧状态回退自然日常", () => {
  assert.equal(normalizeState({}).chatStyle, "daily");
  assert.equal(normalizeState({ chatStyle: "invalid" }).chatStyle, "daily");
  assert.equal(normalizeState({ chatStyle: "gentle" }).chatStyle, "gentle");
});
