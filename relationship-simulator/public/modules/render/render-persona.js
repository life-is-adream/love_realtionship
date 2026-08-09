import { $, escapeHtml } from "../core/dom.js";
import {
  clampAvatarPosition,
  getAllPersonas,
  getAvatarSettings,
  getCurrentPersona,
  getPersonaMemory,
  getState,
  saveState
} from "../core/state.js";

export function renderPersonaControls() {
  const state = getState();
  const persona = getCurrentPersona();
  const all = getAllPersonas(state.customPersonas);
  const select = $("personaSelect");
  if (select) {
    select.innerHTML = Object.values(all).map((item) => {
      const label = item.id?.startsWith("custom-") ? `自定义 · ${item.name}` : item.name;
      return `<option value="${escapeHtml(item.id)}">${escapeHtml(label)}</option>`;
    }).join("");
    select.value = persona.id;
  }

  const avatar = $("personaAvatar");
  if (avatar) {
    const avatarLabel = persona.avatar || persona.name?.slice(0, 1) || "她";
    const avatarSettings = getAvatarSettings(persona);
    if (avatarSettings.src) {
      avatar.classList.add("has-image");
      avatar.innerHTML = `<img src="${escapeHtml(avatarSettings.src)}" alt="${escapeHtml(persona.name)} 的头像" style="object-position:${avatarSettings.x}% ${avatarSettings.y}%" />`;
    } else {
      avatar.classList.remove("has-image");
      avatar.textContent = avatarLabel;
    }
    $("avatarPosX").value = avatarSettings.x;
    $("avatarPosY").value = avatarSettings.y;
    $("avatarPosX").disabled = !avatarSettings.src;
    $("avatarPosY").disabled = !avatarSettings.src;
    $("resetAvatarBtn").disabled = !avatarSettings.isOverride;
  }
  $("personaName").textContent = persona.name;
  $("personaMeta").textContent = persona.meta;
  $("personaLogic").textContent = persona.logic;
  $("personaChips").innerHTML = (persona.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
  if ($("goal") && (!$('goal').value.trim() || $("goal").dataset.personaSynced === "true")) {
    $("goal").value = persona.defaultGoal || "";
    $("goal").dataset.personaSynced = "true";
  }
  const isCustom = String(persona.id).startsWith("custom-");
  $("deletePersonaBtn").disabled = !isCustom;
  $("customName").value = isCustom ? persona.name : "";
  $("customMeta").value = isCustom ? persona.meta : "";
  $("customTags").value = isCustom ? (persona.tags || []).join(", ") : "";
  $("customLogic").value = isCustom ? persona.logic : "";
  $("customOpening").value = isCustom ? (persona.starterMessages?.find((msg) => msg.type === "her")?.text || "") : "";
  renderMemoryControls();
}

export function renderMemoryControls() {
  const memory = getPersonaMemory();
  if (!$("memoryBackground")) return;
  $("memoryBackground").value = memory.background || "";
  $("memoryInterests").value = memory.interests || "";
  $("memoryBoundaries").value = memory.boundaries || "";
}

export function savePersonaMemory(showStatus = true) {
  const state = getState();
  const persona = getCurrentPersona();
  state.personaMemory[persona.id] = {
    background: $("memoryBackground").value.trim(),
    interests: $("memoryInterests").value.trim(),
    boundaries: $("memoryBoundaries").value.trim()
  };
  saveState();
  if (showStatus) $("apiStatus").textContent = `已保存${persona.name}的场景记忆。`;
}

export function switchPersona(personaId, resetConversation = true, { onChanged = () => {} } = {}) {
  const state = getState();
  const persona = getAllPersonas(state.customPersonas)[personaId];
  if (!persona) return;
  state.personaId = personaId;
  if (resetConversation) {
    state.messages = structuredClone(persona.starterMessages);
    state.lastAnalysis = null;
    $("userInput").value = persona.sampleReply || "";
    $("goal").value = persona.defaultGoal || "";
    $("goal").dataset.personaSynced = "true";
  }
  saveState();
  renderPersonaControls();
  onChanged();
}

export function buildCustomPersona() {
  const state = getState();
  const name = $("customName").value.trim();
  if (!name) throw new Error("自定义角色需要姓名。");
  const meta = $("customMeta").value.trim() || "自定义角色";
  const tags = $("customTags").value.split(/[，,]/).map((item) => item.trim()).filter(Boolean);
  const logic = $("customLogic").value.trim() || "她会观察对方是否自然、尊重、稳定、有边界。";
  const opening = $("customOpening").value.trim() || "今天聊得还挺轻松的。";
  return {
    id: state.personaId?.startsWith("custom-") ? state.personaId : `custom-${Date.now()}`,
    name, avatar: name.slice(0, 1), meta,
    tags: tags.length ? tags : ["自定义", "待观察", "重视边界"],
    logic,
    systemRole: `女方叫${name}，${meta}。角色逻辑：${logic}`,
    starterMessages: [
      { who: "我", type: "me", text: "今天和你聊天还挺轻松的。" },
      { who: name, type: "her", text: opening },
      { who: "我", type: "me", text: "我也这么觉得，刚开始还担心会有点尴尬。" }
    ],
    defaultGoal: "围绕她的真实兴趣自然展开，保持尊重、轻松和边界感。",
    localHerReply: opening
  };
}

export function saveCustomPersona({ onChanged = () => {} } = {}) {
  try {
    const state = getState();
    const persona = buildCustomPersona();
    state.customPersonas[persona.id] = persona;
    state.personaId = persona.id;
    state.messages = structuredClone(persona.starterMessages);
    state.lastAnalysis = null;
    saveState();
    renderPersonaControls();
    onChanged();
    $("apiStatus").textContent = `已保存并切换到${persona.name}。`;
  } catch (error) {
    $("apiStatus").textContent = error.message;
  }
}

export function deleteCurrentPersona({ onChanged = () => {} } = {}) {
  const state = getState();
  const persona = getCurrentPersona();
  if (!String(persona.id).startsWith("custom-")) return;
  delete state.customPersonas[persona.id];
  state.personaId = "lin";
  state.messages = structuredClone(getAllPersonas(state.customPersonas).lin.starterMessages);
  state.lastAnalysis = null;
  saveState();
  renderPersonaControls();
  onChanged();
}

async function resizeAvatarImage(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
  const max = 640;
  const scale = Math.min(1, max / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.88);
}

export async function uploadAvatar(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const state = getState();
    const persona = getCurrentPersona();
    state.avatarOverrides[persona.id] = { ...(state.avatarOverrides[persona.id] || {}), src: await resizeAvatarImage(file) };
    saveState();
    renderPersonaControls();
    $("apiStatus").textContent = "头像已保存到本机。";
  } catch (error) {
    $("apiStatus").textContent = `头像处理失败：${error.message}`;
  } finally {
    event.target.value = "";
  }
}

export function resetAvatar() {
  const state = getState();
  const persona = getCurrentPersona();
  delete state.avatarOverrides[persona.id];
  saveState();
  renderPersonaControls();
}

let avatarDrag = null;
export function beginAvatarDrag(event) {
  if (!getAvatarSettings().src) return;
  avatarDrag = { startX: event.clientX, startY: event.clientY, x: Number($("avatarPosX").value), y: Number($("avatarPosY").value) };
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

export function moveAvatarDrag(event) {
  if (!avatarDrag) return;
  const factor = 1.2;
  setAvatarPosition(avatarDrag.x - (event.clientX - avatarDrag.startX) * factor, avatarDrag.y - (event.clientY - avatarDrag.startY) * factor);
}

export function endAvatarDrag() {
  avatarDrag = null;
}

export function setAvatarPosition(x, y, render = true) {
  const state = getState();
  const persona = getCurrentPersona();
  const settings = getAvatarSettings(persona);
  if (!settings.src) return;
  state.avatarOverrides[persona.id] = { ...(state.avatarOverrides[persona.id] || {}), x: clampAvatarPosition(x), y: clampAvatarPosition(y) };
  saveState();
  if (render) renderPersonaControls();
}
