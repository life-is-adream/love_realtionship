import test from "node:test";
import assert from "node:assert/strict";
import { loadState, getStateLoadIssue, setState, mutate } from "../public/modules/core/state.js";
import { STORAGE_KEYS } from "../public/modules/core/config.js";

/**
 * P0-2：状态损坏时必须隔离原件，不能静默重置后被下一次写入覆盖。
 *
 * 此前 loadState() 的 catch 直接重置为默认态，随后任意一次 mutate 会把默认态
 * 写回同一个 key，用户的全部本地档案（对话/训练日志/错题本/成长档案）永久丢失。
 */

function stubStorage(initial = {}, { failSet = false } = {}) {
  const data = { ...initial };
  const writes = [];
  globalThis.localStorage = {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      writes.push({ key, value: String(value) });
      if (failSet) throw new Error("QuotaExceeded");
      data[key] = String(value);
    },
    removeItem: (key) => {
      delete data[key];
    },
    dump: () => data,
    writes
  };
  return globalThis.localStorage;
}

const RAW_CORRUPT = "{bad json";

// ── 损坏路径 ────────────────────────────────────────────────────────────────

test("损坏的 JSON：loadState 不抛错并返回合法默认态", () => {
  stubStorage({ [STORAGE_KEYS.state]: RAW_CORRUPT });
  const state = loadState();
  assert.ok(state && typeof state === "object");
  assert.equal(state.personaId, "lin");
  assert.ok(Array.isArray(state.messages));
  assert.ok(Array.isArray(state.mistakes));
});

test("损坏的 JSON：原始字符串被写入隔离键，不被覆盖", () => {
  const storage = stubStorage({ [STORAGE_KEYS.state]: RAW_CORRUPT });
  loadState();
  assert.equal(storage.dump()[STORAGE_KEYS.stateQuarantine], RAW_CORRUPT);
});

test("损坏的 JSON：getStateLoadIssue 报告原因与时间", () => {
  stubStorage({ [STORAGE_KEYS.state]: RAW_CORRUPT });
  loadState();
  const issue = getStateLoadIssue();
  assert.ok(issue, "损坏后必须留下加载异常记录");
  assert.equal(issue.reason, "state-parse-failed");
  assert.equal(typeof issue.at, "string");
  assert.ok(issue.at.length >= 10);
});

test("损坏后继续 mutate：隔离键仍保留原始副本", () => {
  const storage = stubStorage({ [STORAGE_KEYS.state]: RAW_CORRUPT });
  loadState();
  mutate((draft) => {
    draft.trainingMode = "pua";
  });
  assert.equal(storage.dump()[STORAGE_KEYS.stateQuarantine], RAW_CORRUPT);
  assert.equal(storage.dump()[STORAGE_KEYS.state] !== RAW_CORRUPT, true);
});

test("隔离写入失败（配额满）也不得影响重置流程", () => {
  stubStorage({ [STORAGE_KEYS.state]: RAW_CORRUPT }, { failSet: true });
  const state = loadState();
  assert.ok(state && state.personaId === "lin");
  assert.ok(getStateLoadIssue(), "隔离失败仍应记录加载异常");
});

// ── 正常路径 ────────────────────────────────────────────────────────────────

test("合法状态：getStateLoadIssue 为 null 且不写隔离键", () => {
  const storage = stubStorage({ [STORAGE_KEYS.state]: JSON.stringify({ personaId: "lin", messages: [] }) });
  const state = loadState();
  assert.equal(state.personaId, "lin");
  assert.equal(getStateLoadIssue(), null);
  assert.equal(STORAGE_KEYS.stateQuarantine in storage.dump(), false);
});

test("连续两次加载：异常记录反映最近一次，不会粘住旧值", () => {
  stubStorage({ [STORAGE_KEYS.state]: RAW_CORRUPT });
  loadState();
  assert.ok(getStateLoadIssue());

  stubStorage({ [STORAGE_KEYS.state]: JSON.stringify({ personaId: "lin" }) });
  loadState();
  assert.equal(getStateLoadIssue(), null);
});

test("损坏的 JSON：setState 仍能把新状态正常落盘", () => {
  const storage = stubStorage({ [STORAGE_KEYS.state]: RAW_CORRUPT });
  loadState();
  setState({ personaId: "lin", trainingMode: "pua" });
  assert.equal(JSON.parse(storage.dump()[STORAGE_KEYS.state]).trainingMode, "pua");
});
