/** 修改调用者提供的会话草稿；不读 DOM、全局 store 或持久化。 */
export function appendGeneratedReply(draft, text, source, personaName, createdAt = new Date().toISOString()) {
  const reply = String(text || "").trim();
  if (!reply) return false;
  const last = draft.messages.at(-1);
  if (last?.type === "her" && last.text === reply) return false;
  draft.messages.push({ who: personaName, type: "her", text: reply, source, createdAt });
  return true;
}
