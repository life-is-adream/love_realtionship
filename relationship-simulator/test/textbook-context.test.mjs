import test from "node:test";
import assert from "node:assert/strict";
import { buildTextbookCoachContext } from "../public/modules/content/textbook-search.js";
import { buildCoachPrompt } from "../public/modules/coach/prompts.js";

test("textbook context is bounded to two excerpts and excludes raw replay", () => {
  const context = buildTextbookCoachContext({ summary: "用户连续追问，对方可能需要空间", results: Array.from({ length: 5 }, (_, i) => ({ chapterTitle: `第${i + 1}章`, reviewPointId: `${i + 1}-r1`, searchExcerpt: "摘录".repeat(200) })) });
  assert.equal(context.excerpts.length, 2);
  assert.ok(context.excerpts.every((item) => item.text.length <= 360));
  assert.equal("rawReplay" in context, false);
});

test("prompt keeps the old path valid when textbook evidence is missing", () => {
  const prompt = buildCoachPrompt({ persona: { systemRole: "测试角色" }, memory: { background: "测试", interests: "", boundaries: "" }, user: "继续" });
  assert.match(prompt.system, /恋爱沟通教练/);
  assert.doesNotMatch(prompt.system, /undefined/);
});
