#!/usr/bin/env node
/**
 * 真实上游的有界体验抽样（合成场景，不读取任何真实聊天记录）。
 *
 * 目的不是给模型质量打分，而是回答两个可验证的问题：
 * 1. 经过本地护栏的输入是否真的不再请求上游（身份直问、无依据的事实追问）；
 * 2. 其余场景在真实 mimo 上游上是否仍会编造用户没说过的地点。
 *
 * 用法（需要本机服务已启动，且 .env 已配置模型）：
 *   node scripts/eval-chat-style-live.mjs --base-url=http://localhost:3000
 *   node scripts/eval-chat-style-live.mjs --scenario=greeting --styles=daily
 *
 * 输出：docs/verification/<date>-chat-style-live.md 与同名 .json。
 * 不会输出或写入 API key。
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildHerMessages, callLLM, resolveDeterministicReply } from "../public/modules/core/api-client.js";
import { PROMPT_VERSION } from "../public/modules/coach/prompts.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CASES_PATH = path.join(ROOT, "test", "fixtures", "chat-style-cases.json");

const CITIES = ["北京", "上海", "广州", "深圳", "杭州", "成都", "南京", "武汉", "西安", "重庆", "天津", "苏州", "厦门", "长沙", "郑州", "青岛", "大连", "沈阳", "哈尔滨", "昆明", "贵阳", "南宁", "福州", "合肥", "济南", "宁波", "无锡", "东莞", "珠海", "佛山", "海口", "三亚", "兰州", "乌鲁木齐", "拉萨", "香港", "澳门", "台北"];

const SYNTHETIC_PERSONA = {
  name: "合成角色",
  systemRole: "你是用于接口验证的合成角色，性格平和、说话简短。",
  tags: ["合成"]
};

function parseArgs(argv) {
  const options = { baseUrl: "http://localhost:3000", styles: ["daily", "humorous", "gentle"], scenario: "", timeoutMs: 60_000 };
  for (const arg of argv.slice(2)) {
    const [key, value = ""] = arg.replace(/^--/, "").split("=");
    if (key === "base-url") options.baseUrl = value.replace(/\/$/, "");
    else if (key === "styles") options.styles = value.split(",").map((item) => item.trim()).filter(Boolean);
    else if (key === "scenario") options.scenario = value;
    else if (key === "timeout-ms") options.timeoutMs = Number(value) || options.timeoutMs;
  }
  return options;
}

function citiesIn(text) {
  return CITIES.filter((city) => String(text || "").includes(city));
}

/**
 * 一个回合里问了两件事，就是「查户口」感。
 * 只数问号会漏掉「在你上班路上吗」这种没有标点的问句，所以按分句判：
 * 带问号的分句 + 以疑问词或语气词收尾的分句。
 */
function questionCount(text) {
  const value = String(text || "").trim();
  if (!value) return 0;
  const parts = value.split(/([，,。.！!？?~～\n]+)/);
  let count = 0;
  for (let index = 0; index < parts.length; index += 2) {
    const clause = parts[index].trim();
    const punct = parts[index + 1] || "";
    if (!clause) continue;
    if (/[？?]/.test(punct)) count += 1;
    else if (/(?:吗|呢|还是|哪|谁|什么|怎么样|怎么|为什么|多少|要不要|行不行|好不好|是不是)$/.test(clause)) count += 1;
  }
  return count;
}

/**
 * 角色不该以系统视角确认记忆是否被更新/删除：她既看不到记忆面板，也无法核对。
 * 这类句式是功能层的越权口吻，不是角色台词。
 */
function claimsMemoryState(text) {
  return /我(?:这边)?(?:看到|看得到|收到)[^。！？\n]{0,12}(?:更新|修改|删除|改过)|按新的记忆|记忆(?:已经|已)(?:更新|同步|删除)/.test(String(text || ""));
}

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function main() {
  const options = parseArgs(process.argv);
  const health = await fetch(`${options.baseUrl}/api/health`).then((res) => res.json()).catch(() => ({}));
  if (!health?.ok) throw new Error(`本地服务不可用：${options.baseUrl}/api/health`);
  const allCases = JSON.parse(await readFile(CASES_PATH, "utf8"));
  const cases = options.scenario ? allCases.filter((item) => item.id === options.scenario) : allCases;
  if (!cases.length) throw new Error(`未找到场景：${options.scenario}`);

  const results = [];
  let requestCount = 0;

  for (const scenario of cases) {
    for (const style of options.styles) {
      const history = [{ type: "me", text: scenario.input }];
      const guard = resolveDeterministicReply(scenario.input, history, {});
      if (guard) {
        results.push({
          scenario: scenario.id, style, mode: "guard", source: guard.source,
          reply: guard.text, ms: 0, upstream: false, introducedCities: [], uncertain: false, fabricated: false, followedUp: false
        });
        continue;
      }

      const startedAt = Date.now();
      let reply = "";
      let error = "";
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeoutMs);
        const response = await callLLM({
          endpoint: `${options.baseUrl}/api/chat`,
          messages: buildHerMessages(SYNTHETIC_PERSONA, {}, history, { chatStyle: style }),
          thinking: { type: "disabled" },
          maxCompletionTokens: 200,
          temperature: 0.8,
          signal: controller.signal
        });
        clearTimeout(timer);
        reply = response.content.trim();
      } catch (err) {
        error = err?.message || String(err);
      }
      requestCount += 1;

      const introduced = citiesIn(reply).filter((city) => !scenario.input.includes(city));
      const uncertain = /不确定|不知道|没说过|没提过|没记录|记不清/.test(reply);
      results.push({
        scenario: scenario.id,
        style,
        mode: "upstream",
        source: error ? "error" : "model",
        reply,
        error,
        ms: Date.now() - startedAt,
        upstream: true,
        introducedCities: introduced,
        uncertain,
        fabricated: introduced.length > 0 && !uncertain,
        followedUp: scenario.id === "stop-chat" ? /[？?]/.test(reply) : false
      });
    }
  }

  // 统一在结果上补齐两个可判定的质量维度，护栏行与上游行用同一把尺子。
  for (const item of results) {
    item.questionCount = questionCount(item.reply);
    item.memoryClaim = claimsMemoryState(item.reply);
  }

  const upstream = results.filter((item) => item.upstream);
  const guarded = results.filter((item) => !item.upstream);
  const failed = upstream.filter((item) => item.error);
  const fabricated = upstream.filter((item) => item.fabricated);
  const followedUp = results.filter((item) => item.followedUp);
  const multiQuestion = results.filter((item) => item.questionCount >= 2);
  const memoryClaims = results.filter((item) => item.memoryClaim);

  const summary = {
    generatedAt: new Date().toISOString(),
    timezone: "Asia/Shanghai",
    baseUrl: options.baseUrl,
    promptVersion: PROMPT_VERSION,
    model: health.model || "unknown",
    apiMode: health.apiMode || "unknown",
    scenarioCount: cases.length,
    styleCount: options.styles.length,
    requestCount,
    guardCount: guarded.length,
    upstreamSuccess: upstream.length - failed.length,
    upstreamFailed: failed.length,
    fabricatedCount: fabricated.length,
    stopChatFollowUpCount: followedUp.length,
    multiQuestionCount: multiQuestion.length,
    memoryClaimCount: memoryClaims.length,
    results
  };

  const lines = [
    `# 对话风格与记忆护栏：真实上游抽样（${todayKey()}）`,
    "",
    `- 上游：本机 \`/api/chat\` 代理 → \`${health.model || "unknown"}\`（${health.apiMode || "unknown"}）；脚本不回显凭证`,
    `- 提示词版本：\`${PROMPT_VERSION}\``,
    `- 场景：\`test/fixtures/chat-style-cases.json\` 共 ${cases.length} 个合成场景 × ${options.styles.length} 种风格`,
    `- 实际发往上游：${requestCount} 次；本地护栏拦截：${guarded.length} 次`,
    `- 上游成功：${upstream.length - failed.length}/${upstream.length}；编造未提及城市：${fabricated.length} 条`,
    `- 单回合 ≥2 个问句：${multiQuestion.length} 条；以系统视角确认记忆状态：${memoryClaims.length} 条`,
    `  - 问句数为分句启发式计数（问号结尾 + 疑问词/语气词收尾），只用于观察「连问」倾向，不是质量评分。`,
    "",
    "| 场景 | 风格 | 来源 | 耗时 | 问句 | 编造城市 | 回复摘要 |",
    "| --- | --- | --- | --- | --- | --- | --- |"
  ];
  for (const item of results) {
    const reply = (item.reply || item.error || "").replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 60);
    lines.push(`| ${item.scenario} | ${item.style} | ${item.mode === "guard" ? `护栏/${item.source}` : item.source} | ${item.ms ? `${(item.ms / 1000).toFixed(1)}s` : "—"} | ${item.questionCount} | ${(item.introducedCities || []).join("、") || "—"}${item.uncertain ? "（有不确定表述）" : ""}${item.memoryClaim ? "（越权口吻）" : ""} | ${reply || "—"} |`);
  }
  if (followedUp.length) {
    lines.push("", `> 提醒：${followedUp.length} 条 stop-chat 回复仍带问号，说明「尊重停聊」只能靠提示词约束，规则层面未强制。`);
  }
  if (memoryClaims.length) {
    lines.push("", `> 提醒：${memoryClaims.length} 条回复以系统视角确认记忆状态（如「我这边看到的已经是更新后的内容」），角色无法核对后台记忆。`);
  }
  if (multiQuestion.length) {
    lines.push("", `> 提醒：${multiQuestion.length} 条回复单回合出现两个以上问句，读起来像连续追问。`);
  }
  lines.push("");

  const stamp = todayKey();
  const mdPath = path.join(ROOT, "docs", "verification", `${stamp}-chat-style-live.md`);
  const jsonPath = path.join(ROOT, "docs", "verification", `${stamp}-chat-style-live.json`);
  await writeFile(mdPath, lines.join("\n"), "utf8");
  await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log(`场景 ${cases.length} × ${options.styles.length}；上游请求 ${requestCount}；护栏 ${guarded.length}`);
  console.log(`上游成功 ${upstream.length - failed.length}/${upstream.length}；编造城市 ${fabricated.length}；停聊追问 ${followedUp.length}`);
  console.log(`单回合 ≥2 问句 ${multiQuestion.length}；记忆越权口吻 ${memoryClaims.length}`);
  console.log(`报告：${path.relative(ROOT, mdPath)}`);
  if (failed.length) {
    console.log("失败示例：", failed.slice(0, 3).map((item) => `${item.scenario}/${item.style}: ${item.error}`).join(" | "));
    process.exitCode = 1;
  }
  if (fabricated.length) process.exitCode = 1;
  // 编造用户事实与冒充后台状态是两类「说了不成立的话」，出现即判失败；
  // 多问句属于自然度指标，只统计不判失败（采样温度 0.8，单次波动不足以定性）。
  if (memoryClaims.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("抽样失败：", err?.message || err);
  process.exitCode = 1;
});
