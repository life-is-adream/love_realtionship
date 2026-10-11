import { defaultState } from "./config.js";
import { normalizeState } from "./state.js";

// 当前对话与评分是一次练习；现实复盘、生活记录和明确保存设置独立保留。
export function createConversationResetState(value) {
  const previous = normalizeState(value);
  return normalizeState({
    ...structuredClone(defaultState),
    personaId: previous.personaId,
    customPersonas: previous.customPersonas,
    personaMemory: previous.personaMemory,
    avatarOverrides: previous.avatarOverrides,
    relationshipIntelligence: previous.relationshipIntelligence,
    relationshipPractice: previous.relationshipPractice,
    lifestyle: previous.lifestyle
  });
}
