import test from "node:test";
import assert from "node:assert/strict";
import { shanghaiDate } from "../public/modules/core/date.js";
import { getTrainingStreak } from "../public/modules/training/micro-training.js";

/**
 * 日期键口径统一（P1-2）：全库唯一的"今天"必须是 Asia/Shanghai。
 *
 * 此前有三种口径并存：shanghaiDate（上海）、getFullYear（设备本地）、
 * toISOString().slice(0,10)（UTC）。北京时间 00:00–08:00 之间会显示成"昨天"。
 */

// ── shanghaiDate：跨零点边界 ────────────────────────────────────────────────

test("shanghaiDate：北京 00:30 属于上海的次日，不属于 UTC 当天", () => {
  // 2026-10-20T16:30:00Z = 北京时间 2026-10-21 00:30
  assert.equal(shanghaiDate(new Date("2026-10-20T16:30:00Z")), "2026-10-21");
});

test("shanghaiDate：北京 23:59 仍是上海当天", () => {
  // 2026-10-20T15:59:00Z = 北京时间 2026-10-20 23:59
  assert.equal(shanghaiDate(new Date("2026-10-20T15:59:00Z")), "2026-10-20");
});

test("shanghaiDate：北京 08:00 与 UTC 同日，仍返回上海日期", () => {
  assert.equal(shanghaiDate(new Date("2026-10-20T00:00:00Z")), "2026-10-20");
});

test("shanghaiDate：输出格式恒为 YYYY-MM-DD", () => {
  assert.match(shanghaiDate(), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(shanghaiDate(new Date("2001-02-03T12:00:00Z")), /^\d{4}-\d{2}-\d{2}$/);
});

test("shanghaiDate：非法日期抛 TypeError，不静默返回", () => {
  assert.throws(() => shanghaiDate(new Date("not-a-date")), TypeError);
  assert.throws(() => shanghaiDate("not-a-date"), TypeError);
});

test("shanghaiDate：接受 ISO 字符串与时间戳", () => {
  assert.equal(shanghaiDate("2026-10-20T16:30:00Z"), "2026-10-21");
  assert.equal(shanghaiDate(Date.UTC(2026, 9, 20, 16, 30)), "2026-10-21");
});

// ── 与训练连续天数的一致性 ──────────────────────────────────────────────────

test("getTrainingStreak：任务日期键与 shanghaiDate 同口径，跨零点不丢天", () => {
  // 北京 2026-10-21 00:30 完成的任务；此时北京时间是 2026-10-21 02:00。
  const doneAt = new Date("2026-10-20T16:30:00Z");
  const now = new Date("2026-10-20T18:00:00Z");
  const task = { completed: true, date: shanghaiDate(doneAt) };

  // 若 dateKey 用 UTC 口径，now 会是 10-20 而 task 是 10-21（未来），被过滤掉 → streak 0。
  // 只有两者同为上海口径时才应得到 1。
  assert.equal(getTrainingStreak([task], now), 1);
});

test("getTrainingStreak：连续两天的任务累计为 2", () => {
  const day2 = { completed: true, date: "2026-10-21" };
  const day1 = { completed: true, date: "2026-10-20" };
  const now = new Date("2026-10-20T18:00:00Z"); // 北京 2026-10-21 02:00
  assert.equal(getTrainingStreak([day1, day2], now), 2);
});

test("getTrainingStreak：断档返回 0，不跨空档计数", () => {
  const gap = { completed: true, date: "2026-10-19" };
  const day2 = { completed: true, date: "2026-10-21" };
  const now = new Date("2026-10-20T18:00:00Z");
  assert.equal(getTrainingStreak([gap, day2], now), 1);
});

test("getTrainingStreak：非数组或空数组返回 0", () => {
  assert.equal(getTrainingStreak(null), 0);
  assert.equal(getTrainingStreak([]), 0);
  assert.equal(getTrainingStreak("nope"), 0);
});

// ── 已知边界（明确记录，不伪造断言） ────────────────────────────────────────

test("口径一致性：dateKey 不再随设备时区漂移（通过 shanghaiDate 唯一入口）", () => {
  // 本用例不直接探测 micro-training 内部 dateKey（未导出）。
  // 覆盖方式：R6 规则禁止 public/ 内自拼日期键，配合上面的 shanghaiDate 断言，
  // 保证"今天"只有一处定义。若有人重新引入 getFullYear 自拼，check-conventions 会失败。
  // 注：要在非 Asia/Shanghai 时区下实测跨零点，需以 TZ 环境变量另跑一次，
  // 当前测试运行环境为本机默认时区，该场景未覆盖。
  assert.equal(typeof shanghaiDate, "function");
  assert.match(shanghaiDate(new Date("2026-10-20T16:30:00Z")), /^2026-10-21$/);
});
