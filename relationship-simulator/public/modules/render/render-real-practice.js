import { $, escapeHtml } from "../core/dom.js";
import { getState, mutate } from "../core/state.js";
import { readIntakeProfile } from "../core/intake-profile.js";
import { PRACTICE_PLANS, getPracticePlan, recommendPracticePlan } from "../training/practice-plans.js";
import { PRACTICE_OPTIONS, normalizePracticeState, recordPracticeOutcome, reflectPracticeRecord, setPracticeConsent, shanghaiDate, updatePracticeOutcome } from "../training/real-practice.js";

const DECISIONS = { OBSERVE: "继续观察", MAINTAIN: "保持当前节奏", DE_ESCALATE: "降低投入", EXIT: "停止本次推进" };
const CALIBRATION = { unknown: "目标结果仍未知", supported: "本次观察支持原目标", notConfirmed: "原目标尚未得到支持" };
const FIELD_LABELS = { expected: "行动前的观察目标", attempt: "是否实际尝试", response: "可观察的回应", comfort: "自己的相处感受", expression: "自己的表达", regulation: "自己的生活与恢复", boundary: "双方边界" };
const formDrafts = new Map(); // 本页枚举选择，不参与持久化。
let lastDraftKey = null;
let editingRecordId = null;
let clearDraftOnRender = false;
let nextRound = null;

/** 重置/恢复档案时由应用调用；只清临时输入，不修改已保存复盘。 */
export function resetRealPracticeDrafts() {
  formDrafts.clear();
  lastDraftKey = null;
  editingRecordId = null;
  clearDraftOnRender = true;
  nextRound = null;
}

function select(field, editing) {
  return `<label>${FIELD_LABELS[field]}<select id="practice-${field}"><option value="">${editing ? "保留原记录" : "请选择；不清楚时保留未知"}</option>${Object.entries(PRACTICE_OPTIONS[field]).map(([key, text]) => `<option value="${key}">${escapeHtml(text)}</option>`).join("")}</select></label>`;
}

function summaryFields(record) {
  return `<dl>${Object.entries(FIELD_LABELS).map(([field, label]) => `<dt>${label}</dt><dd>${escapeHtml(PRACTICE_OPTIONS[field][record[field]])}</dd>`).join("")}</dl>`;
}

function historyEntry(record, index) {
  const reflection = reflectPracticeRecord(record);
  return `<details class="practice-history-entry"${index === 0 ? " open" : ""}>
    <summary>${escapeHtml(getPracticePlan(record.planId).label)} · ${escapeHtml(record.date)} · 上海时间${record.history.length ? " · 已更新，保留此前观察" : ""}</summary>
    ${summaryFields(record)}<strong>${escapeHtml(DECISIONS[reflection.decision])}</strong><p>${escapeHtml(reflection.observation)}</p><p>${escapeHtml(reflection.nextAction)}</p><small>${escapeHtml(CALIBRATION[reflection.calibration])}</small>
    ${record.history.length ? `<details><summary>此前观察（${record.history.length}个版本，含原观察与停止信号）</summary>${record.history.map((snapshot, version) => `<article><b>${version === 0 ? "原观察" : `此前版本 ${version + 1}`} · ${escapeHtml(snapshot.date)}</b>${summaryFields(snapshot)}</article>`).join("")}</details>` : ""}
    <p><button class="btn small" type="button" data-practice-edit="${escapeHtml(record.id)}">补充这条记录</button></p>
  </details>`;
}

function nextRoundFor(record) {
  const reflection = reflectPracticeRecord(record);
  if (["EXIT", "DE_ESCALATE"].includes(reflection.decision)) return { planId: "uncertainty", reason: "这条互动需要停止或降低投入，下一轮先练习照顾自己的情绪与生活。" };
  return { planId: record.planId, reason: record.attempt === "done" ? "先根据本次观察准备一个可退、可结束的小动作；没有新的互惠依据时继续观察。" : "先完成不依赖现实机会的准备练习，有合适条件时再行动。" };
}

export function renderRealPractice() {
  const panel = $("realPracticePanel");
  if (!panel) return;
  if (clearDraftOnRender) formDrafts.delete(lastDraftKey);
  else if (lastDraftKey) {
    const draft = { date: $("practice-date")?.value ?? "" };
    for (const field of Object.keys(PRACTICE_OPTIONS)) draft[field] = $(`practice-${field}`)?.value ?? "";
    formDrafts.set(lastDraftKey, draft);
  }
  clearDraftOnRender = false;
  const practice = normalizePracticeState(getState().relationshipPractice);
  const recommendation = recommendPracticePlan(readIntakeProfile());
  const selectedPlan = getPracticePlan(practice.planId);
  const editing = practice.records.find((record) => record.id === editingRecordId) || null;
  if (!editing) editingRecordId = null;
  const plan = editing ? getPracticePlan(editing.planId) : selectedPlan;
  const draftKey = editing ? `edit:${editing.id}` : plan ? `new:${plan.id}` : null;
  const today = shanghaiDate();
  const nextPlan = getPracticePlan(nextRound?.planId);
  panel.innerHTML = `<section class="practice-card" aria-label="现实练习与复盘">
    <div class="daily-head"><strong>现实练习与复盘</strong><span>按你当前的卡点练</span></div>
    <label>现在最想改善什么？<select id="practicePlanSelect"><option value="">选择当前卡点</option>${PRACTICE_PLANS.map((item) => `<option value="${item.id}"${item.id === practice.planId ? " selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select></label>
    ${!plan && recommendation ? `<p class="note">行为自检建议：${escapeHtml(getPracticePlan(recommendation.id).label)}。${escapeHtml(recommendation.reason)} 你可以选择其他方向。</p>` : ""}
    <p class="note">只记录类别，不填写姓名或聊天原文。练习质量与对方意愿分别观察。不同互动可以分别新增匿名事件。</p>
    ${plan ? `<div class="practice-plan"><h3>${escapeHtml(plan.goal)}</h3><p><b>准备练习：</b>${escapeHtml(plan.exercise)}</p><p><b>现实行动：</b>${escapeHtml(plan.realAction)}</p><p><b>观察什么：</b>${escapeHtml(plan.observe)}</p><p><b>停止条件：</b>${escapeHtml(plan.stopCondition)}</p><p class="note">对应课程：${plan.courseNumbers.map((number) => `<a href="/love-learning.html?course=${number}" target="_blank" rel="noopener">第${number}课</a>`).join("、")}</p></div>
    <form id="practiceOutcomeForm" class="practice-form"><h3>${editing ? `补充旧事件：${escapeHtml(plan.label)} · ${escapeHtml(editing.date)}` : "新增一次现实练习"}</h3>${editing ? `<p class="note">空白或未知项保留原值，明确更新会保留此前观察（最多5个版本）。新增互动请取消补充后另记一条。</p>` : `<p class="note">每次提交新增独立记录，同一天同一卡点也不会覆盖此前结果。</p>`}<div class="practice-form-grid"><label>这次互动的日期（上海时间）<input id="practice-date" type="date" max="${today}" value="${editing?.date || today}"${editing ? "" : " required"}></label>${Object.keys(FIELD_LABELS).map((field) => select(field, Boolean(editing))).join("")}</div><button class="btn small" type="submit">${editing ? "保存补充并复盘" : "新增记录并复盘"}</button>${editing ? `<button class="btn small" id="cancelPracticeEdit" type="button">取消补充</button>` : ""}<p id="practiceOutcomeError" role="alert"></p></form>` : ""}
    ${nextPlan ? `<aside class="practice-next-round"><strong>下一轮准备建议：${escapeHtml(nextPlan.label)}</strong><p>${escapeHtml(nextRound.reason)}</p><p>${escapeHtml(nextPlan.exercise)}</p><button class="btn small" type="button" id="usePracticeNextRound">选择这个方向准备</button><p class="note">可以改选其他方向；准备建议不要求再次联系已拒绝的对象。</p></aside>` : ""}
    <label class="practice-consent"><input id="practiceSaveConsent" type="checkbox"${practice.consent ? " checked" : ""}>将结构化复盘保存在此浏览器</label>
    <p class="note">默认只保留在本页，刷新后清空。开启后保存最多30个匿名事件；关闭会清除已有复盘。</p>
    <div class="practice-history"><p>复盘记录：${practice.records.length}条。展开任一记录查看全部类别与此前版本。</p>${[...practice.records].reverse().map(historyEntry).join("")}</div>${practice.records.length ? `<button class="btn small" id="clearPracticeRecords" type="button">清除复盘记录</button>` : ""}
  </section>`;
  lastDraftKey = draftKey;
  const draft = formDrafts.get(draftKey) || editing;
  if (plan && draft) {
    if ($("practice-date") && draft.date) $("practice-date").value = draft.date;
    for (const field of Object.keys(PRACTICE_OPTIONS)) if ($(`practice-${field}`)) $(`practice-${field}`).value = draft[field] || "";
  }
  $("practicePlanSelect")?.addEventListener("change", (event) => {
    editingRecordId = null;
    nextRound = null;
    mutate((state) => { state.relationshipPractice = { ...normalizePracticeState(state.relationshipPractice), planId: getPracticePlan(event.target.value)?.id ?? null }; });
  });
  $("practiceSaveConsent")?.addEventListener("change", (event) => {
    const granted = event.target.checked;
    if (!granted) {
      editingRecordId = null;
      nextRound = null;
      for (const key of formDrafts.keys()) if (key.startsWith("edit:")) formDrafts.delete(key);
      if (lastDraftKey?.startsWith("edit:")) clearDraftOnRender = true;
    }
    mutate((state) => { state.relationshipPractice = setPracticeConsent(state.relationshipPractice, granted); });
  });
  $("clearPracticeRecords")?.addEventListener("click", () => {
    editingRecordId = null;
    for (const key of formDrafts.keys()) if (key.startsWith("edit:")) formDrafts.delete(key);
    if (lastDraftKey?.startsWith("edit:")) clearDraftOnRender = true;
    mutate((state) => { state.relationshipPractice = { ...normalizePracticeState(state.relationshipPractice), records: [] }; });
  });
  panel.querySelectorAll("[data-practice-edit]").forEach((button) => button.addEventListener("click", () => {
    editingRecordId = button.dataset.practiceEdit;
    renderRealPractice();
  }));
  $("cancelPracticeEdit")?.addEventListener("click", () => {
    editingRecordId = null;
    clearDraftOnRender = true;
    renderRealPractice();
  });
  $("usePracticeNextRound")?.addEventListener("click", () => {
    editingRecordId = null;
    mutate((state) => { state.relationshipPractice = { ...normalizePracticeState(state.relationshipPractice), planId: nextPlan.id }; });
  });
  $("practiceOutcomeForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = { planId: plan.id, date: $("practice-date")?.value ?? today };
    for (const field of Object.keys(PRACTICE_OPTIONS)) input[field] = $(`practice-${field}`)?.value;
    try {
      const updated = editing
        ? updatePracticeOutcome(getState().relationshipPractice, editing.id, input)
        : recordPracticeOutcome(getState().relationshipPractice, input);
      const record = editing ? updated.records.find((item) => item.id === editing.id) : updated.records.at(-1);
      nextRound = nextRoundFor(record);
      editingRecordId = null;
      clearDraftOnRender = true;
      mutate((state) => { state.relationshipPractice = updated; });
    } catch (error) { $("practiceOutcomeError").textContent = error.message; }
  });
}
