// F2 错题本：数据层纯函数全覆盖 + state 集成（mutate 单一写路径）+ UI 接线源码级断言。
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { r1ViolationsFor } from "./helpers/conventions.mjs";

import {
  MISTAKES_LIMIT,
  MISTAKE_COLLECT_RULES,
  shouldCollectFromScore,
  shouldCollectFromPreflight,
  classifyPreflightIssues,
  createMistake,
  collectMistake,
  findDuplicateMistake,
  appendMistake,
  resolveMistake,
  deleteMistake,
  normalizeMistakes
} from "../public/modules/core/mistakes.js";

// ── 收集判定 ─────────────────────────────────────────────────────────────────

test("shouldCollectFromScore：总分 < 65 收集，>= 65 不收集", () => {
  assert.equal(shouldCollectFromScore({ total: 64, naturalness: 90, empathy: 90, boundary: 90, momentum: 90 }), true);
  assert.equal(shouldCollectFromScore({ total: 65, naturalness: 90, empathy: 90, boundary: 90, momentum: 90 }), false);
  assert.equal(shouldCollectFromScore({ total: 30, naturalness: 90, empathy: 90, boundary: 90, momentum: 90 }), true);
});

test("shouldCollectFromScore：任一维度 < 55 收集（边界 55 不收）", () => {
  assert.equal(shouldCollectFromScore({ total: 80, naturalness: 54, empathy: 90, boundary: 90, momentum: 90 }), true);
  assert.equal(shouldCollectFromScore({ total: 80, naturalness: 55, empathy: 90, boundary: 90, momentum: 90 }), false);
  assert.equal(shouldCollectFromScore({ total: 80, naturalness: 90, empathy: 0, boundary: 90, momentum: 90 }), true);
  assert.equal(shouldCollectFromScore({ total: 80, naturalness: 90, empathy: 90, boundary: 90, momentum: 54 }), true);
});

test("shouldCollectFromScore：非对象 / 缺字段安全回退", () => {
  assert.equal(shouldCollectFromScore(null), false);
  assert.equal(shouldCollectFromScore("score"), false);
  // 缺维度字段时 Number(undefined) 非有限值，不触发维度判定；总分缺失同样不触发
  assert.equal(shouldCollectFromScore({}), false);
});

test("shouldCollectFromPreflight：仅最高档（high）收集", () => {
  assert.equal(shouldCollectFromPreflight({ level: "high", warning: "x" }), true);
  assert.equal(shouldCollectFromPreflight({ level: "medium", warning: "x" }), false);
  assert.equal(shouldCollectFromPreflight({ level: "low", warning: "x" }), false);
  assert.equal(shouldCollectFromPreflight(null), false);
  assert.equal(shouldCollectFromPreflight(undefined), false);
});

test("classifyPreflightIssues：命中词归类为越界词/施压词语义标签", () => {
  assert.deepEqual(classifyPreflightIssues(["性感", "酒店"]), ["越界词"]);
  assert.deepEqual(classifyPreflightIssues(["宝贝", "必须", "约吗"]), ["施压词"]);
  assert.deepEqual(classifyPreflightIssues(["性感", "必须"]), ["越界词", "施压词"]);
  assert.deepEqual(classifyPreflightIssues([]), []);
  assert.deepEqual(classifyPreflightIssues(), []);
});

// ── 条目标准化 ───────────────────────────────────────────────────────────────

test("createMistake：完整字段保留，非法 source 回退 manual", () => {
  const mistake = createMistake({
    id: "m1",
    ts: "2026-01-09T08:00:00.000Z",
    source: "preflight",
    stage: "暧昧推进",
    mode: "anti",
    text: "  你今天必须出来  ",
    dims: { naturalness: 40, empathy: 55, boundary: 30, drive: 70 },
    issues: ["施压词"]
  });
  assert.equal(mistake.id, "m1");
  assert.equal(mistake.ts, "2026-01-09T08:00:00.000Z");
  assert.equal(mistake.source, "preflight");
  assert.equal(mistake.text, "你今天必须出来");
  assert.deepEqual(mistake.dims, { naturalness: 40, empathy: 55, boundary: 30, drive: 70 });
  assert.equal(mistake.resolved, false);
  assert.equal(mistake.resolvedAt, null);
  assert.equal(mistake.rewriteText, null);
  assert.equal(mistake.rewriteDims, null);
});

test("createMistake：空输入生成默认条目（自动 id/ts，未评分维度为 null）", () => {
  const mistake = createMistake({});
  assert.match(mistake.id, /^mistake-\d+-[a-z0-9]+$/);
  assert.ok(!Number.isNaN(Date.parse(mistake.ts)));
  assert.equal(mistake.source, "manual");
  assert.equal(mistake.mode, "anti");
  assert.deepEqual(mistake.dims, { naturalness: null, empathy: null, boundary: null, drive: null });
  assert.deepEqual(mistake.issues, []);
});

test("createMistake：维度分数裁剪到 0-100，非法值置 null", () => {
  const mistake = createMistake({ dims: { naturalness: 120, empathy: -5, boundary: 62.7, drive: "bad" } });
  assert.deepEqual(mistake.dims, { naturalness: 100, empathy: 0, boundary: 63, drive: null });
});

// ── 去重 / 追加 / 上限 ────────────────────────────────────────────────────────

test("collectMistake：追加新条目并返回 collected=true", () => {
  const result = collectMistake([], { source: "coach", text: "你好啊" });
  assert.equal(result.collected, true);
  assert.equal(result.mistakes.length, 1);
  assert.equal(result.mistakes[0].text, "你好啊");
  assert.equal(result.mistakes[0].source, "coach");
});

test("collectMistake：同 text 未解决错题存在则跳过（去重）", () => {
  const first = collectMistake([], { source: "coach", text: "同一句话" }).mistakes;
  const second = collectMistake(first, { source: "preflight", text: "同一句话" });
  assert.equal(second.collected, false);
  assert.equal(second.mistakes.length, 1);
});

test("collectMistake：同 text 已解决后允许再次收集", () => {
  const first = collectMistake([], { source: "coach", text: "同一句话" }).mistakes;
  const resolved = resolveMistake(first, first[0].id);
  const again = collectMistake(resolved, { source: "manual", text: "同一句话" });
  assert.equal(again.collected, true);
  assert.equal(again.mistakes.length, 2);
});

test("collectMistake：空 text 不收集", () => {
  const result = collectMistake([], { text: "   " });
  assert.equal(result.collected, false);
  assert.equal(result.mistakes.length, 0);
});

test("appendMistake：超过上限 200 条丢最旧", () => {
  const list = Array.from({ length: MISTAKES_LIMIT }, (_, i) => createMistake({ id: `m-${i}`, text: `t-${i}` }));
  const next = appendMistake(list, createMistake({ id: "m-new", text: "t-new" }));
  assert.equal(next.length, MISTAKES_LIMIT);
  assert.equal(next[0].id, "m-1", "最旧的 m-0 应被裁掉");
  assert.equal(next.at(-1).id, "m-new");
});

test("collectMistake 连续收集 201 条后上限恒为 200 且最旧被丢", () => {
  let mistakes = [];
  for (let i = 0; i < MISTAKES_LIMIT + 1; i += 1) {
    mistakes = collectMistake(mistakes, { source: "coach", text: `消息-${i}` }).mistakes;
  }
  assert.equal(mistakes.length, MISTAKES_LIMIT);
  assert.equal(mistakes[0].text, "消息-1");
  assert.equal(mistakes.at(-1).text, `消息-${MISTAKES_LIMIT}`);
});

// ── 解决 / 删除状态迁移 ──────────────────────────────────────────────────────

test("resolveMistake：写 resolved/resolvedAt，可附带重写文本与维度", () => {
  const list = [createMistake({ id: "a", text: "x" }), createMistake({ id: "b", text: "y" })];
  const next = resolveMistake(list, "a", {
    rewriteText: "改好的话",
    rewriteDims: { naturalness: 80, empathy: 75, boundary: 85, drive: 70 }
  });
  assert.equal(next[0].resolved, true);
  assert.ok(next[0].resolvedAt && !Number.isNaN(Date.parse(next[0].resolvedAt)));
  assert.equal(next[0].rewriteText, "改好的话");
  assert.deepEqual(next[0].rewriteDims, { naturalness: 80, empathy: 75, boundary: 85, drive: 70 });
  assert.equal(next[1].resolved, false, "未命中的条目不动");
  assert.equal(list[0].resolved, false, "原数组不被修改（纯函数）");
});

test("resolveMistake：不附带重写时保留原 rewriteText 字段；id 不存在原样返回", () => {
  const list = [createMistake({ id: "a", text: "x" })];
  assert.equal(resolveMistake(list, "missing"), list);
  const next = resolveMistake(list, "a");
  assert.equal(next[0].rewriteText, null);
  assert.equal(next[0].rewriteDims, null);
});

test("deleteMistake：按 id 删除", () => {
  const list = [createMistake({ id: "a", text: "x" }), createMistake({ id: "b", text: "y" })];
  const next = deleteMistake(list, "a");
  assert.deepEqual(next.map((item) => item.id), ["b"]);
});

// ── 持久化标准化（state 集成）────────────────────────────────────────────────

test("normalizeMistakes：过滤非对象条目并裁剪上限", () => {
  const result = normalizeMistakes([
    createMistake({ id: "a", text: "x" }),
    null,
    "bad",
    createMistake({ id: "b", text: "y" })
  ]);
  assert.deepEqual(result.map((item) => item.id), ["a", "b"]);
  const overflow = Array.from({ length: MISTAKES_LIMIT + 5 }, (_, i) => ({ id: `m-${i}`, text: `t-${i}` }));
  assert.equal(normalizeMistakes(overflow).length, MISTAKES_LIMIT);
});

test("state 集成：mutate 写入错题后 loadState 往返一致（localStorage mock）", async () => {
  const mockStorage = new Map();
  global.localStorage = {
    getItem: (key) => (mockStorage.has(key) ? mockStorage.get(key) : null),
    setItem: (key, value) => { mockStorage.set(key, value); },
    removeItem: (key) => { mockStorage.delete(key); },
    clear: () => mockStorage.clear()
  };
  const stateModule = await import("../public/modules/core/state.js");
  stateModule.loadState();
  stateModule.mutate((draft) => {
    const outcome = collectMistake(draft.mistakes, { source: "coach", text: "持久化这句话", dims: { naturalness: 40 } });
    draft.mistakes = outcome.mistakes;
    return outcome.collected;
  });
  const reloaded = stateModule.loadState();
  assert.equal(reloaded.mistakes.length, 1);
  assert.equal(reloaded.mistakes[0].text, "持久化这句话");
  assert.equal(reloaded.mistakes[0].source, "coach");
  assert.equal(reloaded.mistakes[0].dims.naturalness, 40);
  assert.equal(reloaded.mistakes[0].dims.empathy, null, "未评分维度持久化为 null");
});

test("MISTAKE_COLLECT_RULES 阈值契约：overall 65 / dim 55", () => {
  assert.equal(MISTAKE_COLLECT_RULES.overallBelow, 65);
  assert.equal(MISTAKE_COLLECT_RULES.dimBelow, 55);
});

// ── UI 接线源码级断言（复用 backup.test.mjs / reset-confirm.test.mjs 的源码回归模式）──

const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const docSource = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const renderMistakesSource = await readFile(new URL("../public/modules/render/render-mistakes.js", import.meta.url), "utf8");
const renderCoachSource = await readFile(new URL("../public/modules/render/render-coach.js", import.meta.url), "utf8");

test("UI 接线：错题本 section 与重写练习模态存在于页面，app.js 挂载并绑定关闭", () => {
  assert.match(docSource, /id="mistakesPanel"/);
  assert.match(docSource, /id="mistakePracticeModal"[^>]*class="modal hidden"/);
  assert.match(docSource, /id="mistakePracticeContent"/);
  assert.match(docSource, /id="closeMistakePracticeBtn"/);
  assert.match(appSource, /renderMistakes\(\)/);
  assert.match(appSource, /\$\("closeMistakePracticeBtn"\)\?\.addEventListener/);
  assert.match(appSource, /\$\("mistakePracticeOverlay"\)\?\.addEventListener/);
});

test("UI 接线：三个收集点均已接入（preflight / coach / manual）", () => {
  // 收集点一：preflight 回复路径内按 shouldCollectFromPreflight 判定收集
  const preflightFn = appSource.indexOf("async function preflightReply()");
  const collectAt = appSource.indexOf("collectPreflightMistake({ text: original, score, flags })", preflightFn);
  assert.ok(preflightFn > -1 && collectAt > preflightFn, "preflightReply 应调用收集点一");
  assert.match(appSource, /shouldCollectFromPreflight\(flags\)/);
  // 收集点二：教练评分路径内按 shouldCollectFromScore 判定收集
  const logFn = appSource.indexOf("function addTrainingLog(");
  const coachAt = appSource.indexOf("collectCoachMistake(draft, data.coachScore", logFn);
  assert.ok(logFn > -1 && coachAt > logFn, "addTrainingLog 应调用收集点二");
  assert.match(appSource, /shouldCollectFromScore\(coachScore\)/);
  // 收集点三：教练面板手动「加入错题本」按钮
  assert.match(renderCoachSource, /id="addMistakeBtn"/);
  assert.match(renderCoachSource, /addCurrentMistake/);
  assert.match(renderCoachSource, /source: "manual"/);
});

test("UI 接线：错题行三个操作按钮齐备，解决/删除均走 confirm 防误触", () => {
  for (const action of ["practice", "resolve", "delete"]) {
    assert.match(renderMistakesSource, new RegExp(`data-mistake-action="${action}"`));
  }
  // confirm 必须先于对应 mutate 执行
  const resolveConfirmAt = renderMistakesSource.indexOf("globalThis.confirm?.(message) !== true");
  const resolveMutateAt = renderMistakesSource.indexOf("mutate((state) => {\n    state.mistakes = resolveMistake(", resolveConfirmAt);
  assert.ok(resolveConfirmAt > -1 && resolveMutateAt > resolveConfirmAt, "标记解决应先 confirm 再 mutate");
  assert.match(renderMistakesSource, /删除后不可恢复/);
});

test("UI 接线：render-mistakes 全部插值过 escapeHtml 且写路径走 mutate + recordTrainingEvent", () => {
  // 转义纪律由 check-conventions 的 R1 实际执行（作用域分析 + 白名单），
  // 不再用 `assert.match(source, /escapeHtml/)` 这种假断言——文件里出现过一次即可通过。
  assert.deepEqual(r1ViolationsFor("public/modules/render/render-mistakes.js"), [], "render-mistakes 存在未转义的 HTML 插值");
  assert.match(renderMistakesSource, /recordTrainingEvent\(state\.learning/);
  assert.match(renderMistakesSource, /type: "mistake-rewrite"/);
  assert.match(renderMistakesSource, /buildCoachScore\(/, "重写评分应复用本地四维教练（零 LLM）");
  assert.match(renderMistakesSource, /detectReplyFlags\(/, "重写评分应复用本地风险检测");
  assert.match(renderMistakesSource, /buildRewriteComparison\(/);
  // 不允许调用任何模型 API
  assert.doesNotMatch(renderMistakesSource, /callLLM/);
});

test("UI 接线：state 默认包含 mistakes 数组，状态持久化键不变", async () => {
  const { defaultState } = await import("../public/modules/core/config.js");
  assert.ok(Array.isArray(defaultState.mistakes));
  const { STORAGE_KEYS } = await import("../public/modules/core/config.js");
  assert.equal(STORAGE_KEYS.state, "heartflow-state");
});
