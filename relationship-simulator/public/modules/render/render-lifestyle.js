/**
 * F5/F6 生活管理 UI：成长面板区域的「生活管理」可折叠 section。
 *
 * F5 实现健身卡（训练节奏打卡 / 连续记录 / 体重与复查趋势 / 计划卡 / 安全约束卡）；
 * F6 实现护肤卡（今日 AM/PM 复选框 / 连续记录 / 最近 7 天完成度 / 警示行 / 异维A酸护理要点卡）；
 * 穿搭为 F7 占位行（仅静态文案）。
 *
 * 惯例对齐：
 * - 布局对齐 render-mistakes 的 mistakes-box 可折叠先例；全部插值过 escapeHtml；
 * - 状态写入一律 mutate(fn)；打卡/记录为低风险写操作，无确认弹窗；
 * - 纯函数计算来自 training/lifestyle.js，渲染层不掺业务规则。
 */

import { $, escapeHtml } from "../core/dom.js";
import { getState, mutate } from "../core/state.js";
import {
  computeTrainingRhythm,
  computeWeightReview,
  computeStreak,
  computeSkincareCompleteness,
  computeSkincareStreak,
  buildSkincareNotice,
  recordTrainingDay,
  recordWeightEntry,
  setSkincareItem,
  WEIGHT_KG_MIN,
  WEIGHT_KG_MAX
} from "../training/lifestyle.js";

const RHYTHM_LABELS = { start: "开始", train: "训练日", rest: "休息日", done: "已完成" };
const PLACEHOLDER_ROWS = [
  { label: "穿搭管理", desc: "穿搭记录与建议——下一批上线" }
];
const SKINCARE_RECENT_WINDOW = 7;
const SKINCARE_CHECKBOXES = [
  { session: "am", item: "cleanser", label: "温和洁面" },
  { session: "am", item: "moisturizer", label: "保湿" },
  { session: "am", item: "sunscreen", label: "防晒（强制）" },
  { session: "pm", item: "cleanser", label: "温和洁面" },
  { session: "pm", item: "moisturizer", label: "保湿修复" }
];

export function renderLifestyle() {
  const panel = $("lifestylePanel");
  if (!panel) return;
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

  panel.innerHTML = `<details class="mistakes-box lifestyle-box" open>
    <summary>生活管理<span class="mistake-count">健身 · 护肤 · 穿搭</span></summary>
    <div class="lifestyle-fitness">
      <div class="lifestyle-rhythm">
        <span class="lifestyle-rhythm-status is-${escapeHtml(rhythm.status)}">${escapeHtml(RHYTHM_LABELS[rhythm.status] || rhythm.status)}</span>
        <span class="lifestyle-rhythm-message">${escapeHtml(rhythm.message)}</span>
        <button class="btn small primary" type="button" data-lifestyle-action="train-today" ${trainedToday ? "disabled" : ""}>${trainedToday ? "今日已练" : "完成今日训练"}</button>
      </div>
      <div class="lifestyle-streak">连续训练 <b>${escapeHtml(String(streak))}</b> 天${recentTrainings.length ? `<span class="lifestyle-recent">最近：${recentTrainings.map((item) => escapeHtml(item?.date || "")).join("、")}</span>` : ""}</div>
      <div class="lifestyle-weight">
        <div class="lifestyle-weight-row">
          <b>体重记录</b>
          <input type="number" id="lifestyleWeightInput" step="0.1" min="${escapeHtml(String(WEIGHT_KG_MIN))}" max="${escapeHtml(String(WEIGHT_KG_MAX))}" placeholder="公斤（30–200）" aria-label="今日体重">
          <button class="btn small" type="button" data-lifestyle-action="record-weight">记录体重</button>
        </div>
        <p class="lifestyle-trend is-${escapeHtml(review.trend)}">${escapeHtml(review.suggestion)}</p>
        ${recentWeights.length ? `<table class="lifestyle-weight-table"><thead><tr><th>日期</th><th>公斤</th></tr></thead><tbody>
          ${recentWeights.map((item) => `<tr><td>${escapeHtml(item?.date || "")}</td><td>${escapeHtml(formatKg(item?.kg))}</td></tr>`).join("")}
        </tbody></table>` : '<p class="mistake-empty">还没有体重记录。建议每周固定条件称重一次（同一时间、空腹）。</p>'}
      </div>
      <details class="lifestyle-plan">
        <summary>训练计划卡（全身 A/B 交替 · 练一天休一天）</summary>
        <div class="lifestyle-plan-body">
          <b>训练日 A · 下肢 + 推</b>
          <ul>
            <li>杠铃后蹲 3×8</li>
            <li>倒蹬腿举 3×12</li>
            <li>杠铃卧推 3×8</li>
            <li>杠铃坐姿肩推 3×10</li>
            <li>哑铃侧平举 3×15</li>
            <li>绳索下压 3×12</li>
            <li>平板支撑 3×45 秒</li>
          </ul>
          <b>训练日 B · 髋铰链 + 拉</b>
          <ul>
            <li>罗马尼亚硬拉 3×8</li>
            <li>宽握高位下拉 3×10</li>
            <li>杠铃俯身划船 3×10</li>
            <li>俯卧腿弯举 3×12</li>
            <li>上斜哑铃卧推 3×10</li>
            <li>哑铃弯举 3×12</li>
            <li>哑铃农夫行走 3×30 米（可选）</li>
          </ul>
          <p class="note">排法：A → 休 → B → 休 循环交替。组间休息：复合动作 2–3 分钟，孤立动作 60–90 秒。每组结束保留 2–3 次余力。</p>
        </div>
      </details>
      <div class="lifestyle-safety">
        <b>安全约束</b>
        <ul>
          <li>训练强度 RPE 6–7，不做力竭</li>
          <li>硬拉类动作先降级（罗马尼亚硬拉可降至空杆或暂停），大重量一律用助力带 / 安全架或找人保护</li>
          <li>补水 3L 以上，训练日再额外补充</li>
        </ul>
        <p class="lifestyle-redline">⚠ 红线信号：异常肌痛 / 肌无力 / 酱油色尿——提示横纹肌溶解风险，立即停训就医。</p>
        <p class="note">既定安全约束提醒，以医生与正式计划文档为准。</p>
      </div>
    </div>
    <div class="lifestyle-skincare">
      <b>护肤管理</b>
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
        <summary>异维A酸护理要点（既定安全约束）</summary>
        <div class="lifestyle-plan-body">
          <ul>
            <li>防晒为强制项：每日早间防晒必须记录，漏记会在上方持续警示</li>
            <li>温和洁面 + 保湿修复，避免去角质 / 磨砂 / 蜡疗类项目</li>
            <li>禁用维A类补充剂；服药期间禁酒</li>
            <li>补水 3L 以上；复查血脂 / 肝功时主动交代饮食背景</li>
          </ul>
        </div>
      </details>
      <p class="lifestyle-redline">⚠ 红线信号：严重皲裂 / 异常肌痛 / 酱油色尿——立即停用并就医。</p>
      <p class="note">既定安全约束提醒，以医嘱为准。</p>
    </div>
    ${PLACEHOLDER_ROWS.map((row) => `<div class="lifestyle-placeholder"><span>${escapeHtml(row.label)}</span><span class="mistake-empty">${escapeHtml(row.desc)}</span></div>`).join("")}
  </details>`;

  panel.querySelectorAll("button[data-lifestyle-action]").forEach((button) => {
    button.addEventListener("click", () => handleLifestyleAction(button.dataset.lifestyleAction));
  });
  panel.querySelectorAll("input[data-skincare-item]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => handleSkincareToggle(checkbox));
  });
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

/** 本地日期字符串 YYYY-MM-DD（与训练/体重条目的 date 口径一致） */
function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** 本地日期字符串加减天数（跨月安全，UTC 日序号换算不受时区偏移影响） */
function shiftDate(base, deltaDays) {
  const [year, month, day] = String(base).split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return base;
  const date = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
