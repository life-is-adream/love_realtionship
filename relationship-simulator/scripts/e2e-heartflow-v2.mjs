#!/usr/bin/env node
// 合成数据、本地假模型、独立临时浏览器配置；不访问真实模型，不删除临时目录。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const binary = path.join(root, "heartflow-c", "hf-v2-build.exe");
const browserPath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => p && existsSync(p));
if (!browserPath || !existsSync(binary)) throw new Error("缺少浏览器或 C 测试构建。");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const server = createNetServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
let modelCalls = 0, modelDelayMs = 0;
const fake = createServer(async (req, res) => {
  let raw = ""; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || "{}"); modelCalls++;
  const all = JSON.stringify(body.messages || []);
  let content;
  if (all.includes("image_url")) content = JSON.stringify({ messages: [{ speaker: "other", text: "这是截图中的合成消息", timestamp_text: "" }], uncertain: ["请核对"] });
  else if (all.includes("独立的沟通训练评估者")) content = JSON.stringify({ dimensions: ["listening", "clarity", "boundary", "naturalness", "conflict"].map((id) => ({ id, applicable: true, score: 3, reason: "合成评语", evidence: [{ message_id: "practice_user_1", quote: "听起来你很忙" }] })) });
  else if (all.includes("replyOptions")) content = JSON.stringify({ replyOptions: [
    { key: "A", text: "好，你先忙，方便的时候再聊。", effect: "留出时间" },
    { key: "B", text: "听起来你最近挺忙的，先照顾好自己。", effect: "表达关心" },
    { key: "C", text: "我先不打扰了，等你方便再说。", effect: "尊重空间" }
  ] });
  else content = "谢谢你理解，我想先安排好这周的事情。";
  if (modelDelayMs) await sleep(modelDelayMs);
  const result = JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] });
  res.writeHead(200, { "content-type": "application/json" }); res.end(result);
});
await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
const cPort = await freePort(), debugPort = await freePort();
const profile = await mkdtemp(path.join(tmpdir(), "hf-v2-browser-"));
const env = { ...process.env, LLM_ENDPOINT: `http://127.0.0.1:${fake.address().port}/v1/chat/completions`, LLM_API_KEY: "synthetic-only", LLM_MODEL: "synthetic-model", VISION_MODEL: "synthetic-vision", LLM_API_MODE: "chat_completions" };
const app = spawn(binary, ["serve", "--port", String(cPort), "--root", root], { cwd: root, env, stdio: "ignore", windowsHide: true });
const browser = spawn(browserPath, ["--headless=new", "--disable-gpu", "--disable-background-networking", "--disable-extensions", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, "about:blank"], { stdio: "ignore", windowsHide: true });
let socket;
const checks = [];
function check(label, value) { if (!value) throw new Error(label); checks.push(label); console.log("PASS " + label); }
try {
  let target;
  for (let i = 0; i < 200; i++) {
    try {
      const health = await fetch(`http://127.0.0.1:${cPort}/api/health`).then((r) => r.json());
      const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json());
      target = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
      if (health.ok && target) break;
    } catch { /* 正在启动 */ }
    await sleep(100);
  }
  if (!target) throw new Error("测试浏览器或本机服务启动失败。");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const pending = new Map(), pageErrors = []; let id = 0;
  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.method === "Runtime.exceptionThrown") pageErrors.push(data.params?.exceptionDetails?.text || "页面异常");
    if (data.id && pending.has(data.id)) {
      const [resolve, reject] = pending.get(data.id); pending.delete(data.id);
      data.error ? reject(new Error(data.error.message)) : resolve(data.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const callId = ++id; pending.set(callId, [resolve, reject]); socket.send(JSON.stringify({ id: callId, method, params })); });
  const evaluate = async (expression) => {
    const value = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
    return value.result.value;
  };
  const until = async (expr, label) => {
    for (let i = 0; i < 160; i++) { if (await evaluate(`Boolean(${expr})`)) return; await sleep(100); }
    const status = await evaluate("document.querySelector('#hfFlowStatus')?.textContent || ''");
    throw new Error(label + " 超时：" + status);
  };
  const set = (selector, value) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw Error('缺少输入控件'); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  const click = (selector) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw Error('缺少按钮 ' + ${JSON.stringify(selector)}); e.click(); })()`);
  const toggle = (selector, checked) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw Error('缺少开关'); e.checked = ${checked}; e.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  const act = (name) => click(`[data-flow-action="${name}"]`);
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: `http://127.0.0.1:${cPort}/#caseflow` });
  await until("document.querySelector('#hfFlowText')", "页面加载");
  await evaluate("window.confirm = () => true");
  check("关系分析入口展示", await evaluate("!document.querySelector('[data-view-panel=caseflow]').hidden"));
  await set("#hfCaseName", "合成关系 A"); await act("case-create"); await toggle("#hfCaseConsent", true);

  await set("#hfFlowText", "我：周末有空一起看电影吗？\n对方：最近有点忙。");
  await act("parse"); await until("document.querySelectorAll('#hfFlowEditor .flow-message').length === 2", "解析聊天");
  await set("#hfFlowEditor .flow-message:nth-child(2) [data-flow-field=text]", "这周工作忙，暂时没空。");
  await act("replies-only"); await until("document.querySelectorAll('#hfFlowReplies .flow-replies article').length === 3", "快速回复");
  check("快速回复无需先显示完整报告", await evaluate("!document.querySelector('#hfFlowAnalysis').textContent.trim()"));
  await click('[data-flow-action="practice"]'); await until("document.querySelector('#hfPracticeReply')", "快速回复进入练习");
  check("快速回复可直接进入练习", await evaluate("Boolean(document.querySelector('#hfPracticeReply').value)"));
  await evaluate(`(() => {
    const original = globalThis.fetch;
    globalThis.__restoreSlowFetch = () => { globalThis.fetch = original; };
    globalThis.fetch = async (...args) => {
      if (String(args[0]).includes('/learning/recommendations')) await new Promise((resolve) => setTimeout(resolve, 1500));
      return original(...args);
    };
  })()`);
  await act("analyze");
  await new Promise((resolve) => setTimeout(resolve, 600));
  check("慢课程不阻塞已完成的分析与回复", await evaluate("Boolean(document.querySelector('#hfFlowAnalysis h3')) && document.querySelectorAll('#hfFlowReplies .flow-replies article').length === 3 && !document.querySelector('#hfFlowCourses a[href*=course]')"));
  await evaluate("globalThis.__restoreSlowFetch()");
  await until("document.querySelectorAll('#hfFlowCourses a[href*=course]').length > 0", "课程补齐");
  await act("analyze"); await until("document.querySelector('#hfFlowAnalysis h3') && document.querySelectorAll('#hfFlowReplies .flow-replies article').length === 3 && document.querySelectorAll('#hfFlowCourses a[href*=course]').length > 0", "分析和回复");
  check("纠错后分析包含源消息", await evaluate("document.querySelector('#hfFlowAnalysis').textContent.includes('这周工作忙，暂时没空。') && document.querySelector('#hfFlowAnalysis').textContent.includes('msg_002')"));
  check("课程链接和三种回复", await evaluate("document.querySelectorAll('#hfFlowCourses a[href*=course]').length > 0 && document.querySelectorAll('#hfFlowReplies .flow-replies article').length === 3"));
  check("原聊天未自动写入浏览器存储", await evaluate("!Object.values(localStorage).join(' ').includes('周末有空一起看电影吗')"));
  const beforeReply = modelCalls;
  await toggle("#hfReplyModelConsent", true); await act("model-replies");
  await until("document.querySelector('#hfFlowStatus').textContent.includes('模型建议已生成')", "模型回复建议");
  check("模型回复经授权及基础校验后展示", modelCalls > beforeReply && await evaluate("document.querySelector('#hfFlowReplies').textContent.includes('模型生成')"));

  await click('[data-flow-action="practice"]'); await until("document.querySelector('#hfPracticeReply')", "练习情境");
  const beforeRole = modelCalls;
  await toggle("#hfPracticeModelConsent", true);
  await set("#hfPracticeReply", "听起来你很忙，我尊重你的选择。"); await act("practice-turn");
  await until("document.querySelectorAll('#hfPracticeTurns .flow-turn').length === 2", "第一轮模拟");
  check("经授权的 AI 角色生成多轮回应", modelCalls > beforeRole && await evaluate("document.querySelector('#hfPracticeTurns').textContent.includes('AI 模拟角色')"));
  await toggle("#hfPracticeModelConsent", false);
  await set("#hfPracticeReply", "我希望我们有机会再聊，不急。"); await act("practice-turn");
  await until("document.querySelectorAll('#hfPracticeTurns .flow-turn').length === 4", "第二轮模拟");
  await set("#hfPracticeBranch", "declined"); await toggle("#hfPracticeModelConsent", true);
  await set("#hfPracticeReply", "我明白了，谢谢你说清楚。"); await act("practice-turn");
  await until("document.querySelectorAll('#hfPracticeTurns .flow-turn').length === 6", "拒绝分支");
  check("模型偏离拒绝分支时使用明确结束回应", await evaluate("document.querySelector('#hfPracticeTurns').textContent.includes('不想继续这次互动') && document.querySelector('[data-flow-action=practice-turn]').disabled"));
  await act("feedback"); await until("document.querySelector('#hfFlowFeedback h3')", "练习反馈");
  check("多轮练习和可定位评分依据", await evaluate("document.querySelector('#hfFlowFeedback').textContent.includes('practice_user_1') && document.querySelectorAll('#hfPracticeTurns .flow-turn').length === 6"));
  await toggle("#hfEvaluationConsent", true); await act("model-evaluation");
  await until("document.querySelector('#hfModelEvaluation').textContent.includes('独立模型复核')", "模型复核");
  check("独立模型复核使用合成模型及原文证据", await evaluate("document.querySelector('#hfModelEvaluation').textContent.includes('听起来')"));
  await act("save-assessment");
  check("用户主动保存规则分数并显示成长图", await evaluate("document.querySelector('#hfFlowCases .flow-growth-chart') && document.querySelector('#hfFlowStatus').textContent.includes('未保存练习原文')"));
  await set("#hfGrowthScenario", "first-meeting");
  check("筛选成长图时保持面板展开", await evaluate("document.querySelector('#hfGrowthDetails').open && document.querySelector('#hfFlowCases').textContent.includes('所选情境和维度还没有')"));
  await set("#hfGrowthScenario", "low-energy-reply");
  await act("weekly-generate"); await until("document.querySelector('#hfFlowWeekly').textContent.includes('本周重点')", "生成计划");
  await act("weekly-save");
  check("个性化每周计划保存", await evaluate("document.querySelector('#hfFlowStatus').textContent.includes('已保存')"));

  await set("#hfCaseObservation", "双方约定稍后再讨论"); await act("case-event");
  check("经授权记录关系事件", await evaluate("document.querySelector('#hfFlowCases').textContent.includes('双方约定稍后再讨论')"));
  await set("#hfCaseName", "合成关系 B"); await act("case-create");
  check("第二个档案默认无授权且不显示第一段记录", await evaluate("!document.querySelector('#hfCaseConsent').checked && !document.querySelector('#hfFlowCases').textContent.includes('双方约定稍后再讨论')"));
  await evaluate("location.reload()"); await until("document.querySelector('#hfCaseSelect')", "刷新后恢复"); await evaluate("window.confirm = () => true");
  check("每周计划刷新后保留", await evaluate("document.querySelector('#hfFlowWeekly').textContent.includes('本周重点')"));
  await evaluate(`(() => { const e=document.querySelector('#hfCaseSelect'); e.value=[...e.options].find(x=>x.textContent==='合成关系 A').value; e.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  check("切回档案恢复对应事件", await evaluate("document.querySelector('#hfFlowCases').textContent.includes('双方约定稍后再讨论')"));
  check("切回档案恢复已授权评分", await evaluate("Boolean(document.querySelector('#hfFlowCases .flow-growth-chart'))"));
  await toggle("#hfCaseConsent", false);
  check("撤回授权清除对应事件与评分", await evaluate("!document.querySelector('#hfFlowCases').textContent.includes('双方约定稍后再讨论') && !document.querySelector('#hfFlowCases .flow-growth-chart')"));

  const pair = (action, person) => click(`[data-pair-action="${action}"][data-person="${person}"]`);
  await set("#hfPairAnswerA", "我希望提前沟通"); await set("#hfPairPassA", "test-pass-a"); await pair("seal", "A");
  await until("document.querySelector('#hfFlowCouple').textContent.includes('参与者 A 的答案已封存')", "封存 A");
  await set("#hfPairAnswerB", "我希望互相倾听"); await set("#hfPairPassB", "test-pass-b"); await pair("seal", "B");
  await until("document.querySelector('#hfFlowCouple').textContent.includes('参与者 B 的答案已封存')", "封存 B");
  await set("#hfPairPassA", "test-pass-a"); await pair("share", "A");
  await until("document.querySelector('#hfFlowCouple').textContent.includes('等待另一方决定')", "同意 A");
  check("单方同意时不显示双方答案", await evaluate("!document.querySelector('.flow-pair-reveal')"));
  await set("#hfPairPassB", "test-pass-b"); await pair("share", "B");
  await until("document.querySelector('.flow-pair-reveal')", "同意 B");
  check("双方同意后显示答案", await evaluate("document.querySelector('.flow-pair-reveal').textContent.includes('互相倾听')"));
  await pair("withdraw", "A"); check("撤回后隐藏已显示内容", await evaluate("!document.querySelector('.flow-pair-reveal')"));

  await evaluate(`(() => { const c=document.createElement('canvas'); c.width=30;c.height=30; const d=c.toDataURL('image/png'); const b=Uint8Array.from(atob(d.split(',')[1]),ch=>ch.charCodeAt(0)); const dt=new DataTransfer(); dt.items.add(new File([b],'synthetic.png',{type:'image/png'})); document.querySelector('#hfFlowImages').files=dt.files; })()`);
  const before = modelCalls; await act("screenshots");
  check("截图未同意时不调用模型", modelCalls === before && await evaluate("document.querySelector('#hfFlowStatus').textContent.includes('请先确认')"));
  await toggle("#hfFlowVisionConsent", true); await act("screenshots");
  await until("document.querySelector('#hfFlowEditor').textContent.includes('消息 1')", "截图识别");
  check("截图经本地假模型识别后可编辑", modelCalls > before && await evaluate("document.querySelector('#hfFlowEditor textarea').value.includes('合成消息')"));
  await act("clear");
  await evaluate(`(() => { const c=document.createElement('canvas'); c.width=30;c.height=30; const d=c.toDataURL('image/png'); const b=Uint8Array.from(atob(d.split(',')[1]),ch=>ch.charCodeAt(0)); const dt=new DataTransfer(); dt.items.add(new File([b],'synthetic.png',{type:'image/png'})); document.querySelector('#hfFlowImages').files=dt.files; })()`);
  await toggle("#hfFlowVisionConsent", true);
  modelDelayMs = 1200; const beforeCancel = modelCalls; await act("screenshots");
  for (let i = 0; i < 100 && modelCalls === beforeCancel; i++) await sleep(25);
  check("延迟模型请求已发出", modelCalls > beforeCancel);
  await act("cancel"); await sleep(1500); modelDelayMs = 0;
  check("取消等待后迟到的结果不会显示", await evaluate("!document.querySelector('#hfFlowEditor textarea') && document.querySelector('#hfFlowStatus').textContent.includes('已停止等待')"));
  await act("clear");
  await set("#hfFlowText", "我：还能联系吗？\n对方：请不要再联系我。\n对方：嗯。");
  await act("parse"); await until("document.querySelectorAll('#hfFlowEditor .flow-message').length === 3", "拒绝聊天解析");
  await act("replies-only"); await until("document.querySelectorAll('#hfFlowReplies .flow-replies article').length === 3", "拒绝回复");
  const beforeGuard = modelCalls; await toggle("#hfReplyModelConsent", true); await act("model-replies");
  await until("document.querySelector('#hfFlowStatus').textContent.includes('保留本地的尊重边界建议')", "历史拒绝保护");
  check("此前明确拒绝仍阻止追求式模型建议", modelCalls === beforeGuard && await evaluate("document.querySelector('#hfFlowReplies').textContent.includes('停止联系')"));
  check("页面没有未捕获脚本异常", pageErrors.length === 0);
  console.log(`\n浏览器检查：${checks.length}/${checks.length} 通过；仅使用合成数据和本地假模型。`);
} finally {
  socket?.close(); browser.kill(); app.kill(); await new Promise((resolve) => fake.close(resolve));
}
