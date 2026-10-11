import test from "node:test";
import assert from "node:assert/strict";
import { createConversationResetState } from "../public/modules/core/state-reset.js";
import { normalizeState } from "../public/modules/core/state.js";
import { createPracticeRecord } from "../public/modules/training/real-practice.js";
import { modelStatusLabel } from "../public/modules/core/model-status.js";
import { normalizeCoachEvidence, coachEvidenceCards } from "../public/modules/coach/evidence-contract.js";
import { parseModelContent } from "../public/modules/coach/parser.js";
import { versionModuleImports, APP_ASSET_VERSION, staticCacheControl } from "../server/asset-versioning.js";

test("conversation reset preserves independent records and consent, clearing conversation scores", () => {
  const record = createPracticeRecord({ planId: "connection", attempt: "done", response: "refused" });
  const before = normalizeState({ relationshipPractice: { consent: true, planId: "connection", records: [record] }, trainingLog: [{ score: { total: 80 } }], messages: [{ type: "me", text: "test-only" }], lastAnalysis: { judgement: "test-only" } });
  const after = createConversationResetState(before);
  assert.deepEqual(after.relationshipPractice, before.relationshipPractice);
  assert.deepEqual(after.lifestyle, before.lifestyle);
  assert.equal(after.lastAnalysis, null);
  assert.equal(after.trainingLog.length, 0);
  assert.equal(after.learning.events.length, 0);
  assert.equal(after.messages.some(message => message.text === "test-only"), false);
  assert.equal(before.messages[0].text, "test-only");
});

test("local health and credentials never claim provider availability", () => {
  assert.match(modelStatusLabel(), /待检查/);
  assert.match(modelStatusLabel({ health: { ok: true, hasApiKey: false } }), /未配置/);
  const configured = modelStatusLabel({ health: { ok: true, hasApiKey: true } });
  assert.match(configured, /连接未核验/);
  assert.doesNotMatch(configured, /模型在线/);
  assert.match(modelStatusLabel({ failed: true }), /不可用/);
});

test("legacy hidden intent is not displayed as an evidence-backed observation", () => {
  const legacy = parseModelContent(JSON.stringify({ herReply: "你好", herIntent: "她肯定喜欢你", yourGoal: "猜测的目标" }), { latestMine: "你好", goal: "练习清楚表达" });
  const rendered = JSON.stringify(coachEvidenceCards(legacy));
  assert.equal(rendered.includes("她肯定喜欢你"), false);
  assert.equal(rendered.includes("猜测的目标"), false);
  assert.match(rendered, /未返回可核对/);
  assert.match(rendered, /练习清楚表达/);
});

test("structured explanations include supports, counters and bounded unknowns", () => {
  const normalized = normalizeCoachEvidence({ observations: ["对方提出替代时间"], hypotheses: [{ explanation: "愿意继续了解", support: ["具体安排"], counter: ["也可能只是共同活动"] }], unknowns: ["恋爱意愿未确认"], userGoal: "模型猜测" }, "用户选择的目标");
  const cards = coachEvidenceCards({ evidenceReasoning: normalized });
  assert.match(JSON.stringify(cards), /具体安排/);
  assert.match(JSON.stringify(cards), /也可能只是共同活动/);
  assert.match(JSON.stringify(cards), /用户选择的目标/);
  assert.equal(normalizeCoachEvidence({ observations: Array(10).fill("x".repeat(1000)) }).observations.length, 4);
  assert.equal(normalizeCoachEvidence({ observations: ["x".repeat(1000)] }).observations[0].length, 240);
});

test("static and dynamic local module imports share one version and stay idempotent", () => {
  const source = `import { value } from "./state.js";\nimport "../side.js";\nexport { value } from './state.js';\nconst next = import('./next.js');\nimport fs from 'node:fs';`;
  const rewritten = versionModuleImports(source);
  assert.equal((rewritten.match(new RegExp(APP_ASSET_VERSION, "g")) || []).length, 4);
  assert.match(rewritten, /node:fs/);
  assert.equal(versionModuleImports(rewritten), rewritten);
  for (const extension of [".html", ".js", ".css", ".json", ".md", ".txt"]) assert.equal(staticCacheControl(extension), "no-cache");
  assert.equal(staticCacheControl(".jpg"), "public, max-age=86400");
});
