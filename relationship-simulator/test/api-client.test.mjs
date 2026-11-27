import test from "node:test";
import assert from "node:assert/strict";

// ── 导入前设置 mock ───────────────────────────────────────────────────────────

// Mock global fetch
const originalFetch = global.fetch;

// 导入模块
const apiModule = await import("../public/modules/core/api-client.js");
const { buildHerMessages, buildCoachMessages, callLLM, checkHealth, searchWeb, isAiIdentityQuestion } = apiModule;

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

test("buildHerMessages 传入三种可选风格，只影响角色通道并约束未知事实和 AI 身份", () => {
  const expected = { daily: /自然日常/, humorous: /轻松幽默/, gentle: /温柔陪伴/ };
  for (const [style, marker] of Object.entries(expected)) {
    const messages = buildHerMessages(splitPersona, splitMemory, splitMessages, { chatStyle: style });
    assert.match(messages[0].content, marker);
    assert.match(messages[0].content, /未知的用户个人事实必须承认不知道/);
    assert.match(messages[0].content, /我是 AI 模拟角色/);
  }
  const coach = buildCoachMessages({ persona: splitPersona, memory: splitMemory, messages: [], herReply: "嗨", uiValues: { chatStyle: "humorous" } });
  assert.doesNotMatch(coach.map((item) => item.content).join("\n"), /【本轮对话风格】/);
});

test("常见身份直问识别稳定，普通消息不误判", () => {
  for (const question of ["你是真人吗？", "你是 AI 吗？", "你是人工智能还是人？", "你到底是不是人类", "你是机器人吗"]) assert.equal(isAiIdentityQuestion(question), true, question);
  for (const message of ["今天你过得怎么样", "你是林知夏吗？", "我认识一个机器人", "我在看 AI 电影，你觉得怎么样？", "我朋友是真人，聊天很有趣吗？"]) assert.equal(isAiIdentityQuestion(message), false, message);
});

test("记忆直问只引用原话：无证据承认没有记录，有证据不改写，否定不翻成肯定", () => {
  const query = "你还记得我上周去了哪个城市吗？";
  const empty = apiModule.resolveMemoryRecall(query, [{ type: "me", text: query }], {});
  assert.equal(empty, "我这边没有可靠记录，你愿意再告诉我一次吗？");
  const history = [{ type: "me", text: "我上周去了杭州，西湖边人很多。" }, { type: "me", text: query }];
  assert.match(apiModule.resolveMemoryRecall(query, history, {}), /你之前说过：「我上周去了杭州/);
  // 派生字符串不是事实来源：只有 _enhancedInjection 时不得声称用户说过成都。
  const injectedOnly = { _enhancedInjection: "近期记忆：上周去了成都" };
  assert.equal(apiModule.resolveMemoryRecall(query, [{ type: "me", text: query }], injectedOnly), empty);
  // 否定句原样引用，不被改写成肯定。
  const negated = apiModule.resolveMemoryRecall(query, [{ type: "me", text: "我上周没去杭州。" }, { type: "me", text: query }], {});
  assert.ok(!negated.includes("去了杭州"), negated);
  assert.match(negated, /没去杭州/);
  // 覆盖范围不再局限于城市：
  assert.match(apiModule.resolveMemoryRecall("你还记得我上周买了什么吗？", [{ type: "me", text: "我上周买了台咖啡机。" }], {}), /咖啡机/);
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

test("callLLM 只把 json_object 作为 response_format 出站（教练通道靠它消除解析失败）", async () => {
  const prior = global.fetch;
  try {
    const sent = [];
    global.fetch = async (_url, options) => {
      sent.push(JSON.parse(options.body));
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "{}" } }] }) };
    };
    await callLLM({ messages: [{ role: "user", content: "x" }], responseFormat: { type: "json_object" } });
    await callLLM({ messages: [{ role: "user", content: "x" }], responseFormat: { type: "text" } });
    await callLLM({ messages: [{ role: "user", content: "x" }] });
    assert.deepEqual(sent[0].response_format, { type: "json_object" });
    assert.equal("response_format" in sent[1], false, "非 json_object 的格式不应出站");
    assert.equal("response_format" in sent[2], false, "未请求时不应凭空加 response_format");
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
