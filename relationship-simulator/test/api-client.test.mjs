import test from "node:test";
import assert from "node:assert/strict";

// ── 导入前设置 mock ───────────────────────────────────────────────────────────

// Mock global fetch
const originalFetch = global.fetch;

// 导入模块
const apiModule = await import("../public/modules/core/api-client.js");
const { buildHerMessages, buildCoachMessages, callLLM, checkHealth, searchWeb } = apiModule;

test("searchWeb 向 fetch 传入取消信号且请求体只有查询词", async (t) => {
  const prior = global.fetch;
  t.after(() => { global.fetch = prior; });
  const controller = new AbortController();
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ results: [], filtered: 0 }) };
  };
  await searchWeb("公开沟通研究", { signal: controller.signal });
  assert.equal(request.url, "/api/search");
  assert.equal(request.options.signal, controller.signal);
  assert.deepEqual(JSON.parse(request.options.body), { query: "公开沟通研究" });
});

// ── 拆双角色：她 / 教练 两条独立消息链 ────────────────────────────────────────

const splitPersona = { name: "林知夏", systemRole: "角色设定文本", tags: ["慢热"] };
const splitMemory = { background: "测试背景", interests: "测试兴趣", boundaries: "测试边界" };
const splitMessages = [
  { type: "me", text: "你好", who: "我" },
  { type: "her", text: "", who: "林知夏" },
  null,
  { type: "her", text: "嗨", who: "林知夏" }
];

test("buildHerMessages 的 system 里不含教练技能契约与 JSON 要求", () => {
  const result = buildHerMessages(splitPersona, splitMemory, splitMessages, { mode: "anti" });
  assert.equal(result[0].role, "system");
  const system = result[0].content;
  assert.ok(system.includes("角色设定文本"));
  assert.ok(!system.includes("恋爱沟通教练技能契约"), "她不该拿到教练契约");
  assert.ok(!system.includes("JSON 字段"), "她不该被要求输出 JSON");
  assert.ok(!system.includes("replyOptions"), "她不该看到 A/B/C 字段");
});

test("buildHerMessages 映射历史并过滤无文本消息，末尾只要一条微信文本", () => {
  const result = buildHerMessages(splitPersona, splitMemory, splitMessages);
  assert.deepEqual(result.map((item) => item.role), ["system", "user", "assistant", "user"]);
  assert.ok(result[1].content.includes("我：你好"));
  assert.ok(result[2].content.includes("林知夏：嗨"));
  assert.ok(result.at(-1).content.includes("不要输出 JSON"));
});

test("buildHerMessages 在 PUA 识别模式下带上手法清单且仍只要文本", () => {
  const result = buildHerMessages(splitPersona, splitMemory, [], { mode: "pua" });
  assert.ok(result[0].content.includes("不要自曝手法名称"));
});

test("buildCoachMessages 把她的回复作为已知输入并保留教练契约", () => {
  const result = buildCoachMessages({
    persona: splitPersona, memory: splitMemory, messages: splitMessages,
    herReply: "哈哈是呀", uiValues: { stage: "初聊", goal: "自然推进" }
  });
  assert.ok(result[0].content.includes("恋爱沟通教练技能契约"));
  assert.ok(result[0].content.includes("JSON 字段"));
  const last = result.at(-1);
  assert.ok(last.content.includes("她本轮的回复（已确定，不要改写、不要替她说话）：哈哈是呀"));
  assert.ok(last.content.includes("当前阶段：初聊"));
});

test("buildCoachMessages 教材上下文存在时加入参考，真诚度调节落在教练侧", () => {
  const result = buildCoachMessages({
    persona: splitPersona, memory: splitMemory, messages: [],
    herReply: "嗯", uiValues: { textbookContext: { excerpts: [{ text: "教材参考内容" }] }, tone: { sincerity: 90 } }
  });
  assert.ok(result.at(-1).content.includes("教材参考"));
  assert.ok(result[0].content.includes("【本轮表达调节】"));
});

test("她的消息链不含真诚度调节：调节的是男方建议不是她的演出", () => {
  const result = buildHerMessages(splitPersona, splitMemory, [], { tone: { sincerity: 90 } });
  assert.ok(!result[0].content.includes("【本轮表达调节】"));
});

// ── callLLM ───────────────────────────────────────────────────────────────────

test("callLLM 透传 thinking 与输出上限（角色回复通道靠它把 15s 压到 1.8s）", async () => {
  const prior = global.fetch;
  try {
    let sent;
    global.fetch = async (_url, options) => {
      sent = JSON.parse(options.body);
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "早啊" } }] }) };
    };
    await callLLM({ messages: [{ role: "user", content: "x" }], thinking: { type: "disabled" }, maxCompletionTokens: 200 });
    assert.deepEqual(sent.thinking, { type: "disabled" });
    assert.equal(sent.max_completion_tokens, 200);
  } finally { global.fetch = prior; }
});

test("callLLM 不接受非法 thinking 值，也不凭空加输出上限", async () => {
  const prior = global.fetch;
  try {
    let sent;
    global.fetch = async (_url, options) => {
      sent = JSON.parse(options.body);
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "早啊" } }] }) };
    };
    await callLLM({ messages: [{ role: "user", content: "x" }], thinking: { type: "yolo" }, maxCompletionTokens: Number.NaN });
    assert.equal("thinking" in sent, false, `非法 thinking 值不应出站：${JSON.stringify(sent.thinking)}`);
    assert.equal("max_completion_tokens" in sent, false);
  } finally { global.fetch = prior; }
});

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
