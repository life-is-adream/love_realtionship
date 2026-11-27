import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const output = process.argv[2];
if (!output?.endsWith(".html")) throw new Error("请指定用于浏览器复验的 HTML 输出路径。");

const publicRoot = new URL("../public/", import.meta.url);
const read = (file) => readFile(new URL(file, publicRoot), "utf8");
const [dom, card, css] = await Promise.all([
  read("modules/core/dom.js"),
  read("modules/relationship-flow/closing-drill.js"),
  read("relationship-flow.css")
]);
const source = card.replace(/^import .* from "\.\.\/core\/dom\.js";$/m, "");
if (source === card) throw new Error("练习模块入口已变更，需更新浏览器检查页。");

async function runBrowserChecks() {
  const mount = document.querySelector("#hfClosingDrill");
  const panel = mount.parentElement;
  const related = ["Analysis", "Courses", "Replies", "Practice", "Feedback", "Weekly"]
    .map((name) => document.getElementById(`hfFlow${name}`));
  const report = document.querySelector("#report");
  const card = createClosingDrill(mount);
  const input = () => document.querySelector("#hfClosingReply");
  const act = (name) => mount.querySelector(`[data-closing-action="${name}"]`).click();
  const submit = () => input().form.requestSubmit();
  const edit = (text) => {
    input().value = text;
    input().dispatchEvent(new Event("input", { bubbles: true }));
  };
  const stage = (value) => Boolean(mount.querySelector(`[data-closing-stage="${value}"]`));
  const check = (label, condition) => {
    const row = document.createElement("li");
    row.textContent = `${condition ? "通过" : "失败"} · ${label}`;
    report.append(row);
    if (!condition) throw new Error(label);
  };

  card.start("analysis");
  check("初稿空白，焦点到新标题", stage("draft") && input().value === "" && document.activeElement.id === "hfClosingHeading");
  edit("🙂".repeat(1201));
  submit();
  check("超限时回到输入框并播报错误", input().getAttribute("aria-invalid") === "true" && document.activeElement === input() &&
    document.querySelector('#hfClosingError[role="status"]').textContent.length > 0);
  edit("<em>虚构初稿</em>");
  check("重新编辑后清除上一条错误", !input().hasAttribute("aria-invalid") && !document.querySelector("#hfClosingError").textContent);
  submit();
  edit("知道了，谢谢你告诉我。");
  submit();
  check("同屏对照保留原文且按纯文本显示", stage("compare") && !mount.querySelector("em") &&
    mount.querySelector("[data-closing-first]").textContent === "<em>虚构初稿</em>");

  const narrow = document.createElement("iframe");
  narrow.title = "窄屏检查";
  narrow.width = "390";
  await new Promise((loaded) => {
    narrow.addEventListener("load", loaded, { once: true });
    narrow.srcdoc = `<!doctype html><style>${document.querySelector("style").textContent}</style>${mount.innerHTML}`;
    document.body.append(narrow);
  });
  const narrowGrid = narrow.contentDocument.querySelector(".closing-choices");
  check("390 像素窄屏中的前后对照上下排列", narrowGrid.children[0].offsetTop < narrowGrid.children[1].offsetTop);
  narrow.hidden = true;

  act("transfer");
  check("换题输入空白，卡片中没有示例、自查、课程或复盘", stage("transfer") && input().value === "" &&
    !mount.querySelector("[data-closing-first], [data-closing-revised], [data-closing-example], [data-closing-checks], [data-closing-review], a"));
  check("独答期间隐藏原页面的课程和六组相关内容", related.every((section) => getComputedStyle(section).display === "none"));
  const stop = mount.querySelector('[data-closing-action="stop"]');
  stop.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 2 }));
  check("连击不会自动提交换题", stage("transfer"));
  edit("收到，我就不约了。");
  submit();
  check("提交后才出现作答复盘并恢复旧内容", stage("complete") && mount.querySelector("[data-closing-review]").textContent.includes("再表态") &&
    related.every((section) => getComputedStyle(section).display !== "none"));
  act("restart");
  act("stop"); act("stop"); act("transfer");
  card.reset();
  check("换题中途关闭也恢复旧内容并清空卡片", !mount.firstChild && related.every((section) => getComputedStyle(section).display !== "none") && panel.contains(mount));
  card.start("standalone");
  act("stop"); act("stop"); act("transfer"); act("stop");
  check("停下后显示对应复盘", stage("complete") && mount.querySelector("[data-closing-review]").textContent.includes("就此结束"));
}

const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>HeartFlow 2.3 浏览器检查</title>
<style>${css}</style><h1>HeartFlow 2.3 浏览器检查</h1><p id="result" role="status">正在检查</p><ol id="report"></ol>
<div id="relationshipFlowPanel"><div id="hfClosingDrill"></div>
${["Analysis", "Courses", "Replies", "Practice", "Feedback", "Weekly"].map((name) => `<div id="hfFlow${name}">合成内容 ${name}</div>`).join("")}
</div>
<script type="module">${dom}\n${source}\n
(${runBrowserChecks.toString()})().then(() => { document.querySelector("#result").textContent = "全部通过"; },
  (error) => { document.querySelector("#result").textContent = "检查失败：" + error.message; });
</script></html>`;

await writeFile(resolve(output), html, { encoding: "utf8", flag: "wx" });
console.log(resolve(output));
