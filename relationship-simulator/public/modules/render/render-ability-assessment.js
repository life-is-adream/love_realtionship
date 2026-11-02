import { $, escapeHtml } from "../core/dom.js";
import { getState, mutate } from "../core/state.js";
import { ABILITY_DIMENSIONS, ABILITY_LEVELS } from "../training/ability-rubric.js";
import { normalizeAbilityAssessment, setAbilityConsent, recordAbilityAssessment, buildAbilityProfile, setAbilityFocus } from "../training/ability-assessment.js";
import { buildAbilityContext } from "../training/ability-context.js";

const TRAINING_VIEWS = new Set(["lifestyle", "chat", "real", "journey", "practice"]);
const SOURCE_LABELS = { self: "自评", selfReport: "自评", scenario: "情境练习" };
let formDraft = null;
let skipCapture = false;
let formOpen = false;
let expandedDimension = null;

/** 恢复或重置档案后清除未提交输入，下一次渲染从当前档案读取。 */
export function resetAbilityAssessmentDrafts() {
  formDraft = null;
  skipCapture = true;
  formOpen = false;
  expandedDimension = null;
}

function readAnswers() {
  const answers = {};
  const scenarioAnswers = {};
  for (const dimension of ABILITY_DIMENSIONS) {
    for (const indicator of dimension.indicators) {
      const value = $(`ability-answer-${indicator.id}`)?.value ?? "";
      answers[indicator.id] = /^[0-4]$/.test(value) ? Number(value) : "";
    }
    const option = dimension.scenario.options.find((item) => $(`ability-scenario-${dimension.scenario.id}-${item.id}`)?.checked);
    scenarioAnswers[dimension.scenario.id] = option?.id ?? "";
  }
  return { answers, scenarioAnswers };
}

function captureDraft() {
  if (!$("abilityAssessmentForm")) return;
  formDraft = readAnswers();
  formOpen = $("abilityAssessmentEditor")?.open ?? formOpen;
}

function dateLabel(value) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  return `${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date)} · 上海时间`;
}

function scoreLabel(score) { return Number.isFinite(score) ? `${score} / 100` : "待评估"; }

function evidenceItem(item) {
  if (typeof item === "string") return `<li>${escapeHtml(item)}</li>`;
  const source = SOURCE_LABELS[item.type] || SOURCE_LABELS[item.source] || "本次评估";
  const attempt = item.attempt === "retry" ? ` · 重试，首次答案仍保留${Number.isFinite(item.firstLevel) ? `（首次 ${item.firstLevel} / 4 级）` : ""}` : item.type === "scenario" ? " · 首次作答" : "";
  const level = Number.isFinite(item.level) ? ` · ${item.level} / 4 级` : " · 未作答";
  return `<li><b>${escapeHtml(item.label)}</b><small>${escapeHtml(source + attempt + level)}</small>${item.optionLabel ? `<p>本次选择：${escapeHtml(item.optionLabel)}</p>` : ""}${item.feedback ? `<p>${escapeHtml(item.feedback)}</p>` : ""}</li>`;
}

function dimensionRow(dimension, focus, context) {
  const coverage = dimension.coverage;
  const checked = focus.includes(dimension.id);
  const target = TRAINING_VIEWS.has(dimension.targetView) ? dimension.targetView : "practice";
  return `<details class="ability-dimension" data-ability-dimension="${dimension.id}"${dimension.id === expandedDimension ? " open" : ""}>
    <summary><span>${escapeHtml(dimension.label)}</span><b>${scoreLabel(dimension.score)}</b><small>已答 ${coverage.answered} / ${coverage.total}</small></summary>
    <div class="ability-dimension-body"><p class="note">分项基于已答项目；缺项不作零分。此处显示的是自评与题目表现，现实能力仍需复核。</p>
    ${dimension.evidence?.length ? `<ul class="ability-evidence">${dimension.evidence.map(evidenceItem).join("")}</ul>` : `<p>尚无评估依据。</p>`}
    <p class="note ability-reality-context"><b>现实复核材料：</b>${context ? escapeHtml(`${context.source} · ${context.detail}`) : "暂无可用于复核的结构化记录。"}${!context?.count ? " 当前仍未复核。" : " 记录数量不改变分数或题目覆盖度。"}</p>
    <p><b>下一步：</b>${escapeHtml(dimension.nextAction)}</p>
    <div class="ability-row-actions"><label><input type="checkbox" id="ability-focus-${dimension.id}" data-ability-focus="${dimension.id}"${checked ? " checked" : ""}${focus.length >= 2 && !checked ? " disabled" : ""}>选为训练重点</label><a href="#${target}">进入相关练习</a></div></div>
  </details>`;
}

function assessmentForm(draft) {
  return `<details id="abilityAssessmentEditor" class="ability-editor"${formOpen ? " open" : ""}><summary>开始 / 更新评估 <small>16 项自评 · 8 道情境题</small></summary>
    <form id="abilityAssessmentForm"><p class="note">根据近期真实表现选择；不清楚时保留“待评估”。各题不计累计积分，重试不代表现实能力已经提升。</p>
    <details class="ability-level-guide"><summary>查看 0–4 级行为标准</summary><ul>${ABILITY_LEVELS.map((level) => `<li><b>${level.value} 级 · ${escapeHtml(level.label)}</b>：${escapeHtml(level.description)}</li>`).join("")}</ul></details>
    ${ABILITY_DIMENSIONS.map((dimension, index) => `<fieldset class="ability-question-group"><legend>${index + 1}. ${escapeHtml(dimension.label)}</legend><p class="note">${escapeHtml(dimension.description)}</p><details class="ability-level-guide"><summary>这个维度如何选择级别</summary><ul>${(dimension.anchors || ABILITY_LEVELS).map((level) => `<li><b>${level.value} 级</b>：${escapeHtml(level.description)}</li>`).join("")}</ul></details><div class="ability-self-fields">${dimension.indicators.map((indicator) => `<label for="ability-answer-${indicator.id}">${escapeHtml(indicator.label)}<select id="ability-answer-${indicator.id}"><option value="">待评估 / 不清楚</option>${ABILITY_LEVELS.map((level) => `<option value="${level.value}"${String(draft.answers[indicator.id] ?? "") === String(level.value) ? " selected" : ""}>${level.value} · ${escapeHtml(level.label)}</option>`).join("")}</select></label>`).join("")}</div>
    <fieldset class="ability-scenario"><legend>情境练习：${escapeHtml(dimension.scenario.prompt)}</legend><label class="ability-option"><input type="radio" name="ability-${dimension.scenario.id}" id="ability-scenario-${dimension.scenario.id}-unknown" value=""${!draft.scenarioAnswers[dimension.scenario.id] ? " checked" : ""}>暂不作答 / 不清楚</label>${dimension.scenario.options.map((option) => `<label class="ability-option"><input type="radio" name="ability-${dimension.scenario.id}" id="ability-scenario-${dimension.scenario.id}-${option.id}" value="${option.id}"${draft.scenarioAnswers[dimension.scenario.id] === option.id ? " checked" : ""}>${escapeHtml(option.label)}</label>`).join("")}</fieldset></fieldset>`).join("")}
    <div class="ability-form-actions"><button type="submit" class="btn small">提交并查看画像</button><p class="note">允许部分提交；24 项全覆盖后才显示综合分。</p></div></form></details>`;
}

function historySummary(history) {
  if (!history.length) return `<p class="note">尚无复评记录。首次提交会保留为基线，之后可比较同一规则下的变化。</p>`;
  const first = history[0];
  const latest = history[history.length - 1];
  const delta = Number.isFinite(first.total) && Number.isFinite(latest.total) ? latest.total - first.total : null;
  const scoreChange = delta === null ? "覆盖不足，暂不比较综合分" : `综合分变化：${delta > 0 ? "+" : ""}${delta}`;
  return `<details class="ability-history"><summary>基线与最近一次 · ${history.length} 次评估</summary><p>首次：${escapeHtml(dateLabel(first.createdAt))} · ${scoreLabel(first.total)} · 已答 ${first.coverage.answered} / ${first.coverage.total}</p><p>最近：${escapeHtml(dateLabel(latest.createdAt))} · ${scoreLabel(latest.total)} · 已答 ${latest.coverage.answered} / ${latest.coverage.total}</p><p>${escapeHtml(scoreChange)}。自评变化与题目熟悉度会影响结果，请结合现实复盘。</p><div class="ability-history-table"><table><thead><tr><th scope="col">维度</th><th scope="col">首次</th><th scope="col">最近</th></tr></thead><tbody>${ABILITY_DIMENSIONS.map((dimension) => `<tr><th scope="row">${escapeHtml(dimension.label)}</th><td>${scoreLabel(first.dimensions.find((item) => item.id === dimension.id)?.score)}</td><td>${scoreLabel(latest.dimensions.find((item) => item.id === dimension.id)?.score)}</td></tr>`).join("")}</tbody></table></div></details>`;
}

function showError(message) { const error = $("abilityAssessmentError"); if (error) error.textContent = message; }

function updateAssessment(transform) {
  try {
    mutate((state) => {
      state.learning.abilityAssessment = transform(state.learning.abilityAssessment);
    });
    showError("");
    return true;
  } catch (error) {
    // 提交失败时保留表单；状态事务保证旧画像不被部分覆盖。
    showError(error instanceof RangeError || error instanceof TypeError ? `评估未更新：${error.message}` : "评估未更新，浏览器未能保存。请检查存储空间后重试。");
    return false;
  }
}

export function renderAbilityAssessment() {
  const panel = $("abilityAssessmentPanel");
  if (!panel) return;
  if (!skipCapture) captureDraft();
  skipCapture = false;
  const assessment = normalizeAbilityAssessment(getState().learning?.abilityAssessment);
  const profile = buildAbilityProfile(assessment);
  const context = buildAbilityContext(getState());
  const draft = formDraft || { answers: { ...assessment.answers }, scenarioAnswers: { ...assessment.scenarioAnswers } };
  formDraft = draft;
  if (!expandedDimension) expandedDimension = profile.focus[0] || profile.dimensions[0]?.id;
  panel.innerHTML = `<section class="ability-assessment" aria-label="个人恋爱能力画像"><div class="ability-overview"><div><p class="ability-kicker">个人恋爱能力画像</p><h2>${Number.isFinite(profile.total) ? `${profile.total} / 100` : "综合分待评估"}</h2><p>${escapeHtml(profile.grade)} · 初步画像</p></div><div class="ability-coverage"><b>证据覆盖度 ${profile.coverage.percent}%</b><span>已答 ${profile.coverage.answered} / ${profile.coverage.total} 项</span></div></div>
    <p class="note">这套产品训练规则基于你的自评与情境作答，尚未作为科学量表验证；不测量对方好感、医学健康或真实声音表现。现实技能需要实践复核。</p>
    <p class="note">${assessment.history.length ? "下方画像对应最近一次提交，表单中的编辑尚未计入。" : "先做一次初评，再选择最多两个训练重点。待评估项不记为零分。"}${profile.coverage.answered < profile.coverage.total ? " 24 项全覆盖后才显示综合分。" : ""}</p>
    ${profile.criticalGaps.length ? `<aside class="ability-critical" role="status"><b>优先补齐关键边界与知识</b><ul>${profile.criticalGaps.map((gap) => `<li>${escapeHtml(gap.label)}：${escapeHtml(gap.feedback)}</li>`).join("")}</ul></aside>` : ""}
    <div class="ability-dimensions">${profile.dimensions.map((dimension) => dimensionRow(dimension, profile.focus, context.find((item) => item.id === dimension.id))).join("")}</div><p class="note">已选训练重点 ${profile.focus.length} / 2；选择只用于安排练习，不改变分数。</p>
    ${assessmentForm(draft)}
    <div class="ability-data-controls"><label><input id="abilitySaveConsent" type="checkbox"${assessment.consent ? " checked" : ""}>将匿名评估保存在此浏览器</label><p class="note">默认只保留在本页，刷新后清空。仅记录枚举选择，不收集姓名、照片、声音或聊天原文。关闭保存会清空已有评估，未提交输入继续留在本页。</p><button id="clearAbilityAssessment" class="btn small ghost" type="button">清除评估数据与输入</button></div>
    <p id="abilityAssessmentError" role="alert"></p>${historySummary(profile.history)}</section>`;

  panel.querySelectorAll("[data-ability-dimension]").forEach((details) => details.addEventListener("toggle", () => {
    if (!details.open) { if (expandedDimension === details.dataset.abilityDimension) expandedDimension = null; return; }
    expandedDimension = details.dataset.abilityDimension;
    panel.querySelectorAll("[data-ability-dimension]").forEach((other) => { if (other !== details) other.open = false; });
  }));
  $("abilityAssessmentEditor")?.addEventListener("toggle", (event) => { formOpen = event.target.open; });
  $("abilityAssessmentForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    captureDraft();
    updateAssessment((value) => recordAbilityAssessment(value, formDraft));
  });
  for (const dimension of ABILITY_DIMENSIONS) $("ability-focus-" + dimension.id)?.addEventListener("change", (event) => {
    const current = normalizeAbilityAssessment(getState().learning?.abilityAssessment);
    const focus = event.target.checked ? [...current.focus, dimension.id] : current.focus.filter((id) => id !== dimension.id);
    if (!updateAssessment((value) => setAbilityFocus(value, focus))) event.target.checked = current.focus.includes(dimension.id);
  });
  $("abilitySaveConsent")?.addEventListener("change", (event) => {
    const granted = event.target.checked;
    if (!updateAssessment((value) => setAbilityConsent(value, granted))) event.target.checked = normalizeAbilityAssessment(getState().learning?.abilityAssessment).consent;
  });
  $("clearAbilityAssessment")?.addEventListener("click", () => {
    const savedDraft = formDraft;
    const savedOpen = formOpen;
    resetAbilityAssessmentDrafts();
    if (!updateAssessment((value) => setAbilityConsent(setAbilityConsent(value, false), normalizeAbilityAssessment(value).consent))) {
      formDraft = savedDraft;
      formOpen = savedOpen;
      skipCapture = false;
    }
  });
}
