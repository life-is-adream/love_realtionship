import { escapeHtml } from "../core/dom.js";

const QUESTIONS = [
  { knowledge: "把需要说具体，给彼此选择空间。", question: "最近有什么小事会让你感到被尊重？", action: "各自写下一件具体的小事；可以选择不分享。" },
  { knowledge: "听清对方的感受，再讨论是否需要解决。", question: "当你疲惫时，希望怎样被关心？", action: "各自写一个可执行的方式，并允许不同答案。" },
  { knowledge: "需要空间可以被说明，不必通过沉默惩罚。", question: "你需要独处时，希望怎样告诉对方？", action: "各自写一句自己愿意使用的表达。" }
];

export class PrivatePairSession {
  #crypto;
  #items = { A: null, B: null };
  #approved = { A: false, B: false };
  #plain = { A: null, B: null };
  #revision = 0;

  constructor(cryptoImpl = globalThis.crypto) {
    if (!cryptoImpl?.subtle || !cryptoImpl?.getRandomValues) throw new Error("当前浏览器不支持本地加密。");
    this.#crypto = cryptoImpl;
  }

  async #key(passphrase, salt) {
    const material = await this.#crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    return this.#crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 150000 }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }

  async seal(person, answer, passphrase) {
    if (!["A", "B"].includes(person) || !String(answer || "").trim() || String(answer).length > 1000 || String(passphrase || "").length < 6) {
      throw new TypeError("请填写答案，并设置至少 6 位的本轮口令。");
    }
    const revision = ++this.#revision;
    const salt = this.#crypto.getRandomValues(new Uint8Array(16));
    const iv = this.#crypto.getRandomValues(new Uint8Array(12));
    const key = await this.#key(String(passphrase), salt);
    const ciphertext = await this.#crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(String(answer).trim()));
    if (revision !== this.#revision) throw new Error("本轮已变化，请重新填写。");
    this.#items[person] = { salt, iv, ciphertext };
    this.#approved = { A: false, B: false }; this.#plain = { A: null, B: null };
  }

  async consentShare(person, passphrase) {
    if (!["A", "B"].includes(person) || !this.#items.A || !this.#items.B) throw new Error("双方都封存答案后才能选择分享。");
    const revision = this.#revision;
    const item = this.#items[person];
    try {
      const key = await this.#key(String(passphrase || ""), item.salt);
      const plaintext = await this.#crypto.subtle.decrypt({ name: "AES-GCM", iv: item.iv }, key, item.ciphertext);
      if (revision !== this.#revision) throw new Error("本轮已变化。");
      this.#plain[person] = new TextDecoder().decode(plaintext);
      this.#approved[person] = true;
      return this.#approved.A && this.#approved.B ? { A: this.#plain.A, B: this.#plain.B } : null;
    } catch { throw new Error("口令不正确，或本轮已变化。"); }
  }

  withdraw(person) {
    if (["A", "B"].includes(person)) { this.#revision += 1; this.#approved[person] = false; this.#plain[person] = null; }
  }

  status() {
    return { sealedA: Boolean(this.#items.A), sealedB: Boolean(this.#items.B), approvedA: this.#approved.A, approvedB: this.#approved.B };
  }

  clear() {
    this.#revision += 1;
    this.#items = { A: null, B: null }; this.#approved = { A: false, B: false }; this.#plain = { A: null, B: null };
  }
}

export function initCouplePractice(panel) {
  if (!panel || panel.dataset.coupleBound === "1") return;
  panel.dataset.coupleBound = "1";
  let session;
  try { session = new PrivatePairSession(); }
  catch (error) { panel.textContent = error.message; return; }
  let selected = 0;
  const render = (message = "", revealed = null) => {
    const item = QUESTIONS[selected], status = session.status();
    const options = QUESTIONS.map((q, index) => '<option value="' + index + '"' + (index === selected ? " selected" : "") + ">" + escapeHtml(q.question) + "</option>").join("");
    const participants = ["A", "B"].map((person) => '<details><summary>参与者 ' + person + " · " + (status["sealed" + person] ? "已封存" : "尚未封存") + '</summary>' +
      '<label>自己的答案<textarea id="hfPairAnswer' + person + '" rows="3" maxlength="1000"></textarea></label>' +
      '<label>本轮口令（至少 6 位）<input id="hfPairPass' + person + '" type="password" autocomplete="new-password"></label>' +
      '<div class="workspace-actions"><button class="btn small" type="button" data-pair-action="seal" data-person="' + person + '">封存我的答案</button>' +
      '<button class="btn small ghost" type="button" data-pair-action="share" data-person="' + person + '">我同意分享并解锁</button>' +
      '<button class="btn small ghost" type="button" data-pair-action="withdraw" data-person="' + person + '">撤回分享</button></div></details>').join("");
    const result = revealed ? '<div class="flow-pair-reveal"><p><b>A：</b>' + escapeHtml(revealed.A) + '</p><p><b>B：</b>' + escapeHtml(revealed.B) + "</p></div>" : "";
    panel.innerHTML = '<section class="flow-card"><h2>双人五分钟问题</h2>' +
      '<p class="note">仅在双方自愿时使用。答案先在本页加密封存，双方各自同意后才显示；不自动保存或联网。同一设备并非独立账户，无法防止设备所有者检查内存或旁观。撤回只能隐藏本页内容，无法撤回对方已经看到的信息。</p>' +
      '<label>选择问题<select id="hfPairQuestion">' + options + "</select></label>" +
      "<p><b>知识：</b>" + escapeHtml(item.knowledge) + "</p><p><b>问题：</b>" + escapeHtml(item.question) + "</p><p><b>行动：</b>" + escapeHtml(item.action) + "</p>" +
      participants + '<p class="note">分享状态：A ' + (status.approvedA ? "已同意" : "未同意") + "；B " + (status.approvedB ? "已同意" : "未同意") + "。</p>" +
      result + '<p class="note" role="status">' + escapeHtml(message) + '</p><button class="btn small ghost" type="button" data-pair-action="clear">清空本轮</button></section>';
  };
  render();
  panel.addEventListener("change", (event) => {
    if (event.target.id === "hfPairQuestion") { session.clear(); selected = Number(event.target.value) || 0; render("已切换问题并清空本轮答案。"); }
  });
  panel.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-pair-action]");
    if (!button) return;
    const action = button.dataset.pairAction, person = button.dataset.person;
    if (action === "clear") { session.clear(); render("本轮答案已清空。"); return; }
    if (action === "withdraw") { session.withdraw(person); render("已撤回该参与者的分享同意。"); return; }
    const answer = panel.querySelector("#hfPairAnswer" + person)?.value || "";
    const passphrase = panel.querySelector("#hfPairPass" + person)?.value || "";
    button.disabled = true;
    try {
      if (action === "seal") { await session.seal(person, answer, passphrase); render("参与者 " + person + " 的答案已封存。"); }
      else if (action === "share") {
        const revealed = await session.consentShare(person, passphrase);
        render(revealed ? "双方已同意分享。" : "已记录本人的同意，等待另一方决定。", revealed);
      }
    } catch (error) { render(error.message); }
  });
  globalThis.addEventListener?.("pagehide", () => { session.clear(); render("本轮答案已清空。"); });
}
