import test from "node:test";
import assert from "node:assert/strict";
import {
  PUA_TECHNIQUES,
  buildPuaAwarenessPrompt,
  selectLocalPuaReply
} from "../public/modules/training/pua-awareness.js";

test("防御训练手法目录有唯一键、识别信号和本地演示", () => {
  assert.equal(PUA_TECHNIQUES.length, 10);
  assert.equal(new Set(PUA_TECHNIQUES.map((item) => item.key)).size, 10);
  for (const item of PUA_TECHNIQUES) {
    assert.ok(item.name);
    assert.ok(item.demo);
    assert.ok(item.signal);
    assert.ok(item.localReply);
  }
});

test("识别训练 Prompt 由同一目录生成并保留防御边界", () => {
  const prompt = buildPuaAwarenessPrompt();

  assert.match(prompt, /仅防御研究/);
  assert.match(prompt, /禁止把女方演示的任何手法用于真实操控他人/);
  for (const item of PUA_TECHNIQUES) assert.match(prompt, new RegExp(item.name.replace(/[()]/g, "\\$&")));
});

test("本地演示选择确定、可复现，并只返回目录中的示例", () => {
  const first = selectLocalPuaReply({ latestMine: "你好", previousHer: "", messageCount: 3 });
  const second = selectLocalPuaReply({ latestMine: "你好", previousHer: "", messageCount: 3 });

  assert.equal(first, second);
  assert.equal(PUA_TECHNIQUES.some((item) => item.localReply === first), true);
});
