import test from "node:test";
import assert from "node:assert/strict";
import { critiqueResponse, getScenario, listScenarios, retryScenario, startScenario } from "./scenario-engine.mjs";

test("lists bounded, non-gendered scenarios", () => {
  const scenarios = listScenarios();
  assert.equal(scenarios.length, 5);
  assert.ok(scenarios.every((scenario) => scenario.context && scenario.roleInstruction));
  assert.equal(getScenario("missing"), null);
});

test("role-play waits for user response and returns at most three priorities", () => {
  const session = startScenario("low-pressure-invitation");
  const critique = critiqueResponse(session, "听起来不错。如果你周六下午方便，我们可以一起去；不方便也没关系。");
  assert.equal(critique.session.phase, "awaiting_retry");
  assert.ok(critique.priorities.length <= 3);
  assert.equal(critique.standardAnswer, null);
  assert.equal(critique.session.privacy.rawResponsesRetained, false);
});

test("flags pressure and supports a retry without retaining raw response", () => {
  const session = startScenario("low-energy-reply");
  const first = critiqueResponse(session, "你必须马上回我，不回就是不在乎，你今天到底在干嘛？");
  assert.equal(first.score.boundaryAwareness, 0);
  assert.ok(first.priorities.some((item) => item.includes("施压")));
  const retry = retryScenario(first.session, "我听到你最近有点忙，那你先处理自己的事，之后想聊时再发就好。");
  assert.equal(retry.session.turn, 1);
  assert.equal(retry.session.phase, "awaiting_retry");
});

test("ended relationships do not reward a polite reinvitation", () => {
  for (const response of [
    "听起来你需要空间，下周我们一起见面可以吗？",
    "我理解你的决定，能再给我一次机会吗？",
    "谢谢你说清楚，我想再聊聊我们的关系。",
    "我尊重你的决定，明天我来找你。",
    "我会等你回心转意，你一定会回来。",
    "我尊重你的决定，明天一起喝杯咖啡好吗？",
    "谢谢你说清楚，能不能见一下？",
    "我接受你的决定，周末吃顿饭可以吗？",
    "我尊重你的决定，我还能联系你吗？",
    "尊重你的决定，下周有空吗？",
    "我接受你的决定。你愿意的话明天喝咖啡吗？",
    "尊重你的决定。今晚一起吃饭吗？"
  ]) {
    const critique = critiqueResponse(startScenario("breakup-recovery"), response);
    assert.equal(critique.score.boundaryAwareness, 0, response);
    assert.equal(critique.score.momentum, 0, response);
    assert.ok(critique.priorities.some((item) => /结束|退出|重新邀约|挽回/.test(item)), response);
    assert.ok(critique.priorities.every((item) => !/可拒绝的选项|等待对方真实回应/.test(item)), response);
  }
});

test("ended relationships reward clear exit and recovery rather than another invitation", () => {
  for (const response of [
    "谢谢你说清楚，我尊重你的决定，不再联系，祝你顺利。",
    "我理解你的决定，不会再约你；下周我会和朋友一起散步，照顾自己。",
    "我尊重你，我们不再见面，也不再讨论复合。",
    "谢谢你说清楚，我尊重你的决定；明天我会自己去看电影，下周和朋友一起喝咖啡。"
  ]) {
    const critique = critiqueResponse(startScenario("breakup-recovery"), response);
    assert.equal(critique.score.boundaryAwareness, 2, response);
    assert.equal(critique.score.momentum, 2, response);
    assert.ok(critique.priorities.every((item) => !/可拒绝的选项|等待对方真实回应/.test(item)), response);
  }
  const vague = critiqueResponse(startScenario("breakup-recovery"), "听起来你确实很累，最近天气不错。");
  assert.equal(vague.score.momentum, 1);
  assert.ok(vague.priorities.some((item) => /退出|结束/.test(item)));
});
