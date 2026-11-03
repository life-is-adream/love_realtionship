import test from "node:test";
import assert from "node:assert/strict";

import {
  assignMessageIds,
  computeMessageId,
  findMessageById,
  messageIdentity,
  nextMessageIdFor
} from "../public/modules/core/message-ids.js";

const me = (text, extra = {}) => ({ type: "me", who: "我", text, source: "user", ...extra });
const her = (text, extra = {}) => ({ type: "her", who: "苏晚", text, source: "model", ...extra });

test("mid 由内容确定性推导：同一份会话重复加载结果完全相同", () => {
  const messages = [me("周六有空吗"), her("有呀"), me("周六有空吗")];
  assert.deepEqual(
    assignMessageIds(assignMessageIds(messages)).map((m) => m.mid),
    assignMessageIds(messages).map((m) => m.mid)
  );
});

test("assignMessageIds 不改动原始对象，也不丢字段", () => {
  const original = me("在吗", { createdAt: "2026-11-02T10:00:00.000Z" });
  const [assigned] = assignMessageIds([original]);
  assert.equal(original.mid, undefined);
  assert.equal(assigned.text, "在吗");
  assert.equal(assigned.who, "我");
  assert.equal(assigned.createdAt, "2026-11-02T10:00:00.000Z");
});

test("说话人不同、正文相同 => 身份不同", () => {
  assert.notEqual(messageIdentity(me("在吗")), messageIdentity(her("在吗")));
  assert.notEqual(computeMessageId(me("在吗")), computeMessageId(her("在吗")));
});

test("正文首尾空白不计入身份", () => {
  assert.equal(computeMessageId(me("在吗")), computeMessageId(me(" 在吗 \n")));
});

test("重复消息取得互不相同的 mid", () => {
  const ids = assignMessageIds([me("在吗"), me("在吗"), me("在吗")]).map((m) => m.mid);
  assert.equal(new Set(ids).size, 3);
});

test("已有的合法 mid 原样保留，只补空缺", () => {
  const kept = "m-legacy-keep-me";
  const messages = assignMessageIds([me("在吗", { mid: kept }), me("在吗")]);
  assert.equal(messages[0].mid, kept);
  assert.notEqual(messages[1].mid, kept);
});

test("沿用旧 mid 后仍不得与推导值冲突", () => {
  const derived = computeMessageId(me("在吗"), 0);
  // 第一条占用了第二条本该推导出的 ID，第二条必须让开而不是重号。
  const messages = assignMessageIds([me("在吗", { mid: derived }), me("在吗")]);
  assert.equal(messages[0].mid, derived);
  assert.notEqual(messages[1].mid, derived);
  assert.equal(new Set(messages.map((m) => m.mid)).size, 2);
});

test("非数组 / 含空洞输入不抛错", () => {
  assert.deepEqual(assignMessageIds(undefined), []);
  assert.deepEqual(assignMessageIds(null), []);
  assert.deepEqual(assignMessageIds("nope"), []);
  assert.deepEqual(assignMessageIds([null, undefined]).length, 2);
});

// 这是 P1 的真正底线：ledger 的 sourceMessageIds 只能指向「同说话人+同正文」的消息，
// 或者查不到；绝不允许悄悄指向另一条不同内容的消息。
test("删除消息后，残留引用只可能指向同内容消息或查不到", () => {
  const messages = [me("a"), me("b"), me("a"), me("a"), me("b")];
  const stamped = assignMessageIds(messages);
  const citations = stamped.map((m) => ({ mid: m.mid, text: m.text, type: m.type }));

  // 删掉中间那条重复，逼迫后续同文消息的序号前移 —— 这才是会漂移的场景。
  const withoutMiddleA = stamped.filter((_, i) => i !== 2);
  const reloaded = assignMessageIds(withoutMiddleA.map(({ mid, ...rest }) => rest));

  for (const cite of citations) {
    const hit = findMessageById(reloaded, cite.mid);
    if (hit) {
      assert.equal(hit.text, cite.text, `mid ${cite.mid} 漂移到不同正文`);
      assert.equal(hit.type, cite.type, `mid ${cite.mid} 漂移到不同说话人`);
    }
  }
});

test("nextMessageIdFor 与整段补齐的结果一致（逐条写入路径）", () => {
  const source = [me("在吗"), her("在吗"), me("在吗")];
  let incremental = [];
  for (const message of source) {
    const mid = nextMessageIdFor(incremental, message);
    incremental = [...incremental, { ...message, mid }];
  }
  assert.deepEqual(incremental.map((m) => m.mid), assignMessageIds(source).map((m) => m.mid));
});

test("findMessageById 查不到返回 null，供调用方判定来源失效", () => {
  const stamped = assignMessageIds([me("在吗")]);
  assert.equal(findMessageById(stamped, "m-does-not-exist"), null);
  assert.equal(findMessageById([], stamped[0].mid), null);
});
