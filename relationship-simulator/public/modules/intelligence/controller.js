import { analyzeRelationshipIntelligence } from "./client.js";
import {
  applyRelationshipIntelligenceResult,
  buildRelationshipIntelligenceRequest,
  markRelationshipIntelligenceError,
  markRelationshipIntelligenceLoading,
  normalizeRelationshipIntelligenceState,
  resetRelationshipIntelligenceSession,
  setRelationshipIntelligenceConsent
} from "./state.js";

export function createRelationshipIntelligenceController({
  getAppState,
  saveAppState,
  getGoal = () => "",
  updateAppState = null,
  analyze = analyzeRelationshipIntelligence,
  render = () => {}
}) {
  if (typeof getAppState !== "function" || typeof saveAppState !== "function") {
    throw new TypeError("Relationship Intelligence controller requires state accessors");
  }

  let requestSequence = 0;

  function replace(next, { persist = false } = {}) {
    if (persist && typeof updateAppState === "function") {
      // 落盘路径走 mutate：草稿隔离 + 持久化 + 广播（触发 renderAll）。
      // 非落盘路径（loading/error）保持直写，避免每次中间态都写盘。
      updateAppState((draft) => { draft.relationshipIntelligence = next; });
    } else {
      // 未注入 mutate 的装配（测试替身 / 旧调用方）：退回原行为。
      const target = getAppState();
      target.relationshipIntelligence = next;
      if (persist) saveAppState();
    }
    render(next);
    return next;
  }

  async function refresh({ signals } = {}) {
    const sequence = ++requestSequence;
    const appState = getAppState();
    const current = normalizeRelationshipIntelligenceState(appState.relationshipIntelligence);
    replace(markRelationshipIntelligenceLoading(current));

    try {
      const request = buildRelationshipIntelligenceRequest({
        messages: appState.messages,
        goal: getGoal(),
        intelligence: current,
        signals
      });
      const result = await analyze(request);
      if (sequence !== requestSequence) return null;
      replace(applyRelationshipIntelligenceResult(current, result), { persist: true });
      return result;
    } catch (error) {
      if (sequence !== requestSequence) return null;
      replace(markRelationshipIntelligenceError(current, error));
      return null;
    }
  }

  function setConsent(granted) {
    requestSequence += 1;
    const current = getAppState().relationshipIntelligence;
    return replace(setRelationshipIntelligenceConsent(current, granted), { persist: true });
  }

  function reset(bytes) {
    requestSequence += 1;
    const current = getAppState().relationshipIntelligence;
    return replace(resetRelationshipIntelligenceSession(current, bytes), { persist: true });
  }

  // 恢复备份时只让旧回调失效，不读取、改写、保存或渲染已恢复的档案。
  function cancelPending() {
    requestSequence += 1;
  }

  return { refresh, setConsent, reset, cancelPending };
}
