import test from "node:test";
import assert from "node:assert/strict";
import { clampScore, clampScoreOrNull } from "../public/modules/core/number.js";

/**
 * core/number.js 是 0–100 取整的唯一收口。
 * 本文件锁死两类语义，防止回退到"12 份各写各的"。
 */

// ── clampScore：非有限 → 0 ──────────────────────────────────────────────────

test("clampScore：正常值取整并夹取到 0–100", () => {
  assert.equal(clampScore(87.4), 87);
  assert.equal(clampScore(87.5), 88);
  assert.equal(clampScore(-20), 0);
  assert.equal(clampScore(250), 100);
});

test("clampScore：非有限值回退 0", () => {
  assert.equal(clampScore(NaN), 0);
  assert.equal(clampScore(Infinity), 0);
  assert.equal(clampScore(-Infinity), 0);
  assert.equal(clampScore("abc"), 0);
});

test("clampScore：数字串可解析", () => {
  assert.equal(clampScore("42"), 42);
  assert.equal(clampScore("  7  "), 7);
});

test("clampScore：null 与空串经 Number() 变 0（与被合并的三处旧实现一致）", () => {
  assert.equal(clampScore(null), 0);
  assert.equal(clampScore(""), 0);
});

// ── clampScoreOrNull：未评分与非数值 → null ─────────────────────────────────

test("clampScoreOrNull：哨兵值返回 null，不被 Number() 变成 0", () => {
  assert.equal(clampScoreOrNull(null), null);
  assert.equal(clampScoreOrNull(undefined), null);
  assert.equal(clampScoreOrNull(""), null);
  assert.equal(clampScoreOrNull("   "), null, "全空白串是未评分，不是 0 分");
});

test("clampScoreOrNull：布尔与对象按非数值处理", () => {
  assert.equal(clampScoreOrNull(true), null, "Number(true)===1 是陷阱，必须拦");
  assert.equal(clampScoreOrNull(false), null);
  assert.equal(clampScoreOrNull({}), null);
  assert.equal(clampScoreOrNull([]), null);
  assert.equal(clampScoreOrNull([1]), null);
});

test("clampScoreOrNull：非有限值返回 null", () => {
  assert.equal(clampScoreOrNull(NaN), null);
  assert.equal(clampScoreOrNull(Infinity), null);
  assert.equal(clampScoreOrNull("abc"), null);
});

test("clampScoreOrNull：正常值取整并夹取到 0–100", () => {
  assert.equal(clampScoreOrNull(87.4), 87);
  assert.equal(clampScoreOrNull(-5), 0);
  assert.equal(clampScoreOrNull(300), 100);
  assert.equal(clampScoreOrNull("42"), 42);
  assert.equal(clampScoreOrNull("0"), 0, "字符串 '0' 是合法的 0 分，与未评分不同");
});

// ── 两类语义的分界 ──────────────────────────────────────────────────────────

test("两个函数的分界：未评分只能由 clampScoreOrNull 表达为 null", () => {
  assert.notEqual(clampScore(null), clampScoreOrNull(null));
  assert.equal(clampScore(50), clampScoreOrNull(50), "有值时两者结果必须一致");
});
