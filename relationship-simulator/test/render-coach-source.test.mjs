import test from "node:test";
import assert from "node:assert/strict";
import { herReplyTitle } from "../public/modules/render/render-coach.js";

test("女方身份说明与本地兜底/模型回复的来源标签准确区分", () => {
  assert.equal(herReplyTitle({ herReplySource: "identity", generationSource: "model" }), "女方下一句（本地身份说明）");
  assert.equal(herReplyTitle({ herReplySource: "memory-guard", generationSource: "model" }), "女方下一句（本地记忆核对）");
  assert.equal(herReplyTitle({ generationSource: "local" }), "女方下一句（本地兜底）");
  assert.equal(herReplyTitle({ generationSource: "model" }), "女方下一句（模型输出）");
});
