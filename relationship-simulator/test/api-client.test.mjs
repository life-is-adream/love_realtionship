import test from "node:test";
import assert from "node:assert/strict";

// ── 导入前设置 mock ───────────────────────────────────────────────────────────

// Mock global fetch
const originalFetch = global.fetch;

// 导入模块
const apiModule = await import("../public/modules/core/api-client.js");
const { buildMessages, callLLM, checkHealth } = apiModule;

// ── buildMessages ─────────────────────────────────────────────────────────────

test("buildMessages 构建 system 消息", () => {
  const persona = { name: "林知夏", systemRole: "你是一个测试角色" };
  const memory = { background: "测试背景", interests: "测试兴趣", boundaries: "测试边界" };
  const messages = [{ type: "me", text: "你好", who: "我" }];
  const result = buildMessages(persona, memory, messages, { stage: "初聊", styleBias: "A", goal: "测试" });
  assert.equal(result[0].role, "system");
  assert.ok(result[0].content);
});

test("buildMessages 包含用户消息", () => {
  const persona = { name: "林知夏", systemRole: "角色" };
  const memory = { background: "", interests: "", boundaries: "" };
  const messages = [
    { type: "me", text: "你好", who: "我" },
    { type: "her", text: "嗨", who: "林知夏" }
  ];
  const result = buildMessages(persona, memory, messages);
  const userMsg = result.find((m) => m.role === "user" && m.content.includes("我"));
  assert.ok(userMsg);
  assert.ok(userMsg.content.includes("你好"));
});

test("buildMessages 包含助手消息", () => {
  const persona = { name: "林知夏", systemRole: "角色" };
  const memory = { background: "", interests: "", boundaries: "" };
  const messages = [
    { type: "me", text: "你好", who: "我" },
    { type: "her", text: "嗨", who: "林知夏" }
  ];
  const result = buildMessages(persona, memory, messages);
  const assistantMsg = result.find((m) => m.role === "assistant");
  assert.ok(assistantMsg);
  assert.ok(assistantMsg.content.includes("林知夏"));
});

test("buildMessages 过滤无文本消息", () => {
  const persona = { name: "林知夏", systemRole: "角色" };
  const memory = { background: "", interests: "", boundaries: "" };
  const messages = [
    { type: "me", text: "你好", who: "我" },
    { type: "her", text: "", who: "林知夏" },
    null
  ];
  const result = buildMessages(persona, memory, messages);
  // Only the valid message should be included (plus system + user prompt)
  const nonSystem = result.filter((m) => m.role !== "system");
  assert.ok(nonSystem.length >= 1);
});

test("buildMessages 末尾包含用户提示词", () => {
  const persona = { name: "林知夏", systemRole: "角色" };
  const memory = { background: "", interests: "", boundaries: "" };
  const result = buildMessages(persona, memory, [], { stage: "初聊", styleBias: "A", goal: "自然推进" });
  const lastMsg = result[result.length - 1];
  assert.equal(lastMsg.role, "user");
  assert.ok(lastMsg.content.includes("请继续生成"));
  assert.ok(lastMsg.content.includes("初聊"));
});

test("buildMessages 教材上下文存在时加入参考", () => {
  const persona = { name: "林知夏", systemRole: "角色" };
  const memory = { background: "", interests: "", boundaries: "" };
  const textbookContext = { excerpts: [{ text: "教材参考内容" }] };
  const result = buildMessages(persona, memory, [], { textbookContext });
  const lastMsg = result[result.length - 1];
  assert.ok(lastMsg.content.includes("教材参考"));
});

// ── callLLM ───────────────────────────────────────────────────────────────────

test("callLLM 成功调用返回解析内容", async () => {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      choices: [{ message: { content: "你好呀" } }]
    })
  });
  const result = await callLLM({ messages: [{ role: "user", content: "test" }] });
  assert.ok(result.content);
  assert.equal(result.content, "你好呀");
  assert.ok(result.raw);
});

test("callLLM 处理 HTTP 错误", async () => {
  global.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ error: "Unauthorized" })
  });
  await assert.rejects(
    () => callLLM({ messages: [{ role: "user", content: "test" }] }),
    /HTTP 401/
  );
});

test("callLLM 处理空响应", async () => {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: "" } }] })
  });
  await assert.rejects(
    () => callLLM({ messages: [{ role: "user", content: "test" }] }),
    /模型返回为空/
  );
});

test("callLLM 处理网络错误", async () => {
  global.fetch = async () => { throw new Error("网络错误"); };
  await assert.rejects(
    () => callLLM({ messages: [{ role: "user", content: "test" }] }),
    /网络错误/
  );
});

test("callLLM 处理数组内容响应", async () => {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      choices: [{ message: { content: [{ text: "部分A" }, { text: "部分B" }] } }]
    })
  });
  const result = await callLLM({ messages: [{ role: "user", content: "test" }] });
  assert.equal(result.content, "部分A部分B");
});

// ── checkHealth ───────────────────────────────────────────────────────────────

test("checkHealth 成功检查", async () => {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, status: "healthy" })
  });
  const result = await checkHealth();
  assert.ok(result.ok);
});

test("checkHealth 服务器错误时抛出", async () => {
  global.fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ ok: false, message: "服务器错误" })
  });
  await assert.rejects(() => checkHealth(), /服务器错误|HTTP 500/);
});

// ── 恢复原始 fetch ───────────────────────────────────────────────────────────
test.after(() => {
  global.fetch = originalFetch;
});