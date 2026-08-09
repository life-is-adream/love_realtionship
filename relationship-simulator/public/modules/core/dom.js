export const $ = (id) => document.getElementById(id);

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[ch]));
}

export function getMessageSourceLabel(source) {
  if (source === "model") return "MiMo";
  if (source === "local") return "本地兜底";
  if (source === "seed") return "初始";
  return "";
}
