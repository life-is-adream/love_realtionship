/**
 * F5 生活管理（健身切片）：纯函数模块。
 *
 * 不读 DOM、不读 localStorage。状态规范化（normalizeLifestyle）由 core/state.js
 * 在载入与保存时嵌入 state.lifestyle；节奏/体重趋势/连续记录均可独立测试。
 *
 * 内容口径：训练与体重复查规则来自用户既定的增肌计划文档与安全约束
 * （异维A酸服药期间：RPE 6-7、不做力竭、硬拉类先降级、必须助力带、补水 3L+）。
 * UI 层统一标注「既定安全约束提醒，以医生与正式计划文档为准」，不做医疗建议。
 */

export const LIFESTYLE_LIMITS = Object.freeze({
  trainings: 400,
  weights: 365
});

// computeWeightReview 阈值常量（导出便于测试对齐边界）
export const WEIGHT_REVIEW_WINDOW_DAYS = 14;      // 取最近 14 天记录
export const WEIGHT_PLATEAU_MIN_SPAN_DAYS = 7;    // 跨度 ≥7 天
export const WEIGHT_PLATEAU_MIN_RECORDS = 2;      // 且 ≥2 条
export const WEIGHT_PLATEAU_RANGE_KG = 0.1;       // 最大-最小 ≤ 0.1kg → plateau
export const WEIGHT_FAST_GAIN_KG = 0.7;           // 与前一周同期比涨幅 > 0.7kg → fast

export const WEIGHT_KG_MIN = 30;
export const WEIGHT_KG_MAX = 200;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 解析 YYYY-MM-DD 本地日期字符串为 UTC 日序号（跨月安全，不受时区偏移影响） */
function dayNumber(dateStr) {
  if (typeof dateStr !== "string" || !DATE_RE.test(dateStr)) return null;
  const [year, month, day] = dateStr.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

/** 两个 YYYY-MM-DD 的本地日期差（天），无效输入返回 null */
export function dateDiffDays(fromStr, toStr) {
  const from = dayNumber(fromStr);
  const to = dayNumber(toStr);
  if (from === null || to === null) return null;
  return to - from;
}

function normalizeDateString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!DATE_RE.test(trimmed)) return null;
  const [year, month, day] = trimmed.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  // 回读校验：拒绝 2026-02-30 / 2026-13-01 这类格式合法但日历不存在的日期
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return trimmed;
}

function normalizeId(value, prefix) {
  const id = typeof value === "string" ? value.trim() : "";
  return id || makeId(prefix);
}

// ── 状态规范化 ───────────────────────────────────────────────────────────────

/**
 * 规范化 state.lifestyle 切片。坏数据剔除、同日去重/覆盖、超限丢最旧。
 * skincare/grooming 为 F6/F7 占位（只保留 days 字符串数组，不做任何逻辑）。
 * @param {object|null|undefined} value
 * @returns {object}
 */
export function normalizeLifestyle(value) {
  const input = isRecord(value) ? value : {};
  const fitness = isRecord(input.fitness) ? input.fitness : {};
  return {
    fitness: {
      trainings: normalizeTrainings(fitness.trainings),
      weights: normalizeWeights(fitness.weights)
    },
    skincare: { days: normalizePlaceholderDays(input.skincare) },
    grooming: { days: normalizePlaceholderDays(input.grooming) }
  };
}

function normalizePlaceholderDays(value) {
  const days = isRecord(value) ? value.days : null;
  return Array.isArray(days) ? days.filter((day) => typeof day === "string") : [];
}

/** 训练打卡条目 {id, date(YYYY-MM-DD), note?}：坏数据剔除、按 date 去重（一天一条）、上限 400 丢最旧 */
function normalizeTrainings(value) {
  if (!Array.isArray(value)) return [];
  const byDate = new Map();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const date = normalizeDateString(item.date);
    if (!date) continue;
    const entry = { id: normalizeId(item.id, "fit"), date };
    const note = typeof item.note === "string" ? item.note.trim() : "";
    if (note) entry.note = note;
    byDate.set(date, entry); // 同日期后出现的条目覆盖前者
  }
  return [...byDate.values()]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-LIFESTYLE_LIMITS.trainings);
}

/** 体重条目 {id, date, kg(30-200, 1 位小数)}：同 date 覆盖更新、上限 365 丢最旧 */
function normalizeWeights(value) {
  if (!Array.isArray(value)) return [];
  const byDate = new Map();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const date = normalizeDateString(item.date);
    if (!date) continue;
    const kg = normalizeKg(item.kg);
    if (kg === null) continue;
    byDate.set(date, { id: normalizeId(item.id, "wt"), date, kg });
  }
  return [...byDate.values()]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-LIFESTYLE_LIMITS.weights);
}

function normalizeKg(value) {
  const kg = Number(value);
  if (!Number.isFinite(kg) || kg < WEIGHT_KG_MIN || kg > WEIGHT_KG_MAX) return null;
  return Math.round(kg * 10) / 10;
}

// ── 写入辅助（mutate 内调用；规范化兜底交给 normalizeLifestyle） ─────────────

/**
 * 收录一次训练打卡（同日已有记录则保持不变）。返回新的 lifestyle 对象。
 * @param {object|null|undefined} lifestyle
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string} [note]
 * @returns {object}
 */
export function recordTrainingDay(lifestyle, dateStr, note = "") {
  const base = normalizeLifestyle(lifestyle);
  const date = normalizeDateString(dateStr);
  if (!date) return base;
  if (base.fitness.trainings.some((item) => item.date === date)) return base;
  const entry = { id: makeId("fit"), date };
  const trimmedNote = typeof note === "string" ? note.trim() : "";
  if (trimmedNote) entry.note = trimmedNote;
  return {
    ...base,
    fitness: { ...base.fitness, trainings: [...base.fitness.trainings, entry].slice(-LIFESTYLE_LIMITS.trainings) }
  };
}

/**
 * 记录一次体重（同日期覆盖更新）。kg 非法（越界/非数值）时原样返回。
 * @param {object|null|undefined} lifestyle
 * @param {string} dateStr - YYYY-MM-DD
 * @param {number|string} kg
 * @returns {object}
 */
export function recordWeightEntry(lifestyle, dateStr, kg) {
  const base = normalizeLifestyle(lifestyle);
  const date = normalizeDateString(dateStr);
  const normalizedKg = normalizeKg(kg);
  if (!date || normalizedKg === null) return base;
  const entry = { id: makeId("wt"), date, kg: normalizedKg };
  return {
    ...base,
    fitness: {
      ...base.fitness,
      weights: [...base.fitness.weights.filter((item) => item.date !== date), entry]
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        .slice(-LIFESTYLE_LIMITS.weights)
    }
  };
}

// ── 训练节奏（练一天休一天） ─────────────────────────────────────────────────

/**
 * 按最近一次训练日期与 todayStr 的本地日期差推导今日节奏。
 * @param {Array<{date: string}>|null|undefined} trainings
 * @param {string} todayStr - YYYY-MM-DD
 * @returns {{status: 'train'|'rest'|'start'|'done', message: string}}
 */
export function computeTrainingRhythm(trainings, todayStr) {
  const today = dayNumber(todayStr);
  const dated = (Array.isArray(trainings) ? trainings : [])
    .map((item) => dayNumber(item?.date))
    .filter((day) => day !== null && today !== null && day <= today)
    .sort((a, b) => b - a);

  if (!dated.length) return { status: "start", message: "从今天开始第一次训练" };
  const gap = today - dated[0];
  if (gap === 0) return { status: "done", message: "今日已练" };
  if (gap === 1) return { status: "rest", message: "昨天练过，今天休息恢复" };
  return { status: "train", message: `距上次训练已 ${gap} 天，今天练一天，把节奏补回来` };
}

// ── 体重复查（既定复查节点） ─────────────────────────────────────────────────

/**
 * 依据最近 14 天体重记录推导复查建议。
 * - plateau：跨度 ≥7 天且 ≥2 条且（最大-最小）≤0.1kg → 「每日 +150 kcal」
 * - fast：最近一条与前一周同期（≥7 天前最近的一条）比涨幅 >0.7kg → 「每日 −150 kcal」
 * - 数据不足 → insufficient；其余 → normal
 * @param {Array<{date: string, kg: number}>|null|undefined} weights
 * @param {string} todayStr - YYYY-MM-DD
 * @returns {{trend: 'plateau'|'fast'|'normal'|'insufficient', suggestion: string}}
 */
export function computeWeightReview(weights, todayStr) {
  const today = dayNumber(todayStr);
  if (today === null) return { trend: "insufficient", suggestion: "继续记录，满 1-2 周后出趋势" };

  const inWindow = (Array.isArray(weights) ? weights : [])
    .map((item) => ({ day: dayNumber(item?.date), kg: Number(item?.kg) }))
    .filter((item) => item.day !== null && Number.isFinite(item.kg) && item.day <= today && today - item.day <= WEIGHT_REVIEW_WINDOW_DAYS - 1)
    .sort((a, b) => a.day - b.day); // 旧 → 新

  if (inWindow.length < WEIGHT_PLATEAU_MIN_RECORDS || inWindow[inWindow.length - 1].day - inWindow[0].day < WEIGHT_PLATEAU_MIN_SPAN_DAYS) {
    return { trend: "insufficient", suggestion: "继续记录，满 1-2 周后出趋势" };
  }

  const kgs = inWindow.map((item) => item.kg);
  // 先按 1 位小数归一再做阈值比较，避免 46.1 - 46.0 这类浮点误差误判边界
  const range = Math.round((Math.max(...kgs) - Math.min(...kgs)) * 10) / 10;
  if (range <= WEIGHT_PLATEAU_RANGE_KG) {
    return { trend: "plateau", suggestion: "体重连续约 2 周未涨——复查节点：每日 +150 kcal" };
  }

  const latest = inWindow[inWindow.length - 1];
  const weekAgoCandidates = inWindow.filter((item) => item.day <= latest.day - WEIGHT_PLATEAU_MIN_SPAN_DAYS);
  if (weekAgoCandidates.length) {
    const weekAgo = weekAgoCandidates[weekAgoCandidates.length - 1];
    const gain = Math.round((latest.kg - weekAgo.kg) * 10) / 10;
    if (gain > WEIGHT_FAST_GAIN_KG) {
      return { trend: "fast", suggestion: "单周涨幅超 0.7kg——复查节点：每日 −150 kcal" };
    }
  }
  return { trend: "normal", suggestion: "正常推进" };
}

// ── 连续训练记录（口径与 training/micro-training.js getTrainingStreak 对齐） ─

/**
 * 计算连续记录天数：若今天没打卡，从昨天回溯（当天尚未打卡不打断既有连续记录）。
 * @param {Array<string>} dates - YYYY-MM-DD 字符串数组（可含重复/乱序）
 * @param {string} todayStr - YYYY-MM-DD
 * @returns {number}
 */
export function computeStreak(dates, todayStr) {
  const today = dayNumber(todayStr);
  if (today === null) return 0;
  const days = new Set(
    (Array.isArray(dates) ? dates : [])
      .map((date) => dayNumber(date))
      .filter((day) => day !== null && day <= today)
  );
  if (!days.size) return 0;

  let anchor = today;
  if (!days.has(today)) anchor -= 1;
  if (!days.has(anchor)) return 0;

  let streak = 0;
  while (days.has(anchor - streak)) streak += 1;
  return streak;
}
