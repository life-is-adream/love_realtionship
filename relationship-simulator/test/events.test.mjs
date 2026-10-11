import test from "node:test";
import assert from "node:assert/strict";
import { on, emit, off, once, Events } from "../public/modules/core/events.js";

test("同一回调跨事件订阅可以独立解除", () => {
  const seen = [];
  const handler = (value) => seen.push(value);
  const a = on("multi:a", handler);
  const b = on("multi:b", handler);
  try {
    off("multi:a", handler);
    emit("multi:a", "unwanted");
    emit("multi:b", "wanted");
    assert.deepEqual(seen, ["wanted"]);
  } finally { a(); b(); }
});

test("旧订阅取消函数不会取消同回调的新订阅，off 清理该事件的所有订阅", () => {
  let calls = 0;
  const handler = () => calls++;
  const old = on("repeat", handler);
  old();
  const fresh = on("repeat", handler);
  const duplicate = on("repeat", handler);
  try {
    old();
    emit("repeat");
    assert.equal(calls, 2);
    off("repeat", handler);
    emit("repeat");
    assert.equal(calls, 2);
  } finally { fresh(); duplicate(); }
});

test("Events 包含所有事件常量", () => {
  assert.ok(Events.MEMORY_UPDATED);
  assert.ok(Events.ANALYSIS_COMMITTED);
  assert.ok(Events.PERSONA_SWITCHED);
  assert.ok(Events.MESSAGE_SENT);
  assert.ok(Events.STATE_RESET);
  assert.ok(Events.EMOTION_ANALYZED);
  assert.ok(Events.PATTERNS_UPDATED);
});

test("emit 和 on 传递数据", () => {
  const results = [];
  const unsub = on("test:event", (detail) => { results.push(detail); });
  emit("test:event", { msg: "hello" });
  assert.equal(results.length, 1);
  assert.equal(results[0].msg, "hello");
  unsub();
});

test("on 返回取消订阅函数", () => {
  const results = [];
  const unsub = on("test:unsub", (detail) => { results.push(detail); });
  emit("test:unsub", { n: 1 });
  unsub();
  emit("test:unsub", { n: 2 });
  assert.equal(results.length, 1);
});

test("off 取消监听", () => {
  const results = [];
  const handler = (detail) => { results.push(detail); };
  on("test:off", handler);
  emit("test:off", { n: 1 });
  off("test:off", handler);
  emit("test:off", { n: 2 });
  assert.equal(results.length, 1);
});

test("once 只接收一次", async () => {
  const promise = once("test:once");
  emit("test:once", { data: "first" });
  emit("test:once", { data: "second" });
  const result = await promise;
  assert.equal(result.data, "first");
});

test("不同事件互不干扰", () => {
  const a = [];
  const b = [];
  const unsubA = on("event:a", (d) => a.push(d));
  const unsubB = on("event:b", (d) => b.push(d));
  emit("event:a", { val: 1 });
  emit("event:b", { val: 2 });
  assert.equal(a.length, 1);
  assert.equal(a[0].val, 1);
  assert.equal(b.length, 1);
  assert.equal(b[0].val, 2);
  unsubA();
  unsubB();
});
