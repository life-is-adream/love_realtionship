import { TRAINING_MODES } from "../core/config.js";
import { escapeHtml } from "../core/dom.js";

const PUA_CONFIRMATION = "切换到 PUA 识别训练？\n\n女方角色将演示可识别的典型操控手法（打压、推拉、冷热交替、煤气灯等），教练同步给出识别信号与防御回应。\n\n⚠️ 该模式仅用于识别与防御研究，禁止用于操控他人。\n\n继续？";

export function normalizeTrainingMode(value) {
  return value === "pua" ? "pua" : "anti";
}

export function createTrainingModeController({
  getAppState,
  saveAppState,
  getElement = (id) => document.getElementById(id),
  confirmSwitch = (message) => globalThis.confirm?.(message) === true,
  updateAppState = null,
  setStatus = (message) => {
    const status = getElement("apiStatus");
    if (status) status.textContent = message;
  }
}) {
  if (typeof getAppState !== "function" || typeof saveAppState !== "function") {
    throw new TypeError("Training mode controller requires state accessors");
  }

  function render() {
    const mode = normalizeTrainingMode(getAppState().trainingMode);
    const config = TRAINING_MODES[mode];
    const banner = getElement("modeBanner");
    const antiButton = getElement("modeBtnAnti");
    const puaButton = getElement("modeBtnPua");
    antiButton?.classList.toggle("is-active", mode === "anti");
    puaButton?.classList.toggle("is-active", mode === "pua");
    if (!banner) return;
    if (mode === "pua") {
      banner.className = "mode-banner is-pua";
      banner.innerHTML = `⚠️ <b>${escapeHtml(config.label)}模式</b> — 女方角色会演示可识别的典型操控手法，教练负责拆解识别信号与防御回应。<u>仅用于识别与防御研究，禁止用于操控他人。</u>切回 🛡️ 反PUA 训练可回到健康关系练习。`;
    } else {
      banner.className = "mode-banner hidden";
      banner.innerHTML = "";
    }
  }

  function setMode(value, { ask = false } = {}) {
    const state = getAppState();
    const next = normalizeTrainingMode(value);
    if (next === normalizeTrainingMode(state.trainingMode)) {
      render();
      return false;
    }
    if (next === "pua" && ask && !confirmSwitch(PUA_CONFIRMATION)) return false;
    if (typeof updateAppState === "function") {
      updateAppState((draft) => { draft.trainingMode = next; });
    } else {
      // 未注入 mutate 的装配（测试替身 / 旧调用方）：退回落盘 + 直写。
      const target = getAppState();
      target.trainingMode = next;
      saveAppState();
    }
    render();
    const config = TRAINING_MODES[next];
    setStatus(`${config.short} 已切换到「${config.label}」模式。${next === "pua" ? "（仅防御研究用途）" : ""}`);
    return true;
  }

  return { render, setMode };
}
