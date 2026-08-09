import test from "node:test";
import assert from "node:assert/strict";
import { on, emit, off, once, Events } from "../public/modules/core/events.js";

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