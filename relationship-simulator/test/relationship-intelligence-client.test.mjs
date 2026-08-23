import test from "node:test";
import assert from "node:assert/strict";
import { analyzeRelationshipIntelligence } from "../public/modules/intelligence/client.js";

test("Client 固定向本地接口发送 JSON，且不加入认证字段", async () => {
  const calls = [];
  const expected = { version: 1, decision: { value: "OBSERVE" }, memoryPatch: null };
  const result = await analyzeRelationshipIntelligence(
    { messages: [{ type: "me", text: "你好" }], consent: false },
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          status: 200,
          json: async () => expected
        };
      }
    }
  );

  assert.deepEqual(result, expected);
  assert.equal(calls[0].url, "/api/relationship-intelligence");
  assert.equal(calls[0].options.method, "POST");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(Object.hasOwn(body, "apiKey"), false);
});

test("Client 将服务端错误转换为可读异常", async () => {
  await assert.rejects(
    () => analyzeRelationshipIntelligence(
      { messages: [] },
      {
        fetchImpl: async () => ({
          ok: false,
          status: 400,
          json: async () => ({ error: "messages_required", message: "至少需要一条消息。" })
        })
      }
    ),
    (error) => error.message === "至少需要一条消息。" && error.code === "messages_required" && error.status === 400
  );
});

test("Client 处理非 JSON 错误响应", async () => {
  await assert.rejects(
    () => analyzeRelationshipIntelligence(
      { messages: [{ type: "me", text: "你好" }] },
      {
        fetchImpl: async () => ({
          ok: false,
          status: 503,
          json: async () => { throw new SyntaxError("not json"); }
        })
      }
    ),
    /本地关系分析服务返回 HTTP 503/
  );
});
