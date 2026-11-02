import { ABILITY_DIMENSIONS, ABILITY_RUBRIC_VERSION } from "./ability-rubric.js";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasOwn = (value, key) => isObject(value) && Object.hasOwn(value, key);
const indicatorIds = ABILITY_DIMENSIONS.flatMap((dimension) => dimension.indicators.map((indicator) => indicator.id));
const dimensionIds = new Set(ABILITY_DIMENSIONS.map((dimension) => dimension.id));
const MAX_HISTORY = 30;
let sequence = 0;

function empty(consent = false) {
  return { schemaVersion: 1, rubricVersion: ABILITY_RUBRIC_VERSION, consent, answers: {}, scenarioAnswers: {}, firstScenarioAnswers: {}, focus: [], history: [] };
}

function validLevel(value) {
  // 不把空白、布尔值和数值字符串转换成“已观察到的零分”。
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4;
}

function normalizeAnswers(value) {
  const result = {};
  for (const id of indicatorIds) if (hasOwn(value, id) && validLevel(value[id])) result[id] = value[id];
  return result;
}

function scenarioOption(dimension, value) {
  return typeof value === "string" ? dimension.scenario.options.find((option) => option.id === value) : undefined;
}

function normalizeScenarios(value) {
  const result = {};
  for (const dimension of ABILITY_DIMENSIONS) {
    const id = dimension.scenario.id;
    if (hasOwn(value, id) && scenarioOption(dimension, value[id])) result[id] = value[id];
  }
  return result;
}

function normalizeFocus(value) {
  return Array.isArray(value) ? [...new Set(value.filter((id) => typeof id === "string" && dimensionIds.has(id)))].slice(0, 2) : [];
}

function clock(value) {
  const time = value instanceof Date ? value.getTime() : value;
  if (typeof time !== "number" || !Number.isFinite(time) || time < 0 || Number.isNaN(new Date(time).getTime())) throw new TypeError("评估时间无效");
  return Math.floor(time);
}

function timestamp(value, now) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time < 0 || time > now) return null;
  const canonical = new Date(time).toISOString();
  return canonical.replace(".000Z", "Z") === value.replace(".000Z", "Z") ? canonical : null;
}

function snapshotId(value) {
  return typeof value === "string" && /^ability_[a-z0-9_-]{1,96}$/.test(value) ? value : null;
}

function sameAnswers(left, right) {
  return JSON.stringify(left.answers) === JSON.stringify(right.answers) && JSON.stringify(left.scenarioAnswers) === JSON.stringify(right.scenarioAnswers);
}

function boundedHistory(history) {
  return history.length <= MAX_HISTORY ? history : [history[0], ...history.slice(-(MAX_HISTORY - 1))];
}

function normalize(value, now) {
  const state = empty(isObject(value) && value.consent === true);
  if (!isObject(value) || value.schemaVersion !== 1 || value.rubricVersion !== ABILITY_RUBRIC_VERSION) return state;
  state.answers = normalizeAnswers(value.answers);
  state.scenarioAnswers = normalizeScenarios(value.scenarioAnswers);
  state.firstScenarioAnswers = normalizeScenarios(value.firstScenarioAnswers);
  state.focus = normalizeFocus(value.focus);
  const ids = new Set();
  const imported = Array.isArray(value.history) ? value.history : [];
  // 首条基线始终参与规范化；对异常大的导入只读取首条与最近119条。
  const candidates = imported.length <= 120 ? imported : [imported[0], ...imported.slice(-119)];
  for (const entry of candidates) {
    if (!isObject(entry) || entry.rubricVersion !== ABILITY_RUBRIC_VERSION) continue;
    const id = snapshotId(entry.id);
    const createdAt = timestamp(entry.createdAt, now);
    if (!id || !createdAt || ids.has(id)) continue;
    const answers = normalizeAnswers(entry.answers);
    const scenarioAnswers = normalizeScenarios(entry.scenarioAnswers);
    if (Object.keys(answers).length + Object.keys(scenarioAnswers).length === 0) continue;
    ids.add(id);
    state.history.push({ id, createdAt, rubricVersion: ABILITY_RUBRIC_VERSION, answers, scenarioAnswers });
  }
  state.history.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  // 兼容缺少首次答案字段的当前版本备份；不把新版本的题目当作旧题目。
  for (const entry of state.history) {
    for (const [id, answer] of Object.entries(entry.scenarioAnswers)) if (!Object.hasOwn(state.firstScenarioAnswers, id)) state.firstScenarioAnswers[id] = answer;
  }
  for (const [id, answer] of Object.entries(state.scenarioAnswers)) if (!Object.hasOwn(state.firstScenarioAnswers, id)) state.firstScenarioAnswers[id] = answer;
  state.history = boundedHistory(state.history);
  return state;
}

export function normalizeAbilityAssessment(value) {
  return normalize(value, Date.now());
}

export function toPersistedAbilityAssessment(value) {
  const state = normalizeAbilityAssessment(value);
  return state.consent ? state : empty(false);
}

export function setAbilityConsent(value, granted) {
  return granted === true ? { ...normalizeAbilityAssessment(value), consent: true } : empty(false);
}

export function setAbilityFocus(value, ids) {
  return { ...normalizeAbilityAssessment(value), focus: normalizeFocus(ids) };
}

export function recordAbilityAssessment(value, input, { now = Date.now() } = {}) {
  const time = clock(now);
  const state = normalize(value, time);
  const answers = normalizeAnswers(isObject(input) ? input.answers : null);
  const scenarioAnswers = normalizeScenarios(isObject(input) ? input.scenarioAnswers : null);
  if (Object.keys(answers).length + Object.keys(scenarioAnswers).length === 0) throw new TypeError("请至少完成一项自评或情境题");
  if (sameAnswers(state, { answers, scenarioAnswers })) return state;
  const firstScenarioAnswers = { ...state.firstScenarioAnswers };
  for (const [id, answer] of Object.entries(scenarioAnswers)) if (!Object.hasOwn(firstScenarioAnswers, id)) firstScenarioAnswers[id] = answer;
  const usedIds = new Set(state.history.map((entry) => entry.id));
  let id;
  do {
    sequence = (sequence + 1) % Number.MAX_SAFE_INTEGER;
    id = `ability_${time.toString(36)}_${sequence.toString(36)}`;
  } while (usedIds.has(id));
  const entry = { id, createdAt: new Date(time).toISOString(), rubricVersion: ABILITY_RUBRIC_VERSION, answers: { ...answers }, scenarioAnswers: { ...scenarioAnswers } };
  return { ...state, answers, scenarioAnswers, firstScenarioAnswers, history: boundedHistory([...state.history, entry]) };
}

function grade(total, coverage, criticalGaps) {
  if (criticalGaps.length) return "关键知识待补";
  if (coverage.answered === 0) return "待评估";
  if (total === null) return "评估待补全";
  if (total < 40) return "基础起步";
  if (total < 60) return "正在建立";
  if (total < 80) return "基本稳定";
  return "表现熟练";
}

function profileFor(state) {
  const criticalGaps = [];
  const dimensions = ABILITY_DIMENSIONS.map((dimension) => {
    const evidence = dimension.indicators.flatMap((indicator) => {
      if (!Object.hasOwn(state.answers, indicator.id)) return [];
      const level = state.answers[indicator.id];
      return [{ id: indicator.id, type: "indicator", label: indicator.label, level, score: level * 25, source: "self", attempt: "first", feedback: dimension.anchors[level].description }];
    });
    const scenario = dimension.scenario;
    const option = scenarioOption(dimension, state.scenarioAnswers[scenario.id]);
    if (option) {
      const firstOption = scenarioOption(dimension, state.firstScenarioAnswers?.[scenario.id]);
      const retry = firstOption && (firstOption.id !== option.id || state.history?.some((entry) => Object.hasOwn(entry.scenarioAnswers, scenario.id) && entry.scenarioAnswers[scenario.id] !== firstOption.id));
      evidence.push({ id: scenario.id, type: "scenario", label: scenario.prompt, level: option.level, score: option.level * 25, source: "scenario", attempt: retry ? "retry" : "first", optionId: option.id, optionLabel: option.label, feedback: option.feedback, firstOptionId: firstOption?.id ?? option.id, firstLevel: firstOption?.level ?? option.level });
      if (option.critical) criticalGaps.push({ dimensionId: dimension.id, scenarioId: scenario.id, label: dimension.label, feedback: option.feedback });
    }
    return { id: dimension.id, label: dimension.label, score: evidence.length ? Math.round(evidence.reduce((sum, item) => sum + item.score, 0) / evidence.length) : null, coverage: { answered: evidence.length, total: 3 }, evidence, nextAction: dimension.nextAction, targetView: dimension.targetView };
  });
  const answered = dimensions.reduce((sum, dimension) => sum + dimension.coverage.answered, 0);
  const coverage = { answered, total: 24, percent: Math.round(answered / 24 * 100) };
  // 总分只在各维均有完整证据时计算，避免用一项高分代表整个画像。
  const total = answered === 24 ? Math.round(dimensions.reduce((sum, dimension) => sum + dimension.evidence.reduce((subtotal, item) => subtotal + item.score, 0) / 3, 0) / dimensions.length) : null;
  return { total, grade: grade(total, coverage, criticalGaps), coverage, dimensions, criticalGaps };
}

export function buildAbilityProfile(value, { now = Date.now() } = {}) {
  const state = normalize(value, clock(now));
  const profile = profileFor(state);
  return {
    rubricVersion: ABILITY_RUBRIC_VERSION, ...profile, focus: [...state.focus],
    history: state.history.map((entry) => {
      const snapshot = profileFor({ ...entry, firstScenarioAnswers: {}, history: [] });
      return { id: entry.id, createdAt: entry.createdAt, total: snapshot.total, grade: snapshot.grade, coverage: snapshot.coverage, dimensions: snapshot.dimensions.map(({ id, score, coverage }) => ({ id, score, coverage })) };
    }),
    provisional: true
  };
}
