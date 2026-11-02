/**
 * 关系进度可视化（Lovekey 亲密度滑块的启发）。
 *
 * 把 7 个训练阶段映射为可感知的关系进度条：当前阶段、已解锁节点、
 * 百分比。纯函数，不依赖 DOM；渲染由 render-progress.js 负责。
 */
import { RELATIONSHIP_STAGES } from "../core/stages.js";
import { escapeHtml } from "../core/dom.js";

/** 阶段总数（固定 7，与 stages.js 保持一致） */
export const STAGE_TOTAL = RELATIONSHIP_STAGES.length;

/**
 * 根据当前阶段值计算进度信息。
 * @param {string} stageValue 当前阶段（须为合法阶段值；非法则按未开始处理）
 * @returns {{index: number, total: number, percent: number, unlocked: string[], current: string, stages: string[]}}
 */
export function buildStageProgress(stageValue) {
  const values = RELATIONSHIP_STAGES.map((stage) => stage.value);
  const index = values.indexOf(stageValue);
  const currentIndex = index >= 0 ? index : -1;
  return {
    index: currentIndex,
    total: STAGE_TOTAL,
    percent: currentIndex >= 0 ? Math.round(((currentIndex + 1) / STAGE_TOTAL) * 100) : 0,
    unlocked: currentIndex >= 0 ? values.slice(0, currentIndex + 1) : [],
    current: currentIndex >= 0 ? values[currentIndex] : "",
    stages: values
  };
}

/**
 * 生成进度条的 HTML 片段（纯字符串，供渲染模块使用；已做转义）。
 * @param {string} stageValue
 * @returns {string}
 */
export function buildStageProgressHtml(stageValue) {
  const { index, total, percent, stages } = buildStageProgress(stageValue);
  const dots = stages.map((stage, i) => {
    const state = i < index ? "done" : i === index ? "active" : "todo";
    const title = escapeHtml(stage);
    return `<span class="stage-dot ${state}" title="${title}" aria-label="${title}"></span>`;
  }).join("");
  const label = index >= 0 ? escapeHtml(stages[index]) : "未选择阶段";
  return `<div class="stage-progress" role="img" aria-label="关系进度 ${percent}%">
    <div class="stage-progress-bar"><div class="stage-progress-fill" style="width:${percent}%"></div></div>
    <div class="stage-progress-dots">${dots}</div>
    <div class="stage-progress-label">${label} · ${index + 1}/${total}</div>
  </div>`;
}
