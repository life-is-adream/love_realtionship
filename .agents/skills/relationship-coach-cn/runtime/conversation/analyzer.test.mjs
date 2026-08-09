import test from "node:test";
import assert from "node:assert/strict";
import { analyzeConversation, normalizeSpeaker } from "./analyzer.mjs";

test("normalizes speaker aliases without retaining raw identities", () => {
  assert.equal(normalizeSpeaker("我"), "user");
  assert.equal(normalizeSpeaker("对方"), "other");
  assert.equal(normalizeSpeaker("真实姓名"), "unknown");
});

test("extracts observable ratios and reply gaps", () => {
  const result = analyzeConversation([
    { speaker: "我", text: "周末去看展吗？", timestamp: "2026-08-01T09:00:00+08:00" },
    { speaker: "对方", text: "可以呀，我也想看看。", timestamp: "2026-08-01T10:00:00+08:00" },
    { speaker: "对方", text: "你更喜欢哪一类？", timestamp: "2026-08-01T10:05:00+08:00" },
    { speaker: "我", text: "摄影或者设计吧。", timestamp: "2026-08-01T10:10:00+08:00" }
  ]);
  assert.equal(result.metrics.messageCount, 4);
  assert.equal(result.metrics.speakerCounts.other, 2);
  assert.equal(result.metrics.otherQuestionRatio, 0.5);
  assert.equal(result.metrics.averageReplyGapMs, 3600000);
  assert.equal(result.privacy.rawMessagesRetained, false);
});

test("does not fabricate timing when timestamps are absent", () => {
  const result = analyzeConversation([
    { speaker: "user", text: "最近怎么样" },
    { speaker: "other", text: "最近有点忙" },
    { speaker: "user", text: "那你先忙" }
  ]);
  assert.equal(result.metrics.averageReplyGapMs, null);
  assert.equal(result.metrics.timestampCoverage, "missing");
  assert.ok(result.evidence.some((item) => item.observation.includes("时间戳")));
});

test("marks boundary and repeated follow-up as observations, not intent", () => {
  const result = analyzeConversation([
    { speaker: "user", text: "你在干嘛？" },
    { speaker: "user", text: "怎么不回？" },
    { speaker: "other", text: "我现在不想聊，请先这样。" },
    { speaker: "user", text: "好，我先停下。" }
  ]);
  assert.equal(result.metrics.consecutiveFollowups, 1);
  assert.equal(result.metrics.boundaryMessageCount, 2);
  assert.equal(result.metrics.conflictMessageCount, 0);
  assert.equal(result.metrics.emotionalExchange, "boundary");
});
