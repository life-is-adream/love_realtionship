import { $, escapeHtml, getMessageSourceLabel } from "../core/dom.js";
import { getCurrentPersona, getState, mutate } from "../core/state.js";

export function renderChat({ afterRender = () => {} } = {}) {
  const chat = $("chat");
  if (!chat) return;
  const state = getState();
  chat.innerHTML = "";
  state.messages.forEach((message, index) => {
    const div = document.createElement("div");
    div.className = `msg ${message.type}`;
    const sourceLabel = message.type === "her" ? getMessageSourceLabel(message.source) : "";
    const speaker = message.type === "me" ? "我" : (message.who || getCurrentPersona().name);
    const recallButton = message.type === "me" && message.source === "user"
      ? `<button class="msg-recall" type="button" data-recall-index="${index}" aria-label="撤回这条消息" title="撤回这条消息">撤回</button>`
      : "";
    const speakButton = message.type === "her"
      ? `<button class="msg-speak" type="button" data-speak-index="${index}" aria-label="朗读这条消息" title="用本地语音朗读这条消息">朗读</button>`
      : "";
    div.innerHTML = `
      <div class="msg-head"><span class="who">${escapeHtml(speaker)}</span>
        ${sourceLabel ? `<span class="msg-source source-${escapeHtml(message.source)}">${escapeHtml(sourceLabel)}</span>` : ""}
        ${speakButton}${recallButton}
      </div>
      <div class="msg-body">${escapeHtml(message.text)}</div>`;
    chat.appendChild(div);
  });
  chat.scrollTop = chat.scrollHeight;
  afterRender();
}

export function recallMine(index) {
  const state = getState();
  const messageIndex = Number(index);
  const message = state.messages[messageIndex];
  if (!Number.isInteger(messageIndex) || messageIndex < 0 || messageIndex >= state.messages.length) {
    return { ok: false, reason: "消息不存在。" };
  }
  if (message?.type !== "me" || message.source !== "user") {
    return { ok: false, reason: "只能撤回自己发送的消息。" };
  }

  const removed = [message];
  let nextIndex = messageIndex + 1;
  while (state.messages[nextIndex]?.type === "her") {
    removed.push(state.messages[nextIndex]);
    nextIndex += 1;
  }
  mutate((s) => { s.messages.splice(messageIndex, removed.length); });
  return { ok: true, message, removed };
}

export function appendMine({ afterRender = () => {} } = {}) {
  const text = $("userInput")?.value.trim();
  if (!text) return false;
  mutate((state) => { state.messages.push({ who: "我", type: "me", text, source: "user", createdAt: new Date().toISOString() }); });
  renderChat({ afterRender });
  return true;
}

export function appendMineIfNew({ afterRender = () => {} } = {}) {
  const text = $("userInput")?.value.trim();
  if (!text) return false;
  const state = getState();
  const last = state.messages[state.messages.length - 1];
  if (last?.type === "me" && last.text === text) return false;
  mutate((s) => { s.messages.push({ who: "我", type: "me", text, source: "user", createdAt: new Date().toISOString() }); });
  renderChat({ afterRender });
  return true;
}

export function appendHerIfNeeded(text, source = "model", { afterRender = () => {} } = {}) {
  const reply = String(text || "").trim();
  if (!reply) return false;
  const state = getState();
  const last = state.messages[state.messages.length - 1];
  if (last?.type === "her" && last.text === reply) return false;
  mutate((s) => { s.messages.push({ who: getCurrentPersona().name, type: "her", text: reply, source, createdAt: new Date().toISOString() }); });
  renderChat({ afterRender });
  return true;
}
