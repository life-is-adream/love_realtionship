// A-03 真实模型抽样：教练通道的「捏造既成事实」基础率 + 审计器命中率。
//
// 与 eval-behavior.mjs 的分工：那个测「像不像真人、三条有没有别」，这个测「有没有编事故实」。
// 为什么必须单独跑：离线 fixture 只证明审计器对我手写的 50 条写法有效，
// 证明不了模型实际会写出哪些没见过的句式 —— 而那才是 A-03 要求人工盲评的东西。
//
// 用法：
//   node scripts/eval-grounding.mjs              干跑：打印用例、请求次数、token 与费用预估，不联网
//   node scripts/eval-grounding.mjs --yes        真正执行（调用付费 API）
//   可选：--limit=6 --persona=lin --out=docs/verification/2026-11-03-A03-real-sample.md
//
// 刻意不调用 LLM 裁判：同源自评只能做低成本筛查，不能当发布门槛（规范 §12.3）。
// 报告逐字保留模型原文，判定权交给人。
//
// 密钥不进这个脚本：请求走本地代理，钥匙只存在于服务端 .env。
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { builtInPersonas } from "../public/modules/core/config.js";
import { buildHerMessages, buildCoachMessages, callLLM } from "../public/modules/core/api-client.js";
import { parseHerBubbles, joinHerReply } from "../public/modules/coach/her-reply.js";
import { parseModelContent, extractJsonObject, normalizeReplyOptions } from "../public/modules/coach/parser.js";
import { buildEvidenceLedger } from "../public/modules/coach/evidence-ledger.js";
import { auditReplyOption, groundReplyOptions } from "../public/modules/coach/reply-grounding.js";

const args = process.argv.slice(2);
const flag = (name) => args.some((item) => item === `--${name}`);
const opt = (name, fallback) => args.find((item) => item.startsWith(`--${name}=`))?.slice(`--${name}=`.length) ?? fallback;

const BASE_URL = opt("base-url", "http://127.0.0.1:3000").replace(/\/$/, "");
const LIMIT = Number(opt("limit", "99"));
const OUT = opt("out", "docs/verification/2026-11-03-A03-real-sample.md");
const RUN = flag("yes");
const PERSONA = builtInPersonas[opt("persona", "lin")] || builtInPersonas.lin;

/** 与 public/app.js 完全一致；改那边必须同步改这里，否则测的是另一个配置。 */
const HER_LANE = Object.freeze({ thinking: { type: "disabled" }, maxCompletionTokens: 200 });
const COACH_LANE = Object.freeze({ thinking: { type: "disabled" }, responseFormat: { type: "json_object" } });

const PRICE_INPUT_PER_M = 1;
const PRICE_OUTPUT_PER_M = 2;
const CHARS_PER_TOKEN = 1.4;
/** 教练通道生产配置没有输出上限，这里用历史观测值做预算，报告里必须标明它不是上限。 */
const COACH_COMPLETION_BUDGET_TOKENS = 900;

// 用例设计原则：故意「不给足信息」。用户只说了意愿、没说时间地点，
// 才是教练最容易开始编的现场 —— 拿信息齐全的对话去测等于把缺陷藏起来。
const CASES = [
  { id: "g01", seed: "我：周末有个画展，要不要一起去看？", goal: "把邀约说清楚" },
  { id: "g02", seed: "我：我知道有家云南菜很可以，改天带你去。", goal: "自然约一次饭" },
  { id: "g03", seed: "我：等你忙完这阵，我们找个时间见一面。", goal: "推进见面但不施压" },
  { id: "g04", seed: "我：最近有部纪录片挺火，回头看？", goal: "找个共同话题" },
  { id: "g05", seed: "我：你说想喝咖啡，那找个下午一起坐坐。", goal: "把模糊意愿变成一次见面" },
  { id: "g06", seed: "我：天气这么好，别浪费在室内。", goal: "提议户外活动" },
  { id: "g07", seed: "我：这周是不是又快 deadline 了？", goal: "表达关心" },
  { id: "g08", seed: "我：那我不问了，你想说的时候我都在。", goal: "尊重边界" },
  { id: "g09", seed: "我：上次你说想吃日料，我一直记着。", goal: "兑现自己提过的事" },
  { id: "g10", seed: "我：这周末我可能有点事，下周呢？", goal: "改期而不消失" },
  { id: "g11", seed: "我：你下班一般几点？", goal: "确认时间窗口" },
  { id: "g12", seed: "我：要不要顺路一起走一段，就当散步。", goal: "低压力见面" }
];

const activeCases = CASES.slice(0, Math.max(1, LIMIT));
const REQUESTS_PER_CASE = 2;
const TOTAL_REQUESTS = activeCases.length * REQUESTS_PER_CASE;

function estimatePromptChars(item) {
  const messages = [{ mid: "m-seed", type: "me", who: "我", text: item.seed, source: "user" }];
  const her = buildHerMessages(PERSONA, {}, messages, { mode: "anti", stage: "初聊", styleBias: "mix", goal: item.goal });
  const coach = buildCoachMessages({ persona: PERSONA, memory: {}, messages, herReply: "（占位：她的真实回复）", uiValues: { mode: "anti", stage: "初聊", styleBias: "mix", goal: item.goal } });
  const chars = (list) => list.reduce((sum, msg) => sum + String(msg.content).length, 0);
  return { her: chars(her), coach: chars(coach) };
}

function printBudget() {
  console.log("=== A-03 真实抽样：执行前预算（规范 §12.2）===");
  console.log(`目标模型：MiMo（由本地代理转发，具体版本以服务端 .env 为准）`);
  console.log(`测试集版本：eval-grounding v1，用例 ${activeCases.length} 条（共 ${CASES.length} 条可用）`);
  console.log(`角色：${PERSONA.name}｜教练通道配置：thinking=disabled + json_object（与 app.js COACH_LANE 一致）`);
  console.log(`请求上限：${TOTAL_REQUESTS} 次（每用例 角色1 + 教练1；无 LLM 裁判调用）`);
  console.log(`单请求输出：角色通道上限 ${HER_LANE.maxCompletionTokens} tokens；教练通道生产无上限，按历史观测 ${COACH_COMPLETION_BUDGET_TOKENS} tokens 估`);

  let herChars = 0;
  let coachChars = 0;
  for (const item of activeCases) {
    const est = estimatePromptChars(item);
    herChars += est.her;
    coachChars += est.coach;
  }
  const herTokens = Math.ceil(herChars / CHARS_PER_TOKEN);
  const coachTokens = Math.ceil(coachChars / CHARS_PER_TOKEN);
  const completionTokens = activeCases.length * (HER_LANE.maxCompletionTokens + COACH_COMPLETION_BUDGET_TOKENS);
  const cost = (herTokens + coachTokens) / 1e6 * PRICE_INPUT_PER_M + completionTokens / 1e6 * PRICE_OUTPUT_PER_M;

  console.log(`实测 prompt 字符数（本地构造真实消息，非猜）：角色 ${herChars} + 教练 ${coachChars} ≈ 输入 ${herTokens + coachTokens} tokens`);
  console.log(`预估输入+输出合计：约 ${((herTokens + coachTokens + completionTokens) / 1000).toFixed(1)}k tokens`);
  console.log(`费用量级：≈ ¥${cost.toFixed(3)}（输入 ¥${PRICE_INPUT_PER_M}/M、输出 ¥${PRICE_OUTPUT_PER_M}/M；**未核对官方现价与缓存价，不保证**）`);
  console.log(`日志存放：${path.resolve(OUT)}（只存本轮短对话与模型原文，不含 API Key）`);
  console.log(`本地代理：${BASE_URL}`);
  console.log("\n这是干跑：没有发出任何请求。确认要花钱请加 --yes。");
}

function useFor(raw) {
  const usage = raw?.usage || {};
  return {
    prompt: Number(usage.prompt_tokens ?? 0),
    completion: Number(usage.completion_tokens ?? 0),
    finishReason: raw?.choices?.[0]?.finish_reason || "?"
  };
}

async function runCase(api, item) {
  const record = { id: item.id, seed: item.seed, errors: [], ms: {} };
  const messages = [{ mid: "m-seed", type: "me", who: "我", text: item.seed, source: "user" }];
  const uiValues = { mode: "anti", stage: "初聊", styleBias: "mix", goal: item.goal };

  const herStarted = Date.now();
  const herResult = await callLLM({ ...api, ...HER_LANE, messages: buildHerMessages(PERSONA, {}, messages, uiValues) });
  record.ms.her = Date.now() - herStarted;
  const bubbles = parseHerBubbles(herResult.content, PERSONA.name);
  record.herReply = joinHerReply(bubbles);
  record.herUse = useFor(herResult.raw);
  if (!bubbles.length) {
    record.errors.push("角色通道未返回可用回复");
    return record;
  }

  const conversation = [...messages, { mid: "m-her", type: "her", who: PERSONA.name, text: record.herReply, source: "model" }];

  const coachStarted = Date.now();
  const coachResult = await callLLM({
    ...api,
    ...COACH_LANE,
    messages: buildCoachMessages({ persona: PERSONA, memory: {}, messages, herReply: record.herReply, uiValues })
  });
  record.ms.coach = Date.now() - coachStarted;
  record.coachUse = useFor(coachResult.raw);
  record.coachRaw = String(coachResult.content || "");

  // 先量模型本身：直接对模型原始 A/B/C 做审计，绕开 parser 的本地兜底。
  // 否则测的是「兜底模板有多干净」，而不是「模型有没有编事」—— 那是两个完全不同的结论。
  const obj = extractJsonObject(record.coachRaw);
  const rawOptions = obj ? normalizeReplyOptions(obj.replyOptions || obj.choices) : [];
  record.rawOptionCount = rawOptions.length;
  if (!obj) record.errors.push("教练输出未能解析为 JSON");

  const ledger = buildEvidenceLedger(conversation);
  record.audits = rawOptions.map((option) => auditReplyOption(option, ledger));

  // 再看用户实际会看到什么（含降级/整套退回本地）。
  const shown = parseModelContent(record.coachRaw, { herReply: record.herReply, latestMine: item.seed, messages: conversation });
  record.shownSource = shown.replyOptionsSource;
  record.shownOptions = shown.replyOptions.map((option) => ({ key: option.key, text: option.text, flagged: Boolean(option.needsUserFill) }));
  record.grounding = { ok: shown.grounding?.ok, needsUserFill: shown.grounding?.needsUserFill, blockedKeys: shown.grounding?.blockedKeys || [] };
  return record;
}

function summarize(records) {
  const allAudits = records.flatMap((r) => r.audits || []);
  const fabricated = allAudits.filter((a) => a.findings.length);
  const truncated = records.filter((r) => r.coachUse?.finishReason === "length");
  const parseFailed = records.filter((r) => r.errors.length);
  return {
    cases: records.length,
    options: allAudits.length,
    fabricatedOptions: fabricated.length,
    fabricationRate: allAudits.length ? (fabricated.length / allAudits.length * 100).toFixed(1) : "0",
    byType: fabricated.flatMap((a) => a.findings).reduce((acc, f) => ({ ...acc, [f.type]: (acc[f.type] || 0) + 1 }), {}),
    fellBackToLocal: records.filter((r) => r.shownSource === "local").length,
    truncated: truncated.length,
    parseFailed: parseFailed.length,
    totalPrompt: records.reduce((sum, r) => sum + (r.herUse?.prompt || 0) + (r.coachUse?.prompt || 0), 0),
    totalCompletion: records.reduce((sum, r) => sum + (r.herUse?.completion || 0) + (r.coachUse?.completion || 0), 0)
  };
}

function renderReport(records, stats) {
  const lines = [
    "# A-03 真实模型抽样：教练捏造基础率与审计器命中",
    "",
    `- 生成时间：${new Date().toISOString()}`,
    `- 角色：${PERSONA.name}｜用例：${stats.cases}｜教练通道：thinking=disabled + json_object（与 app.js 一致）`,
    `- 请求次数：${stats.cases * REQUESTS_PER_CASE}（角色 ${stats.cases} + 教练 ${stats.cases}），**无 LLM 裁判**`,
    `- token 实测：输入 ${stats.totalPrompt}，输出 ${stats.totalCompletion}`,
    `- 价格假设：输入 ¥${PRICE_INPUT_PER_M}/M、输出 ¥${PRICE_OUTPUT_PER_M}/M，未核对官方现价与缓存价（**量级估计，不保证**）`,
    "",
    "## 结论指标",
    "",
    "| 指标 | 值 |",
    "| --- | --- |",
    `| 模型 A/B/C 总条数 | ${stats.options} |`,
    `| 审计判定含捏造 | ${stats.fabricatedOptions}（${stats.fabricationRate}%） |`,
    `| finding 分布 | ${JSON.stringify(stats.byType)} |`,
    `| 整套退回本地兜底的用例 | ${stats.fellBackToLocal} |`,
    `| 教练输出被长度截断(finish_reason=length) | ${stats.truncated} |`,
    `| 解析/调用异常用例 | ${stats.parseFailed} |`,
    "",
    "> 审计器是词面判定，命中不等于「模型真的错了」，漏检也不等于「模型对了」。",
    "> 下面每条捏造都逐字列出，需要人工盲评：模型是否真的把没发生的事说成了既定事实；审计是否误杀。",
    "",
    "## 逐用例原文",
    ""
  ];

  for (const r of records) {
    lines.push(`### ${r.id}｜${r.seed}`);
    lines.push(`- 她的回复：${r.herReply || "(无)"}`);
    lines.push(`- 耗时：角色 ${r.ms.her}ms / 教练 ${r.ms.coach}ms；教练 finish_reason=${r.coachUse?.finishReason || "?"}`);
    lines.push(`- 用户实际看到：来源 ${r.shownSource}，审计降级条 ${r.grounding?.blockedKeys?.join(",") || "无"}`);
    if (r.errors.length) lines.push(`- ⚠ 异常：${r.errors.join("；")}`);
    if (!r.audits?.length) lines.push("- 模型未给出可解析的 A/B/C。原文前 400 字：" + String(r.coachRaw || "").slice(0, 400));
    r.audits?.forEach((audit, index) => {
      const verdict = audit.findings.length ? `**判定捏造** ${audit.findings.map((f) => `${f.type}→${f.entity}`).join(", ")}` : "通过";
      lines.push(`  ${index + 1}. ${audit.key}: ${audit.text}`);
      lines.push(`     - ${verdict}`);
      lines.push(`     - 人工盲评（模型确实错了吗 / 审计是否误杀）：待填`);
    });
    if (r.shownOptions?.length) {
      lines.push(`  - 展示层最终三条：${r.shownOptions.map((o) => `${o.key}${o.flagged ? "※" : ""}`).join(" ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  if (!RUN) {
    printBudget();
    return;
  }

  let alive = false;
  try {
    alive = (await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(5000) })).ok;
  } catch {
    alive = false;
  }
  if (!alive) {
    console.error(`本地代理不可用：${BASE_URL}。先启动 node server/index.js。本次未发出任何模型请求。`);
    process.exitCode = 1;
    return;
  }

  const api = { endpoint: `${BASE_URL}/api/chat` };
  const records = [];
  // 逐条 try/catch：一次失败不能丢掉已经花钱拿到的其余样本。
  for (const item of activeCases) {
    process.stdout.write(`· ${item.id} `);
    try {
      records.push(await runCase(api, item));
      process.stdout.write("ok\n");
    } catch (error) {
      process.stdout.write(`失败：${error.message}\n`);
      records.push({ id: item.id, seed: item.seed, errors: [`调用失败：${error.message}`], audits: [], ms: {} });
    }
  }

  const stats = summarize(records);
  await writeFile(path.resolve(OUT), renderReport(records, stats), "utf8");
  console.log("\n" + JSON.stringify(stats, null, 2));
  console.log(`报告：${path.resolve(OUT)}`);
  console.log("「人工盲评」栏未填之前，A-03 不能标为通过。");
}

await main();
