import test from "node:test";
import assert from "node:assert/strict";
import { buildTextbookCoachContext } from "../public/modules/content/textbook-search.js";
import { buildCoachMessages } from "../public/modules/core/api-client.js";

test("textbook context is bounded to two excerpts and excludes raw replay", () => {
  const context = buildTextbookCoachContext({ summary: "用户连续追问，对方可能需要空间", results: Array.from({ length: 5 }, (_, i) => ({ chapterTitle: `第${i + 1}章`, reviewPointId: `${i + 1}-r1`, searchExcerpt: "摘录".repeat(200) })) });
  assert.equal(context.excerpts.length, 2);
  assert.ok(context.excerpts.every((item) => item.text.length <= 360));
  assert.equal("rawReplay" in context, false);
});

test("教练通道在缺教材证据时仍然可用", () => {
  // 断言对象必须是真正上线的那条通道：旧的合并式教练 prompt 已删除，它当年也是零调用方。
  const messages = buildCoachMessages({
    persona: { name: "测试角色", systemRole: "测试角色" },
    memory: { background: "测试", interests: "", boundaries: "" },
    messages: [{ type: "me", text: "继续", who: "我" }],
    herReply: "嗯",
    uiValues: {}
  });
  const joined = messages.map((item) => item.content).join("\n");
  assert.match(joined, /恋爱沟通教练/);
  assert.doesNotMatch(joined, /undefined/);
  assert.equal(messages[0].role, "system");
});
