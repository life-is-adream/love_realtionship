// 端到端 HTTP 集成测试：直接监听导出的 server（端口 0），验证 CORS 预检、
// 统一 CORS 注入与 P2-7 静态服务语义在真实请求管线上的表现。
import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { server } from "../server/index.js";
import { APP_ASSET_VERSION } from "../server/asset-versioning.js";

function listenOnce() {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function fetchRaw(path, { method = "GET", headers = {} } = {}) {
  // 用 node:http 原始请求，避免 fetch/URL 构造器把 ../ 规范化掉。
  const port = server.address().port;
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("OPTIONS /api/* 返回 204 预检响应与 CORS 头", async (t) => {
  const port = await listenOnce();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const res = await fetchRaw("/api/chat", {
    method: "OPTIONS",
    headers: { Origin: "http://192.168.1.5:3000", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" }
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers["access-control-allow-origin"], "http://192.168.1.5:3000");
  assert.match(res.headers["access-control-allow-methods"], /POST/);
  assert.match(res.headers["access-control-allow-headers"], /content-type/i);
  assert.ok(Number(res.headers["access-control-max-age"]) > 0);
});

test("OPTIONS /api/* 对外部 Origin 回落默认源", async (t) => {
  const port = await listenOnce();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const res = await fetchRaw("/api/chat", { method: "OPTIONS", headers: { Origin: "http://evil.example.com" } });
  assert.equal(res.status, 204);
  assert.equal(res.headers["access-control-allow-origin"], "http://localhost:3000");
});

test("/api/health 响应统一携带 CORS 头（此前缺失的路由）", async (t) => {
  const port = await listenOnce();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const res = await fetchRaw("/api/health", { headers: { Origin: "http://127.0.0.1:5173" } });
  assert.equal(res.status, 200);
  assert.equal(res.headers["access-control-allow-origin"], "http://127.0.0.1:5173");
  const payload = JSON.parse(res.body);
  assert.equal(payload.ok, true);
});

test("GET /missing.js 返回真 404 而非 HTML 回退", async (t) => {
  const port = await listenOnce();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const res = await fetchRaw("/missing.js");
  assert.equal(res.status, 404);
});

test("GET / 返回 index.html 且 Cache-Control 为 no-cache", async (t) => {
  const port = await listenOnce();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const res = await fetchRaw("/");
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /^text\/html/);
  assert.equal(res.headers["cache-control"], "no-cache");
});

test("GET /app.js 返回可重新验证的版本化模块", async (t) => {
  const port = await listenOnce();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const res = await fetchRaw("/app.js");
  assert.equal(res.status, 200);
  assert.equal(res.headers["cache-control"], "no-cache");
  assert.ok(res.body.includes(`core/config.js?v=${APP_ASSET_VERSION}`));
});

test("原始路径穿越请求永不返回文件内容", async (t) => {
  const port = await listenOnce();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  // 说明：index.js 经 WHATWG URL 的 pathname 分发，"/../" 在该层已被规范化（→ 404）；
  // serveStatic 层的 403 由编码变体触发（单元测试覆盖）。此处断言安全属性本身：
  // 穿越变体永不 200、永不泄漏盘上文件内容。
  for (const attack of ["/../package.json", "/%2e%2e%2fpackage.json", "/..%2f..%2fpackage.json"]) {
    const res = await fetchRaw(attack);
    assert.ok(res.status === 403 || res.status === 404, `${attack} expected 403/404, got ${res.status}`);
    assert.ok(!res.body.includes("LLM_"), `${attack} 泄漏了文件内容`);
  }
});
