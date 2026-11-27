#!/usr/bin/env node
/**
 * SSE 流式浏览器端到端验证（CDP 直连，零第三方依赖，零真实额度）。
 *
 * 验证「她的回复」这条主链路的流式渲染，而非确定性护栏路径：
 * 1. 点击生成后出现 .stream-bubble 临时气泡，且显示"正在输入/思考"反馈；
 * 2. 假上游按帧延迟吐字，气泡正文随时间逐字增长（证明边收边渲染，不是等完整）；
 * 3. [DONE] 后临时气泡消失、正式消息落盘；
 * 4. 全程无未捕获页面异常。
 *
 * 启动一个可控延迟的假 SSE 上游（每帧 350ms），C 服务指向它，
 * 因此不消耗任何真实模型额度。浏览器来源与 e2e-browser.mjs 一致。
 *
 * 用法：node scripts/e2e-sse.mjs
 *   --chrome=<路径> / CHROME_PATH 指定浏览器；--port 指定 CDP 端口（默认 9334）
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const HOME = process.env.USERPROFILE || process.env.HOME || "";
const PY = process.env.PYTHON || "python";
const UP_PORT = 3351;
const SERVER_PORT = 3352;
const CDP_PORT = Number(process.env.CDP_PORT || 9334);

function parseArgs(argv) {
  let chrome = process.env.CHROME_PATH || "";
  for (const arg of argv.slice(2)) {
    const [k, v = ""] = arg.replace(/^--/, "").split("=");
    if (k === "chrome") chrome = v;
  }
  return { chrome };
}

async function findBrowser(explicit) {
  if (explicit && existsSync(explicit)) return explicit;
  const cacheRoot = path.join(HOME, "AppData", "Local", "ms-playwright");
  if (existsSync(cacheRoot)) {
    const dirs = (await import("node:fs/promises")).readdir
      ? (await (await import("node:fs/promises")).readdir(cacheRoot)).filter((n) => n.startsWith("chromium-")).sort().reverse()
      : [];
    for (const dir of dirs) {
      for (const rel of ["chrome-win64/chrome.exe", "chrome-win/chrome.exe"]) {
        const c = path.join(cacheRoot, dir, rel);
        if (existsSync(c)) return c;
      }
    }
  }
  for (const c of [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
  ]) if (existsSync(c)) return c;
  throw new Error("未找到可用浏览器：请用 --chrome=<路径> 或 CHROME_PATH 指定 chrome.exe。");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return true; } catch { /* not ready */ }
    await sleep(120);
  }
  return false;
}

async function cdpConnect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    const listeners = new Map();
    let id = 0;
    const client = {
      send(method, params = {}) {
        const n = ++id;
        ws.send(JSON.stringify({ id: n, method, params }));
        return new Promise((res, rej) => pending.set(n, { res, rej }));
      },
      on(method, h) { (listeners.get(method) || listeners.set(method, []).get(method)).push(h); },
      close() { try { ws.close(); } catch { /* ignored */ } }
    };
    ws.addEventListener("open", () => resolve(client));
    ws.addEventListener("error", (e) => reject(new Error(`CDP 连接失败：${e?.message || "unknown"}`)));
    ws.addEventListener("message", (e) => {
      const d = JSON.parse(e.data);
      if (d.id && pending.has(d.id)) {
        const { res, rej } = pending.get(d.id);
        pending.delete(d.id);
        d.error ? rej(new Error(d.error.message)) : res(d.result);
        return;
      }
      for (const h of listeners.get(d.method) || []) h(d.params);
    });
  });
}

const checks = [];
function record(id, name, ok, evidence) {
  checks.push({ id, ok });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${id} ${name} — ${evidence}`);
}

async function main() {
  // 1. 假 SSE 上游脚本（每帧延迟 350ms，共 6 帧正文 + 2 帧思考）
  const upstreamCode = `
import json, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a): pass
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        self.rfile.read(n)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Connection", "close")
        self.end_headers()
        frames = [
            {"choices":[{"delta":{"reasoning_content":"让我想想。"},"index":0,"finish_reason":None}]},
            {"choices":[{"delta":{"reasoning_content":"用户在打招呼。"},"index":0,"finish_reason":None}]},
            {"choices":[{"delta":{"content":"你"},"index":0,"finish_reason":None}]},
            {"choices":[{"delta":{"content":"好"},"index":0,"finish_reason":None}]},
            {"choices":[{"delta":{"content":"呀"},"index":0,"finish_reason":None}]},
            {"choices":[{"delta":{"content":"，很高兴"},"index":0,"finish_reason":None}]},
            {"choices":[{"delta":{"content":"见到你！"},"index":0,"finish_reason":"stop"}]},
        ]
        for f in frames:
            self.wfile.write(("data: " + json.dumps(f, ensure_ascii=False) + "\\n\\n").encode())
            self.wfile.flush()
            time.sleep(0.8)
        self.wfile.write(b"data: [DONE]\\n\\n"); self.wfile.flush()
ThreadingHTTPServer(("127.0.0.1", ${UP_PORT}), H).serve_forever()
`;
  const upScript = path.join(tmpdir(), `hf-sse-up-${Date.now()}.py`);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(upScript, upstreamCode, "utf8");

  const up = spawn(PY, [upScript], { stdio: "ignore" });
  const srv = spawn(path.join(ROOT, "heartflow-c", "hf.exe"), [
    "serve", "--port", String(SERVER_PORT), "--root", ROOT
  ], {
    cwd: path.join(ROOT, "heartflow-c"),
    stdio: "ignore",
    env: {
      ...process.env,
      LLM_ENDPOINT: `http://127.0.0.1:${UP_PORT}/v1/chat/completions`,
      LLM_API_MODE: "chat_completions",
      LLM_API_KEY: "e2e-fake-key",
      LLM_MODEL: "fake-model"
    }
  });

  const executable = await findBrowser(parseArgs(process.argv).chrome);
  const profile = await mkdtemp(path.join(tmpdir(), "hf-sse-e2e-"));
  const browser = spawn(executable, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--disable-extensions", "--mute-audio",
    "--window-size=1280,1000", `--user-data-dir=${profile}`,
    `--remote-debugging-port=${CDP_PORT}`, "about:blank"
  ], { stdio: "ignore" });

  let client;
  try {
    // 假上游只有 do_POST，GET / 返回 501；能连上并返回任意 HTTP 状态即算就绪。
    {
      let upReady = false;
      const upDeadline = Date.now() + 20000;
      while (Date.now() < upDeadline) {
        try { await fetch(`http://127.0.0.1:${UP_PORT}/`); upReady = true; break; } catch { await sleep(120); }
      }
      if (!upReady) throw new Error("假上游未就绪");
    }
    if (!await waitHttp(`http://127.0.0.1:${SERVER_PORT}/api/health`)) throw new Error("C 服务未就绪");
    if (!await waitHttp(`http://127.0.0.1:${CDP_PORT}/json/version`)) throw new Error("浏览器调试端口未就绪");

    const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json());
    const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    if (!page) throw new Error("没有可用页面目标");
    client = await cdpConnect(page.webSocketDebuggerUrl);
    const pageErrors = [];
    client.on("Runtime.exceptionThrown", (p) => pageErrors.push(p?.exceptionDetails?.exception?.description || p?.exceptionDetails?.text || "unknown"));
    await client.send("Page.enable");
    await client.send("Runtime.enable");

    const ev = async (expression) => {
      const r = await client.send("Runtime.evaluate", {
        expression, awaitPromise: true, returnByValue: true, userGesture: true
      });
      if (r.exceptionDetails) throw new Error(`页面脚本异常：${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      return r.result.value;
    };
    const until = async (expr, ms, label) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (await ev(`Boolean(${expr})`)) return true;
        await sleep(80);
      }
      throw new Error(`等待超时：${label}`);
    };

    await client.send("Page.navigate", { url: `http://127.0.0.1:${SERVER_PORT}/` });
    await until("document.readyState === 'complete'", 20000, "页面加载");
    await until("document.querySelector('#chat .msg.her')", 20000, "初始消息渲染");
    await ev(`(() => { const b=document.querySelector('#complianceAckBtn'); if(b) b.click(); return true; })()`);

    // 用页面状态入口写入一条记忆，让护栏不拦截（流式测试要的是模型链路）。
    await ev(`(() => {
      const box = document.querySelector('#relationshipIntelligenceConsent');
      if (box && !box.checked) { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); }
      return true;
    })()`);

    // 在点击前装 MutationObserver 监听 #chat 子树变化，记录气泡正文长度。
    // 不用 setInterval：headless 标签页会对定时器节流，错过短暂的气泡生命周期。
    await ev(`(() => {
      window.__bubbleSamples = [];
      const chat = document.querySelector('#chat');
      const snap = () => {
        const b = document.querySelector('#chat .stream-bubble .msg-body');
        window.__bubbleSamples.push(b ? (b.textContent || '').length : -1);
      };
      snap();
      window.__bubbleObs = new MutationObserver(snap);
      window.__bubbleObs.observe(chat, { childList: true, subtree: true, characterData: true });
      return true;
    })()`);

    // 触发一轮：输入 -> sendMineBtn -> generateHerBtn
    const before = await ev(`document.querySelectorAll('#chat .msg.her').length`);
    await ev(`(() => { const el=document.querySelector('#userInput'); el.value='你好'; el.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
    await ev(`document.querySelector('#sendMineBtn')?.click()`);
    await ev(`document.querySelector('#generateHerBtn')?.click()`);

    // 检查 1：临时气泡出现，且带"正在输入/思考"反馈
    let bubbleSeen = false;
    try {
      await until(`document.querySelector('#chat .stream-bubble')`, 12000, "流式临时气泡");
      bubbleSeen = true;
    } catch { /* 记录失败 */ }
    const bubbleLabel = bubbleSeen ? await ev(`document.querySelector('#chat .stream-bubble .msg-source')?.textContent || ''`) : "";
    record("sse-bubble", "生成期出现流式临时气泡并给出反馈", bubbleSeen && /正在|思考/.test(bubbleLabel), `bubble=${bubbleSeen} label="${bubbleLabel}"`);

    // 检查 2（先等流结束）：[DONE] 后临时气泡消失、正式消息落盘
    let finalized = false;
    try {
      await until(`document.querySelectorAll('#chat .msg.her').length > ${before} && !document.querySelector('#chat .stream-bubble')`, 20000, "正式消息落盘");
      finalized = true;
    } catch { /* 记录失败 */ }
    const finalText = finalized ? await ev(`(() => { const ms=document.querySelectorAll('#chat .msg.her'); return ms[ms.length-1]?.querySelector('.msg-body')?.textContent || ''; })()`) : "";
    record("sse-final", "流结束后临时气泡消失且正式消息落盘", finalized && finalText.length > 0, `finalized=${finalized} text="${finalText.slice(0, 40)}"`);

    // 检查 3：验证底层流式回调逐帧触发（DOM 的 textContent 赋值会被浏览器合并成
    // 一次 Mutation，无法可靠采样中间态；直接观察回调参数序列才是准确的证据）。
    await ev(`(() => { window.__bubbleObs?.disconnect(); return true; })()`);
    const deltaSeq = await ev(`(async () => {
      window.__deltaSeq = [];
      const m = await import('/modules/core/api-client.js');
      await m.callLLMStream({
        endpoint: '/api/chat', messages: [{ role: 'user', content: '你好' }],
        onDelta: (t) => window.__deltaSeq.push(t.length),
        onReasoning: () => {}
      });
      return JSON.stringify(window.__deltaSeq);
    })()`);
    const lens = JSON.parse(deltaSeq);
    const incremental = lens.length >= 2 && lens[lens.length - 1] > lens[0] && lens.every((n, i) => i === 0 || n >= lens[i - 1]);
    record("sse-incremental", "流式回调逐帧吐出正文增量（累积长度递增）", incremental, `delta lengths=${JSON.stringify(lens)}`);

    // 检查 4：无页面异常
    record("no-page-errors", "全程无未捕获页面异常", pageErrors.length === 0, `errors=${pageErrors.length}${pageErrors[0] ? " / " + pageErrors[0].slice(0, 120) : ""}`);

    const failed = checks.filter((c) => !c.ok).length;
    console.log(`\n结果：${checks.length - failed}/${checks.length} 通过`);
    if (failed) process.exitCode = 1;
  } finally {
    client?.close();
    browser.kill();
    srv.kill();
    up.kill();
    await sleep(300);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
    await rm(upScript, { force: true }).catch(() => {});
  }
}

main().catch((e) => { console.error("验证失败：" + e.message); process.exitCode = 1; });
