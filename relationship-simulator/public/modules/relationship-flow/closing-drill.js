import { escapeHtml } from "../core/dom.js";

const CONTENT = Object.freeze({
  version: "closing-1.1",
  exerciseId: "closing-after-decline",
  A: "你邀请同学周末去看展，对方说「谢谢邀请，我不想一起去，这次就算了。」",
  B: "你邀请对方下班后喝咖啡，对方说「我不想单独见面，就不约了。」"
});
const CHECKS = ["尊重对方已经说出的选择", "到这里结束，别让对方再表态"];
const CHECK_LABELS = { unset: "未选择", met: "做到了", revise: "我想调整", unsure: "不确定" };
const STOP_LABEL = "到此为止，不再发消息";
const TITLES = {
  draft: "对方明确拒绝后，练习收尾", revise: "自查并改写", compare: "对照两次选择",
  transfer: "换个情境，独立作答", complete: "本次练习已完成"
};

function action(name, label, primary = false) {
  return `<button class="btn${primary ? " primary" : ""}" type="button" data-closing-action="${name}">${label}</button>`;
}

function replyForm(stage, keepingStop = false) {
  const label = stage === "revise" ? "保存改写" : "提交选择";
  const stopLabel = keepingStop ? "保持停下，不发消息" : STOP_LABEL;
  return `<form data-closing-form="${stage}" autocomplete="off">
    <label for="hfClosingReply">${stage === "revise" ? "你的改写" : "你会怎样收尾？"}</label>
    <textarea id="hfClosingReply" rows="3" autocomplete="off" aria-describedby="hfClosingError"></textarea>
    <div class="workspace-actions"><button class="btn primary" type="submit">${label}</button>${action("stop", stopLabel)}</div>
    <p id="hfClosingError" class="note" role="status"></p>
  </form>`;
}

function choiceText(choice) {
  return choice.kind === "stop" ? STOP_LABEL : escapeHtml(choice.text);
}

function renderStage(session) {
  switch (session.stage) {
    case "draft":
      return `<p class="note">这是虚构情境。</p><p>${CONTENT.A}</p>
        <p>如果你选择回应，写一句收尾的话。你也可以选择停下。</p>${replyForm("draft")}`;
    case "revise": {
      const keepingStop = session.first.kind === "stop";
      return `<p>${CONTENT.A}</p><div data-closing-checks>${CHECKS.map((check, index) => `<label>${check}
        <select data-closing-check="${index}">${Object.entries(CHECK_LABELS).map(([key, value]) => `<option value="${key}">${value}</option>`).join("")}</select></label>`).join("")}</div>
        <p class="note">对方已明确要求别再联系时，停止联系。</p>
        <details data-closing-example><summary>看一个示例</summary><p>收到，谢谢你说清楚。</p></details>
        ${keepingStop ? '<p class="note">你第一次选择了停下。你可以保留这个选择，也可以试写一句收尾。</p>' : ""}
        ${replyForm("revise", keepingStop)}`;
    }
    case "compare": {
      const same = session.first.kind === session.revised.kind && session.first.text === session.revised.text;
      return `<p data-closing-comparison>${same ? "你保留了原来的选择。" : "看看你想保留什么、删掉什么。"}</p>
        <div class="closing-choices"><div><h4>你第一次的选择</h4><p data-closing-first>${choiceText(session.first)}</p></div>
        <div><h4>你修改后的选择</h4><p data-closing-revised>${choiceText(session.revised)}</p></div></div>
        <ul data-closing-checks>${CHECKS.map((check, index) => `<li>${check} · ${CHECK_LABELS[session.checks[index]]}</li>`).join("")}</ul>
        <div class="workspace-actions">${action("transfer", "换个情境", true)}${action("finish", "结束练习")}</div>`;
    }
    case "transfer":
      return `<p class="note">这是虚构情境。</p><p>${CONTENT.B}</p>${replyForm("transfer")}`;
    case "complete": {
      const transfer = session.transfer;
      const review = transfer?.kind === "stop"
        ? "你选择了停在这里，可以让这轮对话就此结束。"
        : "回看你写的这句：有没有接住对方的拒绝？说完后，还需要对方解释或再表态吗？";
      return `${transfer ? `<p>你的换题选择：<span data-closing-transfer>${choiceText(transfer)}</span></p>
        <p data-closing-review>${review}</p>` : "<p>已完成改写，未进行换题。</p>"}
        <p>下次遇到明确拒绝，可以先停下来，再决定是否需要一句简短回应。</p>
        <div class="workspace-actions"><a href="/love-learning.html?course=19" target="_blank" rel="noopener noreferrer">读第 19 课</a>${action("restart", "再练一次")}</div>`;
    }
  }
}

export function createClosingDrill(mount, { onClose } = {}) {
  if (CONTENT.version !== "closing-1.1" || !CONTENT.A || !CONTENT.B || CONTENT.A === CONTENT.B) return null;
  let session = null;
  let composing = false;

  const reset = () => {
    session = null;
    composing = false;
    mount.replaceChildren();
  };

  function render() {
    const { stage, first, outcome } = session;
    composing = false;
    mount.innerHTML = `<section class="flow-card closing-drill" data-closing-stage="${stage}" data-content-version="${CONTENT.version}" data-exercise-id="${CONTENT.exerciseId}"${outcome ? ` data-closing-outcome="${outcome}"` : ""} aria-labelledby="hfClosingHeading">
      <div class="closing-header"><h3 id="hfClosingHeading" tabindex="-1">${TITLES[stage]}</h3>${action("close", "关闭练习")}</div>
      ${renderStage(session)}</section>`;
    if (stage === "revise" && first.kind === "reply") mount.querySelector("#hfClosingReply").value = first.text;
    mount.querySelector("#hfClosingHeading").focus();
  }

  function start(entry) {
    if (entry !== "standalone" && entry !== "analysis") return false;
    reset();
    session = { entry, stage: "draft", first: null, revised: null, transfer: null, checks: ["unset", "unset"], outcome: null };
    render();
    return true;
  }

  function advance(form, stopping = false) {
    if (!session || composing || !form || !mount.contains(form) || form.dataset.closingForm !== session.stage) return;
    const input = form.querySelector("#hfClosingReply");
    const text = stopping ? "" : input.value.trim();
    if (!stopping && (!text || Array.from(text).length > 1200)) {
      input.setAttribute("aria-invalid", "true");
      form.querySelector("#hfClosingError").textContent = "请输入 1 至 1,200 字符，或选择停下。";
      input.focus();
      return;
    }
    const answer = stopping ? { kind: "stop" } : { kind: "reply", text };
    if (session.stage === "draft") {
      session.first = answer;
      session.stage = "revise";
    } else if (session.stage === "revise") {
      session.checks = [...mount.querySelectorAll("[data-closing-check]")].map(({ value }) => Object.hasOwn(CHECK_LABELS, value) ? value : "unset");
      session.revised = answer;
      session.stage = "compare";
    } else if (session.stage === "transfer") {
      session.transfer = answer;
      session.stage = "complete";
      session.outcome = "transferred";
    }
    render();
  }

  mount.addEventListener("compositionstart", () => { composing = true; });
  mount.addEventListener("compositionend", () => { composing = false; });
  mount.addEventListener("input", (event) => {
    const input = event.target;
    if (input.id !== "hfClosingReply" || !mount.contains(input) || !input.hasAttribute("aria-invalid")) return;
    input.removeAttribute("aria-invalid");
    mount.querySelector("#hfClosingError").textContent = "";
  });
  mount.addEventListener("submit", (event) => {
    if (!event.target.matches("[data-closing-form]")) return;
    event.preventDefault();
    advance(event.target);
  });
  mount.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!session || !button || !mount.contains(button)) return;
    if (event.detail > 1) { event.preventDefault(); return; }
    const name = button.dataset.closingAction;
    if (name === "close") { if (onClose) onClose(); else reset(); return; }
    if (name === "stop") { advance(button.closest("form"), true); return; }
    if (name === "restart" && session.stage === "complete") { start(session.entry); return; }
    if (session.stage !== "compare") return;
    if (name === "transfer") session.stage = "transfer";
    else if (name === "finish") {
      session.stage = "complete";
      session.outcome = "revised_only";
    } else return;
    render();
  });
  return { start, reset };
}
