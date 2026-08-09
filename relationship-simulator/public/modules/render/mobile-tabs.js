import { $ } from "../core/dom.js";

const ACTIVE_TAB_KEY = "heartflow-active-tab";

export function initMobileTabs() {
  const tabs = $("mobileTabs");
  if (!tabs) return;
  tabs.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));
  switchTab(localStorage.getItem(ACTIVE_TAB_KEY) || "chat");
}

export function switchTab(tabName) {
  const tabs = $("mobileTabs");
  if (!tabs) return;
  tabs.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabName));
  document.querySelectorAll(".panel[data-panel]").forEach((panel) => panel.classList.toggle("tab-active", panel.dataset.panel === tabName));
  if (tabName === "coach") clearCoachUnread();
  try { localStorage.setItem(ACTIVE_TAB_KEY, tabName); } catch { /* ignored */ }
}

export function markCoachUnread() { document.querySelector(".unread-dot")?.classList.remove("hidden"); }
export function clearCoachUnread() { document.querySelector(".unread-dot")?.classList.add("hidden"); }
