#!/usr/bin/env node
/**
 * C / 浏览器 JS 规则一致性检查：教练评分、时机评分、聊天回放。
 *
 * 生产 UI 优先调用 /api/v2/rules/*；public/modules 里的同名单函数是服务不可用时的
 * 兜底实现。本脚本用同一批输入同时打两边，逐字段比较，防止两边悄悄漂移。
 *
 * 全程本地、零模型调用；C 服务用临时端口 + 测试豁免（不占生产限流桶、不写日志）。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildCoachScore } from "../../public/modules/coach/coach.js";
import { scoreTiming } from "../../public/modules/training/timing.js";
import { parseReplayText, analyzeReplay, buildReplaySummary } from "../../public/modules/training/replay.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const exe = process.env.HF_RULES_EXE || path.join(root, "heartflow-c", "hf.exe");
const port = Number(process.env.HF_RULES_PORT || 3296);
const base = `http://127.0.0.1:${port}`;
const tolerance = Number(process.env.HF_RULES_TOLERANCE || 1e-6);

if (!existsSync(exe)) {
  console.error(`找不到 C 可执行文件：${exe}\n先运行 heartflow-c/build.sh，或设置 HF_RULES_EXE。`);
  process.exit(2);
}

const server = spawn(exe, ["serve", "--port", String(port), "--root", "."], {
  cwd: root,
  env: { ...process.env, HF_RATE_LIMIT_DISABLE: "1", HF_LOG_DISABLE: "1" },
  stdio: "ignore",
  windowsHide: true
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitHealth() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch { /* not ready */ }
    await sleep(100);
  }
  throw new Error("C 规则服务在 10 秒内没有就绪");
}

async function post(route, body) {
  const response = await fetch(`${base}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${route} HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

function compare(a, b, where, out) {
  if (a === b) return;
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance) return;
    out.push(`${where}: ${a} != ${b}`);
    return;
  }
  if (a == null || b == null) {
    if (a !== b) out.push(`${where}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) { out.push(`${where}: array type mismatch`); return; }
    if (a.length !== b.length) out.push(`${where}.length: ${a.length} != ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) compare(a[i], b[i], `${where}[${i}]`, out);
    return;
  }
  if (typeof a === "object" || typeof b === "object") {
    if (typeof a !== "object" || typeof b !== "object") { out.push(`${where}: object type mismatch`); return; }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) compare(a[key], b[key], `${where}.${key}`, out);
    return;
  }
  out.push(`${where}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}

/* ---------- 语料 ---------- */

const coachCases = [
  ["可能记得太多没用的细节，真正重要的反而忘了。", {}],
  ["已经很厉害了。", {}],
  ["你先忙你的，等你方便再说。", {}],
  ["你现在有男朋友吗？", {}],
  ["你是不是不高兴？", {}],
  ["我只是随便去看了看。", {}],
  ["你确定是你借给我的？", {}],
  ["我意思是天气还不错，不是说你一定要出门，其实我就是想问问你有没有空。", {}],
  ["如果你周五晚上有空可以一起去。", {}],
  ["你今天在做什么？吃饭了吗？忙吗？", {}],
  ["偶尔，最近公司搬到那一片附近。今天开完会走错了路，才发现校门口那家卖烤冷面的店还在。", {}],
  ["抱歉，这句有点装深沉。你不用接。", {}],
  ["明白。你愿意说多少就说多少，我也不会把没说的部分自动补成故事。", {}],
  ["你不用因为我两天没发消息就承担确认我的责任。", {}],
  ["我知道。刚才是你选的帮忙，不是我替你接管。", {}],
  ["好，那就不语音。", {}],
  ["听起来你昨天做了不少事，今天估计会有点累。", {}],
  ["我今天午饭吃了便利店关东煮，里面有一块萝卜像海绵，吸了很多汤但没有味道。", {}],
  ["好，我收回推理。", {}],
  ["我能理解你为什么生气，但我不确定自己有没有资格判断你是不是太较真。", {}],
  ["你想说的时候发就行。", {}],
  ["这盆绿萝看起来像刚开完一场很长的会。", {}],
  ["测试回复。", { risk: "测试", judgement: "测试" }],
  ["今天和你聊得挺自然的。", {}],
  ["你今天好美，做我女朋友吧？", {}],
  ["你平时也喜欢看电影吗？", {}],
  ["我先忙，晚点再说。", { risk: "有施压风险", judgement: "她刚说累" }],
  ["我意思是最近有点忙，不是说你打扰我，其实我就是想解释一下，我的意思是我们改天再聊。", { herLastMessage: "今天加班好累" }],
  ["你应该早点休息，别想太多，理性来说这只是小事。", { herLastMessage: "今天真的好难过" }],
  ["哈哈哈，好呀，我也喜欢！", {}],
  ["在吗", {}],
  ["", {}],
  ["😀😀😀", {}],
  ["你刚才说的“我需要一点空间”我记住了。", { herLastMessage: "今天有点累" }],
  ["我猜你大概不太想来，你是不是觉得我太急了？", { herLastMessage: "最近有点烦" }],
  ["宝贝，睡了吗？", {}],
  ["我想你了，抱抱。", {}],
  ["我知道你累了，那就早点休息吧。", {}],
  ["你愿意说多少就说多少，不用勉强。", {}],
  ["抱歉，我刚才又一点急了，收回结论。", {}],
  ["你是不是不开心？", {}],
  ["我我我我我我，今天有点忙。", {}],
  ["你平时喜欢什么？", {}],
  ["你一般周末都做什么？", {}],
  ["好，那就语音吧。", {}],
  ["我意思是最近有点忙，不是说你打扰我，其实我就是想解释一下，我的意思是我们改天再聊。", { herLastMessage: "今天加班好累" }],
  ["你应该早点休息，别想太多，理性来说这只是小事。", { herLastMessage: "今天真的好难过" }],
  ["我意思是天气不错，不是说你必须出门，其实我就是随口一问，我的意思是看你。", {}],
  ["这盆绿萝看起来像刚开完一场很长的会，叶子都垂下来了。", {}],
  ["我今天午饭吃了便利店关东煮，里面有一块萝卜像海绵，吸了很多汤但没有味道，不过还挺好吃的，下次可以试试别的。", {}],
  ["，像刚开完", { risk: "有风险", judgement: "她有点冷淡", herLastMessage: "先休息" }],
  ["吗值得鼓励你可能不知道abc想说的时候「，自然生气「睡", {}],
  ["我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我我", {}]
];

const timingCases = [
  { messages: [{ type: "her", text: "今天有点忙" }, { type: "me", text: "那你先忙" }], latestDraft: "你怎么还不回我？", stage: "隔天轻联系", now: "2026-07-16T20:00:00+08:00" },
  { messages: [{ type: "her", text: "今天还行，就是有点忙", createdAt: "2026-07-16T19:30:00+08:00" }, { type: "me", text: "那你先忙，晚点聊", createdAt: "2026-07-16T19:31:00+08:00" }, { type: "me", text: "你现在方便吗？", createdAt: "2026-07-16T19:35:00+08:00" }], latestDraft: "怎么不回我？是不是生气了？", stage: "隔天轻联系", now: "2026-07-16T20:00:00+08:00" },
  { messages: [{ type: "her", text: "今天加班好累，早点休息吧", createdAt: "2026-07-16T22:30:00+08:00" }], latestDraft: "好，你也早点休息，改天再聊。", stage: "隔天轻联系", now: "2026-07-16T22:35:00+08:00" },
  { messages: [{ type: "her", text: "今天加班好累，早点休息吧", createdAt: "2026-07-16T22:30:00+08:00" }], latestDraft: "你为什么累？明天几点起？周末要不要见面？", stage: "隔天轻联系", now: "2026-07-16T22:35:00+08:00" },
  { messages: [{ type: "her", text: "我刚到家", createdAt: "2026-07-16T19:00:00+08:00" }], latestDraft: "你今天工作怎么样？吃饭了吗？最近是不是遇到什么问题？我就是有点担心你，也不知道这样问会不会打扰你，希望你能告诉我更多，也可以慢慢说，不急着现在回复。", stage: "隔天轻联系", now: "2026-07-16T20:00:00+08:00" },
  { messages: [{ type: "her", text: "这周末应该有空", createdAt: "2026-07-16T18:00:00+08:00" }], latestDraft: "那周六下午有空的话，一起去喝杯咖啡？不方便也没关系。", stage: "第一次邀约", now: "2026-07-16T20:00:00+08:00" },
  { messages: [{ type: "her", text: "今天聊得还不错", createdAt: "2026-07-16T19:00:00+08:00" }], latestDraft: "我已经喜欢你很久了，我们现在就在一起吧？", stage: "刚加微信后的第一晚", now: "2026-07-16T20:00:00+08:00" },
  { messages: [{ type: "her", text: "今天聊得还不错", createdAt: "2026-07-16T19:00:00+08:00" }], latestDraft: "我也觉得，今天聊得挺轻松的。", stage: "刚加微信后的第一晚", now: "2026-07-16T20:00:00+08:00" },
  { messages: [{ type: "her", text: "早点休息", createdAt: "not-a-date" }], latestDraft: "你明天几点起？" },
  { messages: [], latestDraft: "", stage: "" },
  { messages: [{ speaker: "her", content: "今天有点累", timestamp: 1784200000000 }, { speaker: "me", content: "那你早点休息", timestamp: 1784200300000 }], latestDraft: "明天再聊，晚安。", stage: "第一次约会后", now: "2026-07-16T23:30:00+08:00" },
  { messages: [{ role: "her", message: "今天还行", timestamp: "2026-07-16T19:30:00Z" }, { role: "me", message: "那就好", timestamp: "2026-07-16T19:31:00Z" }], latestDraft: "那明天见？", stage: "第一次邀约", now: "2026-07-16T20:00:00Z" },
  { messages: [{ type: "her", text: "今天有点忙", createdAt: "2026-07-16T19:30:00.123+08:00" }], latestDraft: "好，你先忙。", stage: "隔天轻联系", now: "2026-07-16T20:00:00.456+08:00" },
  { messages: [{ type: "her", text: "今天有点累", createdAt: "2026-07-16 19:30" }], latestDraft: "那你早点休息。", stage: "隔天轻联系", now: "2026-07-16 20:00" },
  { messages: [{ type: "her", text: "今天有点累", createdAt: "2026-07-16T19:30:00+08:00" }], latestDraft: "那你早点休息。", stage: "暧昧推进", now: "2026-07-16T20:00:00+08:00" },
  { messages: [{ type: "her", text: "今天有点累", createdAt: "2026-07-16T19:30:00+08:00" }], latestDraft: "那你早点休息。", stage: "表达好感", now: "2026-07-16T20:00:00+08:00" },
  { messages: [{ type: "her", text: "今天有点累", createdAt: "2026-07-16T19:30:00+08:00" }], latestDraft: "那你早点休息。", stage: "确定关系", now: "2026-07-16T20:00:00+08:00" },
  { messages: [{ type: "her", text: "今天有点累", createdAt: "2026-07-16T19:30:00+08:00" }], latestDraft: "那你早点休息。", stage: "不存在的阶段", now: "2026-07-16T20:00:00+08:00" },
  { messages: [{ type: "her", text: "今天有点累", createdAt: "2026-07-16T19:30:00+08:00" }], latestDraft: "那你早点休息。", stage: "隔天轻联系", now: "2026-07-16T23:30:00+08:00" }
];

const replayCases = [
  "我：今天还顺利吗？\n她：还好，刚下班。",
  "**我：** 你明天有空吗？\n\n**夏紫桐：** 明天可能不行。",
  ["[2026-07-16 20:30] 我方: 最近还好吗？", "2026-07-16T20:45:00+08:00 **女生：** 还好。", "男方：那就好。"].join("\n"),
  "这是一段没有说话人标记的文字\n\n[not-a-time] 仍然保留",
  ["2026-07-16 18:00 我：最近还好吗？", "2026-07-16 18:02 她：还好，刚下班。", "2026-07-16 18:03 我：你在忙吗？", "2026-07-16 18:04 她：今天有点累，先休息吧。", "2026-07-16 18:05 我：那你现在出来吗？", "2026-07-16 21:30 她：改天吧。"].join("\n"),
  ["我：最近还好吗？", "我：你在忙吗？", "她：刚下班，有点累。", "我：那你现在出来吗？"].join("\n"),
  "我：你好\n她：你好",
  "我：你好\n异常行\n她：你好",
  "我：你好\n她：还好，刚下班。",
  "我：电话 13812345678，邮箱 a@example.com，网址 https://example.com/a，编号 110101199001011234。\n她：好。",
  ["2026-07-16 09:00 我：今天有空吗？", "2026-07-16 09:05 她：我今天有点累，先休息吧。", "2026-07-16 09:06 我：那你现在出来吗？", "2026-07-16 12:10 她：晚安", "2026-07-16 12:11 我：为什么这么早睡？"].join("\n"),
  ["2026-07-16 09:00 我：你好", "2026-07-16 09:01 她：你好", "2026-07-16 09:02 她：今天有点忙", "2026-07-16 09:03 她：改天聊"].join("\n"),
  ["2026-07-16 09:00 我：周末有空吗？", "2026-07-16 09:01 她：我在开会，有事要处理", "2026-07-16 09:02 我：那你先忙", "2026-07-16 09:03 她：不太方便，先休息吧", "2026-07-16 09:04 她：晚安"].join("\n"),
  ["2026-07-16 09:00 我：你好", "2026-07-16 09:01 她：昨天那个电话 13812345678 是你吗？", "2026-07-16 09:02 我：不是，邮箱是 a@example.com", "2026-07-16 09:03 她：https://example.com/a 这个呢"].join("\n"),
  ["2026-07-16T09:00:00Z 我：你好", "2026-07-16T09:01:00Z 她：你好", "2026-07-16T09:02:00Z 我：周末有空吗？"].join("\n"),
  ["2026-07-16 09:00 我：你好", "2026-07-16 09:01 她：不太好意思，我不想聊了", "2026-07-16 09:02 我：为什么不想聊？"].join("\n"),
  ["2026-07-16 09:00 我：你好", "2026-07-16 09:01 她：今天有点累", "2026-07-16 09:02 我：那你现在出来吗？"].join("\n"),
  "我：你好\n她：今天好累，example.com 这个你看下",
  "我：你好\n她：今天好累，打我电话 13812345678",
  "我：你好\n她：今天好累，邮箱 a@example.com 这个你看下",
  ""
];

/* ---------- 比较 ---------- */

async function checkCoach() {
  const failures = [];
  for (const [text, context] of coachCases) {
    const expected = buildCoachScore(text, context);
    const actual = await post("/api/v2/rules/coach-score", { text, context });
    const diffs = [];
    compare(expected, actual, "coach", diffs);
    if (diffs.length) failures.push({ input: text, diffs: diffs.slice(0, 8) });
  }
  return failures;
}

async function checkTiming() {
  const failures = [];
  for (const input of timingCases) {
    const expected = scoreTiming(input);
    const actual = await post("/api/v2/rules/timing", input);
    const diffs = [];
    compare(expected, actual, "timing", diffs);
    if (diffs.length) failures.push({ input: JSON.stringify(input).slice(0, 160), diffs: diffs.slice(0, 8) });
  }
  return failures;
}

async function checkReplay() {
  const failures = [];
  for (const raw of replayCases) {
    const parsed = parseReplayText(raw);
    const analysis = analyzeReplay(parsed.messages);
    const expected = { parse: parsed, analysis, summary: buildReplaySummary(analysis) };
    const actual = await post("/api/v2/rules/replay", { text: raw });
    const diffs = [];
    compare(expected, actual, "replay", diffs);
    if (diffs.length) failures.push({ input: raw.slice(0, 120), diffs: diffs.slice(0, 12) });
  }
  return failures;
}

/* ---------- 入口 ---------- */

let exitCode = 0;
try {
  await waitHealth();
  const groups = [
    ["coach-score", await checkCoach()],
    ["timing", await checkTiming()],
    ["replay", await checkReplay()]
  ];
  for (const [name, failures] of groups) {
    if (failures.length === 0) {
      console.log(`PASS  ${name}`);
      continue;
    }
    exitCode = 1;
    console.log(`FAIL  ${name}  ${failures.length} 个差异`);
    for (const failure of failures.slice(0, 5)) {
      console.log(`  input: ${failure.input}`);
      for (const diff of failure.diffs) console.log(`    ${diff}`);
    }
  }
  const total = coachCases.length + timingCases.length + replayCases.length;
  console.log(`规则一致性：${total} 个样本，${exitCode ? "存在差异" : "全部一致"}`);
} catch (error) {
  console.error(`规则一致性检查失败：${error.message}`);
  exitCode = 1;
} finally {
  try { server.kill(); } catch { /* ignore */ }
}
process.exitCode = exitCode;
