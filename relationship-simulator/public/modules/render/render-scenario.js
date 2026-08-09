import { $, escapeHtml } from "../core/dom.js";
import { scenarios } from "../content/scenarios.js";
import { getState, saveState } from "../core/state.js";

let selectedScenarioId = null;
export const REVIEW_MAPPING = {
  "刚加微信后的第一晚": { chapter: 1, topic: "重新联系与第一印象" },
  "隔天轻联系": { chapter: 1, topic: "先说现在，不急着说过去" },
  "第一次邀约": { chapter: 2, topic: "稳定联系与日常靠近" },
  "第一次约会后": { chapter: 3, topic: "低谷边界与信任考验" },
  "暧昧推进": { chapter: 4, topic: "喜欢出现但不急着命名" },
  "表达好感": { chapter: 5, topic: "确认关系与第一轮磨合" },
  "确定关系": { chapter: 6, topic: "亲密之后的普通日子" }
};

export function renderScenarioList() {
  const list = $("scenarioList");
  if (!list) return;
  list.innerHTML = scenarios.map((scenario) => `<label class="scenario-option"><input type="radio" name="scenario" value="${escapeHtml(scenario.id)}" ${scenario.id === selectedScenarioId ? "checked" : ""} /><div class="scenario-info"><strong>${escapeHtml(scenario.title)}</strong><span class="scenario-stage">推荐阶段：${escapeHtml(scenario.recommendedStage)}</span><p>${escapeHtml(scenario.description)}</p></div></label>`).join("");
  list.querySelectorAll('input[name="scenario"]').forEach((input) => input.addEventListener("change", () => { selectedScenarioId = input.value; }));
}

export function loadScenario(scenarioId, { switchPersona = () => {}, onChanged = () => {} } = {}) {
  const scenario = scenarios.find((item) => item.id === (scenarioId || selectedScenarioId));
  if (!scenario) return;
  if (scenario.recommendedStage && $("stage")) $("stage").value = scenario.recommendedStage;
  if (scenario.recommendedPersona) switchPersona(scenario.recommendedPersona, false);
  if (scenario.openingMessages?.length) {
    const state = getState();
    state.messages = [...scenario.openingMessages];
    state.lastAnalysis = null;
    state.lastGenerationMeta = null;
    saveState();
    onChanged();
  }
  if (scenario.contextHint && $("goal")) { $("goal").value = scenario.contextHint; $("goal").dataset.personaSynced = "false"; }
  $("apiStatus").textContent = `已加载剧本：${scenario.title}`;
}
