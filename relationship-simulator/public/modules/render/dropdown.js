// HeartFlow · custom accessible dropdown
// Enhances every <select> with an on-brand, readable popup while keeping the
// native <select> in the DOM so app.js value reads + dynamic option population
// keep working. Syncs via native "change" events and a MutationObserver.
// Converted from IIFE to ES6 module for directory restructuring.

const CARET =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

function enhance(select) {
  if (!select || select.dataset.hfEnhanced) return;
  select.dataset.hfEnhanced = "1";

  const parent = select.parentNode;
  const wrap = document.createElement("div");
  wrap.className = "select";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "select__trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");

  const label = document.createElement("span");
  label.className = "select__label";

  const caret = document.createElement("span");
  caret.className = "select__caret";
  caret.innerHTML = CARET;

  trigger.appendChild(label);
  trigger.appendChild(caret);

  const menu = document.createElement("div");
  menu.className = "select__menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("tabindex", "-1");

  wrap.appendChild(trigger);
  wrap.appendChild(menu);
  parent.insertBefore(wrap, select);
  wrap.appendChild(select); // move native select inside wrap

  select.classList.add("native-select");

  let activeIndex = -1;

  function currentIndex() {
    return select.selectedIndex >= 0 ? select.selectedIndex : 0;
  }

  function build() {
    menu.innerHTML = "";
    const opts = Array.from(select.options);
    opts.forEach((opt, i) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "select__option";
      item.setAttribute("role", "option");
      item.dataset.index = String(i);
      item.textContent = opt.textContent || opt.value;
      if (i === select.selectedIndex) {
        item.classList.add("is-selected");
        item.innerHTML += ' <span class="tick">✓</span>';
      }
      item.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        choose(i);
      });
      item.addEventListener("mousemove", () => setActive(i));
      menu.appendChild(item);
    });
    label.textContent =
      (select.selectedOptions[0] && select.selectedOptions[0].textContent) ||
      (opts[0] && opts[0].textContent) ||
      "";
  }

  function setActive(i) {
    const items = menu.querySelectorAll(".select__option");
    if (!items.length) return;
    activeIndex = Math.max(0, Math.min(i, items.length - 1));
    items.forEach((el, idx) => el.classList.toggle("is-active", idx === activeIndex));
    items[activeIndex].scrollIntoView({ block: "nearest" });
  }

  function choose(i) {
    select.selectedIndex = i;
    // native change so app.js reacts exactly as before
    select.dispatchEvent(new Event("change", { bubbles: true }));
    build();
    close();
    trigger.focus();
  }

  function open() {
    build();
    wrap.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    setActive(currentIndex());
  }

  function close() {
    wrap.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    activeIndex = -1;
  }

  function toggle() {
    wrap.classList.contains("is-open") ? close() : open();
  }

  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggle();
  });

  trigger.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!wrap.classList.contains("is-open")) open();
      else setActive(activeIndex < 0 ? currentIndex() : Math.min(activeIndex + 1, select.options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!wrap.classList.contains("is-open")) open();
      else setActive(activeIndex <= 0 ? 0 : activeIndex - 1);
    } else if (e.key === "Escape") {
      close();
    }
  });

  menu.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(activeIndex < 0 ? currentIndex() : Math.min(activeIndex + 1, select.options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(activeIndex <= 0 ? 0 : activeIndex - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0) choose(activeIndex);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
      trigger.focus();
    }
  });

  // keep label in sync when the native select changes programmatically
  select.addEventListener("change", build);
  select.addEventListener("hf:sync", build);

  // catch dynamic option rebuilds (personaSelect) + selected changes
  const mo = new MutationObserver(() => build());
  mo.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ["selected"] });

  // close when clicking outside
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) close();
  });

  build();
}

function init() {
  document.querySelectorAll("select:not([data-hf-enhanced])").forEach(enhance);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}

/** Sync the visible label after assigning a native select value in code. */
export function sync(select) {
  const label = select?.parentNode?.querySelector?.(".select__label");
  if (label) {
    label.textContent = (select.selectedOptions?.[0] && select.selectedOptions[0].textContent)
      || select.options?.[select.selectedIndex]?.textContent
      || "";
  } else {
    select?.dispatchEvent?.(new Event("hf:sync"));
  }
}

// expose a manual re-sync (safe to call after async data loads)
export { init, enhance };
