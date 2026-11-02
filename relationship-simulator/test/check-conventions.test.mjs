import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * scripts/check-conventions.mjs 的反向用例。
 *
 * 目的不是"证明它跑得起来"，而是**证明它抓得到违规、且合规样例不误报**。
 * 检查器对整个代码库报 0 违规时，如果没有这组用例，就无法区分
 * "规则有效且代码合规" 与 "规则空转、什么都抓不到"。
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECKER = path.join(REPO_ROOT, "scripts", "check-conventions.mjs");

const R1 = "html-interpolation-escape";
const R2 = "state-write-bypass-mutate";
const R3 = "layer-direction";
const R4 = "single-escape-html";
const R5 = "single-clamp-score";
const R6 = "single-date-key";
const R7 = "render-module-test-coverage";

/** 在临时目录构造 fixture，跑检查器，返回解析后的 JSON 与退出码 */
function runChecker(t, files) {
  const root = mkdtempSync(path.join(tmpdir(), "conventions-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  const result = spawnSync(process.execPath, [CHECKER, "--root", root, "--json"], {
    encoding: "utf8",
    cwd: REPO_ROOT
  });
  assert.equal(result.stderr.includes("read failed"), false, `读取失败：${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  return { code: result.status, ...parsed };
}

const rulesOf = (report) => report.violations.map((v) => v.rule);

// ── R1 html-interpolation-escape ─────────────────────────────────────────────

test("R1：文本类属性名裸插进 HTML sink 必须被抓到", (t) => {
  const report = runChecker(t, {
    "a.js": `
export function render(obj) {
  const el = document.createElement("div");
  el.innerHTML = "<p>" + obj.text + "</p>";
  el.innerHTML = \`<p>\${obj.text}</p>\`;
  return el;
}
`
  });
  assert.ok(rulesOf(report).includes(R1), `期望 ${R1}，实际 ${JSON.stringify(report.violations)}`);
  assert.equal(report.code, 1);
});

test("R1：先转义再取变量（白名单二）不误报", (t) => {
  const report = runChecker(t, {
    "a.js": `
export function render(obj) {
  const label = escapeHtml(obj.text);
  const el = document.createElement("div");
  el.innerHTML = \`<p>\${label}</p>\`;
  return el;
}
`
  });
  assert.equal(report.ok, true, `不应有违规，实际 ${JSON.stringify(report.violations)}`);
  assert.equal(report.code, 0);
});

test("R1：插值本身就是 escapeHtml(...) 调用不误报", (t) => {
  const report = runChecker(t, {
    "a.js": `
export function render(obj) {
  const el = document.createElement("div");
  el.innerHTML = \`<p>\${escapeHtml(obj.text)}</p>\`;
  return el;
}
`
  });
  assert.equal(report.ok, true, `不应有违规，实际 ${JSON.stringify(report.violations)}`);
});

test("R1：非文本类属性名不报（避免把 id/数值当文本刷屏）", (t) => {
  const report = runChecker(t, {
    "a.js": `
export function render(row) {
  const el = document.createElement("div");
  el.innerHTML = \`<i data-id="\${row.id}">\${row.count}</i>\`;
  return el;
}
`
  });
  assert.equal(report.ok, true, `不应有违规，实际 ${JSON.stringify(report.violations)}`);
});

// ── R2 state-write-bypass-mutate ─────────────────────────────────────────────

test("R2：mutate 回调外直写 getState() 必须被抓到", (t) => {
  const report = runChecker(t, {
    "a.js": `
export function setThing(getAppState) {
  const appState = getAppState();
  appState.relationshipIntelligence = null;
}
`
  });
  assert.ok(rulesOf(report).includes(R2), `期望 ${R2}，实际 ${JSON.stringify(report.violations)}`);
  assert.equal(report.code, 1);
});

test("R2：getState().prop = 直写必须被抓到", (t) => {
  const report = runChecker(t, {
    "a.js": `
import { getState } from "./state.js";
export function bad() {
  getState().trainingMode = "pua";
}
`
  });
  assert.ok(rulesOf(report).includes(R2), `期望 ${R2}，实际 ${JSON.stringify(report.violations)}`);
});

test("R2：mutate 回调外 delete state.prop 必须被抓到", (t) => {
  const report = runChecker(t, {
    "a.js": `
export function deleteOnly(getAppState) {
  const state = getAppState();
  delete state.lastAnalysis;
}
export function deleteAppAlias(getAppState) {
  const appState = getAppState();
  delete appState.lastAnalysis;
}
`
  });
  const r2 = report.violations.filter((v) => v.rule === R2);
  assert.equal(r2.length, 2, `两处 delete 都必须报，实际 ${JSON.stringify(report.violations)}`);
  assert.ok(r2.some((v) => /delete state\.lastAnalysis/.test(v.message)));
  assert.ok(r2.some((v) => /delete appState\.lastAnalysis/.test(v.message)));
  assert.equal(report.code, 1);
});

test("R2：复合赋值（+= 等）绕过 mutate 同样必须被抓到", (t) => {
  const report = runChecker(t, {
    "a.js": `
import { getState, getAppState } from "./state.js";
export function bump() {
  getState().sessionCount += 1;
}
export function bumpApp() {
  const appState = getAppState();
  appState.sessionCount -= 1;
}
`
  });
  const r2 = report.violations.filter((v) => v.rule === R2);
  assert.equal(r2.length, 2, `两处复合赋值都必须报，实际 ${JSON.stringify(report.violations)}`);
});

test("R2：比较运算与箭头函数不误报（state 已是 getAppState 别名，仅靠运算符区分）", (t) => {
  const report = runChecker(t, {
    "a.js": `
export function compare(getAppState, other) {
  const state = getAppState();
  const a = state.count >= other.count;
  const b = state.count <= other.count;
  const c = state.count == other.count;
  const fn = () => state.draft;
  return { a, b, c, fn };
}
`
  });
  assert.equal(report.ok, true, `不应有违规，实际 ${JSON.stringify(report.violations)}`);
});

test("R2：mutate 回调内的 delete 是合规写法，不得误报", (t) => {
  const report = runChecker(t, {
    "a.js": `
export function good(mutate) {
  mutate((state) => {
    delete state.personaMemory;
  });
}
`
  });
  assert.equal(report.ok, true, `不应有违规，实际 ${JSON.stringify(report.violations)}`);
});

test("R2：mutate 回调内的 state.x = 是合规写法，不得误报", (t) => {
  const report = runChecker(t, {
    "a.js": `
export function good(mutate) {
  mutate((state) => {
    state.trainingMode = "pua";
    delete state.personaMemory;
    state.messages.push({ type: "me", text: "hi" });
  });
}
`
  });
  assert.equal(report.ok, true, `不应有违规，实际 ${JSON.stringify(report.violations)}`);
});

test("R2：与 state 无关的同名变量不误报", (t) => {
  const report = runChecker(t, {
    "a.js": `
export function unrelated(state) {
  state.count = 1;
}
`
  });
  assert.equal(report.ok, true, `不应有违规，实际 ${JSON.stringify(report.violations)}`);
});

// ── R3 layer-direction ──────────────────────────────────────────────────────

test("R3：core 反向 import render 必须被抓到", (t) => {
  const report = runChecker(t, {
    "public/modules/core/a.js": `import { x } from "../render/evil.js";\nexport const y = x;\n`
  });
  assert.ok(rulesOf(report).includes(R3), `期望 ${R3}，实际 ${JSON.stringify(report.violations)}`);
});

test("R3：core import intelligence/state.js 属设计内，不得误报", (t) => {
  const report = runChecker(t, {
    "public/modules/core/a.js": `import { normalize } from "../intelligence/state.js";\nexport const y = normalize;\n`
  });
  assert.equal(report.ok, true, `不应有违规，实际 ${JSON.stringify(report.violations)}`);
});

test("R3：core import intelligence/client.js（含 I/O）必须被抓到", (t) => {
  const report = runChecker(t, {
    "public/modules/core/a.js": `import { call } from "../intelligence/client.js";\nexport const y = call;\n`
  });
  assert.ok(rulesOf(report).includes(R3), `期望 ${R3}，实际 ${JSON.stringify(report.violations)}`);
});

test("R3：server import 前端模块必须被抓到", (t) => {
  const report = runChecker(t, {
    "server/a.js": `import { z } from "../public/app.js";\nexport const y = z;\n`
  });
  assert.ok(rulesOf(report).includes(R3), `期望 ${R3}，实际 ${JSON.stringify(report.violations)}`);
});

// ── R4 single-escape-html ───────────────────────────────────────────────────

test("R4：escapeHtml 出现第二份实现必须被抓到", (t) => {
  const report = runChecker(t, {
    "public/modules/core/dom.js": `export function escapeHtml(v) { return String(v); }\n`,
    "public/modules/render/dup.js": `export function escapeHtml(v) { return String(v); }\n`
  });
  assert.ok(rulesOf(report).includes(R4), `期望 ${R4}，实际 ${JSON.stringify(report.violations)}`);
});

test("R4：委托式薄封装不算第二份实现", (t) => {
  const report = runChecker(t, {
    "public/modules/core/dom.js": `export function escapeHtml(v) { return String(v); }\n`,
    "public/app.js": `import { escapeHtml as shared } from "./modules/core/dom.js";\nfunction escapeHtml(v) { return shared(v); }\nexport { escapeHtml };\n`
  });
  assert.equal(report.ok, true, `不应有违规，实际 ${JSON.stringify(report.violations)}`);
});

// ── R5 single-clamp-score ────────────────────────────────────────────────────

test("R5：public/ 内自拼 0–100 取整必须被抓到", (t) => {
  const report = runChecker(t, {
    "public/modules/training/a.js": `
export function score(v) {
  return Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
}
`
  });
  assert.ok(rulesOf(report).includes(R5), `期望 ${R5}，实际 ${JSON.stringify(report.violations)}`);
});

test("R5：core/number.js 是收口定义处，文件级豁免", (t) => {
  const report = runChecker(t, {
    "public/modules/core/number.js": `
export function clampScore(v) {
  return Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
}
`
  });
  assert.equal(report.ok, true, `不应有违规，实际 ${JSON.stringify(report.violations)}`);
});

test("R5：冻结豁免清单内的刻意不同语义不误报", (t) => {
  const report = runChecker(t, {
    "public/modules/coach/coach.js": `export function clampScore(v) { return Math.max(0, Math.min(100, Math.round(Number(v) || 70))); }\n`,
    "public/modules/core/state.js": `export function clampAvatarPosition(v) { return Math.max(0, Math.min(100, Math.round(Number(v) || 0))); }\n`
  });
  assert.equal(report.ok, true, `不应有违规，实际 ${JSON.stringify(report.violations)}`);
});

test("R5：测试目录不纳入扫描", (t) => {
  const report = runChecker(t, {
    "test/a.test.mjs": `export function clamp(v) { return Math.max(0, Math.min(100, Math.round(v))); }\n`
  });
  assert.equal(report.ok, true, `不应有违规，实际 ${JSON.stringify(report.violations)}`);
});

// ── R6 single-date-key ──────────────────────────────────────────────────────

test("R6：public/ 内自拼日期键必须被抓到", (t) => {
  const report = runChecker(t, {
    "public/a.js": `export function today() { return new Date().toISOString().slice(0, 10); }\n`
  });
  assert.ok(rulesOf(report).includes(R6), `期望 ${R6}，实际 ${JSON.stringify(report.violations)}`);
});

test("R6：core/date.js 是口径定义处，文件级豁免", (t) => {
  const report = runChecker(t, {
    "public/modules/core/date.js": `export function shanghaiDate() { return new Date().toISOString().slice(0, 10); }\n`
  });
  assert.equal(report.ok, true, `不应有违规，实际 ${JSON.stringify(report.violations)}`);
});

test("R6：test/ 目录不纳入扫描", (t) => {
  const report = runChecker(t, {
    "test/a.test.mjs": `export function today() { return new Date().toISOString().slice(0, 10); }\n`
  });
  assert.equal(report.ok, true, `不应有违规，实际 ${JSON.stringify(report.violations)}`);
});

// ── R7 render-module-test-coverage ──────────────────────────────────────────

test("R7：没有测试 import 的 render 模块必须被抓到", (t) => {
  const report = runChecker(t, {
    "public/modules/render/new-widget.js": `export function renderNewWidget() { return "<div>"; }\n`
  });
  assert.ok(rulesOf(report).includes(R7), `期望 ${R7}，实际 ${JSON.stringify(report.violations)}`);
  assert.equal(report.code, 1);
});

test("R7：被 test 文件 import 的 render 模块不报", (t) => {
  const report = runChecker(t, {
    "public/modules/render/widget.js": `export function renderWidget() { return "<div>"; }\n`,
    "test/widget.test.mjs": `import { renderWidget } from "../public/modules/render/widget.js";\nexport default renderWidget;\n`
  });
  assert.equal(report.ok, true, `不应有违规，实际 ${JSON.stringify(report.violations)}`);
});

test("R7：动态 import(...) 同样算覆盖", (t) => {
  const report = runChecker(t, {
    "public/modules/render/lazy.js": `export function renderLazy() { return "<div>"; }\n`,
    "test/lazy.test.mjs": `const mod = await import("../public/modules/render/lazy.js");\nexport default mod;\n`
  });
  assert.equal(report.ok, true, `不应有违规，实际 ${JSON.stringify(report.violations)}`);
});

test("R7：冻结豁免清单内的存量模块不报", (t) => {
  const report = runChecker(t, {
    "public/modules/render/dropdown.js": `export function enhance() {}\n`
  });
  assert.equal(report.ok, true, `不应有违规，实际 ${JSON.stringify(report.violations)}`);
});

test("R7：非 render 模块不受此规则约束", (t) => {
  const report = runChecker(t, {
    "public/modules/core/helper.js": `export function helper() { return 1; }\n`
  });
  assert.equal(report.ok, true, `不应有违规，实际 ${JSON.stringify(report.violations)}`);
});

// ── 整体行为 ────────────────────────────────────────────────────────────────

test("干净 fixture 全部规则通过且退出码为 0", (t) => {
  const report = runChecker(t, {
    "public/modules/core/dom.js": `export function escapeHtml(v) { return String(v); }\n`,
    "public/modules/core/date.js": `export function shanghaiDate() { return "2026-01-01"; }\n`,
    "public/modules/render/view.js": `import { escapeHtml } from "../core/dom.js";\nexport function view(item) { return "<p>" + escapeHtml(item.text) + "</p>"; }\n`,
    "test/view.test.mjs": `import { view } from "../public/modules/render/view.js";\nexport default view;\n`,
    "app.js": `export function boot(mutate) { mutate((state) => { state.x = 1; }); }\n`
  });
  assert.equal(report.ok, true, `不应有违规，实际 ${JSON.stringify(report.violations)}`);
  assert.equal(report.code, 0);
});

test("违规输出是确定性排序（相同输入两次结果一致）", (t) => {
  const files = {
    "public/a.js": "export function today() { return new Date().toISOString().slice(0, 10); }\n" +
      "export function render(o) {\n  const el = document.createElement('div');\n  el.innerHTML = `<p>${o.text}</p>`;\n  return el;\n}\n"
  };
  const first = runChecker(t, files);
  const second = runChecker(t, files);
  assert.deepEqual(first.violations, second.violations);
  assert.ok(first.violations.length >= 2, `应同时命中 R1 与 R6，实际 ${JSON.stringify(first.violations)}`);
  assert.deepEqual(rulesOf(first).sort(), [...new Set(rulesOf(first))].sort());
});
