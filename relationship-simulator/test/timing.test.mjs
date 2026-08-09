import test from "node:test";
import assert from "node:assert/strict";
import { getTimingReasons, hasUsableTimestamps, scoreTiming } from "../public/modules/training/timing.js";

const NOW = "2026-07-16T20:00:00+08:00";

function message(type, text, createdAt) {
  return { type, text, ...(createdAt ? { createdAt } : {}) };
}

test("没有有效时间戳时不计算分数，也不伪造等待时长", () => {
  const messages = [message("her", "今天有点忙"), message("me", "那你先忙")];
  const result = scoreTiming({ messages, latestDraft: "你怎么还不回我？", stage: "隔天轻联系", now: NOW });

  assert.equal(hasUsableTimestamps(messages), false);
  assert.equal(result.dataAvailable, false);
  assert.equal(result.score, null);
  assert.equal(result.metrics.elapsedMinutes, null);
  assert.equal(result.metrics.lastMessageAt, null);
  assert.ok(result.reasons.some((reason) => reason.includes("有效时间戳")));
  assert.ok(!result.reasons.some((reason) => /等待\d+小时|等待几小时/.test(reason)));
});

test("支持 ISO 时间戳，并识别未回应时的连续发送", () => {
  const messages = [
    message("her", "今天还行，就是有点忙", "2026-07-16T19:30:00+08:00"),
    message("me", "那你先忙，晚点聊", "2026-07-16T19:31:00+08:00"),
    message("me", "你现在方便吗？", "2026-07-16T19:35:00+08:00")
  ];
  const result = scoreTiming({ messages, latestDraft: "怎么不回我？是不是生气了？", stage: "隔天轻联系", now: NOW });

  assert.equal(hasUsableTimestamps(messages), true);
  assert.equal(result.dataAvailable, true);
  assert.ok(Number.isFinite(result.score));
  assert.equal(result.flags.continuousSend, true);
  assert.equal(result.flags.unansweredFollowUp, true);
  assert.ok(result.reasons.some((reason) => reason.includes("连续发送")));
  assert.ok(result.reasons.some((reason) => reason.includes("未回应")));
  assert.ok(result.score < 60);
});

test("对方收尾或疲惫时，认可状态的短回复比继续追问得分更高", () => {
  const messages = [message("her", "今天加班好累，早点休息吧", "2026-07-16T22:30:00+08:00")];
  const respectful = scoreTiming({
    messages,
    latestDraft: "好，你也早点休息，改天再聊。",
    stage: "隔天轻联系",
    now: "2026-07-16T22:35:00+08:00"
  });
  const pushy = scoreTiming({
    messages,
    latestDraft: "你为什么累？明天几点起？周末要不要见面？",
    stage: "隔天轻联系",
    now: "2026-07-16T22:35:00+08:00"
  });

  assert.equal(respectful.flags.otherClosing, true);
  assert.equal(respectful.flags.otherFatigued, true);
  assert.ok(respectful.suggestions.some((suggestion) => suggestion.includes("留出空间")));
  assert.ok(respectful.score > pushy.score);
  assert.ok(pushy.reasons.some((reason) => reason.includes("多个问题")));
});

test("过长草稿和多个问题会降低时机分数", () => {
  const messages = [message("her", "我刚到家", "2026-07-16T19:00:00+08:00")];
  const draft = "你今天工作怎么样？吃饭了吗？最近是不是遇到什么问题？我就是有点担心你，也不知道这样问会不会打扰你，希望你能告诉我更多，也可以慢慢说，不急着现在回复。";
  const result = scoreTiming({ messages, latestDraft: draft, stage: "隔天轻联系", now: NOW });

  assert.equal(result.flags.tooLong, true);
  assert.equal(result.flags.multipleQuestions, true);
  assert.ok(result.metrics.questionCount >= 3);
  assert.ok(result.reasons.some((reason) => reason.includes("偏长")));
  assert.ok(result.reasons.some((reason) => reason.includes("多个问题")));
  assert.ok(result.suggestions.some((suggestion) => suggestion.includes("一个重点")));
});

test("第一次邀约阶段的具体、可选择推进点获得正向建议", () => {
  const messages = [message("her", "这周末应该有空", "2026-07-16T18:00:00+08:00")];
  const result = scoreTiming({
    messages,
    latestDraft: "那周六下午有空的话，一起去喝杯咖啡？不方便也没关系。",
    stage: "第一次邀约",
    now: NOW
  });

  assert.equal(result.dataAvailable, true);
  assert.equal(result.flags.stageMatched, true);
  assert.equal(result.flags.clearReturnPoint, true);
  assert.equal(result.metrics.questionCount, 1);
  assert.ok(result.score >= 80);
  assert.ok(result.reasons.some((reason) => reason.includes("第一次邀约阶段匹配")));
  assert.ok(result.suggestions.some((suggestion) => suggestion.includes("可选择")));
});

test("早期阶段的过快升温会被提示，简短低压力表达保持正向", () => {
  const messages = [message("her", "今天聊得还不错", "2026-07-16T19:00:00+08:00")];
  const tooFast = scoreTiming({
    messages,
    latestDraft: "我已经喜欢你很久了，我们现在就在一起吧？",
    stage: "刚加微信后的第一晚",
    now: NOW
  });
  const natural = scoreTiming({
    messages,
    latestDraft: "我也觉得，今天聊得挺轻松的。",
    stage: "刚加微信后的第一晚",
    now: NOW
  });

  assert.ok(tooFast.reasons.some((reason) => reason.includes("推进偏快")));
  assert.ok(tooFast.score < natural.score);
  assert.ok(natural.suggestions.some((suggestion) => suggestion.includes("可以发送")));
});

test("getTimingReasons 是纯解释函数，并能处理非法输入", () => {
  const reasons = getTimingReasons({
    messages: [{ type: "her", text: "早点休息", createdAt: "not-a-date" }],
    latestDraft: "你明天几点起？"
  });

  assert.ok(Array.isArray(reasons));
  assert.ok(reasons.some((reason) => reason.includes("有效时间戳")));
  assert.doesNotThrow(() => getTimingReasons());
});
