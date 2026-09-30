import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { extractModelContent, fetchWithRetry, handleChat, normalizeProxyResponse } from "../server/llmProxy.js";
import { readRequestJson, resolveCorsOrigin, RequestBodyTooLargeError, sendJson, serveStatic } from "../server/staticServer.js";
import { handleLongContent } from "../server/routes-longContent.js";
import { checkRateLimit, rateBuckets } from "../server/rateLimit.js";
import { inferApiMode, maskEndpoint, normalizeApiMode } from "../server/config.js";
import { isAllowedSearchSource, normalizeSearchResults } from "../server/searchProxy.js";

// ── staticServer: readRequestJson ─────────────────────────────────────────────

function fakeReq(chunks) {
  const req = new EventEmitter();
  req.setEncoding = () => {};
  req.destroy = () => {};
  queueMicrotask(() => {
    for (const chunk of chunks) req.emit("data", chunk);
    req.emit("end");
  });
  return req;
}

test("readRequestJson 解析合法 JSON", async () => {
  const body = await readRequestJson(fakeReq(['{"a":1}']));
  assert.deepEqual(body, { a: 1 });
});

test("readRequestJson 空请求体解析为空对象", async () => {
  const body = await readRequestJson(fakeReq([]));
  assert.deepEqual(body, {});
});

test("readRequestJson 非法 JSON 抛出", async () => {
  await assert.rejects(() => readRequestJson(fakeReq(["not json"])), /Invalid JSON/);
});

test("readRequestJson 超过 2MB 抛出 BODY_TOO_LARGE 错误码", async () => {
  const big = JSON.stringify({ data: "x".repeat(2_100_000) });
  await assert.rejects(
    () => readRequestJson(fakeReq([big.slice(0, 1_100_000), big.slice(1_100_000)])),
    (err) => err instanceof RequestBodyTooLargeError && err.code === "BODY_TOO_LARGE"
  );
});

// ── staticServer: CORS ────────────────────────────────────────────────────────

test("resolveCorsOrigin 放行 localhost 与 127.0.0.1 任意端口", () => {
  assert.equal(resolveCorsOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.equal(resolveCorsOrigin("http://127.0.0.1:8080"), "http://127.0.0.1:8080");
});

test("resolveCorsOrigin 外部来源回落到默认源", () => {
  assert.equal(resolveCorsOrigin("http://evil.example.com"), "http://localhost:3000");
  assert.equal(resolveCorsOrigin(""), "http://localhost:3000");
});

test("resolveCorsOrigin 放行 RFC1918 私有网段（局域网访问场景）", () => {
  assert.equal(resolveCorsOrigin("http://192.168.1.5:3000"), "http://192.168.1.5:3000");
  assert.equal(resolveCorsOrigin("http://10.0.0.2:8080"), "http://10.0.0.2:8080");
  assert.equal(resolveCorsOrigin("http://172.16.0.9:3000"), "http://172.16.0.9:3000");
  assert.equal(resolveCorsOrigin("http://172.31.255.1:3000"), "http://172.31.255.1:3000");
  assert.equal(resolveCorsOrigin("http://nas.local:3000"), "http://nas.local:3000");
});

test("resolveCorsOrigin 拒绝非私有网段与边界外地址", () => {
  assert.equal(resolveCorsOrigin("http://172.15.0.1:3000"), "http://localhost:3000");
  assert.equal(resolveCorsOrigin("http://172.32.0.1:3000"), "http://localhost:3000");
  assert.equal(resolveCorsOrigin("http://11.0.0.1:3000"), "http://localhost:3000");
  assert.equal(resolveCorsOrigin("http://193.168.1.5:3000"), "http://localhost:3000");
  assert.equal(resolveCorsOrigin("http://localhost.evil.com:3000"), "http://localhost:3000");
});

test("resolveCorsOrigin 支持自定义端口参数", () => {
  assert.equal(resolveCorsOrigin("http://localhost:4000", 4000), "http://localhost:4000");
});

// ── staticServer: sendJson 支持附加头 ─────────────────────────────────────────

test("sendJson 携带额外响应头", () => {
  const headers = {};
  const res = {
    writeHead: (status, head) => { res.status = status; Object.assign(headers, head); },
    end: () => {}
  };
  sendJson(res, 200, { ok: true }, { "Access-Control-Allow-Origin": "*" });
  assert.equal(res.status, 200);
  assert.equal(headers["Access-Control-Allow-Origin"], "*");
});

// ── llmProxy: 响应归一化 ──────────────────────────────────────────────────────

test("extractModelContent 支持 output_text / output / choices", () => {
  assert.equal(extractModelContent({ output_text: " 你好 " }), "你好");
  assert.equal(extractModelContent({ output: [{ content: [{ type: "output_text", text: "回复A" }] }] }), "回复A");
  assert.equal(extractModelContent({ choices: [{ message: { content: "回复B" } }] }), "回复B");
  assert.equal(extractModelContent({ choices: [{ text: "回复C" }] }), "回复C");
  assert.equal(extractModelContent(null), "");
  assert.equal(extractModelContent({}), "");
});

test("normalizeProxyResponse 保持 chat_completions 模式原样", () => {
  const raw = JSON.stringify({ choices: [{ message: { content: "x" } }] });
  assert.equal(normalizeProxyResponse(raw, "application/json"), raw);
});

test("normalizeProxyResponse 对非 JSON 内容原样返回", () => {
  assert.equal(normalizeProxyResponse("<html>oops</html>", "text/html"), "<html>oops</html>");
});

// ── llmProxy: fetchWithRetry ──────────────────────────────────────────────────

test("fetchWithRetry 5xx 后重试并成功", async () => {
  const calls = [];
  const fakeFetch = async () => {
    calls.push(1);
    return { status: calls.length === 1 ? 500 : 200 };
  };
  const res = await fetchWithRetry("https://x", {}, { attempts: 2, delayMs: 0, fetchImpl: fakeFetch });
  assert.equal(calls.length, 2);
  assert.equal(res.status, 200);
});

test("fetchWithRetry 网络错误后重试并成功", async () => {
  const calls = [];
  const fakeFetch = async () => {
    calls.push(1);
    if (calls.length === 1) throw new Error("ECONNREFUSED");
    return { status: 200 };
  };
  const res = await fetchWithRetry("https://x", {}, { attempts: 2, delayMs: 0, fetchImpl: fakeFetch });
  assert.equal(calls.length, 2);
  assert.equal(res.status, 200);
});

test("fetchWithRetry 4xx 不重试", async () => {
  const calls = [];
  const fakeFetch = async () => { calls.push(1); return { status: 429 }; };
  const res = await fetchWithRetry("https://x", {}, { attempts: 3, delayMs: 0, fetchImpl: fakeFetch });
  assert.equal(calls.length, 1);
  assert.equal(res.status, 429);
});

test("fetchWithRetry 超时错误不重试（直接抛出）", async () => {
  const calls = [];
  const fakeFetch = async () => {
    calls.push(1);
    const err = new Error("timeout");
    err.name = "TimeoutError";
    throw err;
  };
  await assert.rejects(
    () => fetchWithRetry("https://x", {}, { attempts: 3, delayMs: 0, fetchImpl: fakeFetch }),
    /timeout/
  );
  assert.equal(calls.length, 1);
});

test("fetchWithRetry 持续 5xx 用尽重试后抛出", async () => {
  const fakeFetch = async () => ({ status: 503 });
  await assert.rejects(
    () => fetchWithRetry("https://x", {}, { attempts: 2, delayMs: 0, fetchImpl: fakeFetch }),
    /upstream 503/
  );
});

// ── rateLimit ─────────────────────────────────────────────────────────────────

test("checkRateLimit 允许窗口内 24 次并拒绝第 25 次", () => {
  rateBuckets.clear();
  const ip = "127.0.0.1:test";
  for (let i = 0; i < 24; i += 1) assert.equal(checkRateLimit(ip), true);
  assert.equal(checkRateLimit(ip), false);
  rateBuckets.clear();
});

test("checkRateLimit 不同 IP 独立计数", () => {
  rateBuckets.clear();
  const a = "1.1.1.1";
  const b = "2.2.2.2";
  for (let i = 0; i < 24; i += 1) checkRateLimit(a);
  assert.equal(checkRateLimit(a), false);
  assert.equal(checkRateLimit(b), true);
  rateBuckets.clear();
});

// ── config ────────────────────────────────────────────────────────────────────

test("inferApiMode 按端点路径判断模式", () => {
  assert.equal(inferApiMode("https://api.openai.com/v1/responses"), "responses");
  assert.equal(inferApiMode("https://api.deepseek.com/chat/completions"), "chat_completions");
  assert.equal(inferApiMode("https://example.com/v1/chat/completions"), "chat_completions");
  assert.equal(inferApiMode("https://unknown.example.com/v1/other"), "chat_completions");
});

test("normalizeApiMode 归一化输入", () => {
  assert.equal(normalizeApiMode("responses"), "responses");
  assert.equal(normalizeApiMode("chat"), "chat_completions");
  assert.equal(normalizeApiMode("chat-completions"), "chat_completions");
  assert.equal(normalizeApiMode(""), "chat_completions");
  assert.equal(normalizeApiMode(undefined), "chat_completions");
});

test("maskEndpoint 不泄露查询参数与认证信息", () => {
  assert.equal(maskEndpoint("https://api.openai.com/v1/responses?key=secret"), "https://api.openai.com/v1/responses");
  assert.equal(maskEndpoint("not-a-url"), "not-a-url");
});

// ── searchProxy ───────────────────────────────────────────────────────────────

test("isAllowedSearchSource 只放行白名单权威域名", () => {
  assert.equal(isAllowedSearchSource("https://www.apa.org/topics/relationships"), true);
  assert.equal(isAllowedSearchSource("https://edu.cn/psychology"), true);
  assert.equal(isAllowedSearchSource("https://who.int/news"), true);
  assert.equal(isAllowedSearchSource("https://random-blog.example.com/post"), false);
  assert.equal(isAllowedSearchSource("not-a-url"), false);
});

test("normalizeSearchResults 从多种结构提取结果", () => {
  const results = normalizeSearchResults({
    results: [
      { title: "标题A", url: "https://www.apa.org/a", snippet: "摘要A" },
      { title: "标题B", link: "https://edu.cn/b", description: "摘要B" }
    ]
  });
  assert.equal(results.length, 2);
  assert.equal(results[0].title, "标题A");
  assert.equal(results[1].url, "https://edu.cn/b");
  assert.ok(results[0].snippet.length <= 300);
});

test("normalizeSearchResults 处理空/异常输入", () => {
  assert.deepEqual(normalizeSearchResults(null), []);
  assert.deepEqual(normalizeSearchResults({}), []);
  assert.deepEqual(normalizeSearchResults({ results: [{ title: "无链接" }] }), []);
});

// ── staticServer: sendJson 统一注入 CORS 头 ───────────────────────────────────

function mockRes({ reqHeaders } = {}) {
  const headers = {};
  return {
    status: 0,
    body: "",
    req: reqHeaders === undefined ? undefined : { headers: reqHeaders },
    writeHead(status, head) { this.status = status; Object.assign(headers, head); },
    end(body) { this.body = body ?? ""; },
    get headers() { return headers; }
  };
}

test("sendJson 从 res.req 的 Origin 注入 CORS 头（私有网段回显）", () => {
  const res = mockRes({ reqHeaders: { origin: "http://192.168.1.5:3000" } });
  sendJson(res, 200, { ok: true });
  assert.equal(res.headers["Access-Control-Allow-Origin"], "http://192.168.1.5:3000");
});

test("sendJson 外部 Origin 回落默认源而非回显", () => {
  const res = mockRes({ reqHeaders: { origin: "http://evil.example.com" } });
  sendJson(res, 200, { ok: true });
  assert.equal(res.headers["Access-Control-Allow-Origin"], "http://localhost:3000");
});

test("sendJson 无请求上下文（mock res）时不注入 CORS 头", () => {
  const res = mockRes();
  sendJson(res, 200, { ok: true });
  assert.equal(res.headers["Access-Control-Allow-Origin"], undefined);
});

test("sendJson 的 extraHeaders 可覆盖默认 CORS 注入", () => {
  const res = mockRes({ reqHeaders: { origin: "http://192.168.1.5:3000" } });
  sendJson(res, 200, { ok: true }, { "Access-Control-Allow-Origin": "http://custom" });
  assert.equal(res.headers["Access-Control-Allow-Origin"], "http://custom");
});

// ── staticServer: serveStatic 404/SPA 回退/缓存分级/403 ───────────────────────

test("serveStatic 带扩展名且文件不存在返回真 404（不再把 HTML 当 JS）", async () => {
  const res = mockRes();
  await serveStatic("/missing.js", res);
  assert.equal(res.status, 404);
  await serveStatic("/missing.css", res);
  assert.equal(res.status, 404);
});

test("serveStatic 无扩展名路径保持 SPA 回退 index.html 且 no-cache", async () => {
  const res = mockRes();
  await serveStatic("/some/spa-route", res);
  assert.equal(res.status, 200);
  assert.match(String(res.headers["Content-Type"]), /^text\/html/);
  assert.equal(res.headers["Cache-Control"], "no-cache");
});

test("serveStatic 首页 index.html 缓存为 no-cache（发布即失效）", async () => {
  const res = mockRes();
  await serveStatic("/", res);
  assert.equal(res.status, 200);
  assert.equal(res.headers["Cache-Control"], "no-cache");
});

test("serveStatic js/css 缓存 max-age=3600", async () => {
  const res = mockRes();
  await serveStatic("/app.js", res);
  assert.equal(res.status, 200);
  assert.match(String(res.headers["Content-Type"]), /javascript/);
  assert.equal(res.headers["Cache-Control"], "public, max-age=3600");
});

test("serveStatic 其它静态资源（图片/文本类）缓存 max-age=86400", async () => {
  const res = mockRes();
  await serveStatic("/love-learning/books/rational-male-positive.txt", res);
  assert.equal(res.status, 200);
  assert.equal(res.headers["Cache-Control"], "public, max-age=86400");
});

test("serveStatic 路径穿越 ../ 与编码变体全部 403", async () => {
  for (const attack of ["/../package.json", "/../server/config.js", "/%2e%2e/package.json", "/..%2f..%2fpackage.json"]) {
    const res = mockRes();
    await serveStatic(attack, res);
    assert.equal(res.status, 403, `expected 403 for ${attack}`);
  }
});

// ── routes-longContent: 非法章号与路径遍历防护 ────────────────────────────────

test("handleLongContent 非法章号返回 400（0/11/小数/前导零/非数字）", async () => {
  for (const chapter of ["/api/long-content/0", "/api/long-content/11", "/api/long-content/1.5", "/api/long-content/01", "/api/long-content/abc", "/api/long-content/"]) {
    const res = mockRes();
    await handleLongContent(chapter, res);
    assert.equal(res.status, 400, `expected 400 for ${chapter}`);
  }
});

test("handleLongContent ../ 路径遍历变体全拦（不泄漏任何盘上文件）", async () => {
  for (const attack of [
    "/api/long-content/../server/config.js",
    "/api/long-content/../../../.env",
    "/api/long-content/%2e%2e%2fserver%2fconfig.js",
    "/api/long-content/..%2F..%2Fserver%2Fconfig.js"
  ]) {
    const res = mockRes();
    await handleLongContent(attack, res);
    assert.ok(res.status >= 400 && res.status < 500, `expected 4xx for ${attack}, got ${res.status}`);
    assert.ok(!String(res.body).includes("LLM_ENDPOINT"), `${attack} 泄漏了文件内容`);
  }
  // 带合法章号前缀的嵌套遍历（"1/../.."）会命中章 1 数据（白名单内、无泄漏），仅断言不泄漏文件内容。
  const nested = mockRes();
  await handleLongContent("/api/long-content/1/../../../server/config.js", nested);
  assert.ok(!String(nested.body).includes("LLM_ENDPOINT"), "嵌套遍历泄漏了文件内容");
});

test("handleLongContent 合法章号返回章节文本", async () => {
  const res = mockRes();
  await handleLongContent("/api/long-content/1", res);
  assert.equal(res.status, 200);
  assert.match(String(res.headers["Content-Type"]), /text\/plain/);
});

// ── llmProxy: handleChat 主分支（mock fetch，不发真实网络请求） ───────────────

function chatReq(chunks, ip = "10.1.1.1") {
  const req = fakeReq(chunks);
  req.socket = { remoteAddress: ip };
  return req;
}

function chatBody(overrides = {}) {
  return JSON.stringify({ messages: [{ role: "user", content: "你好" }], ...overrides });
}

test("handleChat 服务端缺 key 且请求未带 apiKey 返回 400 missing_api_key", async () => {
  rateBuckets.clear();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; return { status: 200, text: async () => "{}", headers: { get: () => "" } }; };
  try {
    const res = mockRes();
    await handleChat(chatReq([chatBody()]), res, { serverApiKey: "" });
    assert.equal(res.status, 400);
    assert.equal(JSON.parse(res.body).error, "missing_api_key");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    rateBuckets.clear();
  }
});

test("handleChat 请求体超 2MB 返回 413", async () => {
  rateBuckets.clear();
  const big = JSON.stringify({ messages: [{ role: "user", content: "x".repeat(2_100_000) }] });
  const res = mockRes();
  await handleChat(chatReq([big.slice(0, 1_100_000), big.slice(1_100_000)]), res, { serverApiKey: "k" });
  assert.equal(res.status, 413);
  assert.equal(JSON.parse(res.body).error, "payload_too_large");
  rateBuckets.clear();
});

test("handleChat 上游 5xx 重试用尽后返回 502 upstream_unreachable（含一次重试）", async () => {
  rateBuckets.clear();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return { status: 500, text: async () => "boom", headers: { get: () => "application/json" } };
  };
  try {
    const res = mockRes();
    await handleChat(chatReq([chatBody()]), res, { serverApiKey: "test-key" });
    assert.equal(res.status, 502);
    const payload = JSON.parse(res.body);
    assert.equal(payload.error, "upstream_unreachable");
    assert.equal(fetchCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    rateBuckets.clear();
  }
});

test("handleChat 上游 4xx 不重试并透传状态码为 502 upstream_error", async () => {
  rateBuckets.clear();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return { status: 401, text: async () => JSON.stringify({ error: { message: "bad key" } }), headers: { get: () => "application/json" } };
  };
  try {
    const res = mockRes();
    await handleChat(chatReq([chatBody()]), res, { serverApiKey: "bad-key" });
    assert.equal(res.status, 502);
    const payload = JSON.parse(res.body);
    assert.equal(payload.error, "upstream_error");
    assert.equal(payload.upstreamStatus, 401);
    assert.match(payload.message, /bad key/);
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    rateBuckets.clear();
  }
});

test("handleChat 成功路径回显上游响应并对私有网段 Origin 注入 CORS", async () => {
  rateBuckets.clear();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: "回复" } }] }),
    headers: { get: () => "application/json" }
  });
  try {
    const req = chatReq([chatBody()]);
    req.headers = { origin: "http://192.168.1.5:3000" };
    const res = mockRes();
    await handleChat(req, res, { serverApiKey: "test-key" });
    assert.equal(res.status, 200);
    assert.match(res.body, /回复/);
    assert.equal(res.headers["Access-Control-Allow-Origin"], "http://192.168.1.5:3000");
  } finally {
    globalThis.fetch = originalFetch;
    rateBuckets.clear();
  }
});
