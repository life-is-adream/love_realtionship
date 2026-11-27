#!/usr/bin/env node
/**
 * 浏览器端到端验收（CDP 直连，零第三方依赖）。
 *
 * 覆盖四条只能在真实 DOM 上验证的行为：
 * 1. 身份直问：显示固定答复，来源标为本地；
 * 2. 无记忆时追问自己过往：承认没有记录，不猜；
 * 3. 记忆条目编辑 / 删除后重问：答复随可见条目改变，删除后回到「没有记录」；
 * 4. 刷新后：对话风格选中项与可见标签一致，AI 模拟标识仍在。
 *
 * 默认把 `#endpoint` 指向一个不存在的路径，让教练通道走本地降级，
 * 从而把 E2E 限定在确定性路径上（不依赖上游、不产生费用）；
 * 传 `--live` 则保留 `/api/chat`，连真实上游跑同一条链路。
 *
 * 用法（需先启动 `node server/index.js`）：
 *   node scripts/e2e-browser.mjs --base-url=http://127.0.0.1:3000
 *   node scripts/e2e-browser.mjs --report=docs/verification/2026-11-07-browser-e2e.md
 *
 * 浏览器来源优先级：--chrome= / CHROME_PATH → Playwright 缓存 Chromium → Chrome → Edge。
 * 脚本不下载浏览器；找不到时报明确原因。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AI_IDENTITY_REPLY } from "../public/modules/core/api-client.js";

const HOME = process.env.USERPROFILE || process.env.HOME || "";

function parseArgs(argv) {
  const options = {
    baseUrl: "http://127.0.0.1:3000",
    chrome: process.env.CHROME_PATH || "",
    port: 9333,
    live: false,
    keep: false,
    report: "",
    timeoutMs: 60_000
  };
  for (const arg of argv.slice(2)) {
    const [key, value = ""] = arg.replace(/^--/, "").split("=");
    if (key === "base-url") options.baseUrl = value.replace(/\/$/, "");
    else if (key === "chrome") options.chrome = value;
    else if (key === "port") options.port = Number(value) || options.port;
    else if (key === "live") options.live = true;
    else if (key === "keep") options.keep = true;
    else if (key === "report") options.report = value;
    else if (key === "timeout-ms") options.timeoutMs = Number(value) || options.timeoutMs;
  }
  return options;
}

/** 按优先级找一个可用浏览器：不下载，找不到就说清楚。 */
async function findBrowser(explicit) {
  if (explicit && existsSync(explicit)) return explicit;
  const cacheRoot = path.join(HOME, "AppData", "Local", "ms-playwright");
  if (existsSync(cacheRoot)) {
    const dirs = (await readdir(cacheRoot)).filter((name) => name.startsWith("chromium-")).sort().reverse();
    for (const dir of dirs) {
      for (const rel of ["chrome-win64/chrome.exe", "chrome-win/chrome.exe"]) {
        const candidate = path.join(cacheRoot, dir, rel);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  const fixed = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
  ];
  for (const candidate of fixed) if (existsSync(candidate)) return candidate;
  throw new Error("未找到可用浏览器：请用 --chrome=<路径> 或 CHROME_PATH 指定 chrome.exe。");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    const listeners = new Map();
    let nextId = 0;
    const client = {
      send(method, params = {}) {
        const id = ++nextId;
        socket.send(JSON.stringify({ id, method, params }));
        return new Promise((res, rej) => pending.set(id, { res, rej }));
      },
      on(method, handler) {
        if (!listeners.has(method)) listeners.set(method, []);
        listeners.get(method).push(handler);
      },
      close() { try { socket.close(); } catch { /* ignored */ } }
    };
    socket.addEventListener("open", () => resolve(client));
    socket.addEventListener("error", (event) => reject(new Error(`CDP 连接失败：${event?.message || "unknown"}`)));
    socket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (data.id && pending.has(data.id)) {
        const { res, rej } = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) rej(new Error(`${data.error.message}${data.error.data ? `: ${data.error.data}` : ""}`));
        else res(data.result);
        return;
      }
      for (const handler of listeners.get(data.method) || []) handler(data.params);
    });
  });
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
    } catch { /* not ready */ }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`浏览器调试端口 ${port} 未就绪`);
}

async function firstPageTarget(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((res) => res.json());
      const page = list.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* not ready */ }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("没有可用的页面目标");
}

function createPage(client) {
  async function evaluate(expression) {
    const result = await client.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw new Error(`页面脚本异常：${detail}`);
    }
    return result.result.value;
  }

  async function waitUntil(expression, { timeoutMs = 30_000, label = "条件" } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await evaluate(`Boolean(${expression})`)) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`等待超时：${label}`);
  }

  return {
    evaluate,
    waitUntil,
    async goto(url) {
      await client.send("Page.navigate", { url });
      await waitUntil("document.readyState === 'complete'", { label: "页面加载完成" });
      await waitUntil("document.querySelector('#chat .msg.her')", { label: "聊天记录渲染" });
    },
    async reload() {
      // 用 setTimeout 让 reload 在当前求值返回之后发生，否则 CDP 会因执行上下文销毁而报错。
      await evaluate("setTimeout(() => location.reload(), 0)");
      await waitUntil("document.readyState === 'complete'", { label: "刷新完成" });
      await new Promise((resolve) => setTimeout(resolve, 300));
      await waitUntil("document.querySelector('#chat .msg.her')", { label: "刷新后聊天记录" });
    },
    async setInput(selector, value) {
      return evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()`);
    },
    async click(selector) {
      return evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.click();
        return true;
      })()`);
    },
    async herMessages() {
      return evaluate(`Array.from(document.querySelectorAll("#chat .msg.her")).map((node) => ({
        text: node.querySelector(".msg-body")?.textContent || "",
        source: node.querySelector(".msg-source")?.textContent || ""
      }))`);
    },
    async herCount() {
      return evaluate('document.querySelectorAll("#chat .msg.her").length');
    },
    async statusText() {
      return evaluate('document.querySelector("#apiStatus")?.textContent || ""');
    },
    /** 发送一条消息并等她的回复落地；返回这条回复的文本与来源标签。 */
    async send(text, { timeoutMs = 60_000 } = {}) {
      const before = await this.herCount();
      const typed = await this.setInput("#userInput", text);
      if (!typed) throw new Error("找不到 #userInput");
      // 产品是两步：先落「我」这条，再生成她的回复。少点一步就永远等不到新气泡。
      if (!(await this.click("#sendMineBtn"))) throw new Error("找不到 #sendMineBtn");
      if (!(await this.click("#generateHerBtn"))) throw new Error("找不到 #generateHerBtn");
      await waitUntil(
        `document.querySelectorAll("#chat .msg.her").length > ${before}`,
        { timeoutMs, label: `等待对「${text}」的回复` }
      );
      const messages = await this.herMessages();
      const reply = messages[messages.length - 1];
      // 等教练通道结束，避免下一次发送把在途请求顶掉。
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const status = await this.statusText();
        if (!/正在/.test(status)) break;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return reply;
    }
  };
}

const checks = [];
function record(id, name, ok, evidence) {
  checks.push({ id, name, ok, evidence });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${id} ${name} — ${evidence}`);
}

const SEED_MEMORY = "上周去了杭州，西湖边人很多";
const EDITED_MEMORY = "上周去了成都，吃了火锅";
const RECALL_QUERY = "你还记得我上周去了哪个城市吗？";

/** 只取时间线行的可见文本：同一面板里还可能渲染对话摘要行，混在一起会误判。 */
const TIMELINE_TEXTS = `Array.from(document.querySelectorAll("#memoryPanel li.memory-row"))
  .filter((row) => row.querySelector('[data-memory-kind="timeline"]'))
  .map((row) => row.querySelector("[data-memory-view]")?.textContent || "")`;

async function main() {
  const options = parseArgs(process.argv);
  const health = await fetch(`${options.baseUrl}/api/health`).then((res) => res.json()).catch(() => null);
  if (!health?.ok) throw new Error(`本地服务不可用：${options.baseUrl}/api/health`);

  const executable = await findBrowser(options.chrome);
  const profile = await mkdtemp(path.join(tmpdir(), "hf-e2e-"));
  const browser = spawn(executable, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--mute-audio",
    "--window-size=1280,1000",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${options.port}`,
    "about:blank"
  ], { stdio: "ignore" });

  let client;
  let browserVersion = "";
  try {
    const versionInfo = await waitForPort(options.port, 20_000);
    browserVersion = versionInfo?.Browser || "";
    const target = await firstPageTarget(options.port, 10_000);
    client = await connect(target.webSocketDebuggerUrl);
    const pageErrors = [];
    client.on("Runtime.exceptionThrown", (params) => {
      pageErrors.push(params?.exceptionDetails?.exception?.description || params?.exceptionDetails?.text || "unknown");
    });
    await client.send("Page.enable");
    await client.send("Runtime.enable");

    const page = createPage(client);
    await page.goto(options.baseUrl);

    // 合规横幅是首次访问才出现，关掉它避免遮挡判断（不影响被测逻辑）。
    await page.click("#complianceAckBtn");

    // 授权必须走真实开关：controller 只在 setConsent 里推进请求序号，能把在途刷新作废。
    // 直接用状态入口写 consent 不会推进序号，晚到的刷新会把 consent 翻回旧值，面板退回「未授权」。
    const consentGranted = await page.evaluate(`(() => {
      const box = document.querySelector("#relationshipIntelligenceConsent");
      if (!box) return false;
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    if (!consentGranted) throw new Error("找不到授权开关 #relationshipIntelligenceConsent");

    if (!options.live) {
      // 无效端点：教练通道快速失败并走本地降级，E2E 不依赖上游。
      await page.setInput("#endpoint", "/api/__e2e_offline__");
    }

    // ── 1. 身份直问 ─────────────────────────────────────────────────────────
    const identity = await page.send("你是真人还是 AI？");
    record(
      "identity",
      "身份直问给出固定答复并标为本地",
      identity.text === AI_IDENTITY_REPLY && identity.source === "本地兜底",
      `text=${JSON.stringify(identity.text)} source=${JSON.stringify(identity.source)}`
    );

    // ── 2. 无记忆时追问过往 ─────────────────────────────────────────────────
    const unknown = await page.send(RECALL_QUERY);
    record(
      "unknown-fact",
      "没有记忆条目时不猜城市",
      /没有可靠记录/.test(unknown.text) && !/杭州|成都|北京|上海/.test(unknown.text),
      `text=${JSON.stringify(unknown.text)}`
    );

    // ── 3. 注入一条可见记忆，编辑与删除后重问 ────────────────────────────────
    // 用页面已暴露的状态入口注入合成条目（不读写真实聊天记录）。断言只回读面板里
    // 「时间线那一行」的文本，不数总行数：授权后对话摘要也可能出现在同一面板里。
    let seedRows = 0;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const seeded = await page.evaluate(`(() => {
        const api = globalThis.RelationshipLLM;
        if (!api || typeof api.setState !== "function") return { ok: false, reason: "no-facade" };
        api.setState({
          chatStyle: "daily",
          personaId: "lin",
          messages: [],
          relationshipIntelligence: { consent: true },
          personaMemory: {
            lin: {
              _enhanced: {
                memoryTimeline: [{ content: ${JSON.stringify(SEED_MEMORY)} }],
                conversationSummaries: []
              }
            }
          }
        });
        return { ok: true, rows: ${TIMELINE_TEXTS}.length };
      })()`);
      if (!seeded.ok) throw new Error(`无法注入测试记忆：${seeded.reason}`);
      seedRows = seeded.rows;
      if (seedRows > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    record("memory-visible", "授权后记忆条目在面板中可见", seedRows > 0, `timelineRows=${seedRows}`);

    const withMemory = await page.send(RECALL_QUERY);
    record(
      "memory-recall",
      "有依据时引用可见条目而不是编造",
      withMemory.text.includes("杭州") && !/成都/.test(withMemory.text),
      `text=${JSON.stringify(withMemory.text)}`
    );

    // 编辑：改城市后，重问必须跟着变。定位方式按内容找行，不依赖行序。
    const rowWithText = (text) => `Array.from(document.querySelectorAll("#memoryPanel li.memory-row"))
      .find((row) => (row.querySelector("[data-memory-view]")?.textContent || "").includes(${JSON.stringify(text)}))`;
    const editOpened = await page.evaluate(`(() => {
      const row = ${rowWithText("杭州")};
      const button = row?.querySelector("[data-memory-edit]");
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!editOpened) throw new Error("面板里找不到包含种子的时间线行");
    await page.evaluate(`(() => {
      const row = ${rowWithText("杭州")};
      const editor = row?.querySelector("[data-memory-editor]");
      if (!editor) return false;
      editor.value = ${JSON.stringify(EDITED_MEMORY)};
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await page.evaluate(`(${rowWithText("杭州")})?.querySelector("[data-memory-save]")?.click()`);

    const timelineAfterEdit = await page.evaluate(TIMELINE_TEXTS);
    record(
      "memory-edit-ui",
      "编辑后时间线只剩新内容",
      timelineAfterEdit.some((text) => text.includes("成都")) && !timelineAfterEdit.some((text) => text.includes("杭州")),
      `timeline=${JSON.stringify(timelineAfterEdit)}`
    );

    const afterEdit = await page.send(RECALL_QUERY);
    record(
      "memory-edit-recall",
      "编辑后重问只引用新内容",
      afterEdit.text.includes("成都") && !afterEdit.text.includes("杭州"),
      `text=${JSON.stringify(afterEdit.text)}`
    );

    // 删除：清空所有可见条目（时间线与摘要都可能承载这条事实），再问必须承认没有记录。
    for (let guard = 0; guard < 12; guard += 1) {
      const clicked = await page.evaluate(`(() => {
        const button = document.querySelector("#memoryPanel button[data-memory-kind]");
        if (!button) return false;
        button.click();
        return true;
      })()`);
      if (!clicked) break;
    }
    const timelineAfterDelete = await page.evaluate(TIMELINE_TEXTS);
    const panelAfterDelete = await page.evaluate('document.querySelector("#memoryPanel")?.textContent || ""');
    record(
      "memory-delete-ui",
      "删除后面板不再包含该内容",
      !panelAfterDelete.includes("成都") && !panelAfterDelete.includes("杭州"),
      `timeline=${JSON.stringify(timelineAfterDelete)}`
    );

    const afterDelete = await page.send(RECALL_QUERY);
    record(
      "memory-delete-recall",
      "删除后重问承认没有记录",
      /没有可靠记录/.test(afterDelete.text) && !/成都|杭州/.test(afterDelete.text),
      `text=${JSON.stringify(afterDelete.text)}`
    );

    // live 模式必须证明真的打通了上游：护栏只拦「她」那一侧，教练通道仍要成功。
    if (options.live) {
      const lastStatus = await page.statusText();
      record(
        "live-upstream",
        "教练通道经浏览器真实调用上游成功",
        lastStatus.includes("模型调用成功") && !/失败|未通过/.test(lastStatus),
        `status=${JSON.stringify(lastStatus)}`
      );
    }

    // ── 4. 刷新后的风格标签与身份标识 ────────────────────────────────────────
    await page.evaluate(`(() => {
      const select = document.querySelector("#chatStyle");
      select.value = "gentle";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return select.value;
    })()`);
    const labelBefore = await page.evaluate('document.querySelector("#chatStyle").closest(".select")?.querySelector(".select__label")?.textContent || ""');
    await page.reload();
    const afterReload = await page.evaluate(`(() => {
      const select = document.querySelector("#chatStyle");
      return {
        value: select?.value || "",
        label: select?.closest(".select")?.querySelector(".select__label")?.textContent || "",
        badge: document.querySelector(".ai-role-badge")?.textContent || "",
        messages: document.querySelectorAll("#chat .msg").length
      };
    })()`);
    record(
      "style-persist",
      "刷新后风格选中项与可见标签一致",
      afterReload.value === "gentle" && afterReload.label === "温柔陪伴" && labelBefore === "温柔陪伴",
      `before=${JSON.stringify(labelBefore)} after=${JSON.stringify(afterReload.value)}/${JSON.stringify(afterReload.label)}`
    );
    record(
      "identity-badge",
      "刷新后仍显示 AI 模拟角色标识",
      afterReload.badge.includes("AI 模拟角色") && afterReload.messages > 0,
      `badge=${JSON.stringify(afterReload.badge)} messages=${afterReload.messages}`
    );
    record("no-page-errors", "页面运行期无未捕获异常", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | ") || "0");

    const failed = checks.filter((item) => !item.ok);
    const summary = {
      generatedAt: new Date().toISOString(),
      timezone: "Asia/Shanghai",
      baseUrl: options.baseUrl,
      browser: `${path.basename(executable)} ${browserVersion}`.trim(),
      upstream: options.live ? "live" : "offline-coach",
      passed: checks.length - failed.length,
      failed: failed.length,
      checks
    };

    if (options.report) {
      const targetPath = path.isAbsolute(options.report) ? options.report : path.resolve(process.cwd(), options.report);
      const lines = [
        `# 浏览器端到端验收（${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date())}）`,
        "",
        `- 页面：\`${options.baseUrl}\``,
        `- 浏览器：\`${`${path.basename(executable)} ${browserVersion}`.trim()}\`（headless，CDP 直连）`,
        `- 教练通道：${options.live ? "真实上游 `/api/chat`" : "无效端点，强制本地降级（不依赖上游）"}`,
        "- 记忆注入：页面状态入口 `RelationshipLLM.setState`（合成条目，不读写真实聊天记录）",
        `- 结果：${checks.length - failed.length}/${checks.length} 通过`,
        "",
        "| # | 检查 | 结果 | 证据 |",
        "| --- | --- | --- | --- |",
        ...checks.map((item) => `| ${item.id} | ${item.name} | ${item.ok ? "通过" : "失败"} | ${String(item.evidence).replace(/\|/g, "\\|")} |`)
      ];
      await writeFile(targetPath, `${lines.join("\n")}\n`, "utf8");
      console.log(`报告：${path.relative(process.cwd(), targetPath)}`);
    }

    if (failed.length) process.exitCode = 1;
  } finally {
    client?.close();
    browser.kill();
    if (!options.keep) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error("E2E 失败：", error?.message || error);
  process.exitCode = 1;
});
