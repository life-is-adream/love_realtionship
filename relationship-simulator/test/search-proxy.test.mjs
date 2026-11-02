import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

// The real server config loads .env. Copy only reviewed modules and supply a
// synthetic config so no test can read credentials or contact a real upstream.
async function fixture(t, overrides = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "heartflow-search-regression-"));
  const files = ["searchProxy.js", "http.js", "upstream-request.js", "config.js", "package.json"];
  t.after(async () => {
    await Promise.all(files.map(file => unlink(path.join(dir, file))));
    await rmdir(dir);
  });
  await Promise.all(files.slice(0, 3).map(async file => {
    await writeFile(path.join(dir, file), await readFile(new URL(`../server/${file}`, import.meta.url)));
  }));
  await writeFile(path.join(dir, "package.json"), '{"type":"module"}');
  const config = {
    PORT: 3000,
    LLM_API_KEY: "synthetic-key",
    LLM_ENDPOINT: "https://offline.invalid/v1/chat/completions",
    LLM_API_MODE: "chat_completions",
    SEARCH_MODEL: "synthetic-search-model",
    SEARCH_ALLOWED_DOMAINS: ["apa.org"],
    SEARCH_ALLOWED_DOMAINS_EXPLICIT: false,
    SEARCH_API_KEY: "",
    SEARCH_ENDPOINT: "",
    SEARCH_ENABLED: false,
    ...overrides
  };
  await writeFile(path.join(dir, "config.js"), Object.entries(config)
    .map(([key, value]) => `export const ${key}=${JSON.stringify(value)};`).join("\n"));
  return import(pathToFileURL(path.join(dir, "searchProxy.js")).href);
}

function request(body = { query: "公开沟通研究" }) {
  const req = Object.assign(new PassThrough(), { headers: {}, socket: { remoteAddress: "127.0.0.1" } });
  queueMicrotask(() => req.end(JSON.stringify(body)));
  return req;
}

function response() {
  return Object.assign(new EventEmitter(), {
    destroyed: false, writableEnded: false, status: null, payload: null,
    writeHead(status) { this.status = status; },
    end(body) { this.payload = JSON.parse(body); this.writableEnded = true; }
  });
}

const fetchFixtures = new WeakSet();
function mockFetch(t, json, status = 200, inspect = () => {}) {
  if (!fetchFixtures.has(t)) {
    const original = globalThis.fetch;
    t.after(() => { globalThis.fetch = original; });
    fetchFixtures.add(t);
  }
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).hostname, "offline.invalid");
    inspect(JSON.parse(options.body), options);
    return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(json) };
  };
}

const citation = (url, overrides = {}) => ({ type: "url_citation", url, title: "合成来源", summary: "合成摘录", ...overrides });
const chat = annotations => ({ choices: [{ message: { content: "合成未核验摘要，不应被回退返回", annotations } }] });

for (const explicit of [false, true]) {
  test(`模型检索${explicit ? "显式" : "默认"}来源白名单只保留允许域名，未声称证据已验证`, async t => {
    const api = await fixture(t, { SEARCH_ALLOWED_DOMAINS_EXPLICIT: explicit });
    mockFetch(t, chat([
      citation("https://apa.org/research"), citation("https://news.apa.org/research"),
      citation("https://arbitrary-blog.invalid/advice"), citation("https://apa.org.evil.invalid/advice")
    ]), 200, payload => {
      assert.equal(payload.model, "synthetic-search-model");
      assert.equal(payload.messages[1].content, "公开沟通研究");
      assert.equal(payload.input, undefined);
      assert.deepEqual(payload.tools, [{ type: "web_search", max_keyword: 2, force_search: true }]);
    });
    const res = response();
    await api.handleSearch(request(), res);
    assert.equal(res.status, 200);
    assert.deepEqual(res.payload.results.map(item => item.url), ["https://apa.org/research", "https://news.apa.org/research"]);
    assert.equal(res.payload.filtered, 2);
    assert.equal(res.payload.sourcePolicy, "allowlist");
    assert.equal(res.payload.note, "");
  });
}

test("所有引用均被过滤或缺少引用时，不透出未核验模型摘要", async t => {
  const api = await fixture(t, { SEARCH_ALLOWED_DOMAINS_EXPLICIT: true });
  for (const annotations of [[citation("https://arbitrary-blog.invalid/advice")], [], [citation("javascript:void(0)")]]) {
    mockFetch(t, chat(annotations));
    const res = response();
    await api.handleSearch(request(), res);
    assert.equal(res.status, 200);
    assert.deepEqual(res.payload.results, []);
    assert.equal(res.payload.sourcePolicy, "allowlist");
    assert.doesNotMatch(JSON.stringify(res.payload), /合成未核验摘要/);
  }
});

test("引用及外部结果归一化拒绝危险协议、相对路径、模糊 URL 与 userinfo", async t => {
  const api = await fixture(t);
  const invalid = ["javascript:void(0)", "data:text/html,synthetic", "file:///example", "//apa.org/path", "/path", "https:apa.org/path", "https:///apa.org/path", "https://name@apa.org/path", "https://name:secret@apa.org/path", "https://@apa.org/path", "https://apa.org\\@evil.invalid/path", "https://apa.org/pa\nth", "not a URL"];
  for (const url of invalid) {
    assert.equal(api.isAllowedSearchSource(url), false, url);
    assert.deepEqual(api.normalizeCitations({ annotations: [citation(url)] }), [], url);
    assert.deepEqual(api.normalizeSearchResults({ results: [{ url }] }), [], url);
  }
  assert.equal(api.isAllowedSearchSource("https://apa.org/research"), true);
  assert.equal(api.isAllowedSearchSource("http://news.apa.org/research"), true);
  assert.equal(api.isAllowedSearchSource("https://apa.org.evil.invalid"), false);
});

test("引用支持平铺与嵌套结构，规范 URL 去重，并遵循数量与文本长度上限", async t => {
  const api = await fixture(t);
  const results = api.normalizeCitations({ annotations: [
    citation("HTTPS://APA.ORG/research"),
    { type: "url_citation", url_citation: { url: "https://apa.org/research", title: "重复" } },
    { type: "url_citation", url_citation: { url: "https://apa.org/nested", title: "嵌套" } },
    ...Array.from({ length: 10 }, (_, index) => citation(`https://apa.org/${index}`, { title: "x".repeat(500), summary: "s".repeat(600) }))
  ] });
  assert.equal(results.length, 5);
  assert.equal(new Set(results.map(item => item.url)).size, 5);
  assert.equal(results[1].title, "嵌套");
  assert.ok(results.every(item => item.title.length <= 200 && item.snippet.length <= 300));
});

for (const overrides of [
  { LLM_API_MODE: "responses", LLM_ENDPOINT: "https://offline.invalid/v1/responses" },
  { LLM_API_MODE: "responses" },
  { LLM_API_MODE: "chat_completions", LLM_ENDPOINT: "https://offline.invalid/v1/responses" }
]) {
  test(`Responses 或冲突配置在 dispatch 前受控拒绝 ${JSON.stringify(overrides)}`, async t => {
    const api = await fixture(t, overrides);
    let calls = 0;
    mockFetch(t, {}, 200, () => { calls++; });
    const res = response();
    await api.handleSearch(request(), res);
    assert.equal(res.status, 503);
    assert.equal(res.payload.error, "search_api_mode_unsupported");
    assert.equal(calls, 0);
  });
}

test("不同或缺失上游成功响应结构不会伪装为空检索成功", async t => {
  const api = await fixture(t);
  for (const json of [
    { output: [{ type: "message", content: [{ type: "output_text", text: "synthetic", annotations: [citation("https://apa.org/research")] }] }] },
    {}, [], { choices: [] }, { choices: [{ message: null }] }, { choices: [{ message: { content: { unexpected: true } } }] }
  ]) {
    mockFetch(t, json);
    const res = response();
    await api.handleSearch(request(), res);
    assert.equal(res.status, 502);
    assert.equal(res.payload.error, "search_response_unsupported");
  }
});

test("模型搜索缺少 key 时不 dispatch，插件未开通时返回受控 503", async t => {
  const noKey = await fixture(t, { LLM_API_KEY: "" });
  let calls = 0;
  mockFetch(t, {}, 200, () => { calls++; });
  const disabled = response();
  await noKey.handleSearch(request(), disabled);
  assert.equal(disabled.status, 503);
  assert.equal(disabled.payload.error, "search_disabled");
  assert.equal(calls, 0);
  const api = await fixture(t);
  mockFetch(t, { error: { message: "Param Incorrect", param: "webSearchEnabled is false" } }, 400);
  const plugin = response();
  await api.handleSearch(request(), plugin);
  assert.equal(plugin.status, 503);
  assert.equal(plugin.payload.error, "search_plugin_disabled");
});

for (const shape of ["results", "items", "data"]) {
  test(`外部搜索 ${shape} 形状遵守相同来源和 URL 政策并优先于模型模式`, async t => {
    const api = await fixture(t, { SEARCH_ENABLED: true, SEARCH_ENDPOINT: "https://offline.invalid/search", SEARCH_API_KEY: "synthetic-external-key", LLM_API_MODE: "responses" });
    mockFetch(t, { [shape]: [
      { name: "参考来源", link: "https://apa.org/research", description: "s".repeat(600) },
      { url: "https://arbitrary-blog.invalid/advice" }, { url: "javascript:void(0)" },
      { url: "https://name@apa.org/path" }
    ] }, 200, payload => assert.deepEqual(payload, { query: "公开沟通研究", count: 5 }));
    const res = response();
    await api.handleSearch(request(), res);
    assert.equal(res.status, 200);
    assert.equal(res.payload.engine, "external-endpoint");
    assert.equal(res.payload.sourcePolicy, "allowlist");
    assert.deepEqual(res.payload.results.map(item => item.url), ["https://apa.org/research"]);
    assert.equal(res.payload.results[0].snippet.length, 300);
  });
}

for (const external of [false, true]) {
  test(`${external ? "外部" : "模型"}搜索不支持的 JSON、错误状态和不可达均受控失败`, async t => {
    const api = await fixture(t, external ? { SEARCH_ENABLED: true, SEARCH_ENDPOINT: "https://offline.invalid/search", SEARCH_API_KEY: "synthetic-external-key" } : {});
    const unexpected = response();
    mockFetch(t, { unexpected: true });
    await api.handleSearch(request(), unexpected);
    assert.equal(unexpected.status, 502);
    assert.equal(unexpected.payload.error, "search_response_unsupported");
    const upstreamError = response();
    mockFetch(t, { error: { message: "synthetic error" } }, 503);
    await api.handleSearch(request(), upstreamError);
    assert.equal(upstreamError.status, 502);
    assert.equal(upstreamError.payload.error, "search_upstream_error");
    const unreachable = response();
    globalThis.fetch = async () => { throw new Error("synthetic unavailable"); };
    await api.handleSearch(request(), unreachable);
    assert.equal(unreachable.status, 502);
    assert.equal(unreachable.payload.error, "search_unreachable");
  });

  test(`${external ? "外部" : "模型"}搜索断连时取消上游响应体且不写回`, async t => {
    const api = await fixture(t, external ? { SEARCH_ENABLED: true, SEARCH_ENDPOINT: "https://offline.invalid/search", SEARCH_API_KEY: "synthetic-external-key" } : {});
    const original = globalThis.fetch;
    t.after(() => { globalThis.fetch = original; });
    let signal, started;
    const ready = new Promise(resolve => { started = resolve; });
    globalThis.fetch = async (url, options) => {
      assert.equal(new URL(url).hostname, "offline.invalid");
      signal = options.signal;
      return { status: 200, ok: true, text: () => {
        started();
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      } };
    };
    const res = response();
    const task = api.handleSearch(request(), res);
    await ready;
    res.destroyed = true;
    res.emit("close");
    await task;
    assert.equal(signal.aborted, true);
    assert.equal(res.status, null);
    assert.equal(res.payload, null);
    assert.equal(res.listenerCount("close"), 0);
  });
}
