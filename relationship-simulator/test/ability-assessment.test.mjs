import test from "node:test";
import assert from "node:assert/strict";
import { ABILITY_DIMENSIONS, ABILITY_LEVELS, ABILITY_RUBRIC_VERSION } from "../public/modules/training/ability-rubric.js";
import { buildAbilityProfile, normalizeAbilityAssessment, recordAbilityAssessment, setAbilityConsent, setAbilityFocus, toPersistedAbilityAssessment } from "../public/modules/training/ability-assessment.js";

const now = Date.parse("2020-10-13T08:00:00Z");
const firstDimension = ABILITY_DIMENSIONS[0];
const indicatorId = firstDimension.indicators[0].id;
const boundaryDimension = ABILITY_DIMENSIONS.find((dimension) => dimension.id === "boundaries");
const healthDimension = ABILITY_DIMENSIONS.find((dimension) => dimension.id === "knowledge");
const empty = () => normalizeAbilityAssessment(null);
const evaluate = (state, input, time = now) => recordAbilityAssessment(state, input, { now: time });
const profile = (state, time = now) => buildAbilityProfile(state, { now: time });
const allAnswers = (level = 4) => ({
  answers: Object.fromEntries(ABILITY_DIMENSIONS.flatMap((dimension) => dimension.indicators.map((indicator) => [indicator.id, level]))),
  scenarioAnswers: Object.fromEntries(ABILITY_DIMENSIONS.map((dimension) => [dimension.scenario.id, dimension.scenario.options.find((option) => option.level === 4).id]))
});

test("rubric exposes eight fixed dimensions and 24 enum-only assessment items", () => {
  assert.deepEqual(ABILITY_DIMENSIONS.map((dimension) => dimension.id), ["appearance", "voice", "communication", "emotion", "dating", "boundaries", "reliability", "knowledge"]);
  assert.deepEqual(ABILITY_LEVELS.map((level) => level.value), [0, 1, 2, 3, 4]);
  const ids = [];
  for (const dimension of ABILITY_DIMENSIONS) {
    assert.equal(dimension.indicators.length, 2);
    assert.deepEqual(dimension.anchors.map((level) => level.value), [0, 1, 2, 3, 4]);
    assert.equal(new Set(dimension.anchors.map((level) => level.description)).size, 5);
    assert.deepEqual(dimension.scenario.options.map((option) => option.level), [0, 1, 2, 4]);
    assert.equal(new Set(dimension.scenario.options.map((option) => option.id)).size, 4);
    assert.ok(["lifestyle", "chat", "real", "journey", "practice"].includes(dimension.targetView));
    for (const option of dimension.scenario.options) assert.equal(typeof option.feedback, "string");
    ids.push(...dimension.indicators.map((indicator) => indicator.id), dimension.scenario.id);
  }
  assert.equal(new Set(ids).size, 24);
  assert.throws(() => { firstDimension.indicators.push({ id: "wrong" }); }, TypeError);
});

test("unknown is not zero: null, whitespace, booleans and numeric strings cannot score", () => {
  for (const value of [null, "", " ", false, true, "0", "4", NaN, Infinity, -1, 5, 1.5, {}, []]) {
    const state = normalizeAbilityAssessment({ ...empty(), answers: { [indicatorId]: value } });
    const result = profile(state);
    assert.deepEqual(state.answers, {});
    assert.equal(result.total, null);
    assert.equal(result.dimensions[0].score, null);
    assert.equal(result.coverage.answered, 0);
  }
  const state = evaluate(null, { answers: { [indicatorId]: 0 } });
  assert.equal(state.answers[indicatorId], 0);
  assert.equal(profile(state).dimensions[0].score, 0);
  assert.equal(profile(state).coverage.answered, 1);
});

test("empty or invalid-only submissions are rejected even when older answers exist", () => {
  const state = evaluate(null, { answers: { [indicatorId]: 4 } });
  for (const input of [null, {}, { answers: {} }, { answers: { [indicatorId]: null } }, { scenarioAnswers: { [firstDimension.scenario.id]: "unknown" } }]) {
    assert.throws(() => evaluate(state, input), /至少完成/);
  }
});

test("incomplete assessment displays answered coverage but never substitutes a total", () => {
  const partial = evaluate(null, { answers: { [indicatorId]: 4 } });
  const result = profile(partial);
  assert.equal(result.total, null);
  assert.equal(result.grade, "评估待补全");
  assert.deepEqual(result.coverage, { answered: 1, total: 24, percent: 4 });
  assert.deepEqual(result.dimensions[0].coverage, { answered: 1, total: 3 });
  assert.equal(result.dimensions[0].score, 100);
  assert.equal(result.provisional, true);
  const selfOnly = allAnswers();
  delete selfOnly.scenarioAnswers;
  assert.equal(profile(evaluate(null, selfOnly)).total, null);
  assert.equal(profile(evaluate(null, selfOnly)).coverage.answered, 16);
});

test("all 24 current answers have equal item weight and dimension weight", () => {
  const input = allAnswers(2);
  input.answers[indicatorId] = 0;
  input.scenarioAnswers[firstDimension.scenario.id] = firstDimension.scenario.options.find((option) => option.level === 2).id;
  const result = profile(evaluate(null, input));
  assert.equal(result.total, 63);
  assert.equal(result.dimensions[0].score, 33);
  assert.deepEqual(result.coverage, { answered: 24, total: 24, percent: 100 });
  assert.equal(profile(evaluate(null, allAnswers())).total, 100);
});

test("critical boundary or health answers block an otherwise high grade", () => {
  for (const dimension of [boundaryDimension, healthDimension, firstDimension]) {
    const input = allAnswers();
    input.scenarioAnswers[dimension.scenario.id] = dimension.scenario.options.find((option) => option.critical).id;
    const result = profile(evaluate(null, input));
    assert.ok(result.total > 80);
    assert.equal(result.grade, "关键知识待补");
    assert.equal(result.criticalGaps.length, 1);
    assert.equal(result.criticalGaps[0].dimensionId, dimension.id);
    assert.equal(typeof result.criticalGaps[0].feedback, "string");
  }
  const partial = evaluate(null, { scenarioAnswers: { [boundaryDimension.scenario.id]: boundaryDimension.scenario.options[0].id } });
  assert.equal(profile(partial).total, null);
  assert.equal(profile(partial).grade, "关键知识待补");
});

test("identical submissions do not create history or award accumulated points", () => {
  const first = evaluate(null, allAnswers());
  const repeated = evaluate(first, allAnswers(), now + 1000);
  assert.deepEqual(repeated, first);
  assert.equal(repeated.history.length, 1);
  assert.equal(profile(repeated, now + 1000).total, 100);
  assert.equal(profile(repeated, now + 1000).coverage.answered, 24);
});

test("new assessment is the current snapshot, not the accumulation of previous answers", () => {
  const first = evaluate(null, allAnswers());
  const second = evaluate(first, { answers: { [indicatorId]: 1 } }, now + 1000);
  assert.deepEqual(second.answers, { [indicatorId]: 1 });
  assert.deepEqual(second.scenarioAnswers, {});
  const result = profile(second, now + 1000);
  assert.equal(result.total, null);
  assert.equal(result.coverage.answered, 1);
  assert.equal(result.history.length, 2);
  assert.equal(result.history[0].total, 100);
  assert.equal(result.history[1].total, null);
});

test("first scenario answer remains visible after retries and is not the current score", () => {
  const id = boundaryDimension.scenario.id;
  const wrong = boundaryDimension.scenario.options[0].id;
  const correct = boundaryDimension.scenario.options[3].id;
  const first = evaluate(null, { scenarioAnswers: { [id]: wrong } });
  assert.equal(profile(first).dimensions.find((dimension) => dimension.id === "boundaries").evidence[0].attempt, "first");
  const second = evaluate(first, { scenarioAnswers: { [id]: correct } }, now + 1000);
  const result = profile(second, now + 1000);
  const evidence = result.dimensions.find((dimension) => dimension.id === "boundaries").evidence[0];
  assert.equal(second.firstScenarioAnswers[id], wrong);
  assert.equal(evidence.firstOptionId, wrong);
  assert.equal(evidence.firstLevel, 0);
  assert.equal(evidence.level, 4);
  assert.equal(evidence.attempt, "retry");
  assert.equal(result.criticalGaps.length, 0);
  const returned = evaluate(second, { scenarioAnswers: { [id]: wrong } }, now + 2000);
  assert.equal(profile(returned, now + 2000).dimensions.find((dimension) => dimension.id === "boundaries").evidence[0].attempt, "retry");
});

test("focus is a unique allowlisted selection of at most two dimensions", () => {
  const state = setAbilityFocus(null, ["boundaries", "boundaries", "unknown", null, "emotion", "voice", "constructor"]);
  assert.deepEqual(state.focus, ["boundaries", "emotion"]);
  assert.deepEqual(profile(state).focus, ["boundaries", "emotion"]);
  assert.deepEqual(setAbilityFocus(state, null).focus, []);
});

test("persistence without consent clears all assessment data but leaves live values intact", () => {
  const state = setAbilityFocus(evaluate(null, allAnswers()), ["voice", "emotion"]);
  const before = structuredClone(state);
  const stored = toPersistedAbilityAssessment(state);
  assert.deepEqual(stored, empty());
  assert.deepEqual(state, before);
  const granted = setAbilityConsent(state, true);
  assert.equal(toPersistedAbilityAssessment(granted).history.length, 1);
  assert.equal(granted.consent, true);
  assert.deepEqual(setAbilityConsent(granted, false), empty());
  assert.deepEqual(setAbilityConsent(granted, "true"), empty());
});

test("incompatible, missing and future schemas or rubrics cannot inherit scores", () => {
  const state = setAbilityConsent(evaluate(null, allAnswers()), true);
  for (const change of [{ schemaVersion: 2 }, { schemaVersion: "1" }, { schemaVersion: undefined }, { rubricVersion: "future" }, { rubricVersion: undefined }]) {
    const normalized = normalizeAbilityAssessment({ ...state, ...change });
    assert.equal(normalized.consent, true);
    assert.deepEqual(normalized.answers, {});
    assert.deepEqual(normalized.scenarioAnswers, {});
    assert.equal(normalized.history.length, 0);
    assert.equal(profile(normalized).total, null);
  }
});

test("history drops invalid/future timestamps, unknown versions and duplicate ids", () => {
  const state = evaluate(null, allAnswers());
  const good = state.history[0];
  state.history = [
    good, { ...good }, { ...good, id: "ability_invalid", createdAt: "2020-02-30T08:00:00Z" },
    { ...good, id: "ability_future", createdAt: "2099-01-01T00:00:00.000Z" },
    { ...good, id: "ability_bad", createdAt: "not-a-date" },
    { ...good, id: "ability_old", rubricVersion: "legacy" },
    { ...good, id: "<script>" },
    { ...good, id: "ability_blank", answers: {}, scenarioAnswers: {} }
  ];
  assert.equal(normalizeAbilityAssessment(state).history.length, 1);
  assert.equal(profile(state).history.length, 1);
  const notYet = { ...state, history: [{ ...good, id: "ability_tomorrow", createdAt: new Date(now + 1000).toISOString() }] };
  assert.equal(profile(notYet).history.length, 0);
  for (const invalid of [null, "2020-10-13", NaN, Infinity, -1]) assert.throws(() => evaluate(null, allAnswers(), invalid), /时间无效/);
});

test("bounded history retains the baseline and latest 29 snapshots plus the first scenario answer", () => {
  let state = evaluate(null, { scenarioAnswers: { [boundaryDimension.scenario.id]: boundaryDimension.scenario.options[0].id } });
  for (let index = 1; index <= 35; index += 1) {
    state = evaluate(state, { answers: { [indicatorId]: index % 5 }, scenarioAnswers: { [boundaryDimension.scenario.id]: boundaryDimension.scenario.options[3].id } }, now + index * 1000);
  }
  assert.equal(state.history.length, 30);
  assert.equal(state.history[0].createdAt, new Date(now).toISOString());
  assert.equal(state.history[1].createdAt, new Date(now + 7000).toISOString());
  assert.equal(state.history.at(-1).createdAt, new Date(now + 35000).toISOString());
  assert.equal(state.firstScenarioAnswers[boundaryDimension.scenario.id], boundaryDimension.scenario.options[0].id);
  assert.equal(profile(state, now + 35000).coverage.answered, 2);
  const imported = { ...state, history: Array.from({ length: 150 }, (_, index) => ({ ...state.history[0], id: `ability_import_${index}`, createdAt: new Date(now + index * 1000).toISOString() })) };
  const normalized = normalizeAbilityAssessment(imported);
  assert.equal(normalized.history.length, 30);
  assert.equal(normalized.history[0].createdAt, new Date(now).toISOString());
  assert.equal(normalized.history[1].createdAt, new Date(now + 121000).toISOString());
});

test("imported calculated scores, chat metrics, free text and prototype keys are ignored", () => {
  const input = allAnswers(0);
  input.scenarioAnswers = {};
  const state = evaluate(null, input);
  const normalized = normalizeAbilityAssessment({
    ...state, total: 100, dimensions: [{ score: 100 }], rawText: "private-message", personName: "private-name",
    answers: { ...state.answers, unknown: 4, constructor: 4 },
    scenarioAnswers: { constructor: "private-message" },
    history: state.history.map((entry) => ({ ...entry, total: 100, score: 100, rawText: "private-message" })),
    trainingEvents: [{ dimension: "communication", score: 100 }]
  });
  assert.equal(JSON.stringify(normalized).includes("private-"), false);
  assert.equal(Object.hasOwn(normalized.answers, "constructor"), false);
  assert.equal(profile(normalized).dimensions[0].score, 0);
  assert.equal(profile(normalized).total, null);
  assert.equal(profile(normalized).history[0].dimensions[0].score, 0);
  assert.equal(profile({ ...empty(), trainingEvents: [{ score: 100 }], lifestyleLogs: [{ weight: 60 }] }).coverage.answered, 0);
  assert.equal(normalizeAbilityAssessment({ ...empty(), answers: Object.create({ [indicatorId]: 4 }) }).answers[indicatorId], undefined);
});

test("recording and profiling do not mutate state, inputs or historical snapshots", () => {
  const state = evaluate(null, allAnswers());
  const before = structuredClone(state);
  const input = { answers: { [indicatorId]: 0 } };
  const inputBefore = structuredClone(input);
  const updated = evaluate(state, input, now + 1000);
  profile(updated, now + 1000);
  assert.deepEqual(state, before);
  assert.deepEqual(input, inputBefore);
  updated.answers[indicatorId] = 3;
  assert.equal(updated.history.at(-1).answers[indicatorId], 0);
  const result = profile(state);
  result.dimensions[0].evidence[0].level = 0;
  result.history[0].dimensions[0].score = 0;
  assert.deepEqual(state, before);
});
