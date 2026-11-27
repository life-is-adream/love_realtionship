// A-05 量具的测试：不花一次请求，但必须能咬人 ——  percentile 算法、分母口径、
// 以及「架构上量不到的指标不得假装达标」这三件事，都是历史上真栽过的坑。
import test from "node:test";
import assert from "node:assert/strict";

import { validateSampleSet, nearestRank, computeStats, renderPerfReport } from "../scripts/eval-perf.mjs";
import { PERF_CASES } from "../public/modules/dev/perf-cases.js";

const sample = (index, t2, extra = {}) => ({
  label: `p${index}`,
  ok: true,
  error: "",
  // stream=false 的现实：首字与完成同帧。测试刻意保持这个形状，不伪造更早的 t1。
  t1Ms: extra.t1 ?? t2,
  t2Ms: t2,
  promptTokens: 519,
  completionTokens: 11,
  finishReason: "stop",
  contentChars: 30,
  // 默认按「前台可见 + rAF 真实 paint」口径建模，特殊口径由 extra 覆盖。
  t2Source: "raf",
  requestsSent: 1,
  ...extra
});

test("最近秩：n=40 的 P95 是排序后第 38 个点，不是插值", () => {
  const values = Array.from({ length: 40 }, (_, i) => i + 1);
  assert.equal(nearestRank(values, 95), 38);
  assert.equal(nearestRank(values, 50), 20);
  assert.equal(nearestRank(values, 90), 36);
  // 乱序输入也必须给同一个答案，否则「按秩取」会被实现顺序污染。
  assert.equal(nearestRank([...values].reverse(), 95), 38);
  assert.equal(nearestRank([], 95), null);
});

test("样本集合符合规范 §2.1：40 条、15–120 汉字、末行是「我」", () => {
  const result = validateSampleSet(PERF_CASES);
  assert.equal(result.count, 40);
  assert.deepEqual(result.errors, [], result.errors.join("\n"));
});

test("集合校验会拒绝不合格的样本（过短、末行不是「我」、重复 id）", () => {
  const bad = [
    { id: "p01", lines: ["我：太短了"] },
    { id: "p02", lines: ["她：这句不该在最后", "我：好的那你先忙，我改天再约你，别担心我这边时间", "她：嗯"] },
    { id: "p02", lines: ["我：这条重复了 id，应该被抓出来才对呀"] }
  ];
  const result = validateSampleSet(bad);
  assert.ok(result.errors.some((text) => text.includes("p01") && /15–120/.test(text)), result.errors.join("\n"));
  assert.ok(result.errors.some((text) => text.includes("p02") && text.includes("末行")), result.errors.join("\n"));
  assert.ok(result.errors.some((text) => text.includes("重复")), result.errors.join("\n"));
});

test("失败与超时必须留在 Good-turn 分母里，不能靠删样本美化通过率", () => {
  const samples = [
    ...Array.from({ length: 37 }, (_, i) => sample(i + 1, 2000)),
    sample(38, 5000),
    { label: "p39", ok: false, error: "HTTP 504 Gateway Timeout", t1Ms: null, t2Ms: 60000, promptTokens: 0, completionTokens: 0, finishReason: "", contentChars: 0 },
    { label: "p40", ok: false, error: "Upstream timed out", t1Ms: null, t2Ms: 60000, promptTokens: 0, completionTokens: 0, finishReason: "", contentChars: 0 }
  ];
  const stats = computeStats(samples);
  assert.equal(stats.n, 40);
  assert.equal(stats.failed, 2);
  // 38 条 ≤6s / 40 条全部发送 = 95%；分母若偷偷剔掉失败会算成 100%。
  assert.equal(stats.goodTurnRate, "95.0");
  assert.equal(stats.verdict.goodTurn, "达标");
  assert.equal(stats.timeoutLike, 2);
});

test("TTFC P95 超 6 秒就判未达标，不因平均值好看而放行", () => {
  const samples = Array.from({ length: 40 }, (_, i) => sample(i + 1, i < 37 ? 1500 : 9000));
  const stats = computeStats(samples);
  assert.equal(stats.ttfc.p95, "9000ms");
  assert.equal(stats.verdict.ttfc, "未达标");
});

test("stream=false 时 TTFV 报「未测」，不许冒充达标或未达标", () => {
  const samples = Array.from({ length: 40 }, (_, i) => sample(i + 1, 1500));
  const stats = computeStats(samples);
  assert.match(stats.verdict.ttfv, /未测/);
  const report = renderPerfReport(samples, { caseCount: 40 });
  assert.match(report, /TTFV.*未测（当前链路 stream=false/, report);
  // 流式实现后（P2）同一份代码必须改为真判：给一个 streamed 样本验证分支会切换。
  const streamed = samples.map((s) => ({ ...s, streamed: true, t1Ms: 800 }));
  assert.equal(computeStats(streamed).verdict.ttfv, "达标");
});

test("空样本拒绝出报告结论，0 分母不许写成 0% 或达标", () => {
  const stats = computeStats([]);
  assert.equal(stats.n, 0);
  assert.equal(stats.goodTurnRate, "n/a");
  assert.equal(stats.verdict.goodTurn, "无数据");
  assert.equal(stats.verdict.ttfc, "无数据");
  assert.equal(stats.ttfv.p95, "n/a");
});

// ── 彩排抓到的两个真缺陷（页面后台 / 全量拒绝采样）───────────────────────────

test("非浏览器环境下探针拒绝采样，而不是挂死", async () => {
  const { visibilityBlocker } = await import("../public/modules/dev/perf-probe.js");
  assert.match(visibilityBlocker(), /非浏览器环境|visibilityState/, visibilityBlocker());
});

test("全量拒绝采样的那一轮判「本轮无效」，不许报成 SLO 未达标", () => {
  const refused = Array.from({ length: 40 }, (_, i) => ({
    label: `p${i + 1}`, ok: false, error: "拒绝采样：页面 visibilityState=hidden", requestsSent: 0,
    t1Ms: null, t2Ms: null, promptTokens: null, completionTokens: null, finishReason: "", contentChars: 0, t2Source: ""
  }));
  const stats = computeStats(refused);
  assert.equal(stats.n, 40);
  assert.equal(stats.success, 0);
  assert.equal(stats.requestsSent, 0, "拒绝采样必须是 0 次请求，否则白烧一轮付费");
  assert.equal(stats.verdict.ttfc, "本轮无效（0 个成功样本）");
  assert.equal(stats.verdict.goodTurn, "本轮无效（0 个成功样本）");
});

test("rAF 超时的降级口径要在报告里点名，不能与真实 paint 混为一谈", () => {
  const samples = Array.from({ length: 40 }, (_, i) => sample(i + 1, 1500, i >= 36 ? { t2Source: "frame-timeout" } : { t2Source: "raf" }));
  const stats = computeStats(samples);
  assert.equal(stats.frameFallback, 4);
  const report = renderPerfReport(samples, { caseCount: 40 });
  assert.match(report, /下一帧兜底：4 条的 t2 不是真实 paint 时刻/, report);
  // 全 paint 口径的轮次不该出现这行警告：报没有发生的问题同样是噪声。
  const clean = renderPerfReport(Array.from({ length: 4 }, (_, i) => sample(i + 1, 1500, { t2Source: "raf" })), { caseCount: 4 });
  assert.doesNotMatch(clean, /下一帧兜底/, clean);
});

test("非 paint 口径（Node 往返）的一轮禁止产出 TTFV 判定", () => {
  const samples = Array.from({ length: 40 }, (_, i) => ({
    label: `p${i + 1}`, ok: true, error: "", t1Ms: null, t2Ms: 1500,
    promptTokens: 519, completionTokens: 11, finishReason: "stop", contentChars: 30,
    requestsSent: 1, t2Source: "node-proxy"
  }));
  const stats = computeStats(samples);
  assert.equal(stats.nonPaintSamples, 40);
  assert.match(stats.verdict.ttfv, /不是 paint 口径/, stats.verdict.ttfv);
  // TTFC 仍然可判：Node 口径缺的是呈现时刻，不是完成时刻。
  assert.equal(stats.verdict.ttfc, "达标");
  const report = renderPerfReport(samples, { caseCount: 40 });
  assert.match(report, /非 paint 口径/, report);
  // 无数据必须渲染成 n/a，不能带着单位后缀装成一个测量值。
  assert.match(report, /\| 成功 \| n\/a \| 1500ms \|/, report);
  assert.doesNotMatch(report, /n\/ams/, report);
  assert.doesNotMatch(report, /-Infinity/, report);
});

test("报告的「方法」行必须跟样本口径一致，不许写死成浏览器测量", async () => {
  const { describeMethod } = await import("../scripts/eval-perf.mjs");
  const nodeRun = Array.from({ length: 4 }, (_, i) => sample(i + 1, 1500, { t1Ms: null, t2Source: "node-proxy" }));
  const nodeMethod = describeMethod(nodeRun);
  assert.match(nodeMethod, /Node 侧 performance\.now/, nodeMethod);
  assert.doesNotMatch(nodeMethod, /MutationObserver/, nodeMethod);
  // 浏览器口径那轮才允许出现首字可见的说法。
  const browserRun = Array.from({ length: 4 }, (_, i) => sample(i + 1, 1500, { t2Source: "raf" }));
  assert.match(describeMethod(browserRun), /MutationObserver 首字可见/, describeMethod(browserRun));
  // 混口径必须两边都写出来，不能只报好听的那个。
  assert.match(describeMethod([...nodeRun, ...browserRun]), /4 条：Node 侧.*｜4 条：浏览器内/s, describeMethod([...nodeRun, ...browserRun]));
});
