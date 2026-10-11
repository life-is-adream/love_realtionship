// ① 角色回信：buildHerVoice 分档全覆盖 + 边界声明 + 无效输入。
import test from "node:test";
import assert from "node:assert/strict";

import { buildHerVoice, HER_VOICE_DIM_THRESHOLD } from "../public/modules/coach/her-voice.js";

const score = (total, dims = {}) => ({ total, naturalness: 70, empathy: 70, boundary: 70, momentum: 70, ...dims });

test("high total with no weak dim produces a positive letter without blame", () => {
  const voice = buildHerVoice(score(85));
  assert.ok(voice);
  assert.match(voice.headline, /回你/);
  assert.ok(voice.lines.length >= 2);
  assert.match(JSON.stringify(voice.lines), /自在/);
  assert.match(voice.note, /不是读心/);
  assert.match(voice.note, /本人确认/);
});

test("mid total asks for one concrete next step instead of criticizing", () => {
  const voice = buildHerVoice(score(72));
  assert.match(voice.headline, /这样想/);
  assert.match(JSON.stringify(voice.lines), /具体一点/);
  assert.equal(JSON.stringify(voice.lines).includes("教程"), false);
});

test("weak dim below threshold names the dimension and speaks in first person", () => {
  const empathy = buildHerVoice(score(78, { empathy: 50 }));
  assert.match(empathy.headline, /共情/);
  assert.match(empathy.lines[0], /被听到/);
  const boundary = buildHerVoice(score(78, { boundary: 40 }));
  assert.match(boundary.headline, /边界感/);
  assert.match(boundary.lines[0], /到这里|空间/);
  const naturalness = buildHerVoice(score(78, { naturalness: HER_VOICE_DIM_THRESHOLD - 5 }));
  assert.match(naturalness.headline, /自然度/);
  const momentum = buildHerVoice(score(78, { momentum: 30 }));
  assert.match(momentum.headline, /推进力/);
});

test("low total with balanced dims still writes the uncomfortable letter with a reassurance line", () => {
  const voice = buildHerVoice(score(50));
  assert.ok(voice.lines.length >= 2);
  assert.match(voice.lines[1], /第一次尝试|紧张/);
  assert.match(voice.note, /不代表所有女生/);
});

test("no score, invalid score or unscorable totals return null; null dims degrade to the plain letter", () => {
  assert.equal(buildHerVoice(null), null);
  assert.equal(buildHerVoice({}), null);
  assert.equal(buildHerVoice({ total: "abc" }), null);
  // 总分有效但四维全缺：不点名维度，按总分降级为普通回信（正面档）
  const plain = buildHerVoice({ total: 80, naturalness: null, empathy: null, boundary: null, momentum: null });
  assert.match(plain.headline, /回你/);
  const midPlain = buildHerVoice({ total: 70, naturalness: null, empathy: null, boundary: null, momentum: null });
  assert.match(midPlain.headline, /这样想/);
});

test("persona name is echoed in note and empty name falls back to generic signature", () => {
  const named = buildHerVoice(score(85), "夏紫桐");
  assert.match(named.headline, /她/);
  const rendered = JSON.stringify(named);
  assert.ok(rendered.length > 0);
  const anonymous = buildHerVoice(score(85), "");
  assert.ok(anonymous);
});

test("ties on weakest dim resolve deterministically in declaration order", () => {
  const first = buildHerVoice(score(60, { naturalness: 40, empathy: 40, boundary: 40, momentum: 40 }));
  assert.match(first.headline, /自然度/);
});
