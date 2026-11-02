import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createMemory, grantConsent } from "./memory/memory-store.mjs";
import { runRelationshipLoop } from "./agent-loop.mjs";

test("explicit exit and historical EXIT cannot produce advancement or reopen conflict", () => {
  const messages = [{ speaker: "我", text: "你好" }];
  for (const signals of [{ explicitExit: true, concreteDatePlan: true }, { relationshipEnded: true, conflict: true }]) {
    const result = runRelationshipLoop({ messages, signals });
    assert.equal(result.state.to, "EXIT");
    assert.equal(result.decision.value, "EXIT");
  }
  const memory = grantConsent(createMemory({ caseId: "case_exit_test" }), true);
  memory.currentState = "EXIT";
  const result = runRelationshipLoop({ messages, memory, consent: true, signals: { conflict: true, counterOffer: true } });
  assert.equal(result.state.to, "EXIT");
  assert.equal(result.decision.value, "EXIT");
});

test("uses OBSERVE and alternative hypotheses for an ambiguous busy message", () => {
  const result = runRelationshipLoop({
    goal: "判断是否继续联系",
    messages: [
      { speaker: "我", text: "最近有空一起喝咖啡吗？" },
      { speaker: "对方", text: "最近有点忙，之后再说吧。" }
    ]
  });
  assert.equal(result.decision.value, "OBSERVE");
  assert.equal(result.prediction.decision, "OBSERVE");
  assert.equal(result.hypotheses.length, 2);
  assert.equal(result.analysis.metrics.averageReplyGapMs, null);
  assert.equal(result.privacy.rawMessagesReturned, false);
});

test("turns explicit rejection into de-escalation rather than a persuasion script", () => {
  const result = runRelationshipLoop({
    messages: [{ speaker: "对方", text: "我不想继续发展了。" }],
    signals: { explicitRejection: true, counterOffer: false, evidenceIds: ["obs_rejection"] }
  });
  assert.equal(result.decision.value, "DE_ESCALATE");
  assert.match(result.action, /停止追加说服/);
  assert.equal(result.state.to, "EXIT");
});

test("writes only a redacted memory patch when consent is granted", () => {
  const memory = grantConsent(createMemory({ caseId: "case_005" }), true);
  const result = runRelationshipLoop({
    memory,
    consent: true,
    messages: [
      { speaker: "我", text: "周日下午去看展吗？", timestamp: "2026-08-10T10:00:00+08:00" },
      { speaker: "对方", text: "可以，我下午有空。", timestamp: "2026-08-10T10:30:00+08:00" }
    ],
    signals: { concreteDatePlan: true, counterOffer: true }
  });
  assert.equal(result.decision.value, "ADVANCE");
  assert.equal(result.memoryPatch.observations.length, 1);
  assert.equal(result.memoryPatch.privacy.rawChatRetained, false);
  assert.equal(result.memoryPatch.observations[0].summary.includes("周日下午"), false);
});

test("explicit refusals, no-contact requests and safety outrank stale advancement signals", () => {
  for (const [speaker, text] of [
    ["对方", "我不想继续发展了。"],
    ["对方", "不想继续、别再联系我。"],
    ["我", "我决定退出这段关系。"],
    ["对方", "我决定退出这段关系。"],
    ["对方", "请停止纠缠我。"],
    ["对方", "“别再联系我”"],
    ["对方", "不要再发信息给我"],
    ["对方", "别再给我发短信"],
    ["对方", "你不回我，我就去你家堵你。"]
  ]) {
    const result = runRelationshipLoop({
      messages: [{ speaker, text }],
      signals: { concreteDatePlan: true, counterOffer: true, explicitRejection: false, explicitExit: false, safetyRisk: false }
    });
    assert.ok(["EXIT", "DE_ESCALATE"].includes(result.decision.value), text);
    assert.equal(result.state.to, "EXIT", text);
    assert.doesNotMatch(result.action, /给出一个具体|现实选项/);
  }
  const explicit = runRelationshipLoop({ messages: [{ speaker: "other", text: "收到" }], signals: { explicitRejection: true, counterOffer: true } });
  assert.equal(explicit.decision.value, "DE_ESCALATE");
  assert.equal(explicit.state.to, "EXIT");
});

test("ordinary boundaries and a genuine alternative arrangement are not relationship rejection", () => {
  for (const text of ["今天不方便，下周日有空，一起看展吗？", "我不想吃火锅，去看展吧。", "别再熬夜了，周日去看展吗？", "我不想发展副业，下周有空见面。", "我们结束这个话题吧，周日去看展。", "不用联系我家维修师傅了，周日看展吗？", "我不会伤害你，也不会跟踪你。", "上次的话伤害我了，周日可以当面谈吗？", "我不是不想和你在一起，只是需要更多时间", "我不担心暴力", "朋友说不要再联系我，这句话怎么翻译", "剧情里他会打我，这句台词是什么意思", "朋友说她不想和你在一起，这段话你怎么看"]) {
    const result = runRelationshipLoop({ messages: [{ speaker: "other", text }], signals: { concreteDatePlan: true, counterOffer: true } });
    assert.equal(result.decision.value, "ADVANCE", text);
    assert.notEqual(result.state.to, "EXIT", text);
  }
});

test("an explicit temporary pause blocks advancement without ending the relationship", () => {
  for (const text of ["我现在不想聊，请先停下聊天。", "请先别联系我，我现在需要休息。", "今天不想继续联系，等我准备好再说。", "今天不要联系我", "暂时别再联系我"]) {
    const result = runRelationshipLoop({ messages: [{ speaker: "other", text }], signals: { concreteDatePlan: true, counterOffer: true } });
    assert.equal(result.decision.value, "DE_ESCALATE", text);
    assert.notEqual(result.state.to, "EXIT", text);
  }
});

test("memory separates new observations while identical input retries stay idempotent", () => {
  const memory = grantConsent(createMemory({ caseId: "case_loop_digest_test" }), true);
  const firstMessages = [{ speaker: "user", text: "你好" }];
  const first = runRelationshipLoop({ messages: firstMessages, memory, consent: true });
  const secondMessages = [...firstMessages, { speaker: "other", text: "收到" }];
  const second = runRelationshipLoop({ messages: secondMessages, memory: first.memoryPatch, consent: true });
  assert.equal(second.memoryPatch.observations.length, 2);
  assert.match(second.memoryPatch.observations[1].summary, /2条/);
  const repeat = runRelationshipLoop({ messages: secondMessages, memory: second.memoryPatch, consent: true });
  assert.equal(repeat.memoryPatch.observations.length, 2);
  const changedContent = runRelationshipLoop({ messages: [...firstMessages, { speaker: "other", text: "暂时还不清楚" }], memory: repeat.memoryPatch, consent: true });
  assert.equal(changedContent.memoryPatch.observations.length, 3);
  assert.equal(new Set(changedContent.memoryPatch.observations.map(({ id }) => id)).size, 3);
  assert.equal(changedContent.memoryPatch.timeline.length, 3);
  assert.doesNotMatch(JSON.stringify(changedContent.memoryPatch), /暂时还不清楚/);
});

test("retrying the same observation cannot advance the relationship state twice", () => {
  const messages = [
    { speaker: "user", text: "你好" },
    { speaker: "other", text: "收到" },
    { speaker: "user", text: "最近怎么样？" },
    { speaker: "other", text: "还好，谢谢。" }
  ];
  const memory = grantConsent(createMemory({ caseId: "case_replay_state_test" }), true);
  const first = runRelationshipLoop({ messages, memory, consent: true });
  const retry = runRelationshipLoop({ messages: messages.map((message, index) => ({ ...message, id: `new_transport_${index}` })), memory: first.memoryPatch, consent: true });
  assert.equal(retry.state.to, first.state.to);
  assert.equal(retry.state.changed, false);
  assert.equal(retry.memoryPatch.observations.length, 1);
  const stop = runRelationshipLoop({ messages, memory: retry.memoryPatch, consent: true, signals: { safetyRisk: true, counterOffer: true } });
  assert.equal(stop.state.to, "EXIT");
  assert.equal(stop.decision.value, "EXIT");
});

test("new decision signals create a new observation even with unchanged conversation", () => {
  const messages = [{ speaker: "user", text: "你好" }, { speaker: "other", text: "收到" }];
  const memory = grantConsent(createMemory({ caseId: "case_signal_update_test" }), true);
  const first = runRelationshipLoop({ messages, memory, consent: true });
  assert.equal(first.decision.value, "OBSERVE");
  const update = runRelationshipLoop({ messages, memory: first.memoryPatch, consent: true, signals: { concreteDatePlan: true } });
  assert.equal(update.decision.value, "ADVANCE");
  assert.equal(update.memoryPatch.observations.length, 2);
  assert.match(update.memoryPatch.observations[1].summary, /ADVANCE/);
  const retry = runRelationshipLoop({ messages, memory: update.memoryPatch, consent: true, signals: { concreteDatePlan: true } });
  assert.equal(retry.memoryPatch.observations.length, 2);
});

test("direct runtime goal redacts known contact identifiers", () => {
  const result = runRelationshipLoop({ goal: "练习联系 synthetic.goal@example.invalid，电话 13800138000" });
  assert.doesNotMatch(result.goal, /synthetic\.goal@example\.invalid|13800138000/);
});

test("real HTTP handler enforces stop signals and accumulates new observations without dotenv", async () => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "relationship-runtime-http-"));
  const runtimeUrl = new URL("./index.mjs", import.meta.url).href;
  const memoryUrl = new URL("./memory/memory-store.mjs", import.meta.url).href;
  const apiSource = await readFile(new URL("../../../../relationship-simulator/server/relationshipIntelligence.js", import.meta.url), "utf8");
  const httpSource = await readFile(new URL("../../../../relationship-simulator/server/http.js", import.meta.url), "utf8");
  await writeFile(path.join(fixtureDir, "http.mjs"), httpSource.replace('import { PORT } from "./config.js";', "const PORT = 0;"));
  await writeFile(path.join(fixtureDir, "api.mjs"), apiSource
    .replace('"../../.agents/skills/relationship-coach-cn/runtime/index.mjs"', JSON.stringify(runtimeUrl))
    .replace('"../../.agents/skills/relationship-coach-cn/runtime/memory/memory-store.mjs"', JSON.stringify(memoryUrl))
    .replace('"./http.js"', '"./http.mjs"'));
  const { handleRelationshipIntelligence } = await import(pathToFileURL(path.join(fixtureDir, "api.mjs")).href);
  const server = createServer((req, res) => handleRelationshipIntelligence(req, res));
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const url = `http://127.0.0.1:${server.address().port}/api/relationship-intelligence`;
  const post = async (body) => {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    const stop = await post({ messages: [{ type: "her", text: "不想继续、别再联系我。" }], signals: { concreteDatePlan: true, counterOffer: true, explicitRejection: false } });
    assert.ok(["EXIT", "DE_ESCALATE"].includes(stop.decision.value));
    assert.equal(stop.state.to, "EXIT");
    const firstMessages = [{ type: "me", text: "你好" }];
    const first = await post({ messages: firstMessages, consent: true, caseId: "case_http_digest_test" });
    const secondMessages = [...firstMessages, { type: "her", text: "收到" }];
    const second = await post({ messages: secondMessages, consent: true, caseId: "case_http_digest_test", memory: first.memoryPatch });
    assert.equal(second.memoryPatch.observations.length, 2);
    const retry = await post({ messages: secondMessages, consent: true, caseId: "case_http_digest_test", memory: second.memoryPatch });
    assert.equal(retry.memoryPatch.observations.length, 2);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
