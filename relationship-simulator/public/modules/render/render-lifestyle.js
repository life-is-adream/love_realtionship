/**
 * 日常记录 UI：健身、护理和穿搭整理的可折叠记录区。
 * 知识依据在独立分类阅读区呈现；这里保留原记录结构，避免通用化个人计划与医嘱。
 *
 * 惯例对齐：
 * - 布局对齐 render-mistakes 的 mistakes-box 可折叠先例；全部插值过 escapeHtml；
 * - 状态写入一律 mutate(fn)；打卡/记录为低风险写操作，无确认弹窗；
 * - 纯函数计算来自 training/lifestyle.js，渲染层不掺业务规则。
 */

import { $, escapeHtml } from "../core/dom.js";
import { shanghaiDate } from "../core/date.js";
import { getState, mutate } from "../core/state.js";
import { renderKnowledgeSources } from "./render-presentation-knowledge.js";
import {
  computeTrainingRhythm,
  computeWeightReview,
  computeStreak,
  computeSkincareCompleteness,
  computeSkincareStreak,
  buildSkincareNotice,
  computeGroomingCompleteness,
  computeGroomingStreak,
  buildGroomingNotice,
  recordTrainingDay,
  recordWeightEntry,
  setSkincareItem,
  setGroomingItem,
  GROOMING_ITEMS,
  WEIGHT_KG_MIN,
  WEIGHT_KG_MAX
} from "../training/lifestyle.js";

const RHYTHM_LABELS = { start: "未记录", train: "活动安排", rest: "恢复安排", done: "已记录" };
const SKINCARE_RECENT_WINDOW = 7;
const GROOMING_RECENT_WINDOW = 7;
const SKINCARE_CHECKBOXES = [
  { session: "am", item: "cleanser", label: "温和洁面" },
  { session: "am", item: "moisturizer", label: "保湿" },
  { session: "am", item: "sunscreen", label: "日晒防护" },
  { session: "pm", item: "cleanser", label: "温和洁面" },
  { session: "pm", item: "moisturizer", label: "保湿修复" }
];
const GROOMING_CHECKBOX_LABELS = {
  pressed: "衣服平整无渍",
  shoes: "鞋子干净",
  nails: "指甲修剪",
  hair: "发型整齐",
  breath: "口气清新"
};

export function renderLifestyle() {
  const panel = $("lifestylePanel");
  if (!panel) return;
  const openSections = new Set([...panel.querySelectorAll("details[open]")].map((section) => section.querySelector("summary")?.textContent));
  const lifestyle = getState().lifestyle;
  const todayStr = todayKey();
  const fitness = lifestyle?.fitness || { trainings: [], weights: [] };
  const trainings = Array.isArray(fitness.trainings) ? fitness.trainings : [];
  const weights = Array.isArray(fitness.weights) ? fitness.weights : [];

  const rhythm = computeTrainingRhythm(trainings, todayStr);
  const streak = computeStreak(trainings.map((item) => item?.date), todayStr);
  const review = computeWeightReview(weights, todayStr);
  const recentTrainings = [...trainings].slice(-5).reverse();
  const recentWeights = [...weights].slice(-10).reverse();
  const trainedToday = rhythm.status === "done";

  const skincareDays = Array.isArray(lifestyle?.skincare?.days) ? lifestyle.skincare.days : [];
  const todayEntry = skincareDays.find((day) => day?.date === todayStr) || null;
  const skincareStreak = computeSkincareStreak(skincareDays, todayStr);
  const skincareNotices = buildSkincareNotice(todayEntry);
  const recentSkincareDays = Array.from({ length: SKINCARE_RECENT_WINDOW }, (_, i) => {
    const date = shiftDate(todayStr, -(SKINCARE_RECENT_WINDOW - 1 - i));
    const entry = skincareDays.find((day) => day?.date === date) || { date };
    return { date, ...computeSkincareCompleteness(entry) };
  }).reverse();

  const groomingDays = Array.isArray(lifestyle?.grooming?.days) ? lifestyle.grooming.days : [];
  const todayGrooming = groomingDays.find((day) => day?.date === todayStr) || null;
  const groomingStreak = computeGroomingStreak(groomingDays, todayStr);
  const groomingNotices = buildGroomingNotice(todayGrooming, new Date());
  const recentGroomingDays = Array.from({ length: GROOMING_RECENT_WINDOW }, (_, i) => {
    const date = shiftDate(todayStr, -(GROOMING_RECENT_WINDOW - 1 - i));
    const entry = groomingDays.find((day) => day?.date === date) || { date };
    return { date, ...computeGroomingCompleteness(entry) };
  }).reverse();

  // 记录独立折叠，先阅读上方知识卡；不把打卡完整度当成健康或吸引力评分。
  panel.innerHTML = `<details class="mistakes-box lifestyle-box">
    <summary>日常记录<span class="mistake-count">运动 · 护理 · 整理</span></summary>
    <div class="lifestyle-fitness">
      <div class="lifestyle-rhythm">
        <span class="lifestyle-rhythm-status is-${escapeHtml(rhythm.status)}">${escapeHtml(RHYTHM_LABELS[rhythm.status] || rhythm.status)}</span>
        <span class="lifestyle-rhythm-message">${escapeHtml(rhythm.message)}</span>
        <button class="btn small primary" type="button" data-lifestyle-action="train-today" ${trainedToday ? "disabled" : ""}>${trainedToday ? "今日已练" : "完成今日训练"}</button>
      </div>
      <div class="lifestyle-streak">连续训练记录 <b>${escapeHtml(String(streak))}</b> 天${recentTrainings.length ? `<span class="lifestyle-recent">最近：${recentTrainings.map((item) => escapeHtml(item?.date || "")).join("、")}</span>` : ""}</div>
      <p class="note">打卡只记录活动，不要求连续训练。恢复与强度按自己的计划安排。</p>
      <div class="lifestyle-weight">
        <div class="lifestyle-weight-row">
          <b>体重记录</b>
          <input type="number" id="lifestyleWeightInput" step="0.1" min="${escapeHtml(String(WEIGHT_KG_MIN))}" max="${escapeHtml(String(WEIGHT_KG_MAX))}" placeholder="公斤（30–200）" aria-label="今日体重">
          <button class="btn small" type="button" data-lifestyle-action="record-weight">记录体重</button>
        </div>
        <p class="lifestyle-trend is-${escapeHtml(review.trend)}">${escapeHtml(review.suggestion)}</p>
        ${recentWeights.length ? `<table class="lifestyle-weight-table"><thead><tr><th>日期</th><th>公斤</th></tr></thead><tbody>
          ${recentWeights.map((item) => `<tr><td>${escapeHtml(item?.date || "")}</td><td>${escapeHtml(formatKg(item?.kg))}</td></tr>`).join("")}
        </tbody></table>` : '<p class="mistake-empty">还没有体重记录。按需要记录，尽量保持称重条件一致；不必每天称重。</p>'}
      </div>
      <details class="lifestyle-plan">
        <summary>训练卡 · 基础依据与计划选择</summary>
        <div class="lifestyle-plan-body">
          <p>先区分有氧活动与主要肌群强化，逐步安排运动量；动作不熟悉时从合适版本开始。上方健身知识卡提供具体依据、示范入口与自测。</p>
          <p>固定 A/B、大重量、组数和增肌饮食属于个体计划，需要结合经验、目标、健康状态与恢复调整。</p>
          <ul class="knowledge-sources">${renderKnowledgeSources(["cdc-activity", "nhs-strength"])}</ul>
        </div>
      </details>
      <div class="lifestyle-safety">
        <b>适用范围</b>
        <p>通用卡不规定所有人的饮水量或热量，也不替代已有医嘱。训练中明显不适时停止，按需要寻求医疗评估。</p>
        <p class="note">体重趋势为记录摘要；界面提示阈值不是医学标准，不能据此诊断或自动调整饮食。</p>
      </div>
    </div>
    <div class="lifestyle-skincare">
      <b>护肤管理</b>
      <p class="note">按肤质与当日需要护理；勾选仅表示已记录，连续天数不是皮肤健康评价。</p>
      <div class="lifestyle-skincare-today">
        <span class="lifestyle-skincare-session">早间</span>
        ${renderSkincareCheckbox(todayEntry, "am", "cleanser")}
        ${renderSkincareCheckbox(todayEntry, "am", "moisturizer")}
        ${renderSkincareCheckbox(todayEntry, "am", "sunscreen")}
        <span class="lifestyle-skincare-session">晚间</span>
        ${renderSkincareCheckbox(todayEntry, "pm", "cleanser")}
        ${renderSkincareCheckbox(todayEntry, "pm", "moisturizer")}
      </div>
      ${skincareNotices.map((notice) => `<p class="lifestyle-skincare-notice">⚠ ${escapeHtml(notice)}</p>`).join("")}
      <div class="lifestyle-streak">连续护肤 <b>${escapeHtml(String(skincareStreak))}</b> 天</div>
      <table class="lifestyle-weight-table lifestyle-skincare-table">
        <thead><tr><th>日期</th><th>早</th><th>晚</th><th>防晒</th></tr></thead>
        <tbody>
          ${recentSkincareDays.map((day) => `<tr><td>${escapeHtml(day.date)}</td><td>${day.amDone ? "AM✓" : "—"}</td><td>${day.pmDone ? "PM✓" : "—"}</td><td>${day.sunscreenDone ? "防晒★" : "—"}</td></tr>`).join("")}
        </tbody>
      </table>
      <details class="lifestyle-plan">
        <summary>护理卡 · 基础护理与药物适用范围</summary>
        <div class="lifestyle-plan-body">
          <p>从温和清洁、保湿和日晒防护开始，按肤质选择，避免临时叠加陌生产品。上方护肤知识卡列出产品选择与防护要点。</p>
          <p>异维 A 酸属于处方治疗，只有实际服药者才需要相关护理与随访；本应用不推断用药，不推荐开始、停用或改剂量。</p>
          <ul class="knowledge-sources">${renderKnowledgeSources(["aad-basics", "aad-isotretinoin"])}</ul>
        </div>
      </details>
    </div>
    <div class="lifestyle-grooming">
      <b>穿搭管理</b>
      <div class="lifestyle-skincare-today">
        <span class="lifestyle-skincare-session">出门快速检查</span>
        ${GROOMING_ITEMS.map((item) => renderGroomingCheckbox(todayGrooming, item)).join("")}
      </div>
      ${groomingNotices.map((notice) => `<p class="lifestyle-grooming-notice">· ${escapeHtml(notice)}</p>`).join("")}
      <div class="lifestyle-streak">连续整理 <b>${escapeHtml(String(groomingStreak))}</b> 天</div>
      <table class="lifestyle-weight-table lifestyle-skincare-table">
        <thead><tr><th>日期</th><th>完成度</th></tr></thead>
        <tbody>
          ${recentGroomingDays.map((day) => `<tr><td>${escapeHtml(day.date)}</td><td>${day.allDone ? "全过✓" : `${escapeHtml(String(day.doneCount))}/5`}</td></tr>`).join("")}
        </tbody>
      </table>
      <details class="lifestyle-plan">
        <summary>穿搭卡 · 场景选择与专业基础</summary>
        <div class="lifestyle-plan-body">
          <p>按天气、活动和场所选择衣鞋，再检查版型与活动舒适度。上方穿搭知识卡提供廓形、纹理、色彩概念，以及日常、约会和正式场景的试穿方法。</p>
          <p class="note">具体搭配是审美与实践建议，不提供“偏瘦必须修身”或“某种衣服提高好感”的结论。</p>
          <ul class="knowledge-sources">${renderKnowledgeSources(["usu-design", "ada-breath"])}</ul>
        </div>
      </details>
    </div>
  </details>`;

  panel.querySelectorAll("details").forEach((section) => {
    section.open = openSections.has(section.querySelector("summary")?.textContent);
  });
  panel.querySelectorAll("button[data-lifestyle-action]").forEach((button) => {
    button.addEventListener("click", () => handleLifestyleAction(button.dataset.lifestyleAction));
  });
  panel.querySelectorAll("input[data-skincare-item]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => handleSkincareToggle(checkbox));
  });
  panel.querySelectorAll("input[data-grooming-item]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => handleGroomingToggle(checkbox));
  });
}

/** 单个穿搭复选框：按当日记录状态渲染勾选态 */
function renderGroomingCheckbox(dayEntry, item) {
  const flags = dayEntry && typeof dayEntry.items === "object" ? dayEntry.items : {};
  const checked = flags[item] === true ? " checked" : "";
  return `<label class="lifestyle-skincare-item"><input type="checkbox" data-grooming-item="${escapeHtml(item)}"${checked}>${escapeHtml(GROOMING_CHECKBOX_LABELS[item] || item)}</label>`;
}

/** 复选框切换 → mutate 写当日记录（同日覆盖）；mutate 回调触发整卡重渲染 */
function handleGroomingToggle(checkbox) {
  const item = String(checkbox.dataset.groomingItem || "");
  const checked = checkbox.checked === true;
  mutate((state) => {
    state.lifestyle = setGroomingItem(state.lifestyle, todayKey(), item, checked);
  });
  $("apiStatus").textContent = checked ? "穿搭检查已保存。" : "穿搭检查已取消。";
}

/** 单个护肤复选框：按当日记录状态渲染勾选态 */
function renderSkincareCheckbox(dayEntry, session, item) {
  const sessionFlags = dayEntry && typeof dayEntry[session] === "object" ? dayEntry[session] : {};
  const checked = sessionFlags[item] === true ? " checked" : "";
  const meta = SKINCARE_CHECKBOXES.find((entry) => entry.session === session && entry.item === item);
  return `<label class="lifestyle-skincare-item"><input type="checkbox" data-skincare-item="${session}:${item}"${checked}>${escapeHtml(meta?.label || item)}</label>`;
}

/** 复选框切换 → mutate 写当日记录（同日覆盖）；mutate 回调触发整卡重渲染 */
function handleSkincareToggle(checkbox) {
  const [session, item] = String(checkbox.dataset.skincareItem || "").split(":");
  const checked = checkbox.checked === true;
  mutate((state) => {
    state.lifestyle = setSkincareItem(state.lifestyle, todayKey(), session, item, checked);
  });
  $("apiStatus").textContent = checked ? "护肤记录已保存。" : "护肤记录已取消。";
}

function handleLifestyleAction(action) {
  if (action === "train-today") recordTodayTraining();
  if (action === "record-weight") recordWeight();
}

function recordTodayTraining() {
  mutate((state) => {
    state.lifestyle = recordTrainingDay(state.lifestyle, todayKey());
  });
  $("apiStatus").textContent = "已收录今日训练记录。";
}

function recordWeight() {
  const input = $("lifestyleWeightInput");
  if (!input) return;
  const kg = Number(input.value);
  if (!input.value.trim() || !Number.isFinite(kg) || kg < WEIGHT_KG_MIN || kg > WEIGHT_KG_MAX) {
    $("apiStatus").textContent = `体重需在 ${WEIGHT_KG_MIN}–${WEIGHT_KG_MAX} kg 之间，请检查后重试。`;
    return;
  }
  mutate((state) => {
    state.lifestyle = recordWeightEntry(state.lifestyle, todayKey(), kg);
  });
  input.value = "";
  $("apiStatus").textContent = "体重记录已保存。";
}

function formatKg(kg) {
  const value = Number(kg);
  return Number.isFinite(value) ? value.toFixed(1) : "";
}

/** 当天日期键 YYYY-MM-DD（统一走 Asia/Shanghai 口径，与训练/体重条目的 date 一致） */
function todayKey() {
  return shanghaiDate();
}

/** 本地日期字符串加减天数（跨月安全，UTC 日序号换算不受时区偏移影响） */
function shiftDate(base, deltaDays) {
  const [year, month, day] = String(base).split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return base;
  const date = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
