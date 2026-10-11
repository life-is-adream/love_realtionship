import test from "node:test";
import assert from "node:assert/strict";
import { normalizeState, serializeStateForStorage } from "../public/modules/core/state.js";
import { applyBackup, buildBackup } from "../public/modules/core/backup.js";
import { STORAGE_KEYS } from "../public/modules/core/config.js";
import { createPracticeRecord, normalizePracticeState, recordPracticeOutcome, reflectPracticeRecord, setPracticeConsent, shanghaiDate, toPersistedPracticeState, updatePracticeOutcome } from "../public/modules/training/real-practice.js";

const now = new Date("2026-08-20T16:10:00Z");
const outcome = (extra = {}) => ({ date: "2026-08-21", planId: "connection", attempt: "done", response: "reciprocal", comfort: "comfortable", expression: "clear", boundary: "respected", expected: "reciprocal", ...extra });

test("Shanghai date crosses UTC midnight and rejects invalid dates", () => {
  assert.equal(shanghaiDate("2026-08-20T16:10:00Z"), "2026-08-21");
  assert.equal(shanghaiDate("2026-08-20T15:59:00Z"), "2026-08-20");
  assert.throws(() => shanghaiDate("bad"), /日期无效/);
  assert.throws(() => createPracticeRecord(outcome({ date: "2026-02-30" }), now), /有效/);
  assert.throws(() => createPracticeRecord(outcome({ date: "2026-08-22" }), now), /有效/);
});

test("only a selected plan and explicit attempt can become a record", () => {
  assert.throws(() => createPracticeRecord({ planId: "connection" }, now), /实际尝试/);
  assert.throws(() => createPracticeRecord(outcome({ planId: "unknown" }), now), /卡点/);
  const record = createPracticeRecord({ planId: "opening", attempt: "done" }, now);
  assert.equal(record.response, "notObserved");
  assert.equal(record.boundary, "uncertain");
  assert.equal(reflectPracticeRecord(record).decision, "OBSERVE");
});

test("not attempting cannot inherit positive dropdown values", () => {
  for (const attempt of ["notYet", "noOpportunity"]) {
    const record = createPracticeRecord(outcome({ attempt }), now);
    assert.equal(record.response, "notObserved");
    assert.equal(record.comfort, "unknown");
    assert.equal(reflectPracticeRecord(record).calibration, "unknown");
    assert.equal(reflectPracticeRecord(record).decision, "OBSERVE");
  }
});

test("rejection and incompatibility stop regardless of positive self ratings", () => {
  for (const response of ["refused", "incompatible"]) {
    const reflection = reflectPracticeRecord(createPracticeRecord(outcome({ response }), now));
    assert.equal(reflection.decision, "EXIT");
    assert.equal(reflection.calibration, "unknown");
  }
  assert.equal(reflectPracticeRecord(createPracticeRecord(outcome({ boundary: "violated" }), now)).decision, "EXIT");
  assert.equal(reflectPracticeRecord(createPracticeRecord(outcome({ comfort: "uncomfortable" }), now)).decision, "DE_ESCALATE");
});

test("reciprocity does not grant intimacy; unknown stays unknown", () => {
  assert.equal(reflectPracticeRecord(createPracticeRecord(outcome(), now)).decision, "MAINTAIN");
  const unknown = reflectPracticeRecord(createPracticeRecord(outcome({ response: "notObserved" }), now));
  assert.equal(unknown.decision, "OBSERVE");
  assert.equal(unknown.calibration, "unknown");
  assert.equal(reflectPracticeRecord(createPracticeRecord(outcome({ response: "unclear" }), now)).calibration, "notConfirmed");
});

test("new events are enum-only and never overwrite another event on the same date", () => {
  const input = outcome({ rawText: "must-not-store", name: "must-not-store", response: "<script>" });
  const first = recordPracticeOutcome(null, input, now);
  const second = recordPracticeOutcome(first, outcome(), now);
  assert.equal(second.records.length, 2);
  assert.notEqual(second.records[0].id, second.records[1].id);
  assert.equal(second.records[0].response, "notObserved");
  assert.equal(second.records[1].response, "reciprocal");
  assert.equal(JSON.stringify(first).includes("must-not-store"), false);
  assert.equal(JSON.stringify(first).includes("<script>"), false);
  assert.equal(normalizePracticeState({ records: [null, {}, outcome({ date: "bad" })] }).records.length, 0);
  const withoutDate = outcome();
  delete withoutDate.date;
  assert.equal(normalizePracticeState({ records: [withoutDate] }).records.length, 0);
});

test("same-day new reciprocity leaves an earlier rejection visible and does not lock another event", () => {
  const first = recordPracticeOutcome(null, outcome({ response: "refused" }), now);
  const second = recordPracticeOutcome(first, outcome(), now);
  assert.equal(second.records.length, 2);
  assert.equal(reflectPracticeRecord(second.records[0]).decision, "EXIT");
  assert.equal(reflectPracticeRecord(second.records[1]).decision, "MAINTAIN");
});

test("legacy date-and-plan records survive migration and a corrected date keeps their identity", () => {
  const legacyId = "2026-08-21:connection";
  const migrated = normalizePracticeState({ consent: true, records: [{ ...outcome(), id: legacyId }] }, now);
  assert.equal(migrated.records[0].id, legacyId);
  assert.equal(migrated.records[0].response, "reciprocal");
  const updated = updatePracticeOutcome(migrated, legacyId, { date: "2026-08-20", regulation: "maintained" }, now);
  assert.equal(normalizePracticeState(updated, now).records[0].id, legacyId);
  assert.equal(updated.records[0].history[0].date, "2026-08-21");
});

test("supplementing preserves omitted and unknown values plus the original observation", () => {
  const state = recordPracticeOutcome(null, outcome({ response: "refused" }), now);
  const id = state.records[0].id;
  const updated = updatePracticeOutcome(state, id, { response: "notObserved", comfort: "unknown", expression: "notApplicable", boundary: "uncertain", expected: "unknown", regulation: "maintained", name: "must-not-store" }, now);
  const record = updated.records[0];
  assert.equal(record.response, "refused");
  assert.equal(record.comfort, "comfortable");
  assert.equal(record.expression, "clear");
  assert.equal(record.boundary, "respected");
  assert.equal(record.expected, "reciprocal");
  assert.equal(record.regulation, "maintained");
  assert.equal(record.history.length, 1);
  assert.equal(record.history[0].regulation, "unknown");
  assert.equal(record.history[0].response, "refused");
  assert.equal(JSON.stringify(updated).includes("must-not-store"), false);
  assert.equal(state.records[0].regulation, "unknown");
  assert.equal(updatePracticeOutcome(updated, id, { response: "", regulation: "unknown" }, now).records[0].history.length, 1);
});

test("a supplement cannot erase a completed stop signal or silently turn it into ordinary continuation", () => {
  const state = recordPracticeOutcome(null, outcome({ response: "refused" }), now);
  const id = state.records[0].id;
  assert.throws(() => updatePracticeOutcome(state, id, { attempt: "notYet" }, now), /已尝试/);
  const updated = updatePracticeOutcome(state, id, { response: "reciprocal" }, now);
  assert.equal(updated.records[0].history[0].response, "refused");
  assert.equal(reflectPracticeRecord(updated.records[0]).decision, "EXIT");
  assert.throws(() => updatePracticeOutcome(state, "unknown", {}, now), /不存在/);
  assert.throws(() => updatePracticeOutcome(state, id, { date: "2026-08-22" }, now), /有效/);
});

test("revision history is bounded while retaining the original observation and stop signals", () => {
  let state = recordPracticeOutcome(null, outcome({ response: "unclear", regulation: "unknown" }), now);
  const id = state.records[0].id;
  state = updatePracticeOutcome(state, id, { response: "refused" }, now);
  state = updatePracticeOutcome(state, id, { response: "reciprocal" }, now);
  for (let index = 0; index < 10; index += 1) state = updatePracticeOutcome(state, id, { regulation: index % 2 ? "maintained" : "struggled" }, now);
  assert.equal(state.records[0].history.length, 5);
  assert.equal(state.records[0].history[0].response, "unclear");
  assert.ok(state.records[0].history.some((snapshot) => snapshot.response === "refused"));
  assert.equal(reflectPracticeRecord(state.records[0]).decision, "EXIT");
});

test("anonymous event IDs remain distinct with a degraded random source and capacity stays thirty", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  try {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: { getRandomValues: (bytes) => bytes.fill(1) } });
    let state = null;
    for (let index = 0; index < 35; index += 1) state = recordPracticeOutcome(state, outcome(), now);
    assert.equal(state.records.length, 30);
    assert.equal(new Set(state.records.map((record) => record.id)).size, 30);
    assert.ok(state.records.every((record) => /^practice_[a-z0-9_-]{8,96}$/.test(record.id)));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    else delete globalThis.crypto;
  }
});

test("restoring one's life requires its own observation rather than inferred boundaries", () => {
  const unknown = createPracticeRecord(outcome({ expected: "space", response: "notObserved", regulation: "unknown" }), now);
  assert.equal(reflectPracticeRecord(unknown).calibration, "unknown");
  assert.equal(reflectPracticeRecord(createPracticeRecord(outcome({ expected: "space", regulation: "maintained" }), now)).calibration, "supported");
  assert.equal(reflectPracticeRecord(createPracticeRecord(outcome({ expected: "space", regulation: "struggled" }), now)).calibration, "notConfirmed");
});

test("default persistence removes observations without mutating page state", () => {
  const page = recordPracticeOutcome(null, outcome(), now);
  assert.equal(page.consent, false);
  assert.equal(toPersistedPracticeState(page).records.length, 0);
  assert.equal(page.records.length, 1);
  const application = normalizeState({ relationshipPractice: page });
  const persisted = serializeStateForStorage(application);
  assert.equal(persisted.relationshipPractice.records.length, 0);
  assert.equal(application.relationshipPractice.records.length, 1);
});

test("explicit save persists bounded categories; withdrawal clears them", () => {
  const page = recordPracticeOutcome(null, outcome(), now);
  const supplemented = updatePracticeOutcome(page, page.records[0].id, { regulation: "maintained" }, now);
  const consented = setPracticeConsent(supplemented, true);
  const persisted = serializeStateForStorage(normalizeState({ relationshipPractice: consented }));
  assert.equal(persisted.relationshipPractice.records.length, 1);
  assert.equal(persisted.relationshipPractice.records[0].history.length, 1);
  const revoked = setPracticeConsent(consented, false);
  assert.equal(revoked.records.length, 0);
  assert.equal(toPersistedPracticeState(revoked).records.length, 0);
});

test("restored versions retain only enums and valid metadata, never supplied raw text or identity", () => {
  const snapshot = { ...outcome({ response: "refused" }), rawText: "must-not-store", name: "must-not-store", id: "must-not-store" };
  const restored = normalizePracticeState({ records: [{ ...outcome(), id: "must-not-store", history: [snapshot] }] }, now);
  assert.equal(restored.records.length, 1);
  assert.equal(restored.records[0].history[0].response, "refused");
  assert.equal(JSON.stringify(restored).includes("must-not-store"), false);
  assert.equal(toPersistedPracticeState(restored).records.length, 0);
});

test("backup export and restoration cannot retain observations without consent", () => {
  const page = normalizeState({ relationshipPractice: recordPracticeOutcome(null, outcome(), now) });
  const storageMap = new Map();
  const storage = { getItem: (key) => storageMap.get(key) ?? null, setItem: (key, value) => storageMap.set(key, value), removeItem: (key) => storageMap.delete(key) };
  const backup = buildBackup(serializeStateForStorage(page), storage);
  assert.equal(JSON.parse(backup.data[STORAGE_KEYS.state]).relationshipPractice.records.length, 0);
  backup.data[STORAGE_KEYS.state] = JSON.stringify(page); // 导入未经裁剪的历史快照。
  assert.equal(applyBackup(backup, storage).ok, true);
  assert.equal(JSON.parse(storageMap.get(STORAGE_KEYS.state)).relationshipPractice.records.length, 0);
});

test("observation history stays bounded to thirty records", () => {
  const records = Array.from({ length: 45 }, (_, index) => outcome({ date: new Date(Date.UTC(2026, 5, index + 1)).toISOString().slice(0, 10) }));
  const normalized = normalizePracticeState({ consent: true, records });
  assert.equal(normalized.records.length, 30);
  assert.equal(normalized.records[0].date, "2026-06-16");
});
