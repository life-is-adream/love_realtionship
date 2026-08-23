import test from "node:test";
import assert from "node:assert/strict";
import { createTrainingModeController } from "../public/modules/training/training-mode-controller.js";

function fakeElement() {
  const classes = new Set();
  return {
    className: "",
    innerHTML: "",
    textContent: "",
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
      contains(name) { return classes.has(name); }
    }
  };
}

function harness({ confirmed = true } = {}) {
  const state = { trainingMode: "anti" };
  const elements = new Map([
    ["modeBanner", fakeElement()],
    ["modeBtnAnti", fakeElement()],
    ["modeBtnPua", fakeElement()]
  ]);
  let saves = 0;
  let status = "";
  const controller = createTrainingModeController({
    getAppState: () => state,
    saveAppState: () => { saves += 1; },
    getElement: (id) => elements.get(id) || null,
    confirmSwitch: () => confirmed,
    setStatus: (message) => { status = message; }
  });
  return { state, elements, controller, get saves() { return saves; }, get status() { return status; } };
}

test("默认模式隐藏防御训练横幅并激活 anti 按钮", () => {
  const h = harness();
  h.controller.render();

  assert.equal(h.elements.get("modeBtnAnti").classList.contains("is-active"), true);
  assert.equal(h.elements.get("modeBtnPua").classList.contains("is-active"), false);
  assert.equal(h.elements.get("modeBanner").className, "mode-banner hidden");
});

test("切换到识别模式会保存状态并展示只用于防御的边界", () => {
  const h = harness();
  const changed = h.controller.setMode("pua", { ask: true });

  assert.equal(changed, true);
  assert.equal(h.state.trainingMode, "pua");
  assert.equal(h.saves, 1);
  assert.match(h.elements.get("modeBanner").innerHTML, /仅用于识别与防御研究/);
  assert.match(h.status, /PUA 识别训练/);
});

test("用户取消确认时不改变模式也不保存", () => {
  const h = harness({ confirmed: false });
  const changed = h.controller.setMode("pua", { ask: true });

  assert.equal(changed, false);
  assert.equal(h.state.trainingMode, "anti");
  assert.equal(h.saves, 0);
});
