import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { extractModelContent, fetchWithRetry, normalizeProxyResponse } from "../server/llmProxy.js";
import { readRequestJson, resolveCorsOrigin, RequestBodyTooLargeError, sendJson } from "../server/staticServer.js";
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
