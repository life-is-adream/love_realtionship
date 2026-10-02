// F5 生活管理（健身切片）：normalizeLifestyle 边界 + 三个纯函数全分支 +
// micro-training 口径一致性 + state mutate 往返 + UI 接线源码级断言。
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
  computeTrainingRhythm,
  computeWeightReview,
  computeStreak,
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

test("normalizeLifestyle：skincare/grooming 占位保留字符串 days，剔除坏元素", () => {
  const result = normalizeLifestyle({
    skincare: { days: ["2026-10-01", 42, null, "2026-10-02"] },
    grooming: { days: "not-array" }
  });
  assert.deepEqual(result.skincare.days, ["2026-10-01", "2026-10-02"]);
  assert.deepEqual(result.grooming.days, []);
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

  // 护肤/穿搭占位不接逻辑：index.html 容器仍存在，但 F6/F7 无独立实现文件
  assert.match(renderSource, /护肤管理/);
  assert.match(renderSource, /穿搭管理/);
});
