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
