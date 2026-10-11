import test from "node:test";
import assert from "node:assert/strict";
import { runProductRelationshipIntelligence } from "../server/relationshipIntelligence.js";
import { createRelationshipIntelligenceController } from "../public/modules/intelligence/controller.js";
import {
  normalizeRelationshipIntelligenceState,
  toPersistedRelationshipIntelligenceState
} from "../public/modules/intelligence/state.js";

const CASE_ID = "case_0123456789abcdef";
const LOCAL_ONLY_TEXT = "这段原始聊天只应在本地消费，不应进入结果或匿名记忆。";

test("垂直旅程：HeartFlow 消息 → 本地分析 → 同意记忆 → 拒绝后的降级 → 撤回", async () => {
  const appState = {
    messages: [
      { id: "m1", type: "me", text: "最近有空一起喝咖啡吗？" },
      { id: "m2", type: "her", text: "最近有点忙，之后再说吧。" },
      { id: "m3", type: "me", text: LOCAL_ONLY_TEXT }
    ],
    relationshipIntelligence: normalizeRelationshipIntelligenceState({
      consent: false,
      caseId: CASE_ID
    })
  };
  const requests = [];
  let saveCount = 0;

  const controller = createRelationshipIntelligenceController({
    getAppState: () => appState,
    saveAppState: () => { saveCount += 1; },
    getGoal: () => "判断是否继续联系",
    analyze: async (request) => {
      requests.push(request);
      return runProductRelationshipIntelligence(request);
    }
  });

  const withoutConsent = await controller.refresh();

  assert.equal(withoutConsent.privacy.rawMessagesReturned, false);
  assert.equal(withoutConsent.memoryPatch, null);
  assert.equal(requests[0].consent, false);
  assert.equal(Object.hasOwn(requests[0], "caseId"), false);
  assert.equal(JSON.stringify(withoutConsent).includes(LOCAL_ONLY_TEXT), false);
  assert.equal(appState.relationshipIntelligence.memory, null);

  controller.setConsent(true);
  const withConsent = await controller.refresh();

  assert.equal(requests[1].consent, true);
  assert.equal(requests[1].caseId, CASE_ID);
  assert.equal(withConsent.memoryPatch.caseId, CASE_ID);
  assert.equal(withConsent.memoryPatch.privacy.anonymized, true);
  assert.equal(withConsent.memoryPatch.privacy.rawChatRetained, false);
  assert.equal(appState.relationshipIntelligence.memory.currentState, "INITIAL_CONTACT");
  assert.equal(JSON.stringify(appState.relationshipIntelligence.memory).includes(LOCAL_ONLY_TEXT), false);
  assert.ok(withConsent.action);
  assert.ok(withConsent.prediction.expectedSignal);

  appState.messages = [
    ...appState.messages,
    { id: "m4", type: "her", text: "不了，谢谢。请不要再联系我。" }
  ];
  const afterRejection = await controller.refresh({ signals: { explicitRejection: true } });

  assert.equal(requests[2].memory.currentState, "INITIAL_CONTACT");
  assert.equal(afterRejection.state.to, "EXIT");
  assert.equal(afterRejection.decision.value, "DE_ESCALATE");
  assert.match(afterRejection.action, /停止追加说服|降低投入/);
  assert.equal(JSON.stringify(afterRejection).includes(LOCAL_ONLY_TEXT), false);
  assert.equal(appState.relationshipIntelligence.memory.currentState, "EXIT");

  controller.setConsent(false);
  assert.equal(appState.relationshipIntelligence.consent, false);
  assert.equal(appState.relationshipIntelligence.memory, null);
  const persisted = toPersistedRelationshipIntelligenceState(appState.relationshipIntelligence);
  assert.equal(persisted.lastResult, null);
  assert.equal(persisted.memory, null);
  assert.ok(saveCount >= 3);
});
