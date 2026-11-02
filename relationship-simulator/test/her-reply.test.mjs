import test from "node:test";
import assert from "node:assert/strict";
import { parseHerBubbles, joinHerReply, MAX_HER_BUBBLES, MAX_HER_BUBBLE_LENGTH } from "../public/modules/coach/her-reply.js";

test("反斜杠分隔连发消息，拆成多条气泡", () => {
  assert.deepEqual(parseHerBubbles("哈哈确实\\那我明天问你", "林知夏"), ["哈哈确实", "那我明天问你"]);
});

test("换行同样作为气泡分隔", () => {
  assert.deepEqual(parseHerBubbles("还行吧\n你今天怎么这么闲", "林知夏"), ["还行吧", "你今天怎么这么闲"]);
});

test("剥掉代码围栏、包裹引号与说话人前缀", () => {
  assert.deepEqual(parseHerBubbles("```text\n“林知夏：哈哈哈真的吗”\n```", "林知夏"), ["哈哈哈真的吗"]);
});

test("超过三条气泡截断，避免她把整段分析连发出来", () => {
  const bubbles = parseHerBubbles("一\\二\\三\\四\\五", "林知夏");
  assert.equal(bubbles.length, MAX_HER_BUBBLES);
});

test("单条超长截断并保留省略号", () => {
  const bubbles = parseHerBubbles("字".repeat(MAX_HER_BUBBLE_LENGTH + 40), "林知夏");
  assert.equal(bubbles.length, 1);
  assert.ok(bubbles[0].endsWith("…"));
  assert.ok(bubbles[0].length <= MAX_HER_BUBBLE_LENGTH + 1);
});

test("模型仍吐 JSON 时不产出气泡，交给上层判定本轮失败", () => {
  assert.deepEqual(parseHerBubbles('{"herReply":"哈哈","coachScore":{}}', "林知夏"), []);
});

test("空输入、纯空白与只有前缀都返回空数组", () => {
  for (const raw of ["", "   ", "她：", undefined, null]) {
    assert.deepEqual(parseHerBubbles(raw, "林知夏"), [], `应拒绝：${String(raw)}`);
  }
});

test("气泡内部换行与连续空白折叠为单空格", () => {
  assert.deepEqual(parseHerBubbles("今天  挺\n\n顺利的", "林知夏"), ["今天 挺", "顺利的"]);
});

test("joinHerReply 合成给教练与朗读用的单条文本", () => {
  assert.equal(joinHerReply(["哈哈确实", "那我明天问你"]), "哈哈确实 那我明天问你");
  assert.equal(joinHerReply([]), "");
  assert.equal(joinHerReply(null), "");
});

test("角色名含正则元字符时前缀剥离不炸", () => {
  assert.deepEqual(parseHerBubbles("夏(紫)桐：早啊", "夏(紫)桐"), ["早啊"]);
});
