/**
 * F3 入学测试入口卡 UI：学习/成长区域内（错题本上方）的「入学测试」卡片。
 *
 * 惯例对齐：
 * - render-* 模块由 app.js renderLearningPanels 链挂载；全部插值过 escapeHtml；
 * - 画像键 'heartflow-intake-profile' 是主 state 之外的独立键：
 *   读取经 core/intake-profile.js 的 readIntakeProfile（坏键自动清）；
 *   清除直接 localStorage.removeItem（合法，非主 mutate 写路径）；
 * - 清除确认复用 RESET_CONFIRMATION 的 globalThis.confirm 防误触模式；
 * - 「开始/重新测试」新开 /intake-quiz.html（同源独立页，样式保持 quiz 自身风格）。
 */

import { $, escapeHtml } from "../core/dom.js";
import { STORAGE_KEYS } from "../core/config.js";
import { readIntakeProfile, buildIntakeSummary } from "../core/intake-profile.js";

const QUIZ_URL = "/intake-quiz.html";
const CLEAR_CONFIRMATION = "确认清除已保存的入学测试画像？\n\n清除后主应用将不再显示基线画像，且不可恢复（quiz 页可重新测试并保存）。\n\n继续？";

export function renderIntake() {
  const panel = $("intakePanel");
  if (!panel) return;
  const profile = readIntakeProfile();

  if (!profile) {
    panel.innerHTML = `<div class="intake-card">
      <div class="intake-head"><strong>入学测试</strong><span>15 个微信情境 · 约 5 分钟</span></div>
      <p class="intake-hint">还没做过入学测试。完成 15 个情境选择，生成你的恋爱沟通画像，作为失误雷达与成长档案的对照基线。</p>
      <div class="intake-actions"><button class="btn small" id="intakeOpenQuizBtn" type="button">开始入学测试</button></div>
    </div>`;
  } else {
    panel.innerHTML = `<div class="intake-card">
      <div class="intake-head"><strong>入学测试</strong><span>完成于 ${escapeHtml(profile.testDate)} · ${escapeHtml(String(profile.questions))} 题</span></div>
      <p class="intake-baseline">基线画像：${escapeHtml(buildIntakeSummary(profile))}</p>
      <div class="intake-actions">
        <button class="btn small" id="intakeOpenQuizBtn" type="button">重新测试</button>
        <button class="btn small ghost" id="intakeClearBtn" type="button">清除画像</button>
      </div>
    </div>`;
  }

  $("intakeOpenQuizBtn")?.addEventListener("click", () => {
    globalThis.open?.(QUIZ_URL, "_blank");
  });
  $("intakeClearBtn")?.addEventListener("click", clearIntakeProfile);
}

function clearIntakeProfile() {
  if (globalThis.confirm?.(CLEAR_CONFIRMATION) !== true) return;
  try {
    localStorage.removeItem(STORAGE_KEYS.intakeProfile);
  } catch {
    // localStorage 不可用时静默：下一帧渲染会按无画像处理
  }
  renderIntake();
  if ($("apiStatus")) $("apiStatus").textContent = "入学测试画像已清除。";
}
