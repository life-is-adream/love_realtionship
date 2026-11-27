/**
 * A-05 性能验收：预算、样本校验与报告生成。
 *
 * 默认 **0 次请求**。付费执行必须在浏览器里做（规范 §2.1 要求客户端 performance.now()
 * 并且 t1 是「首字符可见 DOM 更新」），所以本脚本不自己发请求，只做三件事：
 *   1) 打印请求次数、token 上界与费用量级（花钱之前必须先看到这个）；
 *   2) 生成浏览器里要执行的采样计划；
 *   3) 用 --ingest 把采到的样本汇成规范 §2.2 要求的脱敏性能报告。
 * 这样「测的是不是跑的那套」有唯一答案：探针直接 import 生产模块。
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PERF_CASES, toMessages } from "../public/modules/dev/perf-cases.js";
import { callLLM, buildHerMessages } from "../public/modules/core/api-client.js";
import { builtInPersonas } from "../public/modules/core/config.js";

const RUN = process.argv.includes("--yes");
const opt = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const OUT = opt("out", "docs/verification/2026-11-04-A05-perf.md");
const PERSONA = builtInPersonas[opt("persona", "lin")] || builtInPersonas.lin;

/** 与 public/app.js 的 HER_LANE 一致；新脚本一律进 test/lane-config-parity.test.mjs 的比对清单。 */
const HER_LANE = Object.freeze({ thinking: { type: "disabled" }, maxCompletionTokens: 200 });

const PRICE_INPUT_PER_M = 1;
const PRICE_OUTPUT_PER_M = 2;
/** 角色通道实测 token 数（2026-11-03 A-03 抽样，12 次，输入 505–522、输出 4–19）。 */
const MEASURED_PROMPT_TOKENS = { min: 505, avg: 519, max: 522 };
const SLO_TTFC_MS = 6000;
const SLO_TTFV_MS = 2000;
const SLO_GOOD_TURN_RATE = 95;
const FRAME_WAIT_TIMEOUT_MS = 3000;
const FRAME_FALLBACK_LABEL = "frame-timeout";
// Node 口径：请求走的是同一条 /api/chat 代理、同一份 HER_LANE 与同一套消息构造，
// 但拿不到「首字符可见 DOM 更新」—— 那是浏览器里的事，所以 t1 必须是 null。
const NODE_SOURCE = "node-proxy";
const BASE_URL = (process.env.HEARTFLOW_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
/** 无数据一律渲染成 n/a：带单位的 "n/ams"、空集合的 "-Infinityms" 都会伪装成一个测量值。 */
const ms = (value) => (Number.isFinite(value) ? `${Math.round(value)}ms` : "n/a");

/** §2.1 的集合定义是可执行约束，不是散文：不合格就拒绝采样。 */
export function validateSampleSet(cases) {
  const errors = [];
  const ids = new Set();
  for (const item of cases) {
    if (ids.has(item.id)) errors.push(`${item.id} 重复`);
    ids.add(item.id);
    const last = item.lines[item.lines.length - 1] || "";
    if (!last.startsWith("我：")) errors.push(`${item.id} 末行不是「我」，与用户按发送时的状态不符`);
    const han = (last.replace(/^我：/, "").match(/[㐀-䶿一-鿿]/g) || []).length;
    if (han < 15 || han > 120) errors.push(`${item.id} 用户输入 ${han} 汉字，超出 §2.1 的 15–120`);
    const messages = buildHerMessages(PERSONA, {}, toMessages(item.lines), { mode: "anti", stage: "初聊", styleBias: "mix", goal: "x" });
    if (messages.some((m) => /tools|web_search|联网/i.test(JSON.stringify(m)))) errors.push(`${item.id} 触发了联网搜索，不属于短回复 SLO 集合`);
  }
  return { count: cases.length, errors };
}

/** 最近秩：n=40 的 P95 是排序后第 38 个点（规范 §2.2 明确指定这个算法，不许用插值美化）。 */
export function nearestRank(values, percentile) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const rank = Math.max(1, Math.ceil((percentile / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

export function computeStats(samples) {
  const total = samples.length;
  const successes = samples.filter((s) => s.ok);
  const failures = samples.filter((s) => !s.ok);
  // 主 SLO 的分母是**全部合格发送样本**，含超时与失败：把失败删掉来美化通过率是最常见的自欺。
  const goodTurns = successes.filter((s) => s.t2Ms <= SLO_TTFC_MS).length;
  const ttfv = successes.map((s) => s.t1Ms);
  const ttfc = successes.map((s) => s.t2Ms);
  const fmt = ms;
  const series = (values) => {
    const valid = values.filter(Number.isFinite);
    return {
      n: valid.length,
      p50: fmt(nearestRank(valid, 50)),
      p90: fmt(nearestRank(valid, 90)),
      p95: fmt(nearestRank(valid, 95)),
      // 空集合的 Math.max 是 -Infinity：让它渲染成「-Infinityms」就等于把无数据伪装成一个测量值。
      max: fmt(valid.length ? Math.max(...valid) : null)
    };
  };
  const goodTurnRateValue = total ? goodTurns / total * 100 : null;
  // 分子/分母都得有东西可算：全被拒绝采样（比如页面在后台）时 n>0 但成功 0，
  // 这时报「未达标」同样是在骗人 —— 那轮根本没量到任何延迟。
  const voided = total > 0 && successes.length === 0;
  // 只有真实 paint 口径（raf）才允许产出 TTFV 判定：Node 往返与后台标签页都没有可见时刻，
  // 给它们算一个 TTFV 数字就是在伪造一个测不到的指标。
  const paintable = samples.filter((s) => s.ok && s.t2Source === "raf");
  const nonPaint = successes.length - paintable.length;
  return {
    n: total,
    success: successes.length,
    failed: failures.length,
    voided,
    requestsSent: samples.reduce((sum, s) => sum + (s.requestsSent ?? 1), 0),
    nonPaintSamples: nonPaint,
    frameFallback: successes.filter((s) => s.t2Source === "frame-timeout").length,
    // 「timed out」和「timeout」都要收：代理抛的是 DOMException("Upstream timed out")，
    // 只匹配一个写法会把超时样本漏计成普通失败，长尾归因就失真了。
    timeoutLike: failures.filter((s) => /timed out|timeout|abort|504|HTTP 5/i.test(s.error || "")).length,
    goodTurnRate: goodTurnRateValue === null ? "n/a" : goodTurnRateValue.toFixed(1),
    ttfv: series(ttfv),
    ttfc: series(ttfc),
    promptTokens: successes.reduce((sum, s) => sum + (s.promptTokens || 0), 0),
    completionTokens: successes.reduce((sum, s) => sum + (s.completionTokens || 0), 0),
    contentChars: successes.reduce((sum, s) => sum + (s.contentChars || 0), 0),
    verdict: {
      ttfc: voided ? "本轮无效（0 个成功样本）" : (nearestRank(ttfc, 95) === null ? "无数据" : (nearestRank(ttfc, 95) <= SLO_TTFC_MS ? "达标" : "未达标")),
      // TTFV 有两种「量不到」，都必须报未测而不是未达标：
      //   1) 本轮口径里没有 paint（Node 往返，或后台标签页 —— 那种环境连定时器都被钳到 ~1s）；
      //   2) 链路 stream=false，首字与完成同帧，调参不可能达标，要等 P2 的 SSE。
      ttfv: !paintable.length
        ? `未测（本轮 ${successes.length} 条都不是 paint 口径；首字可见要前台浏览器量，或等 P2 流式）`
        : samples.some((s) => s.streamed)
          ? (nearestRank(ttfv, 95) !== null && nearestRank(ttfv, 95) <= SLO_TTFV_MS ? "达标" : "未达标")
          : "未测（当前链路 stream=false，首字与完成同帧）",
      goodTurn: voided ? "本轮无效（0 个成功样本）" : (goodTurnRateValue === null ? "无数据" : (goodTurnRateValue >= SLO_GOOD_TURN_RATE ? "达标" : "未达标"))
    }
  };
}

/**
 * 「方法」一行必须从样本口径推出来，不能写死。
 * 上一版模板硬印「浏览器内 MutationObserver 首字可见」，而这一轮其实是 Node 往返 ——
 * 报告声称用了它没用过的量法，等于伪造验收证据。
 */
export function describeMethod(samples) {
  const counts = samples.reduce((acc, s) => {
    const key = s.t2Source || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const METHOD_BY_SOURCE = {
    [NODE_SOURCE]: "Node 侧 performance.now()：请求发出 → 拿到完整正文；无 DOM 观测，t1 不产出",
    raf: "浏览器内 performance.now() + MutationObserver 首字可见 + rAF 呈现",
    [FRAME_FALLBACK_LABEL]: "浏览器内但 rAF 超时兜底（可见时刻不可信）"
  };
  const parts = Object.entries(counts).map(([source, count]) => `${count} 条：${METHOD_BY_SOURCE[source] || `未知口径 ${source}`}`);
  return `${parts.join("｜")}；串行，不并发`;
}

export function renderPerfReport(samples, meta = {}) {
  const stats = computeStats(samples);
  const lines = [
    "# A-05 真实性能验收（角色短回复通道）",
    "",
    `- 日期：${new Date().toISOString()}`,
    `- 模型/参数：由本地代理转发（版本以服务端 .env 为准）｜通道配置：thinking=disabled + max_completion_tokens=${HER_LANE.maxCompletionTokens}（与 app.js HER_LANE 一致）`,
    `- 角色：${PERSONA.name}｜样本集合：§2.1 短角色回复 ${meta.caseCount ?? stats.n} 条｜方法：${describeMethod(samples)}`,
    `- 网络/服务状态：${meta.network || "未记录"}｜缓存：${meta.cache || "未区分冷/热（本轮未控）"}`,
    `- 采样模式：${stats.nonPaintSamples || stats.frameFallback ? "非 paint 口径（见明细「口径」列）" : "前台可见 + rAF 真实 paint"}`,
    "",
    "## 结论",
    "",
    "| SLO | 门槛 | 实测 |",
    "| --- | --- | --- |",
    `| Good-turn（成功且 TTFC≤6s / 全部发送，含超时失败） | ≥${SLO_GOOD_TURN_RATE}% | ${stats.goodTurnRate}% → **${stats.verdict.goodTurn}** |`,
    `| TTFC P95（最近秩） | ≤${SLO_TTFC_MS}ms | ${stats.ttfc.p95} → **${stats.verdict.ttfc}** |`,
    `| TTFV P95 | ≤${SLO_TTFV_MS}ms | ${stats.ttfv.p95} → **${stats.verdict.ttfv}** |`,
    "",
    "## 明细（规范 §2.2 要求字段）",
    "",
    `n=${stats.n}，成功 ${stats.success}，失败 ${stats.failed}（其中超时/5xx 类 ${stats.timeoutLike}）；实际发出请求 ${stats.requestsSent} 次`,
    ...(stats.frameFallback ? [`⚠ 下一帧兜底：${stats.frameFallback} 条的 t2 不是真实 paint 时刻（rAF 未在 ${FRAME_WAIT_TIMEOUT_MS}ms 内触发），这批可见时刻不可信，应重采。`] : []),
    `TTFC：P50 ${stats.ttfc.p50} / P90 ${stats.ttfc.p90} / P95 ${stats.ttfc.p95} / max ${stats.ttfc.max}（有效样本 ${stats.ttfc.n}）`,
    `TTFV：P50 ${stats.ttfv.p50} / P90 ${stats.ttfv.p90} / P95 ${stats.ttfv.p95} / max ${stats.ttfv.max}（有效样本 ${stats.ttfv.n}）`,
    `token：输入合计 ${stats.promptTokens}，输出合计 ${stats.completionTokens}；正文合计 ${stats.contentChars} 字`,
    `费用实测：≈ ¥${(stats.promptTokens / 1e6 * PRICE_INPUT_PER_M + stats.completionTokens / 1e6 * PRICE_OUTPUT_PER_M).toFixed(4)}（按 ¥${PRICE_INPUT_PER_M}/M 入、¥${PRICE_OUTPUT_PER_M}/M 出，未核对官方现价与缓存价）`,
    "",
    "## 逐条样本（脱敏）",
    "",
    "| 用例 | 结果 | TTFV | TTFC | 输入 tok | 输出 tok | finish | 口径 | 备注 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"
  ];
  for (const s of samples) {
    lines.push(`| ${s.label} | ${s.ok ? "成功" : "失败"} | ${ms(s.t1Ms)} | ${ms(s.t2Ms)} | ${s.promptTokens ?? "n/a"} | ${s.completionTokens ?? "n/a"} | ${s.finishReason || "n/a"} | ${s.t2Source || "raf"} | ${(s.error || "").replace(/\|/g, "/") || "—"} |`);
  }
  lines.push("", "> 本表只描述本次采样窗口。40 条的最近秩 P95 是发布门槛统计，不宣称反映所有时段/地区的真实总体 P95。");
  if (stats.nonPaintSamples) {
    lines.push(`> 本轮有 ${stats.nonPaintSamples} 条不是 paint 口径（Node 往返或后台标签页）：TTFC 可用，TTFV 记 n/a。${stats.nonPaintSamples === stats.success ? "整轮只能当 TTFC 基线用，不能声称达成首字可见 SLO。" : "混口径的轮次不能整体当达标证据。"}`);
  }
  if (!samples.some((s) => s.streamed)) {
    lines.push("> 链路当前 stream=false（server/llmProxy.js:85 写死），首字与完成同帧：TTFV P95≤2s 不可能靠调参达标，需要 P2 的 SSE 通道。");
  }
  return lines.join("\n");
}

function printBudget() {
  const validation = validateSampleSet(PERF_CASES);
  const n = validation.count;
  const inputTypical = Math.round(MEASURED_PROMPT_TOKENS.avg * n);
  const outputTypical = Math.round(11 * n);
  const outputWorst = HER_LANE.maxCompletionTokens * n;
  const cost = (inp, out) => inp / 1e6 * PRICE_INPUT_PER_M + out / 1e6 * PRICE_OUTPUT_PER_M;
  console.log("=== A-05 真实性能采样：执行前预算（规范 §2.2 / §12）===");
  console.log(`样本集合校验：${n} 条 ${validation.errors.length ? `不合规 ${validation.errors.length} 处：\n  ${validation.errors.join("\n  ")}` : "全部符合 §2.1（15–120 汉字、末行为「我」、不触发联网）"}`);
  console.log(`请求次数：${n}（仅角色通道；教练通道与 TTS、联网搜索均不触发）`);
  console.log(`单请求上限：max_completion_tokens=${HER_LANE.maxCompletionTokens}；实测输入 ${MEASURED_PROMPT_TOKENS.min}–${MEASURED_PROMPT_TOKENS.max} tok、输出 4–19 tok`);
  console.log(`输入合计 ≈ ${inputTypical} tok`);
  console.log(`费用：典型 ≈ ¥${cost(inputTypical, outputTypical).toFixed(3)}｜最坏上界 ≈ ¥${cost(inputTypical, outputWorst).toFixed(3)}（全部跑满 200 tok）`);
  console.log(`        （按输入 ¥${PRICE_INPUT_PER_M}/M、输出 ¥${PRICE_OUTPUT_PER_M}/M 估算，**未核对官方现价与缓存价**）`);
  console.log("");
  console.log("⚠ 结构性事实：server/llmProxy.js 把 stream 写死为 false，链路里没有增量正文，");
  console.log("  所以 TTFV（首字符可见）在架构上等于 TTFC，P95≤2s 这条**不可能靠调参达标**，");
  console.log("  只能等 P2 的 SSE 通道。本轮实测的产出是 n=40 的 TTFC/Good-turn 基线 + 失败与长尾分布。");
  console.log("");
  console.log("两条可选口径（都只在 --yes 时才可能花钱）：");
  console.log("  A. Node 口径：`node scripts/eval-perf.mjs --yes` —— 同一份 HER_LANE、同一条 /api/chat、同一套消息构造，");
  console.log("     量「请求 → 拿到完整正文」。t1=null、t2Source=node-proxy，报告只判 TTFC 与 Good-turn，TTFV 如实报未测。");
  console.log("  B. 浏览器口径（t1 唯一可信来源，需窗口前台可见）：");
  console.log("     页面里 import /modules/dev/perf-probe.js 与 /modules/dev/perf-cases.js（改动后记得带 ?cb= 绕开模块缓存）；");
  console.log("     异步起跑挂到 window 上再轮询（单条 1.7–40s，同步等待会被工具超时打断）：");
  console.log("       window.__hfPerf = { done: false, samples: [] };");
  console.log("       runPerfBatch(PERF_CASES, { lane: HER_LANE, callLLM, buildMessages, onEach: (s) => window.__hfPerf.samples.push(s) }).then(() => window.__hfPerf.done = true);");
  console.log("     收尾必须 probeHygiene(samples).clean === true（不写 localStorage、无残留节点），再：");
  console.log(`       node scripts/eval-perf.mjs --ingest=<样本JSON> --out=${OUT}`);
  console.log("");
  console.log(`未带 --yes 时本脚本不发出任何请求。是否执行由用户决定；A-05 在未获批准前状态是「未测」，不是「通过」。`);
}

/**
 * Node 口径采样：走同一条 /api/chat 本地代理、同一份 HER_LANE、同一套 buildHerMessages，
 * 量「发出请求 → 拿到完整正文」。拿不到的东西不假装：浏览器呈现与首字可见不在口径内，
 * 所以 t1 记 null、t2Source 标 node-proxy，报告端据此禁止产出 TTFV 判定。
 * 之所以留这条路径：A-05 的窗口必须前台可见，而隐藏标签页里连 setTimeout(200) 都被钳到 ~1s，
 * 那种环境下浏览器探针同样量不准 —— Node 路径至少不受标签页节流影响。
 */
export async function runNodeBatch(cases, { onEach = () => {} } = {}) {
  const out = [];
  for (const item of cases) {
    const sample = {
      label: item.id, ok: false, error: "", t1Ms: null, t2Ms: null,
      promptTokens: null, completionTokens: null, finishReason: "", contentChars: 0,
      t2Source: NODE_SOURCE, requestsSent: 0
    };
    const started = performance.now();
    try {
      sample.requestsSent = 1;
      const result = await callLLM({ endpoint: `${BASE_URL}/api/chat`, ...HER_LANE, messages: buildHerMessages(PERSONA, {}, toMessages(item.lines), { mode: "anti", stage: "初聊", styleBias: "mix", goal: "把这一句自然接下去" }) });
      sample.t2Ms = performance.now() - started;
      sample.ok = true;
      sample.contentChars = String(result.content || "").length;
      const usage = result.raw?.usage || {};
      sample.promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? null;
      sample.completionTokens = usage.completion_tokens ?? usage.output_tokens ?? null;
      sample.finishReason = result.raw?.choices?.[0]?.finish_reason || "";
    } catch (error) {
      sample.t2Ms = performance.now() - started;
      sample.error = String(error?.message || error).slice(0, 200);
    }
    out.push(sample);
    onEach(sample, out.length);
  }
  return out;
}

async function main() {
  const ingest = opt("ingest", "");
  if (ingest) {
    const samples = JSON.parse(await readFile(path.resolve(ingest), "utf8"));
    if (!Array.isArray(samples) || !samples.length) {
      console.error("样本文件为空或不是数组：拒绝出报告（0 分母不能渲染成 0% 或 100% 达标）。");
      process.exitCode = 1;
      return;
    }
    const report = renderPerfReport(samples, { caseCount: PERF_CASES.length, network: opt("network", "未记录"), cache: opt("cache", "未区分") });
    await mkdir(path.dirname(path.resolve(OUT)), { recursive: true });
    await writeFile(path.resolve(OUT), report, "utf8");
    const stats = computeStats(samples);
    console.log(JSON.stringify({ n: stats.n, success: stats.success, failed: stats.failed, goodTurnRate: stats.goodTurnRate, ttfcP95: stats.ttfc.p95, ttfvP95: stats.ttfv.p95, verdict: stats.verdict }, null, 2));
    console.log(`报告：${path.resolve(OUT)}`);
    return;
  }
  if (RUN) {
    const validation = validateSampleSet(PERF_CASES);
    if (validation.errors.length) {
      console.error(`样本集合不合规（${validation.errors.length} 处），拒绝发出任何请求：${validation.errors.join(" / ")}`);
      process.exitCode = 1;
      return;
    }
    let alive = false;
    try { alive = (await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(5000) })).ok; } catch { alive = false; }
    if (!alive) {
      console.error(`本地代理不可用：${BASE_URL}。本次未发出任何模型请求。`);
      process.exitCode = 1;
      return;
    }
    printBudget();
    console.log("");
    console.log("开始采样（Node 口径，t1=null）：");
    const samples = await runNodeBatch(PERF_CASES, {
      onEach: (s, i) => process.stdout.write(`${i}:${s.ok ? Math.round(s.t2Ms) : "×"}ms `)
    });
    const jsonPath = path.resolve(OUT).replace(/\.md$/, "-samples.json");
    await mkdir(path.dirname(jsonPath), { recursive: true });
    await writeFile(jsonPath, JSON.stringify(samples), "utf8");
    await writeFile(path.resolve(OUT), renderPerfReport(samples, { caseCount: PERF_CASES.length, network: "Node → 本地代理，未记录网络类型", cache: "未区分" }), "utf8");
    const stats = computeStats(samples);
    console.log("");
    console.log(JSON.stringify({ n: stats.n, success: stats.success, failed: stats.failed, requestsSent: stats.requestsSent, goodTurnRate: stats.goodTurnRate, ttfcP95: stats.ttfc.p95, verdict: stats.verdict }, null, 2));
    console.log(`报告：${path.resolve(OUT)}`);
    console.log(`原始样本（可离线重出报告，不必再付费）：${jsonPath}`);
    return;
  }
  printBudget();
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await main();
