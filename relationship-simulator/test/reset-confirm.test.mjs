// R1 Minor-2（重置防误触）+ 顺带记录 1（死导入清理）的回归测试。
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const docSource = await readFile(new URL("../docs/设计文档-解耦重构.md", import.meta.url), "utf8");
const memorySource = await readFile(new URL("../public/modules/core/memory.js", import.meta.url), "utf8");

test("重置按钮须经 confirm 确认后才执行 resetSession（复用 PUA 确认模式）", () => {
  assert.match(appSource, /RESET_CONFIRMATION = "确认重置当前对话？/);
  const listenerAt = appSource.indexOf('$("resetBtn")?.addEventListener');
  const confirmAt = appSource.indexOf("globalThis.confirm?.(RESET_CONFIRMATION)");
  const resetAt = appSource.indexOf("resetSession()", confirmAt);
  assert.ok(listenerAt > -1 && confirmAt > listenerAt && resetAt > confirmAt);
  // 取消确认（confirm 返回 false）时不得触发重置
  assert.doesNotMatch(appSource, /\$\("resetBtn"\)\?\.addEventListener\("click",\s*resetSession\)/);
});

test("app.js 不再死导入 buildConversationSummary（P2-10 收敛遗留清理）", () => {
  assert.equal(appSource.includes("buildConversationSummary"), false);
  // memory.js 中 object 版签名与 string 版更名保持现状
  assert.match(memorySource, /export function buildConversationSummary\(messages, analysis = null\)/);
  assert.match(memorySource, /export function buildConversationTranscript\(messages\)/);
});

test("设计文档与 B3 收敛后的实际签名一致", () => {
  assert.match(docSource, /buildConversationSummary\(messages, analysis\): \{ date; messageCount; summary; topics; avgScore \}/);
  assert.match(docSource, /buildConversationTranscript\(messages\): string/);
  assert.doesNotMatch(docSource, /buildConversationSummary\(messages\): string/);
});
