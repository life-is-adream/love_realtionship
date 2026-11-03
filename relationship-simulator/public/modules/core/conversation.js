import { nextMessageIdFor } from "./message-ids.js";

/** 追加一条消息并分配稳定 mid；调用方负责把它包进 mutate()。 */
export function pushMessage(draft, fields) {
  const message = { ...fields, createdAt: fields.createdAt || new Date().toISOString() };
  message.mid = nextMessageIdFor(draft.messages, message);
  draft.messages.push(message);
  return message;
}

/** 修改调用者提供的会话草稿；不读 DOM、全局 store 或持久化。 */
export function appendGeneratedReply(draft, text, source, personaName, createdAt) {
  const reply = String(text || "").trim();
  if (!reply) return false;
  const last = draft.messages.at(-1);
  if (last?.type === "her" && last.text === reply) return false;
  pushMessage(draft, { who: personaName, type: "her", text: reply, source, createdAt });
  return true;
}
