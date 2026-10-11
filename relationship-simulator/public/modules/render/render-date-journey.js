import { $, escapeHtml } from "../core/dom.js";
import {
  DATE_JOURNEY_STAGES, DATE_JOURNEY_SCENARIOS, createDateJourney, getDateJourneyScene, getDateJourneySummary,
  submitDateJourneyResponse, retryDateJourneyResponse, recordDateJourneyObservation,
  advanceDateJourney, beginDateJourneyFollowup, stopDateJourney, invalidateDateJourneyResponse
} from "../training/date-journey.js";

// 模拟会话、练习原文和反馈均仅保留在本页面模块内存。
// 不写 getState()/mutate()/localStorage，不进入聊天、画像、日志或远程请求。
let journey = createDateJourney();
let draft = "";
let reviewedDraft = "";
let selectedBranch = "";
let notice = "";

const STAGE_LABELS = ["初识", "见面相处", "约会后", "再次邀约", "表达好感", "关系协商"];
const DECISION_LABELS = { ADVANCE: "可以探索下一步", MAINTAIN: "保持当前节奏", OBSERVE: "保留未知，继续观察", DE_ESCALATE: "降低投入", EXIT: "停止本次探索" };

/** 清理本模块的临时会话和原文；由 app.resetSession 在 renderAll 前调用。 */
export function resetDateJourney(scenarioId = "gallery") {
  journey = createDateJourney(scenarioId);
  draft = ""; reviewedDraft = ""; selectedBranch = ""; notice = "";
}

export function buildDateJourneyHtml(session, currentDraft = "", message = "", selection = "") {
  const scene = getDateJourneyScene(session);
  const summary = getDateJourneySummary(session);
  const feedback = session.lastFeedback;
  const complete = summary.complete;
  const canSelect = session.status === "active" && !session.observation && feedback?.hasResponse && feedback.current !== false;
  const feedbackHtml = feedback ? `<div class="date-journey-feedback" role="status" aria-live="polite"><strong>表达反馈 · 第 ${session.attempts} 次检查</strong>
    <p id="dateJourneyReviewStatus">${feedback.current === false ? "草稿已修改，这份反馈已失效；先重新检查当前表达。" : "这份反馈对应当前已提交的练习表达。"}</p>
    ${feedback.strengths.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
    <ul>${feedback.improvements.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    ${feedback.comparison ? `<p>${escapeHtml(feedback.comparison)}</p>` : ""}
    <small>本地启发式只能检查部分表达特征，不是完整安全审查，不能预测对方反应或证明现实效果。</small></div>` : "";
  const observationsHtml = canSelect ? `<fieldset class="date-journey-observations"><legend>选择模拟中的对方回应</legend><p class="note">这是一条情境分支，不是对真人内心的判断。确认后会保留，重练表达不会覆盖它。每条分支都是有效结局、也各有代价；本轮结束后可以看到这条路你得到了什么、放弃了什么。</p>
    ${scene.responses.map((item) => `<label><input type="radio" name="dateJourneyBranch" value="${item.branch}" ${selection === item.branch ? "checked" : ""}><span><b>${escapeHtml(item.label)}</b>${escapeHtml(item.observation)}</span></label>`).join("")}
    <button class="btn small" type="button" data-journey-action="observe">确认这条模拟回应</button></fieldset>` : "";
  const historyHtml = summary.observations.length ? `<details class="date-journey-history"><summary>已保留 ${summary.observations.length} 条模拟观察</summary><ol>${summary.observations.map((item) => `<li><b>${escapeHtml(item.stageTitle)}：${escapeHtml(item.label)}${item.kind === "followup" ? "（新的主动回应）" : ""}</b><p>${escapeHtml(item.observation)}</p></li>`).join("")}</ol></details>` : "";
  const tradeoff = summary.tradeoff;
  const tradeoffHtml = tradeoff ? `<div class="date-journey-tradeoff"><p class="note">每一种结局都是有效结果，不计分、不进错题本；下面只是帮你把这条路看得更清楚。</p>
    <p><b>这条路你得到了</b></p><ul>${tradeoff.gains.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    <p><b>它同时意味着放弃</b></p><ul>${tradeoff.costs.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    ${tradeoff.note.map((item) => `<p class="note">${escapeHtml(item)}</p>`).join("")}</div>` : "";
  return `<section class="date-journey-card" aria-label="连续约会训练">
    <div class="daily-head"><strong>连续约会训练</strong><span>${complete ? "本轮完成" : `${scene.index + 1} / ${DATE_JOURNEY_STAGES.length}`}</span></div>
    <p class="note">虚构成人场景 · 先自己回复，再看反馈、重练和选择回应。练习内容只留在本页面，刷新即清空。</p>
    <label for="dateJourneyScenario">选择练习场景（更换会开始新一轮）</label><select id="dateJourneyScenario">${DATE_JOURNEY_SCENARIOS.map((item) => `<option value="${item.id}" ${item.id === scene.scenarioId ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select>
    <ol class="date-journey-steps">${STAGE_LABELS.map((label, index) => `<li ${index === scene.index ? 'aria-current="step"' : ""} class="${index < scene.index ? "is-done" : index === scene.index ? "is-current" : ""}">${escapeHtml(label)}</li>`).join("")}</ol>
    ${complete ? `<div class="date-journey-summary"><strong>六段模拟已经完成</strong><p>这一分支里，双方通过明确表达和安排达成了一致。现实中仍要观察兼容性、兑现承诺与双方感受。</p></div>` : `<h3>${escapeHtml(scene.title)}</h3>
    <p>${escapeHtml(scene.context)}</p>
    <p class="date-journey-task">${escapeHtml(scene.task)}</p>
    <p class="note">练习重点：${escapeHtml(scene.focus)}</p>
    <details class="date-journey-evidence"><summary>已有事实、反证和未知</summary><p>此前事实：${escapeHtml(scene.previousEvidence)}</p>${scene.currentEvidence ? `<p>本阶段已记录的回应：${escapeHtml(scene.currentEvidence)}</p>` : ""}<p>反证与替代解释：${escapeHtml(scene.counterEvidence)}</p>${scene.unknowns.map((item) => `<p>未知：${escapeHtml(item)}</p>`).join("")}</details>
    <label for="dateJourneyDraft">${summary.stopped ? "练习体面收尾（可选）" : "先写下你会怎么回应"}</label>
    <textarea id="dateJourneyDraft" rows="3" maxlength="1200" placeholder="用自己的话写，不需要标准答案。">${escapeHtml(currentDraft)}</textarea>
    <div class="date-journey-actions"><button class="btn small" type="button" data-journey-action="critique">${feedback?.hasResponse ? "按反馈重练并比较" : "查看表达反馈"}</button>${!summary.stopped ? '<button class="btn ghost small" type="button" data-journey-action="stop">我决定不继续这段探索</button>' : ""}</div>
    ${feedbackHtml}${observationsHtml}`}
    <div class="date-journey-summary" aria-live="polite"><strong>${escapeHtml(DECISION_LABELS[summary.decision] || "继续观察")}</strong><p>${escapeHtml(summary.message)}</p>
      ${tradeoffHtml}
      ${summary.canAdvance ? `<button class="btn small" type="button" data-journey-action="advance">${scene.index === DATE_JOURNEY_STAGES.length - 1 ? "完成本轮复盘" : "进入下一段情境"}</button>` : ""}
      ${summary.canObserveFollowup ? '<p class="note">改写回复不会带来新证据。可以先停在这里；若要练习后续分支，只模拟对方主动补充回应，不追加追问。</p><button class="btn small" type="button" data-journey-action="followup">模拟后来收到一条主动回应</button>' : ""}
    </div>
    ${historyHtml}
    <p id="dateJourneyNotice" class="date-journey-notice" role="status">${escapeHtml(message)}</p>
    <button class="btn ghost small" type="button" data-journey-action="restart">开始另一轮虚构情境</button>
  </section>`;
}

export function renderDateJourney(target = $("dateJourneyPanel")) {
  if (!target) return;
  target.innerHTML = buildDateJourneyHtml(journey, draft, notice, selectedBranch);
  target.querySelector("#dateJourneyScenario")?.addEventListener("change", (event) => {
    resetDateJourney(event.target.value);
    renderDateJourney(target);
  });
  target.querySelector("#dateJourneyDraft")?.addEventListener("input", (event) => {
    draft = event.target.value.slice(0, 1200);
    reviewedDraft = "";
    journey = invalidateDateJourneyResponse(journey);
    selectedBranch = "";
    if (journey.lastFeedback) {
      notice = "草稿已修改，先重新检查当前表达，再选择模拟回应。";
      const feedbackStatus = target.querySelector("#dateJourneyReviewStatus");
      if (feedbackStatus) feedbackStatus.textContent = "草稿已修改，这份反馈已失效；先重新检查当前表达。";
      const noticeNode = target.querySelector("#dateJourneyNotice");
      if (noticeNode) noticeNode.textContent = notice;
      // 不重建输入框，保留正在输入时的焦点和光标。
      target.querySelectorAll('input[name="dateJourneyBranch"]').forEach((input) => { input.checked = false; input.disabled = true; });
      const observeButton = target.querySelector('button[data-journey-action="observe"]');
      if (observeButton) observeButton.disabled = true;
      const advanceButton = target.querySelector('button[data-journey-action="advance"]');
      if (advanceButton) advanceButton.disabled = true;
    }
  });
  target.querySelectorAll('input[name="dateJourneyBranch"]').forEach((input) => input.addEventListener("change", (event) => { selectedBranch = event.target.value; }));
  target.querySelectorAll("button[data-journey-action]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.journeyAction;
    notice = "";
    if (action === "critique") {
      journey = journey.lastFeedback?.hasResponse ? retryDateJourneyResponse(journey, draft) : submitDateJourneyResponse(journey, draft);
      reviewedDraft = draft;
      selectedBranch = "";
    } else if (action === "observe") {
      if (journey.lastFeedback?.current === false || draft !== reviewedDraft) notice = "草稿已修改，旧反馈不能确认推进；先重新检查当前表达。";
      else if (!selectedBranch) notice = "先选择一条模拟回应。";
      else {
        const next = recordDateJourneyObservation(journey, selectedBranch);
        if (!next.observation) notice = "先按反馈重练，去掉风险措辞或读心定论，再确认推进分支。明确拒绝或不合适仍会立即停止。";
        else if (next.status === "stopped") { draft = ""; reviewedDraft = ""; }
        journey = next;
      }
    } else if (action === "advance") {
      const next = advanceDateJourney(journey);
      if (next.stageIndex === journey.stageIndex && next.status === journey.status) notice = "先重新检查当前表达，完成必要的重练，再进入下一段情境。";
      else { draft = ""; reviewedDraft = ""; selectedBranch = ""; }
      journey = next;
    } else if (action === "followup") {
      journey = beginDateJourneyFollowup(journey);
      draft = ""; reviewedDraft = ""; selectedBranch = "";
    } else if (action === "stop") {
      journey = stopDateJourney(journey);
      draft = ""; reviewedDraft = ""; selectedBranch = "";
    } else if (action === "restart") {
      resetDateJourney(journey.scenarioId);
    }
    renderDateJourney(target);
  }));
}
