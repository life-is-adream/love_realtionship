import test from "node:test";
import assert from "node:assert/strict";
import { autoDetectStage, onStageManualChange } from "../public/modules/render/render-stage.js";
import { setState } from "../public/modules/core/state.js";
import { STAGE_VALUES } from "../public/modules/core/stages.js";

test("手动改阶段后迟到的自动识别不能覆盖选择或写入旧结果", async (t) => {
  const previous = new Map(["document", "localStorage", "fetch"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const elements = new Map(["stage", "autoStageBtn", "stageBadge", "stageProgress"].map((key) => [key, { value: STAGE_VALUES[0], disabled: false, textContent: "", innerHTML: "" }]));
  const storage = new Map();
  globalThis.document = { getElementById: (id) => elements.get(id) };
  globalThis.localStorage = { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
  setState({ messages: [{ type: "me", text: "synthetic message" }] });
  let resolveRequest, observedSignal;
  globalThis.fetch = async (_url, options) => {
    observedSignal = options.signal;
    return new Promise((resolve) => { resolveRequest = resolve; });
  };
  const statuses = [];
  const request = autoDetectStage({ onStatus: (value) => statuses.push(value) });
  await new Promise(setImmediate);
  elements.get("stage").value = STAGE_VALUES[1];
  onStageManualChange();
  resolveRequest({ ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ stage: STAGE_VALUES[5], confidence: "high" }) } }] }) });
  await request;
  assert.equal(observedSignal.aborted, true);
  assert.equal(elements.get("stage").value, STAGE_VALUES[1]);
  assert.equal(storage.has("heartflow-stage-auto-result"), false);
  assert.deepEqual(statuses, []);
  assert.equal(elements.get("autoStageBtn").disabled, false);
});
