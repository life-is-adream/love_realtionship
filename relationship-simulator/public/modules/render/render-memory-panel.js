/**
 * 关系档案面板：把长期记忆从「内部注入」变成「用户可见、可删」。
 *
 * 设计契约（对应 docs/设计文档-关系推进分层.md §4）：
 * - 用户能看见系统记住了什么，并能逐条删除；
 * - 删除立即生效——`buildMemoryInjection` 会读取 `memoryTimeline` 最后 3 条，
 *   删掉的条目不会再进入 system prompt；
 * - 未授权时可持久记忆本就不存在（`core/state.js` 在关闭授权时删除 `_enhanced`），
 *   面板只显示授权提示，不渲染任何记忆内容。
 *
 * @module render/render-memory-panel
 */

import { $, escapeHtml } from "../core/dom.js";
import { getCurrentPersona, getState, mutate } from "../core/state.js";

/** 面板最多展示的条目数（内存里可保留更多，见 MEMORY_CONFIG） */
const DISPLAY_LIMIT = { timeline: 100, summary: 20 };

/**
 * 渲染关系档案面板到 #memoryPanel。
 * 无该节点时静默返回，便于在非成长视图下复用。
 */
export function renderMemoryPanel() {
  const panel = $("memoryPanel");
  if (!panel) return;

  const state = getState();
  const consent = state.relationshipIntelligence?.consent === true;

  if (!consent) {
    panel.innerHTML = renderGate();
    bindConsentLink();
    return;
  }

  const persona = getCurrentPersona();
  const enhanced = state.personaMemory?.[persona.id]?._enhanced || null;
  if (!enhanced) {
    panel.innerHTML = renderEmpty();
    return;
  }

  const timeline = Array.isArray(enhanced.memoryTimeline) ? enhanced.memoryTimeline : [];
  const summaries = Array.isArray(enhanced.conversationSummaries) ? enhanced.conversationSummaries : [];
  const history = enhanced.interactionHistory || {};

  panel.innerHTML = `
    <div class="memory-card">
      <div class="memory-head">
        <strong>关系档案</strong>
        <span>记忆 ${timeline.length} 条 · 摘要 ${summaries.length} 条</span>
      </div>
      <p class="note">下方完整列出自动保存的时间线和摘要，均可编辑或删除。时间线最近 3 条、最近一次摘要进入角色上下文；删除不会清除当前聊天或其他重复记录。</p>
      <div class="memory-stats">
        <span>互动轮次 ${escapeHtml(String(history.totalConversations ?? 0))}</span>
        <span>消息累计 ${escapeHtml(String(history.messagesExchanged ?? 0))}</span>
        <span>常见话题 ${escapeHtml(String((history.commonTopics || []).length))}</span>
      </div>
      ${renderTimeline(timeline)}
      ${renderSummaries(summaries)}
    </div>`;
  bindDeleteHandlers(panel, persona.id);
}

/**
 * 删除单条记忆。
 * @param {string} personaId
 * @param {"timeline"|"summary"} kind
 * @param {number} index
 */
export function removeMemoryEntry(personaId, kind, index) {
  if (!["timeline", "summary"].includes(kind)) return false;
  const list = getMemoryList(personaId, kind);
  if (!list || !Number.isInteger(index) || index < 0 || index >= list.length) return false;
  mutate((draft) => {
    const target = getMemoryListFromState(draft, personaId, kind);
    if (target) target.splice(index, 1);
  });
  globalThis.dispatchEvent?.(new Event("heartflow:memory-changed"));
  return true;
}

export function updateMemoryEntry(personaId, kind, index, text) {
  if (!["timeline", "summary"].includes(kind) || !Number.isInteger(index)) return false;
  const value = String(text ?? "").trim();
  if (!value || value.length > 500) return false;
  const list = getMemoryList(personaId, kind);
  if (!list || index < 0 || index >= list.length) return false;
  mutate((draft) => {
    const target = getMemoryListFromState(draft, personaId, kind);
    if (kind === "timeline") target[index] = { ...target[index], content: value };
    else target[index] = { ...target[index], summary: value };
  });
  globalThis.dispatchEvent?.(new Event("heartflow:memory-changed"));
  return true;
}

// ── 渲染片段 ─────────────────────────────────────────────────────────────────

function renderGate() {
  return `<div class="memory-card memory-gate">
      <div class="memory-head"><strong>关系档案</strong><span>未授权</span></div>
      <p class="note">自动提取的结构化长期记忆默认关闭。原始聊天记录和手动场景设置仍会保存在本机；这不是聊天自动清空。关闭授权会清除增强记忆。</p>
      <p class="note">想启用：勾选「证据与决策」中的「允许保存结构化复盘记忆」。关闭授权会同时清除已保存的记忆。</p>
      <button class="btn small" type="button" data-memory-open-consent>去授权</button>
    </div>`;
}

function renderEmpty() {
  return `<div class="memory-card memory-gate">
      <div class="memory-head"><strong>关系档案</strong><span>暂无记录</span></div>
      <p class="note">已授权，但还没有提取到可长期保存的记忆。完成一轮分析后会自动生成。</p>
    </div>`;
}

function renderTimeline(timeline) {
  if (!timeline.length) return "";
  const start = Math.max(0, timeline.length - DISPLAY_LIMIT.timeline);
  const rows = timeline
    .slice(start)
    .map((item, offset) => {
      const index = start + offset;
      const time = formatTime(item?.timestamp);
      const content = String(item?.content || "（无内容）");
      return `<li class="memory-row">
          <time>${escapeHtml(time)}</time>
          <span data-memory-view>${escapeHtml(content)}</span>
          <textarea data-memory-editor hidden maxlength="500" aria-label="编辑时间线记忆">${escapeHtml(content)}</textarea>
          <button class="btn small ghost" type="button" data-memory-edit>编辑</button>
          <button class="btn small ghost" type="button" data-memory-save hidden>保存</button>
          <button class="btn small ghost" type="button" data-memory-cancel hidden>取消</button>
          <button class="btn small ghost" type="button" data-memory-kind="timeline" data-memory-index="${index}">删除</button>
        </li>`;
    })
    .join("");
  const hidden = timeline.length > DISPLAY_LIMIT.timeline
    ? `<p class="note">仅显示最近 ${DISPLAY_LIMIT.timeline} 条，共 ${timeline.length} 条。</p>`
    : "";
  return `<div class="memory-section"><div class="memory-subtitle">记忆时间线</div><ul class="memory-list">${rows}</ul>${hidden}</div>`;
}

function renderSummaries(summaries) {
  if (!summaries.length) return "";
  const start = Math.max(0, summaries.length - DISPLAY_LIMIT.summary);
  const rows = summaries
    .slice(start)
    .map((item, offset) => {
      const index = start + offset;
      const date = String(item?.date || "").slice(0, 10) || "未知日期";
      const text = String(item?.summary || "（无摘要）");
      return `<li class="memory-row">
          <time>${escapeHtml(date)}</time>
          <span data-memory-view>${escapeHtml(text)}</span>
          <textarea data-memory-editor hidden maxlength="500" aria-label="编辑对话摘要">${escapeHtml(text)}</textarea>
          <button class="btn small ghost" type="button" data-memory-edit>编辑</button>
          <button class="btn small ghost" type="button" data-memory-save hidden>保存</button>
          <button class="btn small ghost" type="button" data-memory-cancel hidden>取消</button>
          <button class="btn small ghost" type="button" data-memory-kind="summary" data-memory-index="${index}">删除</button>
        </li>`;
    })
    .join("");
  return `<div class="memory-section"><div class="memory-subtitle">对话摘要</div><ul class="memory-list">${rows}</ul></div>`;
}

// ── 交互绑定 ─────────────────────────────────────────────────────────────────

function bindDeleteHandlers(panel, personaId) {
  for (const button of panel.querySelectorAll("button[data-memory-kind]")) {
    button.addEventListener("click", () => {
      const kind = button.dataset.memoryKind === "summary" ? "summary" : "timeline";
      const index = Number(button.dataset.memoryIndex);
      removeMemoryEntry(personaId, kind, index);
      renderMemoryPanel();
    });
  }
  for (const row of panel.querySelectorAll(".memory-row")) {
    const editor = row.querySelector("[data-memory-editor]");
    const view = row.querySelector("[data-memory-view]");
    const edit = row.querySelector("[data-memory-edit]");
    const save = row.querySelector("[data-memory-save]");
    const cancel = row.querySelector("[data-memory-cancel]");
    const toggle = (active) => { editor.hidden = !active; view.hidden = active; edit.hidden = active; save.hidden = !active; cancel.hidden = !active; };
    edit?.addEventListener("click", () => toggle(true));
    cancel?.addEventListener("click", () => { editor.value = view.textContent; toggle(false); });
    save?.addEventListener("click", () => {
      const entry = row.querySelector("[data-memory-kind]");
      if (updateMemoryEntry(personaId, entry.dataset.memoryKind, Number(entry.dataset.memoryIndex), editor.value)) renderMemoryPanel();
    });
  }
}

function bindConsentLink() {
  const link = $("memoryPanel")?.querySelector("[data-memory-open-consent]");
  link?.addEventListener("click", () => {
    $("relationshipIntelligenceConsent")?.scrollIntoView({ behavior: "smooth", block: "center" });
    $("relationshipIntelligenceConsent")?.focus();
  });
}

// ── 工具 ─────────────────────────────────────────────────────────────────────

function getMemoryList(personaId, kind) {
  return getMemoryListFromState(getState(), personaId, kind);
}

function getMemoryListFromState(state, personaId, kind) {
  const enhanced = state?.personaMemory?.[personaId]?._enhanced;
  if (!enhanced) return null;
  const list = kind === "summary" ? enhanced.conversationSummaries : enhanced.memoryTimeline;
  return Array.isArray(list) ? list : null;
}

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
