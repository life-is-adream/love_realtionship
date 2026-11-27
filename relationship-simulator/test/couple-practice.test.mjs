import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { PrivatePairSession } from "../public/modules/relationship-flow/couple.js";

test("双方封存且各自同意后才返回答案；错误口令和撤回不能解锁", async () => {
  const session = new PrivatePairSession(webcrypto);
  await session.seal("A", "我希望被提前告知", "alpha-secret");
  await assert.rejects(session.consentShare("A", "alpha-secret"), /双方都封存/);
  await session.seal("B", "我希望先休息一下", "bravo-secret");
  assert.equal(await session.consentShare("A", "alpha-secret"), null);
  await assert.rejects(session.consentShare("B", "wrong-secret"), /口令/);
  assert.deepEqual(await session.consentShare("B", "bravo-secret"), { A: "我希望被提前告知", B: "我希望先休息一下" });
  session.withdraw("A");
  assert.equal(session.status().approvedA, false);
  session.clear();
  assert.deepEqual(session.status(), { sealedA: false, sealedB: false, approvedA: false, approvedB: false });
});

test("撤回会使正在处理的分享请求失效", async () => {
  const session = new PrivatePairSession(webcrypto);
  await session.seal("A", "答案 A", "alpha-secret");
  await session.seal("B", "答案 B", "bravo-secret");
  const pending = session.consentShare("A", "alpha-secret");
  session.withdraw("A");
  await assert.rejects(pending, /本轮已变化/);
  assert.equal(session.status().approvedA, false);
});
