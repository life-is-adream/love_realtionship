// 通道配置一致性守卫。
//
// 今天踩过的坑：评测脚本里的 COACH_LANE 与 app.js 手工各写一份，改一边忘改另一边，
// 于是「评测结论」测的其实是另一个配置。这个接缝必须有机检，不能靠人记住注释里那句
// 「改这里必须同步改那边」。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function laneFrom(file, name) {
  const source = readFileSync(join(root, file), "utf8");
  const match = new RegExp(`const ${name} = Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\)`).exec(source);
  assert.ok(match, `${file} 里找不到 ${name} 的 Object.freeze 定义 —— 定义方式变了，守卫要一起改`);
  const body = match[1];
  const read = (key) => {
    const entry = new RegExp(`${key}:\\s*\\{([^}]*)\\}|${key}:\\s*([0-9]+)`).exec(body);
    if (!entry) return undefined;
    return entry[1] ? entry[1].replace(/["\s]/g, "") : Number(entry[2]);
  };
  return {
    thinking: read("thinking"),
    maxCompletionTokens: read("maxCompletionTokens"),
    responseFormat: read("responseFormat")
  };
}

test("角色通道：app.js 与评测脚本配置逐字段一致", () => {
  const app = laneFrom("public/app.js", "HER_LANE");
  const evalScript = laneFrom("scripts/eval-grounding.mjs", "HER_LANE");
  const behavior = laneFrom("scripts/eval-behavior.mjs", "HER_LANE");
  const perf = laneFrom("scripts/eval-perf.mjs", "HER_LANE");
  assert.deepEqual(evalScript, app, "eval-grounding 的 HER_LANE 与生产不一致");
  assert.deepEqual(behavior, app, "eval-behavior 的 HER_LANE 与生产不一致");
  assert.deepEqual(perf, app, "eval-perf 的 HER_LANE 与生产不一致：A-05 量的就不是跑的那条链路");
});

// 探针拿通道配置只能靠调用方传入。它一旦自带一份，就会变成第四真理来源 ——
// 「评测脚本与生产各写一份」这件事已经骗过我们一轮并白烧了一次付费采样。
test("性能探针不自带通道配置", () => {
  const source = readFileSync(join(root, "public/modules/dev/perf-probe.js"), "utf8");
  assert.ok(!/const\s+(HER|COACH)_LANE\s*=/.test(source), "perf-probe.js 里出现了自己的通道配置");
  assert.ok(/if \(!lane\) throw/.test(source), "perf-probe.js 缺少 lane 缺失即抛错的守卫");
});

// A-05 量的是「用户实际会经历的那条链路」：端点、模型、鉴权都必须沿用生产默认值。
// 硬编码一个模型名就能让整轮付费采样测到另一个模型上 —— 这类事我们已经栽过一次。
test("A-05 采样脚本沿用生产的端点与模型默认值", () => {
  const source = readFileSync(join(root, "scripts/eval-perf.mjs"), "utf8");
  assert.doesNotMatch(source, /model:\s*["']/, "eval-perf 硬编码了模型名：量的可能不是 app.js 用的那个模型");
  assert.doesNotMatch(source, /apiKey:\s*["'][^"']/, "eval-perf 里出现了内联密钥：凭据只能来自服务端环境");
  assert.match(source, /\/api\/chat/, "eval-perf 没走 app.js 同一条 /api/chat 本地代理");
});

test("教练通道：app.js 与评测脚本配置逐字段一致", () => {
  const app = laneFrom("public/app.js", "COACH_LANE");
  const evalScript = laneFrom("scripts/eval-grounding.mjs", "COACH_LANE");
  assert.deepEqual(evalScript, app, "eval-grounding 的 COACH_LANE 与生产不一致：评测测的不是生产配置");
});

// 上限来自实测：12 轮真实抽样 completion 375–655（中位 503），
// 唯一长尾跑到 4096 并 finish_reason=length。1500 = 最大合法值 2.3 倍。
test("教练通道有输出上限，且不低于实测最大合法值的两倍", () => {
  const app = laneFrom("public/app.js", "COACH_LANE");
  assert.equal(typeof app.maxCompletionTokens, "number", "教练通道缺少 maxCompletionTokens：失控轮次没有上界");
  assert.ok(app.maxCompletionTokens >= 503 * 2, `上限 ${app.maxCompletionTokens} 离实测中位太近，会截断正常输出`);
  assert.ok(app.maxCompletionTokens < 4096, `上限 ${app.maxCompletionTokens} 等于供应商默认值，等于没设`);
});

test("角色通道保持短上限（她是短回复，不是长文）", () => {
  const app = laneFrom("public/app.js", "HER_LANE");
  assert.equal(app.maxCompletionTokens, 200);
  assert.equal(app.thinking, "type:disabled");
});
