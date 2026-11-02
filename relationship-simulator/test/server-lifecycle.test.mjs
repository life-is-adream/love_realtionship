import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, writeFile, readFile, unlink, rmdir, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequestHandler, isDirectEntry } from "../server/request-handler.js";
import { withUpstreamRequest } from "../server/upstream-request.js";

function dependencies(overrides = {}) {
  const fail = async () => { await Promise.resolve(); throw new Error("offline route failure"); };
  return {
    resolveCorsOrigin: () => "http://localhost:3000",
    sendJson: (res, status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); },
    sendText: (res, status, body) => { res.writeHead(status); res.end(body); },
    handleHealth: fail, handleChat: fail, handleSearch: fail,
    handleRelationshipIntelligence: fail, handleLongContent: fail, handleTts: fail, handleTtsHealth: fail, serveStatic: fail,
    ...overrides
  };
}

test("每个异步路由的拒绝都得到受控 500，服务继续响应", async (t) => {
  const server = createServer(createRequestHandler(dependencies()));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const [method, url] of [
    ["GET", "/api/health"], ["POST", "/api/chat"], ["POST", "/api/search"],
    ["POST", "/api/relationship-intelligence"], ["GET", "/api/long-content/1"], ["GET", "/index.html"],
    ["POST", "/api/tts"], ["GET", "/api/tts/health"]
  ]) {
    const result = await new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: server.address().port, path: url, method }, res => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", chunk => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(result.status, 500, `${method} ${url}`);
    assert.equal(result.body.error, "server_error");
  }
});

test("路由错误不会重写已结束响应，已发送响应头时关闭连接", async () => {
  const handler = createRequestHandler(dependencies());
  for (const state of [{ destroyed: true }, { writableEnded: true }, { headersSent: true }]) {
    let writes = 0, closes = 0;
    const res = { ...state, writeHead: () => { writes++; }, end: () => { writes++; }, destroy: () => { closes++; } };
    await handler({ method: "GET", url: "/index.html", headers: {} }, res);
    assert.equal(writes, 0);
    assert.equal(closes, state.headersSent ? 1 : 0);
  }
});

test("入口匹配真实文件身份，支持相对路径和别名并拒绝同名文件", async (t) => {
  const first = await mkdtemp(path.join(tmpdir(), "heartflow-entry-"));
  const second = await mkdtemp(path.join(tmpdir(), "heartflow-entry-"));
  const entry = path.join(first, "index.js"), alias = path.join(first, "alias.js"), other = path.join(second, "index.js");
  await writeFile(entry, "// offline entry\n");
  await writeFile(other, "// different entry\n");
  await link(entry, alias);
  t.after(async () => {
    await Promise.all([unlink(entry), unlink(alias), unlink(other)]);
    await Promise.all([rmdir(first), rmdir(second)]);
  });
  const url = pathToFileURL(entry);
  assert.equal(isDirectEntry(url, entry), true);
  assert.equal(isDirectEntry(url, path.relative(process.cwd(), entry)), true);
  assert.equal(isDirectEntry(url, alias), true);
  assert.equal(isDirectEntry(url, other), false);
  assert.equal(isDirectEntry(url, path.join(first, "missing.js")), false);
  assert.equal(isDirectEntry(url, ""), false);
});

test("上游生命周期覆盖响应体读取的超时并清理监听器", async (t) => {
  const res = new EventEmitter();
  // The production timeout is unref'ed; this reference keeps the isolated test alive.
  const keepAlive = setTimeout(() => {}, 1_000);
  t.after(() => clearTimeout(keepAlive));
  const result = withUpstreamRequest(res, 10, async signal => {
    await Promise.resolve();
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  });
  await assert.rejects(result, { name: "TimeoutError" });
  assert.equal(res.listenerCount("close"), 0);
});

test("已断开的客户端不会启动上游，成功和失败均释放监听器", async () => {
  const closed = Object.assign(new EventEmitter(), { destroyed: true });
  let calls = 0;
  await assert.rejects(withUpstreamRequest(closed, 1_000, async () => { calls++; }), { name: "AbortError" });
  assert.equal(calls, 0);
  assert.equal(closed.listenerCount("close"), 0);
  const res = new EventEmitter();
  assert.equal(await withUpstreamRequest(res, 1_000, async () => "ok"), "ok");
  assert.equal(res.listenerCount("close"), 0);
  await assert.rejects(withUpstreamRequest(res, 1_000, async () => { throw new Error("offline failure"); }), /offline failure/);
  assert.equal(res.listenerCount("close"), 0);
});

// Copy only the reviewed source modules to a fixture with a synthetic config.
// Importing the real config would read the user's .env, even with fetch mocked.
async function offlineModules(t, apiMode = "responses") {
  const dir = await mkdtemp(path.join(tmpdir(), "heartflow-upstream-"));
  const modules = ["http.js", "upstream-request.js", "llmProxy.js", "searchProxy.js", "rateLimit.js", "healthRoute.js"];
  const files = [...modules, "package.json", "config.js"];
  t.after(async () => { await Promise.all(files.map(file => unlink(path.join(dir, file)))); await rmdir(dir); });
  await Promise.all(modules.map(async file => writeFile(path.join(dir, file), await readFile(new URL(`../server/${file}`, import.meta.url)))));
  await writeFile(path.join(dir, "package.json"), '{"type":"module"}');
  await writeFile(path.join(dir, "config.js"), `
export const PORT=3000, LLM_API_KEY="offline-placeholder", LLM_API_MODE="${apiMode}", LLM_ENDPOINT="https://offline.invalid", LLM_MODEL="offline-model", LLM_MAX_COMPLETION_TOKENS=1000, LLM_REASONING_EFFORT="medium", LLM_TEMPERATURE=0.7, LLM_TOP_P=1;
export const SEARCH_ALLOWED_DOMAINS=["example.test"], SEARCH_API_KEY="offline-placeholder", SEARCH_ENABLED=true, SEARCH_ENDPOINT="https://offline.invalid", SEARCH_MODEL="offline-model", SEARCH_ALLOWED_DOMAINS_EXPLICIT=true;
export const maskEndpoint=()=>"masked-offline-endpoint";
`);
  return {
    chat: await import(pathToFileURL(path.join(dir, "llmProxy.js"))),
    search: await import(pathToFileURL(path.join(dir, "searchProxy.js"))),
    health: await import(pathToFileURL(path.join(dir, "healthRoute.js")))
  };
}

test("chat_completions 模式透传 thinking 且拒绝非法值；responses 模式不带它", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const upstream = () => ({
    status: 200,
    ok: true,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify({ choices: [{ message: { content: "早啊" } }] })
  });
  const drive = async (modules, body) => {
    let payload;
    globalThis.fetch = async (_url, options) => {
      payload = JSON.parse(options.body);
      return upstream();
    };
    const req = Object.assign(new PassThrough(), { socket: { remoteAddress: "127.0.0.1" }, headers: {} });
    const res = Object.assign(new EventEmitter(), {
      writableEnded: false, destroyed: false, writeHead: () => {}, end: () => {}
    });
    const task = modules.chat.handleChat(req, res);
    req.end(JSON.stringify(body));
    await task;
    return payload;
  };
  const chatModules = await offlineModules(t, "chat_completions");
  const base = { messages: [{ role: "user", content: "offline test" }] };
  assert.deepEqual((await drive(chatModules, { ...base, thinking: { type: "disabled" }, max_completion_tokens: 200 })).thinking, { type: "disabled" }, "MiMo 思考默认开启，关不掉就等于每轮多花 29 个推理 token");
  assert.equal((await drive(chatModules, base)).max_completion_tokens, 1000, "未指定时用配置默认值");
  assert.equal("thinking" in await drive(chatModules, { ...base, thinking: { type: "yolo" } }), false);
  const responsesModules = await offlineModules(t, "responses");
  assert.equal("thinking" in await drive(responsesModules, { ...base, thinking: { type: "disabled" } }), false, "responses 模式用 reasoning.effort，不发 thinking");
});

test("LLM 和搜索在客户端断开时取消读取中的上游响应体", async (t) => {
  const modules = await offlineModules(t);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const kind of ["chat", "search"]) {
    let signal, started;
    const ready = new Promise(resolve => { started = resolve; });
    globalThis.fetch = async (_url, options) => {
      signal = options.signal;
      const payload = JSON.parse(options.body);
      if (kind === "search") assert.deepEqual(payload, { query: "offline test", count: 5 });
      else assert.deepEqual(payload.input, [{ role: "user", content: "offline test" }]);
      return { status: 200, ok: true, text: () => {
        started();
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      } };
    };
    const req = Object.assign(new PassThrough(), { socket: { remoteAddress: "127.0.0.1" }, headers: {} });
    let writes = 0;
    const res = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false, writeHead: () => { writes++; }, end: () => { writes++; } });
    const body = kind === "search" ? { query: "offline test" } : { messages: [{ role: "user", content: "offline test" }] };
    const task = kind === "search" ? modules.search.handleSearch(req, res) : modules.chat.handleChat(req, res);
    req.end(JSON.stringify(body));
    await ready;
    res.destroyed = true;
    res.emit("close");
    await task;
    assert.equal(signal.aborted, true, kind);
    assert.equal(writes, 0, kind);
    assert.equal(res.listenerCount("close"), 0, kind);
    globalThis.fetch = originalFetch;
  }
});

test("健康响应提供稳定服务标识且保留旧字段", async (t) => {
  const modules = await offlineModules(t);
  let status, payload;
  modules.health.handleHealth({ writeHead: value => { status = value; }, end: body => { payload = JSON.parse(body); } });
  assert.equal(status, 200);
  assert.deepEqual(payload, { ok: true, service: "heartflow", endpoint: "masked-offline-endpoint", model: "offline-model", apiMode: "responses", hasApiKey: true });
});

test("取消信号阻止首次请求及 5xx 后的重试", async (t) => {
  const modules = await offlineModules(t);
  const alreadyClosed = new AbortController();
  alreadyClosed.abort();
  let calls = 0;
  await assert.rejects(modules.chat.fetchWithRetry("https://offline.invalid", { signal: alreadyClosed.signal }, {
    fetchImpl: async () => { calls++; return { status: 200 }; }
  }), { name: "AbortError" });
  assert.equal(calls, 0);
  const controller = new AbortController();
  await assert.rejects(modules.chat.fetchWithRetry("https://offline.invalid", { signal: controller.signal }, {
    delayMs: 0,
    fetchImpl: async () => {
      calls++;
      return { status: 503, body: { cancel: async () => controller.abort() } };
    }
  }), { name: "AbortError" });
  assert.equal(calls, 1);
});
