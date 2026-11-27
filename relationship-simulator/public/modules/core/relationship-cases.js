import { createAnonymousCaseId } from "../intelligence/state.js";
import { redactSensitiveText } from "./privacy.js";
import { shanghaiDate } from "./date.js";

const CASE_ID = /^case_[a-f0-9]{16}$/;
const ENTRY_ID = /^entry_[a-f0-9]{16}$/;
const SCORE_ID = /^score_[a-f0-9]{16}$/;
const MAX_CASES = 12;
const MAX_ENTRIES = 30;
const RUBRIC_VERSIONS = ["1.1.0", "2.1.0"];
const DIMENSIONS = ["listening", "clarity", "boundary", "naturalness", "conflict"];
const SCENARIOS = ["first-meeting", "low-energy-reply", "low-pressure-invitation", "conflict-repair", "breakup-recovery"];
const record = (value) => value && typeof value === "object" && !Array.isArray(value);
const safeText = (value, max) => redactSensitiveText(String(value || "")).text.trim().slice(0, max);

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  const [year, month, day] = value.split("-").map(Number);
  return Number.isFinite(parsed.getTime()) && parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
}

function normalizeEntry(value, now) {
  if (!record(value) || !ENTRY_ID.test(String(value.id || "")) || !validDate(value.date) || value.date > shanghaiDate(now)) return null;
  const observation = safeText(value.observation, 300);
  if (!observation) return null;
  return {
    id: value.id,
    date: value.date,
    observation,
    hypothesis: safeText(value.hypothesis, 300),
    outcome: safeText(value.outcome, 300)
  };
}

function normalizeAssessment(value, now) {
  if (!record(value) || !SCORE_ID.test(String(value.id || "")) || !validDate(value.date) || value.date > shanghaiDate(now) ||
      !RUBRIC_VERSIONS.includes(value.rubricVersion) || !SCENARIOS.includes(value.scenarioId) || !record(value.dimensions)) return null;
  const dimensions = {};
  for (const id of DIMENSIONS) {
    const score = value.dimensions[id];
    if (Number.isInteger(score) && score >= 0 && score <= 4) dimensions[id] = score;
  }
  return Object.keys(dimensions).length ? { id: value.id, date: value.date, scenarioId: value.scenarioId, rubricVersion: value.rubricVersion, dimensions } : null;
}

export function normalizeRelationshipCases(value, now = new Date()) {
  const input = record(value) && value.schemaVersion === 1 ? value : {};
  const seen = new Set();
  const cases = [];
  for (const item of (Array.isArray(input.cases) ? input.cases : []).slice(0, MAX_CASES)) {
    if (!record(item) || !CASE_ID.test(String(item.id || "")) || seen.has(item.id)) continue;
    const label = safeText(item.label, 40);
    if (!label) continue;
    seen.add(item.id);
    const consent = item.consent === true;
    const eventIds = new Set();
    const events = consent ? (Array.isArray(item.events) ? item.events : []).map((event) => normalizeEntry(event, now)).filter((event) => {
      if (!event || eventIds.has(event.id)) return false;
      eventIds.add(event.id); return true;
    }).slice(-MAX_ENTRIES) : [];
    const assessmentIds = new Set();
    const assessments = consent ? (Array.isArray(item.assessments) ? item.assessments : []).map((entry) => normalizeAssessment(entry, now)).filter((entry) => {
      if (!entry || assessmentIds.has(entry.id)) return false;
      assessmentIds.add(entry.id); return true;
    }).slice(-MAX_ENTRIES) : [];
    const memory = consent ? safeText(item.memory, 600) : "";
    cases.push({ id: item.id, label, consent, events, assessments, memory });
  }
  return { schemaVersion: 1, activeId: cases.some((item) => item.id === input.activeId) ? input.activeId : null, cases };
}

export function toPersistedRelationshipCases(value) {
  return normalizeRelationshipCases(value);
}

export function createRelationshipCase(value, label, id = createAnonymousCaseId()) {
  const state = normalizeRelationshipCases(value);
  const name = safeText(label, 40);
  if (!name) throw new TypeError("请输入便于自己识别的匿名名称。");
  if (!CASE_ID.test(id) || state.cases.some((item) => item.id === id)) throw new TypeError("无法创建独立档案，请重试。");
  if (state.cases.length >= MAX_CASES) throw new TypeError("最多保存 12 个关系档案。");
  return { ...state, activeId: id, cases: [...state.cases, { id, label: name, consent: false, events: [], assessments: [], memory: "" }] };
}

export function selectRelationshipCase(value, id) {
  const state = normalizeRelationshipCases(value);
  if (!id) return { ...state, activeId: null };
  if (!state.cases.some((item) => item.id === id)) throw new TypeError("关系档案不存在。");
  return { ...state, activeId: id };
}

export function setCaseConsent(value, id, granted) {
  const state = normalizeRelationshipCases(value);
  if (!state.cases.some((item) => item.id === id)) throw new TypeError("关系档案不存在。");
  return { ...state, cases: state.cases.map((item) => item.id === id
    ? { ...item, consent: granted === true, events: granted === true ? item.events : [], assessments: granted === true ? item.assessments : [], memory: granted === true ? item.memory : "" }
    : item) };
}

export function deleteRelationshipCase(value, id) {
  const state = normalizeRelationshipCases(value);
  const cases = state.cases.filter((item) => item.id !== id);
  return { ...state, cases, activeId: state.activeId === id ? null : state.activeId };
}

export function addCaseEvent(value, id, input, now = new Date(), eventId = "entry_" + createAnonymousCaseId().slice(5)) {
  const state = normalizeRelationshipCases(value, now);
  const target = state.cases.find((item) => item.id === id);
  if (!target?.consent) throw new TypeError("请先允许保存该档案的结构化复盘。");
  const event = normalizeEntry({ ...input, id: eventId }, now);
  if (!event) throw new TypeError("请填写有效日期和可观察的事实。");
  if (target.events.some((item) => item.id === event.id)) throw new TypeError("记录标识重复，请重试。");
  return { ...state, cases: state.cases.map((item) => item.id === id ? { ...item, events: [...item.events, event].slice(-MAX_ENTRIES) } : item) };
}

export function deleteCaseEvent(value, id, eventId) {
  const state = normalizeRelationshipCases(value);
  return { ...state, cases: state.cases.map((item) => item.id === id ? { ...item, events: item.events.filter((event) => event.id !== eventId) } : item) };
}

export function addCaseAssessment(value, id, scenarioId, evaluation, now = new Date(), assessmentId = "score_" + createAnonymousCaseId().slice(5)) {
  const state = normalizeRelationshipCases(value, now);
  const target = state.cases.find((item) => item.id === id);
  if (!target?.consent) throw new TypeError("请先选择关系档案并允许保存复盘。");
  const dimensions = {};
  for (const item of Array.isArray(evaluation?.dimensions) ? evaluation.dimensions : []) {
    if (DIMENSIONS.includes(item.id) && item.status === "scored" && Number.isInteger(item.score) && item.score >= 0 && item.score <= 4) dimensions[item.id] = item.score;
  }
  const assessment = normalizeAssessment({ id: assessmentId, date: shanghaiDate(now), scenarioId, rubricVersion: evaluation?.rubric_version, dimensions }, now);
  if (!assessment) throw new TypeError("本次练习没有可保存的规则评分。");
  if (target.assessments.some((item) => item.id === assessment.id)) throw new TypeError("记录标识重复，请重试。");
  return { ...state, cases: state.cases.map((item) => item.id === id ? { ...item, assessments: [...item.assessments, assessment].slice(-MAX_ENTRIES) } : item) };
}

export function deleteCaseAssessment(value, id, assessmentId) {
  const state = normalizeRelationshipCases(value);
  return { ...state, cases: state.cases.map((item) => item.id === id ? { ...item, assessments: item.assessments.filter((entry) => entry.id !== assessmentId) } : item) };
}

export function setCaseMemory(value, id, summary) {
  const state = normalizeRelationshipCases(value);
  const target = state.cases.find((item) => item.id === id);
  if (!target?.consent) throw new TypeError("请先允许保存该档案的结构化复盘。");
  return { ...state, cases: state.cases.map((item) => item.id === id ? { ...item, memory: safeText(summary, 600) } : item) };
}
