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
  assert.deepEqual(evalScript, app, "eval-grounding 的 HER_LANE 与生产不一致");
  assert.deepEqual(behavior, app, "eval-behavior 的 HER_LANE 与生产不一致");
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
