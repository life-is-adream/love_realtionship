import test from "node:test";
import assert from "node:assert/strict";
import { COMPLIANCE_MESSAGE, hasAcknowledgedCompliance, initComplianceBanner } from "../public/modules/render/compliance-banner.js";
import { STORAGE_KEYS } from "../public/modules/core/config.js";

function fakeElement() {
  const listeners = {};
  return {
    className: "",
    innerHTML: "",
    textContent: "",
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    querySelector: () => null,
    __listeners: listeners
  };
}

function fakeBanner() {
  const banner = fakeElement();
  const button = fakeElement();
  banner.querySelector = (selector) => (selector === "#complianceAckBtn" ? button : null);
  banner.__ackButton = button;
  return banner;
}

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    dump: () => data
  };
}

function harness({ storage = fakeStorage(), acknowledged = false } = {}) {
  const banner = fakeBanner();
  const elements = new Map([["complianceBanner", banner]]);
  const result = initComplianceBanner({
    getElement: (id) => elements.get(id) || null,
    storage: acknowledged ? fakeStorage({ [STORAGE_KEYS.complianceAck]: "true" }) : storage
  });
  return { banner, result, storage };
}

test("首访（无知悉记录）显示 AI 模拟合规横幅", () => {
  const { banner, result } = harness();
  assert.equal(result.visible, true);
  assert.equal(banner.className, "compliance-banner");
  assert.match(banner.innerHTML, /AI 模拟/);
  assert.ok(banner.innerHTML.includes(COMPLIANCE_MESSAGE));
  assert.match(banner.innerHTML, /非真人/);
});

test("点击「我知道了」后持久化知悉状态并隐藏横幅", () => {
  const { banner, storage } = harness();
  const clickHandlers = banner.__ackButton.__listeners.click;
  assert.ok(Array.isArray(clickHandlers) && clickHandlers.length === 1);
  clickHandlers[0]();
  assert.equal(banner.className, "compliance-banner hidden");
  assert.equal(banner.innerHTML, "");
  assert.equal(storage.dump()[STORAGE_KEYS.complianceAck], "true");
  // 持久化后再次初始化不再显示。
  const again = initComplianceBanner({ getElement: () => banner, storage });
  assert.equal(again.visible, false);
});

test("已持久化知悉状态的访问不再显示横幅", () => {
  const { banner, result } = harness({ acknowledged: true });
  assert.equal(result.visible, false);
  assert.equal(banner.className, "");
  assert.equal(banner.innerHTML, "");
});

test("localStorage 不可用时按已知悉处理（不阻塞、不重复弹）", () => {
  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(hasAcknowledgedCompliance(throwing), true);
  const banner = fakeBanner();
  const result = initComplianceBanner({ getElement: () => banner, storage: throwing });
  assert.equal(result.visible, false);
});

test("页面无横幅挂载点或 getElement 为空时安全跳过", () => {
  const result = initComplianceBanner({ getElement: () => null, storage: fakeStorage() });
  assert.equal(result.visible, false);
});
