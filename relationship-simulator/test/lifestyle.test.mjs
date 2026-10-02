// F5/F6 生活管理：normalizeLifestyle 边界 + 三个纯函数全分支 +
// micro-training 口径一致性 + state mutate 往返 + UI 接线源码级断言。
// F6 新增：护肤切片规范化（真实条目）+ completeness/streak/notice + setSkincareItem 写路径。
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  LIFESTYLE_LIMITS,
  WEIGHT_PLATEAU_RANGE_KG,
  WEIGHT_FAST_GAIN_KG,
  normalizeLifestyle,
  recordTrainingDay,
  recordWeightEntry,
  setSkincareItem,
  computeTrainingRhythm,
  computeWeightReview,
  computeStreak,
  computeSkincareCompleteness,
  computeSkincareStreak,
  buildSkincareNotice,
  dateDiffDays
} from "../public/modules/training/lifestyle.js";

// ── 日期工具（全部按本地日期字符串构造，不涉时区）────────────────────────────

const TODAY = "2026-10-02";

function shiftDate(base, deltaDays) {
  const [year, month, day] = base.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

const daysAgo = (n) => shiftDate(TODAY, -n);

// ── dateDiffDays ─────────────────────────────────────────────────────────────

test("dateDiffDays：按本地日期字符串计算差值，跨月安全", () => {
  assert.equal(dateDiffDays("2026-09-30", "2026-10-02"), 2);
  assert.equal(dateDiffDays("2026-02-28", "2028-03-01"), 732);
  assert.equal(dateDiffDays("2026-10-02", "2026-10-02"), 0);
  assert.equal(dateDiffDays("bad", TODAY), null);
  assert.equal(dateDiffDays(null, TODAY), null);
});

// ── normalizeLifestyle ───────────────────────────────────────────────────────

test("normalizeLifestyle：空/坏输入返回完整默认结构（skincare/grooming 占位容忍）", () => {
  for (const input of [null, undefined, "x", 42, [], {}]) {
    const result = normalizeLifestyle(input);
    assert.deepEqual(Object.keys(result).sort(), ["fitness", "grooming", "skincare"]);
    assert.deepEqual(result.fitness, { trainings: [], weights: [] });
    assert.deepEqual(result.skincare, { days: [] });
    assert.deepEqual(result.grooming, { days: [] });
  }
});

test("normalizeLifestyle：grooming 占位保留字符串 days，剔除坏元素", () => {
  const result = normalizeLifestyle({
    grooming: { days: ["2026-10-01", 42, null, "2026-10-02"] }
  });
  assert.deepEqual(result.grooming.days, ["2026-10-01", "2026-10-02"]);
});

test("normalizeLifestyle：trainings 剔除坏数据（缺日期/坏日期/非对象），补 id", () => {
  const result = normalizeLifestyle({
    fitness: {
      trainings: [
        null,
        { date: "2026-10-40" },
        { date: "nope" },
        { id: "fit-1", date: TODAY },
        { date: daysAgo(1), note: "  全身 A  " }
      ]
    }
  });
  assert.equal(result.fitness.trainings.length, 2);
  // 日期升序：补 id 的 10-01 在前，显式 id 的 TODAY 在后
  assert.equal(result.fitness.trainings[0].date, daysAgo(1));
  assert.ok(result.fitness.trainings[0].id.length > 0);
  assert.equal(result.fitness.trainings[0].note, "全身 A");
  assert.deepEqual(result.fitness.trainings[1], { id: "fit-1", date: TODAY });
});

test("normalizeLifestyle：trainings 同日去重（后到覆盖），上限 400 丢最旧", () => {
  const dup = normalizeLifestyle({
    fitness: { trainings: [{ id: "a", date: TODAY, note: "旧" }, { id: "b", date: TODAY }] }
  });
  assert.equal(dup.fitness.trainings.length, 1);
  assert.equal(dup.fitness.trainings[0].id, "b");
  assert.equal(dup.fitness.trainings[0].note, undefined);

  const many = Array.from({ length: LIFESTYLE_LIMITS.trainings + 5 }, (_, i) => ({
    id: `t${i}`,
    date: shiftDate("2020-01-01", i)
  }));
  const trimmed = normalizeLifestyle({ fitness: { trainings: many } });
  assert.equal(trimmed.fitness.trainings.length, LIFESTYLE_LIMITS.trainings);
  assert.equal(trimmed.fitness.trainings[0].id, "t5"); // 最旧 5 条被丢
  assert.equal(trimmed.fitness.trainings.at(-1).id, `t${LIFESTYLE_LIMITS.trainings + 4}`);
});

test("normalizeLifestyle：weights 越界/非数值剔除，kg 归一到 1 位小数，同日覆盖，上限 365", () => {
  const result = normalizeLifestyle({
    fitness: {
      weights: [
        { id: "w1", date: daysAgo(1), kg: 29.9 },   // 低于下限
        { id: "w2", date: daysAgo(2), kg: 200.1 },  // 高于上限
        { id: "w3", date: daysAgo(3), kg: "abc" },  // 非数值
        { id: "w4", date: daysAgo(4), kg: 46.04 },  // 46.0
        { id: "w5", date: daysAgo(4), kg: 46.32 }   // 同日覆盖 → 46.3
      ]
    }
  });
  assert.equal(result.fitness.weights.length, 1); // w4/w5 同日去重
  assert.equal(result.fitness.weights[0].kg, 46.3);
  assert.equal(result.fitness.weights[0].id, "w5");

  const rounding = normalizeLifestyle({
    fitness: { weights: [{ date: TODAY, kg: 46.04 }] }
  });
  assert.equal(rounding.fitness.weights[0].kg, 46.0);

  const many = Array.from({ length: LIFESTYLE_LIMITS.weights + 3 }, (_, i) => ({
    id: `w${i}`,
    date: shiftDate("2020-01-01", i),
    kg: 46
  }));
  const trimmed = normalizeLifestyle({ fitness: { weights: many } });
  assert.equal(trimmed.fitness.weights.length, LIFESTYLE_LIMITS.weights);
  assert.equal(trimmed.fitness.weights[0].id, "w3");
});

// ── recordTrainingDay / recordWeightEntry（mutate 内写入辅助） ───────────────

test("recordTrainingDay：收录新日期；同日已有记录保持不变；note 去空白", () => {
  const base = normalizeLifestyle(null);
  const withToday = recordTrainingDay(base, TODAY, "  全身 B  ");
  assert.equal(withToday.fitness.trainings.length, 1);
  assert.equal(withToday.fitness.trainings[0].note, "全身 B");

  const again = recordTrainingDay(withToday, TODAY);
  assert.equal(again.fitness.trainings.length, 1);
  assert.equal(again.fitness.trainings[0].note, "全身 B");

  assert.equal(recordTrainingDay(base, "2026-13-99").fitness.trainings.length, 0);
});

test("recordWeightEntry：新增；同日期覆盖更新；非法 kg 原样返回", () => {
  const base = normalizeLifestyle(null);
  const first = recordWeightEntry(base, TODAY, 46.5);
  assert.deepEqual(first.fitness.weights.map((w) => w.kg), [46.5]);

  const overwrite = recordWeightEntry(first, TODAY, "46.8");
  assert.equal(overwrite.fitness.weights.length, 1);
  assert.equal(overwrite.fitness.weights[0].kg, 46.8);

  for (const bad of ["", "abc", 29.9, 200.1, null]) {
    assert.deepEqual(recordWeightEntry(base, TODAY, bad).fitness.weights, []);
  }
});

// ── computeTrainingRhythm 全分支 ─────────────────────────────────────────────

test("computeTrainingRhythm：无有效记录 → start", () => {
  assert.deepEqual(computeTrainingRhythm([], TODAY), { status: "start", message: "从今天开始第一次训练" });
  assert.equal(computeTrainingRhythm(null, TODAY).status, "start");
  // 未来日期与坏日期不算记录
  assert.equal(computeTrainingRhythm([{ date: shiftDate(TODAY, 1) }, { date: "bad" }], TODAY).status, "start");
});

test("computeTrainingRhythm：今天已练 → done", () => {
  const result = computeTrainingRhythm([{ date: TODAY }], TODAY);
  assert.equal(result.status, "done");
  assert.equal(result.message, "今日已练");
});

test("computeTrainingRhythm：昨天练过 → rest", () => {
  const result = computeTrainingRhythm([{ date: daysAgo(1) }], TODAY);
  assert.equal(result.status, "rest");
  assert.equal(result.message, "昨天练过，今天休息恢复");
});

test("computeTrainingRhythm：距今 ≥2 天 → train（漏练补上语义，含天数）", () => {
  const result = computeTrainingRhythm([{ date: daysAgo(3) }], TODAY);
  assert.equal(result.status, "train");
  assert.ok(result.message.includes("3 天"));
  // 多条记录时只看最近一次
  const multi = computeTrainingRhythm([{ date: daysAgo(9) }, { date: daysAgo(2) }], TODAY);
  assert.equal(multi.status, "train");
  assert.ok(multi.message.includes("2 天"));
});

// ── computeWeightReview 四分支与阈值边界 ─────────────────────────────────────

test("computeWeightReview：数据不足（<2 条或跨度 <7 天）→ insufficient", () => {
  assert.equal(computeWeightReview([], TODAY).trend, "insufficient");
  assert.equal(computeWeightReview(null, TODAY).trend, "insufficient");
  assert.equal(computeWeightReview([{ date: TODAY, kg: 46 }], TODAY).trend, "insufficient");
  // 跨度 6 天
  const short = [
    { date: daysAgo(6), kg: 46 },
    { date: TODAY, kg: 46.8 }
  ];
  assert.equal(computeWeightReview(short, TODAY).trend, "insufficient");
  // 超出 14 天窗口的记录不参与
  const outside = [
    { date: daysAgo(20), kg: 46 },
    { date: daysAgo(13), kg: 46 },
    { date: TODAY, kg: 46.05 }
  ];
  const result = computeWeightReview(outside, TODAY);
  assert.equal(result.trend, "plateau"); // 20 天前那条被排除后 46.0/46.05 视为平台
});

test("computeWeightReview：plateau（范围 == 0.1 边界命中，> 0.1 不命中）", () => {
  const atLimit = [
    { date: daysAgo(13), kg: 46.0 },
    { date: TODAY, kg: 46.0 + WEIGHT_PLATEAU_RANGE_KG }
  ];
  const plateau = computeWeightReview(atLimit, TODAY);
  assert.equal(plateau.trend, "plateau");
  assert.ok(plateau.suggestion.includes("+150 kcal"));

  // kg 以 1 位小数存储，用 46.2 拉开与下限的差距
  const overLimit = [
    { date: daysAgo(13), kg: 46.0 },
    { date: daysAgo(6), kg: 46.2 },
    { date: TODAY, kg: 46.2 }
  ];
  assert.notEqual(computeWeightReview(overLimit, TODAY).trend, "plateau");
});

test("computeWeightReview：fast（涨幅 == 0.7 不命中，> 0.7 命中）", () => {
  // kg 以 1 位小数存储，0.7 是该精度下「未超阈值」的最大单周涨幅
  const atLimit = [
    { date: daysAgo(8), kg: 46.0 },
    { date: TODAY, kg: 46.0 + WEIGHT_FAST_GAIN_KG }
  ];
  assert.equal(computeWeightReview(atLimit, TODAY).trend, "normal");

  const over = [
    { date: daysAgo(8), kg: 46.0 },
    { date: TODAY, kg: 46.8 }
  ];
  const fast = computeWeightReview(over, TODAY);
  assert.equal(fast.trend, "fast");
  assert.ok(fast.suggestion.includes("−150 kcal"));
});

test("computeWeightReview：normal（有波动但未触阈值）", () => {
  const normal = [
    { date: daysAgo(10), kg: 46.0 },
    { date: daysAgo(5), kg: 46.3 },
    { date: TODAY, kg: 46.5 }
  ];
  const result = computeWeightReview(normal, TODAY);
  assert.equal(result.trend, "normal");
  assert.equal(result.suggestion, "正常推进");
});

// ── computeStreak（与 micro-training 口径一致性） ────────────────────────────

test("computeStreak：连续天数 / 今天未打卡从昨天回溯 / 断档归零", () => {
  assert.equal(computeStreak([], TODAY), 0);
  assert.equal(computeStreak([daysAgo(5)], TODAY), 0);
  // 今天已练：3 天连续
  assert.equal(computeStreak([TODAY, daysAgo(1), daysAgo(2), daysAgo(9)], TODAY), 3);
  // 今天未练：从昨天回溯 2 天
  assert.equal(computeStreak([daysAgo(1), daysAgo(2)], TODAY), 2);
  // 今天练了但昨天没练 → 1
  assert.equal(computeStreak([TODAY, daysAgo(2)], TODAY), 1);
  // 乱序 / 重复不影响
  assert.equal(computeStreak([daysAgo(2), TODAY, daysAgo(1), daysAgo(1)], TODAY), 3);
  assert.equal(computeStreak(["bad", null], TODAY), 0);
});

test("computeStreak 与 micro-training getTrainingStreak 口径一致", async () => {
  const { getTrainingStreak } = await import("../public/modules/training/micro-training.js");
  const cases = [
    [TODAY, daysAgo(1), daysAgo(2)],
    [daysAgo(1), daysAgo(2)],
    [TODAY, daysAgo(2)],
    [daysAgo(4), daysAgo(3)],
    []
  ];
  for (const dates of cases) {
    const tasks = dates.map((date) => ({ completed: true, date }));
    // micro-training 以 Date 实例取本地日期，用当日正午避免时区偏移
    const today = new Date(`${TODAY}T12:00:00`);
    assert.equal(computeStreak(dates, TODAY), getTrainingStreak(tasks, today), `口径不一致：${dates.join(",")}`);
  }
});

// ── F6 护肤：normalizeSkincareDays（真实条目，占位转实） ─────────────────────

test("normalizeLifestyle：skincare 坏日期/非对象/占位字符串剔除，布尔严格归一，补 id", () => {
  const result = normalizeLifestyle({
    skincare: {
      days: [
        "2026-10-01", // F5 时期占位字符串 → 剔除
        null,
        42,
        { date: "2026-02-30" }, // 格式合法但日历不存在 → 剔除
        { date: "nope" },
        { id: "sk-1", date: TODAY, am: { cleanser: 1, moisturizer: "yes" }, pm: "bad" },
        { date: TODAY, am: { cleanser: true, moisturizer: true, sunscreen: true }, pm: { cleanser: true, moisturizer: true } }
      ]
    }
  });
  assert.equal(result.skincare.days.length, 1); // 同日覆盖，后到覆盖
  const day = result.skincare.days[0];
  assert.ok(typeof day.id === "string" && day.id.length > 0); // 覆盖条目无 id → 补新 id
  assert.notEqual(day.id, "sk-1"); // sk-1 属于被覆盖的旧条目
  assert.deepEqual(day.am, { cleanser: true, moisturizer: true, sunscreen: true });
  assert.deepEqual(day.pm, { cleanser: true, moisturizer: true });
});

test("normalizeLifestyle：skincare 同日覆盖（后到覆盖），上限 180 丢最旧", () => {
  const dup = normalizeLifestyle({
    skincare: {
      days: [
        { id: "a", date: TODAY, am: { sunscreen: true } },
        { id: "b", date: TODAY, am: { cleanser: true } }
      ]
    }
  });
  assert.equal(dup.skincare.days.length, 1);
  assert.equal(dup.skincare.days[0].id, "b");
  assert.deepEqual(dup.skincare.days[0].am, { cleanser: true, moisturizer: false, sunscreen: false });

  const many = Array.from({ length: LIFESTYLE_LIMITS.skincare + 5 }, (_, i) => ({
    id: `s${i}`,
    date: shiftDate("2020-01-01", i)
  }));
  const trimmed = normalizeLifestyle({ skincare: { days: many } });
  assert.equal(trimmed.skincare.days.length, LIFESTYLE_LIMITS.skincare);
  assert.equal(trimmed.skincare.days[0].id, "s5"); // 最旧 5 条被丢
  assert.equal(trimmed.skincare.days.at(-1).id, `s${LIFESTYLE_LIMITS.skincare + 4}`);
});

// ── F6 护肤：computeSkincareCompleteness 全组合 ──────────────────────────────

test("computeSkincareCompleteness：AM=洁面+保湿+防晒全勾，PM=洁面+保湿全勾，防晒独立标记", () => {
  assert.deepEqual(computeSkincareCompleteness(null), { amDone: false, pmDone: false, sunscreenDone: false, allDone: false });
  assert.deepEqual(computeSkincareCompleteness({}), { amDone: false, pmDone: false, sunscreenDone: false, allDone: false });

  const full = { am: { cleanser: true, moisturizer: true, sunscreen: true }, pm: { cleanser: true, moisturizer: true } };
  assert.deepEqual(computeSkincareCompleteness(full), { amDone: true, pmDone: true, sunscreenDone: true, allDone: true });

  // AM 缺防晒 → AM 不完成
  const missingSun = computeSkincareCompleteness({ ...full, am: { cleanser: true, moisturizer: true, sunscreen: false } });
  assert.equal(missingSun.amDone, false);
  assert.equal(missingSun.sunscreenDone, false);
  assert.equal(missingSun.allDone, false);

  // PM 缺保湿 → PM 不完成
  const missingMoist = computeSkincareCompleteness({ ...full, pm: { cleanser: true, moisturizer: false } });
  assert.equal(missingMoist.pmDone, false);
  assert.equal(missingMoist.allDone, false);

  // 只勾防晒：sunscreenDone 独立为 true，AM 仍不完成
  const onlySun = computeSkincareCompleteness({ am: { cleanser: false, moisturizer: false, sunscreen: true }, pm: {} });
  assert.deepEqual(onlySun, { amDone: false, pmDone: false, sunscreenDone: true, allDone: false });
});

// ── F6 护肤：computeSkincareStreak（回溯语义对齐 computeStreak） ─────────────

test("computeSkincareStreak：只有 AM+PM 全完成计 1 天；今天未完成从昨天回溯；断档归零", () => {
  const fullDay = (date) => ({ date, am: { cleanser: true, moisturizer: true, sunscreen: true }, pm: { cleanser: true, moisturizer: true } });
  const amOnlyDay = (date) => ({ date, am: { cleanser: true, moisturizer: true, sunscreen: true }, pm: { cleanser: true, moisturizer: false } });

  assert.equal(computeSkincareStreak([], TODAY), 0);
  assert.equal(computeSkincareStreak(null, TODAY), 0);
  // 只完成 AM 不算完成
  assert.equal(computeSkincareStreak([amOnlyDay(TODAY)], TODAY), 0);
  // 今天全完成 → 1
  assert.equal(computeSkincareStreak([fullDay(TODAY)], TODAY), 1);
  // 连续 3 天（更早的 AM-only 不计）
  assert.equal(computeSkincareStreak([fullDay(TODAY), fullDay(daysAgo(1)), fullDay(daysAgo(2)), amOnlyDay(daysAgo(3))], TODAY), 3);
  // 今天未完成：从昨天回溯 2 天
  assert.equal(computeSkincareStreak([fullDay(daysAgo(1)), fullDay(daysAgo(2))], TODAY), 2);
  // 今天完成但昨天断档 → 1
  assert.equal(computeSkincareStreak([fullDay(TODAY), amOnlyDay(daysAgo(1))], TODAY), 1);
  // 乱序 / 重复不影响
  assert.equal(computeSkincareStreak([fullDay(daysAgo(1)), fullDay(TODAY), fullDay(daysAgo(1))], TODAY), 2);
});

// ── F6 护肤：buildSkincareNotice 三分支 ──────────────────────────────────────

test("buildSkincareNotice：尚未开始 / 防晒强制 / 无警示 三分支", () => {
  const SUNSCREEN_NOTICE = "今日防晒未记录——异维A酸期间防晒为强制项";
  const NOT_STARTED = "今日护肤尚未开始";

  assert.deepEqual(buildSkincareNotice(null), [NOT_STARTED]);
  assert.deepEqual(buildSkincareNotice({}), [NOT_STARTED]);
  assert.deepEqual(
    buildSkincareNotice({ am: { cleanser: false, moisturizer: false, sunscreen: false }, pm: { cleanser: false, moisturizer: false } }),
    [NOT_STARTED]
  );
  // AM 有记录但防晒未勾 → 强制项警示（即使 PM 完成）
  assert.deepEqual(
    buildSkincareNotice({ am: { cleanser: true, moisturizer: true, sunscreen: false }, pm: { cleanser: true, moisturizer: true } }),
    [SUNSCREEN_NOTICE]
  );
  // 只勾了防晒也视为 AM 有记录，但防晒已完成 → 无警示
  assert.deepEqual(buildSkincareNotice({ am: { cleanser: false, moisturizer: false, sunscreen: true }, pm: {} }), []);
  // PM 有记录、AM 全无：不触发防晒警示（防晒属早间），也不算尚未开始
  assert.deepEqual(buildSkincareNotice({ am: { cleanser: false, moisturizer: false, sunscreen: false }, pm: { cleanser: true, moisturizer: true } }), []);
});

// ── F6 护肤：setSkincareItem（mutate 写路径辅助） ────────────────────────────

test("setSkincareItem：新增；同日覆盖保留 id 与既有勾选；取消勾选；非法入参原样返回", () => {
  const base = normalizeLifestyle(null);

  const on = setSkincareItem(base, TODAY, "am", "sunscreen", true);
  assert.equal(on.skincare.days.length, 1);
  assert.equal(on.skincare.days[0].am.sunscreen, true);
  assert.equal(on.skincare.days[0].am.cleanser, false);

  const id = on.skincare.days[0].id;
  const more = setSkincareItem(on, TODAY, "am", "cleanser", true);
  assert.equal(more.skincare.days.length, 1); // 同日覆盖
  assert.equal(more.skincare.days[0].id, id); // id 保留
  assert.equal(more.skincare.days[0].am.sunscreen, true); // 既有勾选保留
  assert.equal(more.skincare.days[0].am.cleanser, true);

  const off = setSkincareItem(more, TODAY, "am", "sunscreen", false);
  assert.equal(off.skincare.days[0].am.sunscreen, false);
  assert.equal(off.skincare.days[0].am.cleanser, true);

  const pm = setSkincareItem(off, TODAY, "pm", "moisturizer", true);
  assert.equal(pm.skincare.days[0].pm.moisturizer, true);
  assert.equal(pm.skincare.days[0].am.cleanser, true); // AM 不受影响

  // 非法：坏日期 / 未知时段 / pm 无防晒项 / am 无未知项
  for (const [date, session, item] of [
    ["2026-13-99", "am", "cleanser"],
    ["bad", "pm", "cleanser"],
    [TODAY, "noon", "cleanser"],
    [TODAY, "pm", "sunscreen"],
    [TODAY, "am", "shave"]
  ]) {
    assert.equal(setSkincareItem(base, date, session, item, true).skincare.days.length, 0, `${date} ${session} ${item} 应被拒绝`);
  }
});

// ── state 集成（mutate 单一写路径 + 持久化往返） ─────────────────────────────

test("state 集成：mutate 写 lifestyle → 持久化 → loadState 往返一致", async () => {
  const mockStorage = new Map();
  globalThis.localStorage = {
    getItem: (key) => mockStorage.get(key) ?? null,
    setItem: (key, value) => mockStorage.set(key, value),
    removeItem: (key) => mockStorage.delete(key),
    clear: () => mockStorage.clear()
  };
  const stateModule = await import("../public/modules/core/state.js");
  const { defaultState } = await import("../public/modules/core/config.js");

  // defaultState 携带 lifestyle 占位结构，且未新增 STORAGE key
  assert.deepEqual(defaultState.lifestyle.skincare, { days: [] });
  assert.deepEqual(defaultState.lifestyle.grooming, { days: [] });

  const saved = stateModule.mutate((state) => {
    state.lifestyle = recordTrainingDay(state.lifestyle, TODAY, "全身 A");
    state.lifestyle = recordWeightEntry(state.lifestyle, daysAgo(1), 46.2);
    state.lifestyle = recordWeightEntry(state.lifestyle, daysAgo(1), 46.4); // 同日覆盖
    return state.lifestyle;
  });
  assert.equal(saved.fitness.trainings.length, 1);
  assert.equal(saved.fitness.weights.length, 1);
  assert.equal(saved.fitness.weights[0].kg, 46.4);

  const reloaded = stateModule.loadState();
  assert.deepEqual(reloaded.lifestyle.fitness.trainings, saved.fitness.trainings);
  assert.deepEqual(reloaded.lifestyle.fitness.weights, saved.fitness.weights);

  // 载入坏数据也能被 normalizeLifestyle 兜住
  mockStorage.set("heartflow-state", JSON.stringify({
    ...JSON.parse(mockStorage.get("heartflow-state")),
    lifestyle: { fitness: { trainings: [{ date: "bad" }], weights: [{ date: TODAY, kg: 999 }] } }
  }));
  const badReload = stateModule.loadState();
  assert.deepEqual(badReload.lifestyle.fitness, { trainings: [], weights: [] });
  assert.deepEqual(badReload.lifestyle.skincare, { days: [] });
});

test("state 集成：护肤复选框切换走 mutate 写路径 → 持久化 → loadState 往返一致", async () => {
  const mockStorage = new Map();
  globalThis.localStorage = {
    getItem: (key) => mockStorage.get(key) ?? null,
    setItem: (key, value) => mockStorage.set(key, value),
    removeItem: (key) => mockStorage.delete(key),
    clear: () => mockStorage.clear()
  };
  const stateModule = await import("../public/modules/core/state.js");

  // 模拟 UI 复选框逐项点击：今天 AM 三项 + PM 两项
  const saved = stateModule.mutate((state) => {
    state.lifestyle = setSkincareItem(state.lifestyle, TODAY, "am", "sunscreen", true);
    state.lifestyle = setSkincareItem(state.lifestyle, TODAY, "am", "cleanser", true);
    state.lifestyle = setSkincareItem(state.lifestyle, TODAY, "am", "moisturizer", true);
    state.lifestyle = setSkincareItem(state.lifestyle, TODAY, "pm", "cleanser", true);
    state.lifestyle = setSkincareItem(state.lifestyle, TODAY, "pm", "moisturizer", true);
    return state.lifestyle;
  });
  assert.equal(saved.skincare.days.length, 1);
  assert.deepEqual(computeSkincareCompleteness(saved.skincare.days[0]), { amDone: true, pmDone: true, sunscreenDone: true, allDone: true });
  assert.equal(computeSkincareStreak(saved.skincare.days, TODAY), 1);
  assert.deepEqual(buildSkincareNotice(saved.skincare.days[0]), []);

  // 再勾一项昨日 → 连续 2 天；today 完成后 notice 为空
  stateModule.mutate((state) => {
    state.lifestyle = setSkincareItem(state.lifestyle, daysAgo(1), "am", "cleanser", true);
    state.lifestyle = setSkincareItem(state.lifestyle, daysAgo(1), "am", "moisturizer", true);
    state.lifestyle = setSkincareItem(state.lifestyle, daysAgo(1), "am", "sunscreen", true);
    state.lifestyle = setSkincareItem(state.lifestyle, daysAgo(1), "pm", "cleanser", true);
    state.lifestyle = setSkincareItem(state.lifestyle, daysAgo(1), "pm", "moisturizer", true);
    return state.lifestyle;
  });
  const reloaded = stateModule.loadState();
  assert.equal(reloaded.lifestyle.skincare.days.length, 2);
  assert.equal(computeSkincareStreak(reloaded.lifestyle.skincare.days, TODAY), 2);
  // 空状态（无记录日）警示：尚未开始
  assert.deepEqual(buildSkincareNotice(reloaded.lifestyle.skincare.days.find((day) => day.date === daysAgo(2)) || null), ["今日护肤尚未开始"]);
});

// ── UI 接线源码断言 ──────────────────────────────────────────────────────────

test("UI 接线：app.js 挂载 renderLifestyle，index.html 提供 lifestylePanel 容器", async () => {
  const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const htmlSource = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const renderSource = await readFile(new URL("../public/modules/render/render-lifestyle.js", import.meta.url), "utf8");

  assert.match(appSource, /import \{ renderLifestyle \} from "\.\/modules\/render\/render-lifestyle\.js";/);
  assert.match(appSource, /\n\s*renderLifestyle\(\);/);
  assert.match(htmlSource, /id="lifestylePanel"/);

  // 渲染层接线：mutate 写路径、escapeHtml、无 confirm（打卡/记录可直接写）
  assert.match(renderSource, /mutate\(\(state\) =>/);
  assert.match(renderSource, /escapeHtml\(/);
  assert.doesNotMatch(renderSource, /confirm/);
  assert.match(renderSource, /data-lifestyle-action="train-today"/);
  assert.match(renderSource, /data-lifestyle-action="record-weight"/);

  // 计划卡与安全约束卡内容齐全（来自既定计划文档与安全约束）
  for (const text of ["训练日 A · 下肢 + 推", "训练日 B · 髋铰链 + 拉", "罗马尼亚硬拉 3×8", "RPE 6–7", "助力带", "补水 3L", "横纹肌溶解", "以医生与正式计划文档为准", "下一批上线"]) {
    assert.ok(renderSource.includes(text), `缺少内容：${text}`);
  }

  // F6 护肤卡接线：复选框 → setSkincareItem（mutate）、警示行、连续记录、7 天小表、要点卡
  assert.match(renderSource, /data-skincare-item="/);
  assert.match(renderSource, /setSkincareItem\(state\.lifestyle, todayKey\(\)/);
  assert.match(renderSource, /buildSkincareNotice\(/);
  assert.match(renderSource, /computeSkincareStreak\(/);
  assert.match(renderSource, /computeSkincareCompleteness\(/);
  for (const text of [
    "护肤管理",
    "温和洁面",
    "保湿修复",
    "防晒（强制）",
    "连续护肤",
    "防晒★",
    "异维A酸护理要点",
    "去角质",
    "磨砂",
    "蜡疗",
    "维A类补充剂",
    "禁酒",
    "血脂 / 肝功",
    "严重皲裂",
    "酱油色尿",
    "立即停用并就医",
    "以医嘱为准"
  ]) {
    assert.ok(renderSource.includes(text), `缺少护肤卡内容：${text}`);
  }

  // 穿搭占位保留（F7 不实现）
  assert.match(renderSource, /穿搭管理/);
});
