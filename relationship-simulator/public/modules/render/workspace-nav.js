/** 教程工作区导航：仅切换可见性，保留各面板中的表单与状态。 */

const VIEW_COPY = Object.freeze({
  home: { title: "恋爱成长学习目录", description: "按当前需要选择课程或练习，从一个具体问题开始。" },
  caseflow: { title: "聊天分析与训练", description: "核对聊天、查看依据和课程，再练习一种表达。" },
  chat: { title: "对话练习", description: "练习倾听、自我表达和尊重边界的来回互动。" },
  practice: { title: "每日小练习", description: "一次只练一个动作，用几分钟练清楚表达。" },
  journey: { title: "连续约会练习", description: "跟随连续情境，练习邀约、相处和关系选择。" },
  real: { title: "现实练习与复盘", description: "按实际卡点准备行动，记录可观察结果与下一步。" },
  coach: { title: "分析与建议", description: "结合当前对话，查看依据、局限和可执行建议。" },
  growth: { title: "成长记录", description: "回看练习记录与复盘；练习分数仅表示题目规则符合度。" },
  abilities: { title: "个人恋爱能力画像", description: "用自评与情境练习定位八个方面的短板，再选择两个训练重点。" },
  lifestyle: { title: "形象与身心知识", description: "学习健身、护肤、穿搭、声音，以及女性生理和心理知识；每张卡可查看依据、练习与来源。" },
  settings: { title: "设置与档案", description: "调整模拟、角色和模型设置，管理导出、备份与恢复。" }
});

const controllers = new WeakMap();
const validView = (value) => typeof value === "string" && Object.hasOwn(VIEW_COPY, value);
const viewFromHash = (hash) => typeof hash === "string" && hash.startsWith("#") && validView(hash.slice(1)) ? hash.slice(1) : null;

export function initWorkspaceNav({ root = globalThis.document, initialView = "home", onViewChange = () => {} } = {}) {
  if (!root || typeof root.querySelectorAll !== "function") throw new TypeError("工作区导航需要可查询的页面根节点");
  if (controllers.has(root)) return controllers.get(root);
  const panels = [...root.querySelectorAll("[data-view-panel]")];
  const links = [...root.querySelectorAll("[data-view]")];
  const title = root.querySelector("#workspaceTitle");
  const description = root.querySelector("#workspaceDescription");
  const sidebar = root.querySelector("#workspaceSidebar");
  const menuToggle = root.querySelector("#workspaceMenuToggle");
  const browser = root.defaultView || root.ownerDocument?.defaultView || globalThis.window;
  const panelByView = new Map();
  for (const panel of panels) {
    if (validView(panel.dataset.viewPanel) && !panelByView.has(panel.dataset.viewPanel)) panelByView.set(panel.dataset.viewPanel, panel);
  }
  let current = null;

  function setMenuOpen(open) {
    // 桌面目录保持可见；移动展开由 CSS 的 .is-open 决定。
    sidebar?.classList.toggle("is-open", open);
    menuToggle?.setAttribute("aria-expanded", String(open));
  }

  function resolveView(requested) {
    const view = validView(requested) ? requested : "home";
    if (panelByView.has(view) || panels.length === 0) return view;
    return panelByView.has("home") ? "home" : panelByView.keys().next().value || "home";
  }

  function replaceHash(view) {
    if (browser?.location && browser.location.hash !== `#${view}` && typeof browser.history?.replaceState === "function") {
      browser.history.replaceState(null, "", `#${view}`);
    }
  }

  function applyView(requested, { focus = true, writeHash = false } = {}) {
    const view = resolveView(requested);
    const activePanel = panelByView.get(view);
    const changed = current !== view;
    for (const panel of panels) {
      const hidden = panel !== activePanel;
      panel.hidden = hidden;
      panel.inert = hidden;
      panel.setAttribute("aria-hidden", String(hidden));
      if (hidden) panel.setAttribute("inert", "");
      else panel.removeAttribute("inert");
    }
    for (const link of links) {
      const active = link.dataset.view === view;
      link.classList.toggle("active", active);
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    if (title) title.textContent = VIEW_COPY[view].title;
    if (description) description.textContent = VIEW_COPY[view].description;
    current = view;
    setMenuOpen(false);
    if (writeHash && browser?.location && browser.location.hash !== `#${view}`) browser.location.hash = `#${view}`;
    if (focus) {
      const focusTarget = title || activePanel;
      if (focusTarget) {
        focusTarget.tabIndex = -1;
        focusTarget.focus?.({ preventScroll: true });
      }
    }
    if (changed && typeof onViewChange === "function") onViewChange(view);
    return view;
  }

  const controller = {
    show(view, { focus = true } = {}) { return applyView(view, { focus, writeHash: true }); },
    currentView() { return current; }
  };
  controllers.set(root, controller);
  for (const link of links) link.addEventListener("click", (event) => {
    event.preventDefault();
    controller.show(link.dataset.view);
  });
  menuToggle?.addEventListener("click", () => {
    setMenuOpen(menuToggle.getAttribute("aria-expanded") !== "true");
  });
  menuToggle?.setAttribute("aria-controls", "workspaceSidebar");
  browser?.addEventListener("hashchange", () => {
    const hashView = viewFromHash(browser.location.hash);
    const view = resolveView(hashView || "home");
    // 浏览器前进/后退只更新界面；非法路由替换当前项，不增加历史。
    if (!hashView || hashView !== view) replaceHash(view);
    if (view !== current) applyView(view);
  });
  const hash = browser?.location?.hash || "";
  const firstView = resolveView(viewFromHash(hash) || (hash ? "home" : initialView));
  applyView(firstView, { focus: false });
  if (!viewFromHash(hash) || firstView !== viewFromHash(hash)) replaceHash(firstView);
  return controller;
}
