import test from "node:test";
import assert from "node:assert/strict";
import { buildReplyOptionsForHer, isUsableModelReplyOptions } from "../public/modules/coach/replies.js";

test("A/B/C are rebuilt from the latest female reply", () => {
  const book = buildReplyOptionsForHer("mix", "我最近在看一本关于城市生活的书。", "你最近忙什么？");
  const tired = buildReplyOptionsForHer("mix", "今天加班太累了，我想先休息。", "你最近忙什么？");

  assert.equal(book.length, 3);
  assert.deepEqual(book.map(item => item.key), ["A", "B", "C"]);
  assert.notDeepEqual(book.map(item => item.text), tired.map(item => item.text));
  assert.match(book[0].text, /城市生活|最吸引/);
  assert.match(tired[0].text, /消耗|休息/);
});

test("closing messages produce a clean sign-off instead of stale topic questions", () => {
  const options = buildReplyOptionsForHer("mix", "哈哈还好吧，就正常聊天呀。天晚了你早点休息~", "这条消息看起来心情不错，我隔着屏幕都接到一点好天气。");
  const all = options.map(item => item.text).join("\n");

  assert.deepEqual(options.map(item => item.key), ["A", "B", "C"]);
  assert.match(all, /晚安|早点休息/);
  assert.doesNotMatch(all, /哪个瞬间|最近才有的感觉/);
});

test("suggestions never copy the user's just-sent message", () => {
  const mine = "这条消息看起来心情不错，我隔着屏幕都接到一点好天气。";
  const options = buildReplyOptionsForHer("mix", "哈哈，还好吧。", mine);

  assert.ok(options.every(item => item.text !== mine));
});

test("boundary replies do not continue pressuring the user", () => {
  const options = buildReplyOptionsForHer("mix", "我今天不想说了，想安静一会儿。", "是不是发生什么了？");
  const all = options.map(item => item.text).join("\n");

  assert.match(all, /节奏|不打扰|安静/);
  assert.doesNotMatch(all, /你平时也会参加这种活动吗/);
});

test("style changes display order without changing option identities", () => {
  assert.deepEqual(buildReplyOptionsForHer("B", "周六下午见面吧。", "好").map(item => item.key), ["B", "A", "C"]);
  assert.deepEqual(buildReplyOptionsForHer("C", "周六下午见面吧。", "好").map(item => item.key), ["C", "A", "B"]);
});

// ── 教练校准后回归用例 ─────────────────────────────────────────────────────────

test("A/B/C 回复不包含操控性话术（校准后仍保持）", () => {
  const options = buildReplyOptionsForHer("mix", "我今天有点累。", "你还好吗？");
  const all = options.map(item => item.text).join("\n");
  // 确保不出现 PUA 话术
  assert.doesNotMatch(all, /你必须|你一定|宝贝|你怎么总是/);
});

test("boundary 回复不施压（校准后回归）", () => {
  const options = buildReplyOptionsForHer("mix", "我今天不想说了，想安静一会儿。", "是不是发生什么了？");
  const all = options.map(item => item.text).join("\n");
  assert.match(all, /节奏|不打扰|安静/);
  // 确保不连续追问
  const questionCount = (all.match(/[？?]/g) || []).length;
  assert.ok(questionCount <= 3, `问题数量 ${questionCount} 过多`);
});

test("closing 回复自然收尾（校准后回归）", () => {
  const options = buildReplyOptionsForHer("mix", "晚安，明天再聊。", "好的");
  const all = options.map(item => item.text).join("\n");
  assert.match(all, /晚安|早点休息/);
  assert.doesNotMatch(all, /哪个瞬间|最近才有的感觉/);
});

test("校准后 A/B/C 三项仍完整", () => {
  const options = buildReplyOptionsForHer("mix", "今天加班很累。", "辛苦了");
  assert.equal(options.length, 3);
  assert.deepEqual(options.map(item => item.key), ["A", "B", "C"]);
  // 每项都有文本
  assert.ok(options.every(item => item.text.length > 0));
});

test("模型 ABC 通过校验时应保留，不能被本地模板覆盖", () => {
  const modelOptions = [
    { key: "A", label: "A 温柔高情商", text: "我也很喜欢那种安静又有点未知的感觉，所以才推荐深海那集。" },
    { key: "B", label: "B 幽默风趣", text: "深海像地球偷偷开的隐藏副本，越看越想知道下面还有什么。" },
    { key: "C", label: "C 深入了解", text: "你说的治愈感更像来自画面，还是看它时整个人会慢下来？" }
  ];
  assert.equal(isUsableModelReplyOptions(modelOptions, "海洋类的吧，感觉很治愈。你呢，为什么推荐深海那集…", "好呀"), true);
});

test("模型返回的对象形式 ABC 也应被视为三条有效建议", () => {
  const modelOptions = [
    { key: "A", text: "是的，尤其是那些空旷的镜头，会让人觉得世界很大，又很近。" },
    { key: "B", text: "看着深海里自己发光的小生物，莫名觉得它们挺朋克的。" },
    { key: "C", text: "我印象最深的是深海热泉的生态系统。你觉得那里最神奇的是什么？" }
  ];
  assert.equal(isUsableModelReplyOptions(modelOptions, "深海部分是不是特别安静？", "我推荐深海那集"), true);
});

test("模型 ABC 变成教练元话语时应拒绝并允许本地兜底", () => {
  const modelOptions = [
    { key: "A", text: "我听到你说‘海洋类’了。你愿意的话，可以再跟我说一点。" },
    { key: "B", text: "收到，这句我先记下，不急着抢答。" },
    { key: "C", text: "关于这句话，你更想继续聊它，还是换个轻松一点的话题？" }
  ];
  assert.equal(isUsableModelReplyOptions(modelOptions, "海洋类的吧，感觉很治愈。", "好呀"), false);
});
