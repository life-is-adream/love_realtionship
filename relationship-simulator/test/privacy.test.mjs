import test from "node:test";
import assert from "node:assert/strict";
import { redactSensitiveText, sanitizeOutboundMessages, formatRedactionNotice } from "../public/modules/core/privacy.js";
import { callLLM } from "../public/modules/core/api-client.js";

test("redactSensitiveText 脱敏电话/邮箱/网址/长编号并保留普通文字", () => {
  const result = redactSensitiveText("电话 13812345678，邮箱 a@example.com，网址 https://example.com/a，编号 110101199001011234。普通文字保留。");
  assert.match(result.text, /\[已隐藏手机号\]/);
  assert.match(result.text, /\[已隐藏邮箱\]/);
  assert.match(result.text, /\[已隐藏网址\]/);
  assert.match(result.text, /\[已隐藏编号\]/);
  assert.match(result.text, /普通文字保留/);
});

test("sanitizeOutboundMessages 对所有出站消息脱敏并报告命中", () => {
  const { messages, hits } = sanitizeOutboundMessages([
    { role: "user", content: "我电话 13812345678，加我微信" },
    { role: "assistant", content: "好的，明天见。" },
    { role: "user", content: 42 }
  ]);
  assert.match(messages[0].content, /\[已隐藏手机号\]/);
  assert.equal(messages[1].content, "好的，明天见。");
  assert.equal(messages[2].content, 42);
  assert.ok(hits.some((hit) => hit.type === "phone"));
});

test("sanitizeOutboundMessages 处理非数组输入", () => {
  assert.deepEqual(sanitizeOutboundMessages(null), { messages: [], hits: [] });
  assert.deepEqual(sanitizeOutboundMessages(undefined), { messages: [], hits: [] });
});

test("formatRedactionNotice 无命中时返回空字符串", () => {
  assert.equal(formatRedactionNotice([]), "");
  assert.equal(formatRedactionNotice(null), "");
  assert.equal(formatRedactionNotice(undefined), "");
});

test("formatRedactionNotice 汇总命中并输出信任提示", () => {
  const notice = formatRedactionNotice([{ type: "phone", count: 1 }, { type: "email", count: 2 }]);
  assert.match(notice, /已脱敏/);
  assert.match(notice, /手机号 1 处/);
  assert.match(notice, /邮箱 2 处/);
  assert.match(notice, /未发送原始信息/);
});

test("callLLM 发送前对消息脱敏（通过捕获请求体验证）", async () => {
  let capturedBody = null;
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "回复" } }] })
    };
  };
  try {
    const result = await callLLM({
      messages: [{ role: "user", content: "我的电话是 13812345678，地址在北京市" }]
    });
    assert.ok(capturedBody.messages[0].content.includes("[已隐藏手机号]"));
    assert.ok(!capturedBody.messages[0].content.includes("13812345678"));
    assert.ok(result.redactionHits.some((hit) => hit.type === "phone"));
  } finally {
    global.fetch = originalFetch;
  }
});
