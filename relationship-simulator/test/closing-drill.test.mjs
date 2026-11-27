import test from "node:test";
import assert from "node:assert/strict";
import { canOfferClosingDrill, closingDrillEnabled, initRelationshipFlow } from "../public/modules/relationship-flow/flow.js";
import { createClosingDrill } from "../public/modules/relationship-flow/closing-drill.js";
import { analyzeV2 } from "../server/v2.js";

test("收尾试用只接受唯一、完全匹配的入口参数", () => {
  assert.equal(closingDrillEnabled("?hf_drill=closing-v1"), true);
  for (const input of [undefined, "", "?hf_drill=unknown", "?hf_drill=closing-v1&hf_drill=closing-v1"]) {
    assert.equal(closingDrillEnabled(input), false);
  }
});

test("分析后入口只接受说话人和 Unicode 码点都可回读的降级证据", () => {
  const messages = [{ id: "msg_002", speaker: "other", text: "🙂这次先不约。" }];
  const initial = { decision: {
    category: "DE_ESCALATE", abstain: false, evidence_status: "sufficient", source_message_ids: ["msg_002"],
    safety: { hard_boundary_detected: false, pressure_reply_blocked: true, threat_detected: false },
    evidence: [{ message_id: "msg_002", unit: "unicode_code_point", start: 1, end: 7, text: "这次先不约。" }]
  } };
  assert.equal(canOfferClosingDrill(initial, messages), true);
  for (const patch of [
    { category: "EXIT" }, { category: "OBSERVE" }, { abstain: true }, { abstain: undefined },
    { evidence_status: "insufficient" }, { source_message_ids: [] }, { evidence: [null] },
    { safety: { ...initial.decision.safety, threat_detected: true } },
    { safety: { ...initial.decision.safety, hard_boundary_detected: true } },
    { safety: { ...initial.decision.safety, pressure_reply_blocked: false } },
    ...[{ unit: "utf16" }, { start: 2 }, { end: 8 }, { text: "无来源" }].map((span) => ({ evidence: [{ ...initial.decision.evidence[0], ...span }] }))
  ]) {
    assert.equal(canOfferClosingDrill({ decision: { ...initial.decision, ...patch } }, messages), false, JSON.stringify(patch));
  }
  for (const speaker of ["user", "unknown"]) {
    assert.equal(canOfferClosingDrill(initial, [{ ...messages[0], speaker }]), false);
  }
});

test("解析期间隐藏直接入口，离开后迟到分析仍展示旧结果但不显示练习入口", async (t) => {
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { configurable: true, value: { search: "?hf_drill=closing-v1" } });
  t.after(() => {
    if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation);
    else delete globalThis.location;
  });
  const messages = [
    { id: "msg_001", speaker: "user", text: "周末有空看展吗？" },
    { id: "msg_002", speaker: "other", text: "🙂抱歉。这周先不约。" }
  ];
  const analysis = analyzeV2(messages);
  assert.equal(canOfferClosingDrill(analysis, messages), true);
  let finishImport, finishAnalysis;
  let nextImport = new Promise((resolve) => { finishImport = resolve; });
  let nextAnalysis = new Promise((resolve) => { finishAnalysis = resolve; });
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.endsWith("/imports/chat")) return Response.json(await nextImport);
    if (url.endsWith("/analyses")) return Response.json(await nextAnalysis);
    return Response.json({});
  });
  const elements = new Map([["#hfFlowText", { value: "" }], ["#hfFlowImages", { files: [] }]]);
  const listeners = new Map();
  const panel = {
    dataset: {},
    querySelector(selector) {
      if (!selector.startsWith("#")) return null;
      if (!elements.has(selector)) elements.set(selector, { dataset: {}, addEventListener() {} });
      return elements.get(selector);
    },
    addEventListener(type, handler) { listeners.set(type, [...(listeners.get(type) || []), handler]); }
  };
  const flow = initRelationshipFlow(panel);
  assert.equal(initRelationshipFlow(panel), undefined);
  const click = (flowAction) => listeners.get("click")[0]({ target: { closest: () => ({ dataset: { flowAction }, closest: () => null }) } });
  const parse = click("parse");
  assert.equal(elements.get("#hfClosingStandalone").hidden, true);
  finishImport({ messages: [] });
  await parse;
  assert.equal(elements.get("#hfClosingStandalone").hidden, false);
  nextImport = { messages };
  await click("parse");
  assert.equal(elements.get("#hfClosingStandalone").hidden, true);
  const pending = click("analyze");
  flow.leaveClosingDrill();
  finishAnalysis(analysis);
  await pending;
  assert.match(elements.get("#hfFlowAnalysis").innerHTML, /证据与决策|降低投入/);
  assert.doesNotMatch(elements.get("#hfFlowAnalysis").innerHTML, /data-entry="analysis"/);
  nextAnalysis = analysis;
  await click("analyze");
  assert.match(elements.get("#hfFlowAnalysis").innerHTML, /data-entry="analysis"/);
});

// Simulate only the DOM operations the isolated card needs. The browser gate separately covers layout and navigation.
function setupDrill() {
  const listeners = new Map();
  let generation = 0, markup, form, focused;
  const checks = [{ value: "unset" }, { value: "unset" }];
  const mount = {
    addEventListener(type, listener) { assert.equal(listeners.has(type), false); listeners.set(type, listener); },
    contains(node) { return node?.generation === generation; },
    replaceChildren() { this.innerHTML = ""; },
    querySelectorAll(selector) { assert.equal(selector, "[data-closing-check]"); return checks; },
    querySelector(selector) {
      if (selector === "#hfClosingHeading") return { focus() { focused = true; } };
      return form?.querySelector(selector);
    },
    set innerHTML(next) {
      markup = next;
      generation += 1;
      focused = false;
      checks.forEach((entry) => { entry.value = "unset"; });
      const stage = /data-closing-form="(\w+)"/.exec(next)?.[1];
      const elements = {
        "#hfClosingReply": {
          id: "hfClosingReply", generation, value: "",
          setAttribute(name, value) { this[name] = value; },
          hasAttribute(name) { return Object.hasOwn(this, name); },
          removeAttribute(name) { delete this[name]; },
          focus() { focused = "reply"; }
        },
        "#hfClosingError": { textContent: "" }
      };
      form = stage && {
        generation, dataset: { closingForm: stage },
        matches: (selector) => selector === "[data-closing-form]", querySelector: (selector) => elements[selector]
      };
    }
  };
  const drill = createClosingDrill(mount);
  return {
    drill, checks, mount,
    get markup() { return markup; }, get form() { return form; }, get focused() { return focused; },
    submit(target = form) { listeners.get("submit")({ target, preventDefault() {} }); },
    compose(active) { listeners.get(active ? "compositionstart" : "compositionend")(); },
    edit(value) {
      const target = mount.querySelector("#hfClosingReply");
      target.value = value;
      listeners.get("input")({ target });
    },
    click(action, detail = 1) {
      const button = { generation, dataset: { closingAction: action }, closest: (selector) => selector === "form" ? form : button };
      let prevented = false;
      listeners.get("click")({ target: button, detail, preventDefault() { prevented = true; } });
      return prevented;
    }
  };
}

test("先写后看示例，保留初稿并在换题时移除所有教学提示", () => {
  const page = setupDrill();
  assert.equal(page.drill.start("analysis"), true);
  assert.equal(page.focused, true);
  assert.match(page.markup, /周末去看展/);
  assert.match(page.markup, /data-content-version="closing-1\.1"/);
  assert.doesNotMatch(page.markup, /data-closing-example|data-closing-checks|data-closing-review|course=19/);
  const originalForm = page.form;
  const reply = () => page.mount.querySelector("#hfClosingReply");
  reply().value = "  <em>合成初稿</em>  ";
  page.submit();
  assert.match(page.markup, /已明确要求别再联系时，停止联系/);
  assert.match(page.markup, /data-closing-example/);
  assert.equal(reply().value, "<em>合成初稿</em>");
  page.submit(originalForm);
  assert.match(page.markup, /data-closing-stage="revise"/);
  page.checks[0].value = "met";
  reply().value = "收到，谢谢你说清楚。";
  page.submit();
  assert.match(page.markup, /&lt;em&gt;合成初稿&lt;\/em&gt;/);
  assert.doesNotMatch(page.markup, /<em>合成初稿<\/em>/);
  assert.match(page.markup, /尊重对方已经说出的选择 · 做到了/);
  page.click("transfer");
  assert.equal(reply().value, "");
  assert.match(page.markup, /下班后喝咖啡/);
  assert.doesNotMatch(page.markup, /合成初稿|谢谢你说清楚|data-closing-example|data-closing-checks|data-closing-review|course=19/);
  reply().value = "知道了，谢谢你告诉我。";
  page.submit();
  assert.match(page.markup, /data-closing-outcome="transferred"/);
  assert.match(page.markup, /data-closing-transfer>知道了，谢谢你告诉我/);
  assert.match(page.markup, /data-closing-review>回看你写的这句：有没有接住对方的拒绝？说完后，还需要对方解释或再表态吗？/);
  assert.match(page.markup, /\/love-learning\.html\?course=19/);
  page.click("restart");
  assert.equal(reply().value, "");
  assert.doesNotMatch(page.markup, /合成初稿|知道了/);
});

test("空答不等同于停下，停止选择可直接确认，退出清除草稿", () => {
  const page = setupDrill();
  assert.equal(page.drill.start("invalid"), false);
  page.drill.start("standalone");
  page.mount.querySelector("#hfClosingReply").value = " ";
  page.submit();
  assert.match(page.markup, /data-closing-stage="draft"/);
  assert.match(page.mount.querySelector("#hfClosingError").textContent, /1,200/);
  page.click("stop");
  assert.match(page.markup, /data-closing-stage="revise"/);
  assert.match(page.markup, /保持停下，不发消息/);
  page.click("stop");
  assert.match(page.markup, /你保留了原来的选择/);
  assert.match(page.markup, /data-closing-first>到此为止，不再发消息/);
  page.click("finish");
  assert.match(page.markup, /data-closing-outcome="revised_only"/);
  assert.match(page.markup, /未进行换题/);
  assert.doesNotMatch(page.markup, /data-closing-review/);
  page.click("restart");
  page.mount.querySelector("#hfClosingReply").value = "草稿哨兵";
  page.click("close");
  assert.equal(page.markup, "");
  page.drill.reset();
  page.drill.start("standalone");
  assert.equal(page.mount.querySelector("#hfClosingReply").value, "");
});

test("同一次连击不会确认下一步，换题停下有对应复盘提示", () => {
  const page = setupDrill();
  page.drill.start("standalone");
  page.click("stop");
  assert.equal(page.click("stop", 2), true);
  assert.match(page.markup, /data-closing-stage="revise"/);
  page.click("stop", 0);
  assert.match(page.markup, /data-closing-stage="compare"/);
  page.click("transfer");
  assert.equal(page.click("stop", 2), true);
  assert.match(page.markup, /data-closing-stage="transfer"/);
  assert.doesNotMatch(page.markup, /data-closing-review/);
  page.click("stop");
  assert.match(page.markup, /data-closing-outcome="transferred"/);
  assert.match(page.markup, /data-closing-review>你选择了停在这里/);
  assert.doesNotMatch(page.markup, /回看你写的这句/);
});

test("按码点校验上限，中文输入法合成期间不提交", () => {
  const page = setupDrill();
  page.drill.start("standalone");
  const input = page.mount.querySelector("#hfClosingReply");
  input.value = "🙂".repeat(1201);
  page.submit();
  assert.equal(input["aria-invalid"], "true");
  assert.equal(page.focused, "reply");
  assert.match(page.markup, /data-closing-stage="draft"/);
  page.edit("🙂".repeat(1200));
  assert.equal(input.hasAttribute("aria-invalid"), false);
  assert.equal(page.mount.querySelector("#hfClosingError").textContent, "");
  page.compose(true);
  page.submit();
  assert.match(page.markup, /data-closing-stage="draft"/);
  page.compose(false);
  page.submit();
  assert.match(page.markup, /data-closing-stage="revise"/);
  assert.equal(Array.from(page.mount.querySelector("#hfClosingReply").value).length, 1200);
});
