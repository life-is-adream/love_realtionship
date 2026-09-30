/**
 * 合规横幅：首次访问明示「本应用角色为 AI 模拟，非真人」。
 * 用户点击「我知道了」后关闭，知悉状态持久化到 localStorage（键名走 STORAGE_KEYS 惯例）。
 * 横幅内容为纯静态常量（不走用户输入），沿用 PUA 模式横幅的静态 innerHTML 先例，无注入风险。
 */
import { STORAGE_KEYS } from "../core/config.js";

export const COMPLIANCE_MESSAGE = "本应用角色为 AI 模拟，非真人。对话内容仅用于沟通训练与自我觉察，请理性对待。";

/** localStorage 不可用（隐私模式等）时按"已知悉"处理：不阻塞界面，也不在每次访问重复弹出。 */
export function hasAcknowledgedCompliance(storage = globalThis.localStorage) {
  try {
    return storage.getItem(STORAGE_KEYS.complianceAck) === "true";
  } catch {
    return true;
  }
}

export function initComplianceBanner({
  getElement = (id) => document.getElementById(id),
  storage = globalThis.localStorage
} = {}) {
  const banner = getElement("complianceBanner");
  if (!banner) return { visible: false };
  if (hasAcknowledgedCompliance(storage)) return { visible: false };

  function dismiss() {
    try {
      storage.setItem(STORAGE_KEYS.complianceAck, "true");
    } catch {
      /* ignored */
    }
    banner.className = "compliance-banner hidden";
    banner.innerHTML = "";
  }

  banner.className = "compliance-banner";
  banner.innerHTML = `<span class="compliance-banner-text">ℹ️ <b>AI 模拟声明</b> — ${COMPLIANCE_MESSAGE}</span><button type="button" class="btn small ghost compliance-banner-close" id="complianceAckBtn">我知道了</button>`;
  banner.querySelector("#complianceAckBtn")?.addEventListener("click", dismiss);
  return { visible: true };
}
