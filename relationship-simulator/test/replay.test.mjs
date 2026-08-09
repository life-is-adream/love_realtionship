import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeReplay,
  buildReplaySummary,
  parseReplayText,
  redactSensitiveText
} from "../public/modules/training/replay.js";

test("parses 我/她 speaker prefixes and preserves order", () => {
  const result = parseReplayText("我：今天还顺利吗？\n她：还好，刚下班。");

  assert.deepEqual(result.messages.map((message) => [message.speaker, message.text]), [
    ["self", "今天还顺利吗？"],
    ["other", "还好，刚下班。"]
  ]);
  assert.deepEqual(result.stats, { total: 2, parsed: 2, unknown: 0 });
  assert.equal(result.messages[0].timestamp, null);
});

test("accepts markdown bold speaker prefixes and ignores blank lines", () => {
  const result = parseReplayText("**我：** 你明天有空吗？\n\n**夏紫桐：** 明天可能不行。");

  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].speaker, "self");
  assert.equal(result.messages[1].speaker, "other");
  assert.equal(result.messages[1].text, "明天可能不行。");
  assert.deepEqual(result.messages.map((message) => message.line), [1, 3]);
});

test("recognizes aliases, ASCII colons, and optional ISO-like timestamps", () => {
  const result = parseReplayText([
    "[2026-07-16 20:30] 我方: 最近还好吗？",
    "2026-07-16T20:45:00+08:00 **女生：** 还好。",
    "男方：那就好。"
  ].join("\n"));

  assert.deepEqual(result.messages.map((message) => message.speaker), ["self", "other", "self"]);
  assert.match(result.messages[0].timestamp, /^2026-07-16T12:30:00\.000Z$/);
  assert.match(result.messages[1].timestamp, /^2026-07-16T12:45:00\.000Z$/);
  assert.equal(result.warnings.some((warning) => warning.includes("未检测到")), false);
});

test("does not invent speakers for malformed lines and retains the line", () => {
  const result = parseReplayText("这是一段没有说话人标记的文字\n\n[not-a-time] 仍然保留");

  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].speaker, "unknown");
  assert.equal(result.messages[0].text, "这是一段没有说话人标记的文字");
  assert.equal(result.messages[1].speaker, "unknown");
  assert.equal(result.messages[1].text, "[not-a-time] 仍然保留");
  assert.equal(result.stats.unknown, 2);
  assert.ok(result.warnings.some((warning) => warning.includes("2 行")));
});

test("redacts phone, email, url, and long numeric identifiers without changing ordinary prose", () => {
  const result = redactSensitiveText(
    "电话 13812345678，邮箱 a@example.com，网址 https://example.com/a，编号 110101199001011234。普通文字保留。"
  );

  assert.match(result.text, /\[已隐藏手机号\]/);
  assert.match(result.text, /\[已隐藏邮箱\]/);
  assert.match(result.text, /\[已隐藏网址\]/);
  assert.match(result.text, /\[已隐藏编号\]/);
  assert.match(result.text, /普通文字保留/);
  assert.deepEqual(result.hits, [
    { type: "phone", count: 1 },
    { type: "email", count: 1 },
    { type: "url", count: 1 },
    { type: "id", count: 1 }
  ]);
});

test("redaction keeps ordinary prose unchanged when there is no sensitive data", () => {
  const text = "今天下班后去看展，路上风很大。";
  assert.deepEqual(redactSensitiveText(text), { text, hits: [] });
});

test("calculates initiative, reply length, question density, cooldown, and boundaries", () => {
  const messages = parseReplayText([
    "2026-07-16 18:00 我：最近还好吗？",
    "2026-07-16 18:02 她：还好，刚下班。",
    "2026-07-16 18:03 我：你在忙吗？",
    "2026-07-16 18:04 她：今天有点累，先休息吧。",
    "2026-07-16 18:05 我：那你现在出来吗？",
    "2026-07-16 21:30 她：改天吧。"
  ].join("\n")).messages;
  const result = analyzeReplay(messages, { cooldownMinutes: 60 });

  assert.equal(result.overview.totalMessages, 6);
  assert.equal(result.metrics.avgSelfLength > 0, true);
  assert.equal(result.metrics.avgOtherLength > 0, true);
  assert.equal(result.metrics.questionRate, 1);
  assert.equal(result.metrics.replyRate, 1);
  assert.equal(result.metrics.cooldownCount, 1);
  assert.ok(result.metrics.boundarySignals.length >= 2);
  assert.ok(result.observations.some((item) => item.type === "boundary_signal"));
  assert.ok(result.observations.some((item) => item.type === "possible_misread"));
  assert.equal(result.dimensions.timing.status, "available");
});

test("detects consecutive follow-up and offers timing practice", () => {
  const messages = parseReplayText([
    "我：最近还好吗？",
    "我：你在忙吗？",
    "她：刚下班，有点累。",
    "我：那你现在出来吗？"
  ].join("\n")).messages;
  const result = analyzeReplay(messages);

  assert.equal(result.metrics.consecutiveSelfCount, 2);
  assert.ok(result.observations.some((item) => item.type === "consecutive_follow_up"));
  assert.ok(result.suggestions.some((item) => item.dimension === "timing"));
});

test("does not claim timing problems when timestamps are absent", () => {
  const result = analyzeReplay(parseReplayText("我：你好\n她：你好").messages);

  assert.equal(result.dimensions.timing.status, "unknown");
  assert.equal(result.dimensions.timing.score, null);
  assert.equal(result.metrics.cooldownCount, null);
  assert.match(buildReplaySummary(result), /不对消息时机下结论/);
  assert.doesNotMatch(buildReplaySummary(result), /检测到 .*次较长间隔/);
});

test("keeps unknown lines out of speaker metrics but includes them in overview", () => {
  const result = analyzeReplay(parseReplayText("我：你好\n异常行\n她：你好").messages);

  assert.equal(result.overview.totalMessages, 3);
  assert.equal(result.overview.selfMessages, 1);
  assert.equal(result.overview.otherMessages, 1);
  assert.equal(result.metrics.replyRate, 1);
});

test("buildReplaySummary is concise, evidence-based, and does not expose raw messages", () => {
  const result = analyzeReplay(parseReplayText("我：你好\n她：还好，刚下班。").messages);
  const summary = buildReplaySummary(result);

  assert.equal(typeof summary, "string");
  assert.match(summary, /共分析 2 条消息/);
  assert.match(summary, /未提供可用时间戳/);
  assert.doesNotMatch(summary, /刚下班/);
});

