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
  weights: 365,
  skincare: 180,
  grooming: 180
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
    skincare: { days: normalizeSkincareDays(input.skincare) },
    grooming: { days: normalizeGroomingDays(input.grooming) }
  };
}

/** 护肤日条目 {id, date, am:{cleanser,moisturizer,sunscreen}, pm:{cleanser,moisturizer}}：坏数据剔除、同 date 覆盖、上限 180 丢最旧 */
function normalizeSkincareDays(value) {
  const days = isRecord(value) ? value.days : null;
  if (!Array.isArray(days)) return [];
  const byDate = new Map();
  for (const item of days) {
    if (!isRecord(item)) continue;
    const date = normalizeDateString(item.date);
    if (!date) continue;
    const am = isRecord(item.am) ? item.am : {};
    const pm = isRecord(item.pm) ? item.pm : {};
    byDate.set(date, {
      id: normalizeId(item.id, "sk"),
      date,
      am: { cleanser: am.cleanser === true, moisturizer: am.moisturizer === true, sunscreen: am.sunscreen === true },
      pm: { cleanser: pm.cleanser === true, moisturizer: pm.moisturizer === true }
    });
  }
  return [...byDate.values()]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-LIFESTYLE_LIMITS.skincare);
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

// ── 护肤打卡（F6：异维A酸护理） ─────────────────────────────────────────────

const SKINCARE_SESSIONS = { am: ["cleanser", "moisturizer", "sunscreen"], pm: ["cleanser", "moisturizer"] };

/**
 * 设置某天某时段某项的勾选状态（同日覆盖更新，保留既有条目 id）。
 * session/item 非法或日期无效时原样返回。
 * @param {object|null|undefined} lifestyle
 * @param {string} dateStr - YYYY-MM-DD
 * @param {'am'|'pm'} session
 * @param {'cleanser'|'moisturizer'|'sunscreen'} item
 * @param {boolean} checked
 * @returns {object}
 */
export function setSkincareItem(lifestyle, dateStr, session, item, checked) {
  const base = normalizeLifestyle(lifestyle);
  const date = normalizeDateString(dateStr);
  const allowedItems = SKINCARE_SESSIONS[session];
  if (!date || !Array.isArray(allowedItems) || !allowedItems.includes(item)) return base;
  const flag = checked === true;
  const existing = base.skincare.days.find((day) => day.date === date);
  const entry = existing
    ? { ...existing, [session]: { ...existing[session], [item]: flag } }
    : {
        id: makeId("sk"),
        date,
        am: session === "am" ? { cleanser: false, moisturizer: false, sunscreen: false, [item]: flag } : { cleanser: false, moisturizer: false, sunscreen: false },
        pm: session === "pm" ? { cleanser: false, moisturizer: false, [item]: flag } : { cleanser: false, moisturizer: false }
      };
  return {
    ...base,
    skincare: {
      days: [...base.skincare.days.filter((day) => day.date !== date), entry]
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        .slice(-LIFESTYLE_LIMITS.skincare)
    }
  };
}

/**
 * 单日护肤完成度：AM 完成=洁面+保湿+防晒全勾；PM 完成=洁面+保湿全勾。
 * @param {object|null|undefined} day - skincare.days 条目
 * @returns {{amDone: boolean, pmDone: boolean, sunscreenDone: boolean, allDone: boolean}}
 */
export function computeSkincareCompleteness(day) {
  const am = isRecord(day?.am) ? day.am : {};
  const pm = isRecord(day?.pm) ? day.pm : {};
  const amDone = am.cleanser === true && am.moisturizer === true && am.sunscreen === true;
  const pmDone = pm.cleanser === true && pm.moisturizer === true;
  return { amDone, pmDone, sunscreenDone: am.sunscreen === true, allDone: amDone && pmDone };
}

/**
 * 计算连续护肤天数（口径与 computeStreak 一致）：只有当天 AM+PM 都完成才计 1 天；
 * 今天未完成则从昨天回溯（当天尚未完成不打断既有连续记录）。
 * @param {Array<object>} days - skincare.days 条目数组（可含乱序/重复日期）
 * @param {string} todayStr - YYYY-MM-DD
 * @returns {number}
 */
export function computeSkincareStreak(days, todayStr) {
  const today = dayNumber(todayStr);
  if (today === null) return 0;
  const complete = new Set(
    (Array.isArray(days) ? days : [])
      .map((day) => (computeSkincareCompleteness(day).allDone ? dayNumber(day?.date) : null))
      .filter((day) => day !== null && day <= today)
  );
  if (!complete.size) return 0;

  let anchor = today;
  if (!complete.has(today)) anchor -= 1;
  if (!complete.has(anchor)) return 0;

  let streak = 0;
  while (complete.has(anchor - streak)) streak += 1;
  return streak;
}

/**
 * 单日护肤警示（异维A酸既定安全约束提醒，以医嘱为准）：
 * - AM 有记录但防晒未勾 → 防晒强制提醒；AM/PM 全无记录 → 尚未开始；否则空数组。
 * @param {object|null|undefined} day - skincare.days 条目
 * @returns {string[]}
 */
export function buildSkincareNotice(day) {
  const am = isRecord(day?.am) ? day.am : {};
  const pm = isRecord(day?.pm) ? day.pm : {};
  const amAny = am.cleanser === true || am.moisturizer === true || am.sunscreen === true;
  const pmAny = pm.cleanser === true || pm.moisturizer === true;
  if (!amAny && !pmAny) return ["今日护肤尚未开始"];
  if (amAny && am.sunscreen !== true) return ["今日防晒未记录——异维A酸期间防晒为强制项"];
  return [];
}

// ── 穿搭管理（F7：出门快速检查五项） ─────────────────────────────────────────

export const GROOMING_ITEMS = Object.freeze(["pressed", "shoes", "nails", "hair", "breath"]);
const GROOMING_LABELS = { pressed: "衣服平整无渍", shoes: "鞋子干净", nails: "指甲修剪", hair: "发型整齐", breath: "口气清新" };

/**
 * 规范化 grooming.days（条目 {id, date, items:{pressed,shoes,nails,hair,breath}}）：
 * F7 之前该切片为字符串占位数组 → 占位字符串直接剔除；坏日期/非对象剔除；
 * 布尔严格归一（=== true）、同 date 覆盖、上限 180 丢最旧。
 */
function normalizeGroomingDays(value) {
  const days = isRecord(value) ? value.days : null;
  if (!Array.isArray(days)) return [];
  const byDate = new Map();
  for (const item of days) {
    if (!isRecord(item)) continue;
    const date = normalizeDateString(item.date);
    if (!date) continue;
    const flags = isRecord(item.items) ? item.items : {};
    const items = {};
    for (const key of GROOMING_ITEMS) items[key] = flags[key] === true;
    byDate.set(date, { id: normalizeId(item.id, "gr"), date, items });
  }
  return [...byDate.values()]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-LIFESTYLE_LIMITS.grooming);
}

/**
 * 设置某天某项的勾选状态（同日覆盖更新，保留既有条目 id）。
 * item 非法或日期无效时原样返回。
 * @param {object|null|undefined} lifestyle
 * @param {string} dateStr - YYYY-MM-DD
 * @param {'pressed'|'shoes'|'nails'|'hair'|'breath'} item
 * @param {boolean} checked
 * @returns {object}
 */
export function setGroomingItem(lifestyle, dateStr, item, checked) {
  const base = normalizeLifestyle(lifestyle);
  const date = normalizeDateString(dateStr);
  if (!date || !GROOMING_ITEMS.includes(item)) return base;
  const flag = checked === true;
  const existing = base.grooming.days.find((day) => day.date === date);
  const entry = existing
    ? { ...existing, items: { ...existing.items, [item]: flag } }
    : {
        id: makeId("gr"),
        date,
        items: Object.fromEntries(GROOMING_ITEMS.map((key) => [key, key === item ? flag : false]))
      };
  return {
    ...base,
    grooming: {
      days: [...base.grooming.days.filter((day) => day.date !== date), entry]
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        .slice(-LIFESTYLE_LIMITS.grooming)
    }
  };
}

/**
 * 单日穿搭快速检查完成度：五项全勾 = 完成。
 * @param {object|null|undefined} day - grooming.days 条目
 * @returns {{doneCount: number, allDone: boolean}}
 */
export function computeGroomingCompleteness(day) {
  const items = isRecord(day?.items) ? day.items : {};
  const doneCount = GROOMING_ITEMS.filter((item) => items[item] === true).length;
  return { doneCount, allDone: doneCount === GROOMING_ITEMS.length };
}

/**
 * 计算连续整理天数（口径与 computeSkincareStreak 一致）：当天五项全勾才计 1 天；
 * 今天未完成则从昨天回溯（当天尚未完成不打断既有连续记录）。
 * @param {Array<object>} days - grooming.days 条目数组（可含乱序/重复日期）
 * @param {string} todayStr - YYYY-MM-DD
 * @returns {number}
 */
export function computeGroomingStreak(days, todayStr) {
  const today = dayNumber(todayStr);
  if (today === null) return 0;
  const complete = new Set(
    (Array.isArray(days) ? days : [])
      .map((day) => (computeGroomingCompleteness(day).allDone ? dayNumber(day?.date) : null))
      .filter((day) => day !== null && day <= today)
  );
  if (!complete.size) return 0;

  let anchor = today;
  if (!complete.has(today)) anchor -= 1;
  if (!complete.has(anchor)) return 0;

  let streak = 0;
  while (complete.has(anchor - streak)) streak += 1;
  return streak;
}

/**
 * 单日穿搭轻提示（非警示，上午不催）：
 * - 五项全勾 → 「今日检查已完成」；
 * - 今天全无记录且当前时间 ≥12:00 → 出门前快速检查轻提示；
 * - 其余（上午未开始 / 部分勾选）→ 空。
 * @param {object|null|undefined} day - grooming.days 条目
 * @param {Date} [now] - 可注入时间（测试不依赖真实时钟）
 * @returns {string[]}
 */
export function buildGroomingNotice(day, now = new Date()) {
  if (computeGroomingCompleteness(day).allDone) return ["今日检查已完成"];
  const hour = now instanceof Date && Number.isFinite(now.getTime()) ? now.getHours() : null;
  const anyChecked = isRecord(day?.items) && GROOMING_ITEMS.some((item) => day.items[item] === true);
  if (!anyChecked && hour !== null && hour >= 12) return ["出门前 30 秒过一遍快速检查"];
  return [];
}

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
