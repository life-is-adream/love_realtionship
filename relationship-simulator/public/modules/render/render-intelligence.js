import { $, escapeHtml } from "../core/dom.js";
import { normalizeRelationshipIntelligenceState } from "../intelligence/state.js";

const DECISION_LABELS = {
  ADVANCE: "小步推进",
  MAINTAIN: "维持节奏",
  OBSERVE: "继续观察",
  DE_ESCALATE: "降低投入",
  EXIT: "停止推进"
};

const QUALITY_LABELS = {
  adequate: "数据基本够用",
  limited: "数据有限"
};

const STATE_LABELS = {
  UNKNOWN: "状态未知",
  INITIAL_CONTACT: "初次互动",
  MUTUAL_FAMILIARITY: "逐步熟悉",
  GROWING_INTEREST: "互惠增加",
  DATING_EXPLORATION: "约会探索",
  COMMITTED_RELATIONSHIP: "已确认关系",
  CONFLICT: "冲突处理中",
  REPAIR: "关系修复",
  STABLE_RELATIONSHIP: "稳定关系",
  EXIT: "停止推进"
};

function emptyStateHtml(state) {
  if (state.status === "loading") {
    return '<div class="ri-empty is-loading"><span class="ri-spinner" aria-hidden="true"></span><div><b>正在运行本地确定性分析</b><p>只在本机服务中处理当前会话，不会调用远程模型。</p></div></div>';
  }
  if (state.status === "error") {
    return `<div class="ri-empty is-error"><div><b>本地分析暂时不可用</b><p>${escapeHtml(state.lastError || "请确认本地服务已经启动。")}</p><small>聊天、教练与课程功能不会因此中断。</small></div></div>`;
  }
  return '<div class="ri-empty"><div><b>等待本地分析</b><p>发送或生成一条消息后，这里会显示可核对的证据、工作状态和下一步。该分析不会调用远程模型。</p></div></div>';
}

function buildEvidenceHtml(evidence) {
  const items = (Array.isArray(evidence) ? evidence : []).slice(0, 4);
  if (!items.length) return '<li>当前文本没有提供足够区分性信号。</li>';
  return items.map((item) => `<li>${escapeHtml(item?.observation || "证据不足")}</li>`).join("");
}

function buildHypothesesHtml(hypotheses) {
  const items = (Array.isArray(hypotheses) ? hypotheses : []).slice(0, 2);
  if (!items.length) return "";
  return `<div class="ri-hypotheses"><b>保留的解释</b>${items.map((item) => `<p>${escapeHtml(item?.label || "未知")} <small>${escapeHtml(item?.confidence || "")}</small></p>`).join("")}</div>`;
}

export function buildRelationshipIntelligenceHtml(value) {
  const state = normalizeRelationshipIntelligenceState(value);
  const consentText = state.consent
    ? "已开启匿名结构化记忆；只保存通过校验的观察摘要，不保存原始聊天。"
    : "未开启匿名长期记忆；当前结果仅在本次页面会话中显示。";

  if (!state.lastResult) {
    return `${emptyStateHtml(state)}<p class="ri-consent-note ${state.consent ? "is-on" : ""}">${escapeHtml(consentText)}</p>`;
  }

  const result = state.lastResult;
  const metrics = result.analysis?.metrics || {};
  const decision = String(result.decision?.value || "OBSERVE");
  const relationshipState = String(result.state?.to || "UNKNOWN");
  const timestampLabel = metrics.timestampCoverage === "complete" ? "时间戳完整" : "时间戳不完整";
  const limitations = Array.isArray(result.analysis?.limitations) && result.analysis.limitations.length
    ? result.analysis.limitations.slice(0, 2)
    : ["指标只描述可观察文本，不是心理诊断、兴趣概率或人格结论。"];

  return `
    <div class="ri-summary">
      <div class="ri-decision"><span>本轮建议</span><strong>${escapeHtml(DECISION_LABELS[decision] || "保守处理")}</strong><small>${escapeHtml(decision)}</small></div>
      <div class="ri-state"><span>工作状态</span><strong>${escapeHtml(STATE_LABELS[relationshipState] || "状态未知")}</strong><small>${escapeHtml(`${relationshipState} · ${result.state?.reason || "没有足够的新证据改变状态"}`)}</small></div>
    </div>
    <div class="ri-metrics">
      <span>${escapeHtml(metrics.messageCount ?? 0)} 条消息</span>
      <span>${escapeHtml(QUALITY_LABELS[metrics.dataQuality] || "数据状态未知")}</span>
      <span>${escapeHtml(timestampLabel)}</span>
    </div>
    <div class="ri-grid">
      <div><b>可核对证据</b><ul>${buildEvidenceHtml(result.analysis?.evidence)}</ul></div>
      <div><b>下一步</b><p>${escapeHtml(result.action || result.decision?.reason || "先保持低压力，并等待新的可观察信息。")}</p></div>
    </div>
    ${buildHypothesesHtml(result.hypotheses)}
    <div class="ri-limitations"><b>限制</b>${limitations.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}<p>这不是心理诊断，也不能替代现实中的同意、边界和安全判断。</p></div>
    <p class="ri-consent-note ${state.consent ? "is-on" : ""}">${escapeHtml(consentText)}</p>
  `;
}

export function renderRelationshipIntelligence(value, target = $("relationshipIntelligencePanel")) {
  if (!target) return;
  target.innerHTML = buildRelationshipIntelligenceHtml(value);
}
