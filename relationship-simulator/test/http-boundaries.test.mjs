import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { EventEmitter } from "node:events";
import { server } from "../server/index.js";
import { readRequestJson, RequestBodyTooLargeError, resolveCorsOrigin } from "../server/http.js";

function send(path, body) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: server.address().port, method: body === undefined ? "GET" : "POST", path, headers: body === undefined ? {} : { "Content-Type": "application/json" } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (part) => { text += part; });
      res.on("end", () => resolve({ status: res.statusCode, text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("HTTP 边界：非对象 JSON、中文超限、非法路径均返回受控响应", async (t) => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  for (const body of ["null", "[]", "true", '"text"']) {
    for (const route of ["/api/chat", "/api/relationship-intelligence"]) {
      const result = await send(route, body);
      assert.equal(result.status, 400, `${route}: ${body}`);
    }
  }
  const large = await send("/api/relationship-intelligence", JSON.stringify({ text: "中".repeat(700_000) }));
  assert.equal(large.status, 413, "UTF-8 字节超过限制，应得到 413 而不是 socket reset");
  for (const path of ["/%ZZ", "/%00"]) assert.equal((await send(path)).status, 400);
  assert.equal((await send("/modules")).status, 404);
  assert.equal((await send("/")).status, 200, "处理非法请求后仍正常服务");
});

test("解析器超限后停止累积数据，提前断流会拒绝 Promise", async () => {
  const req = new EventEmitter();
  req.setEncoding = () => {};
  const result = readRequestJson(req);
  req.emit("data", "中".repeat(700_000));
  req.emit("data", "ignored");
  req.emit("end");
  await assert.rejects(result, RequestBodyTooLargeError);
  const aborted = new EventEmitter();
  aborted.setEncoding = () => {};
  const rejected = readRequestJson(aborted);
  aborted.emit("aborted");
  await assert.rejects(rejected, /aborted/);
});

test("CORS 不接受本地主机上的非 HTTP 协议、凭据或路径", () => {
  for (const origin of ["ftp://localhost:8888", "http://user:password@localhost:8888", "http://localhost:8888/path"]) {
    assert.equal(resolveCorsOrigin(origin, 3333), "http://localhost:3333");
  }
});
