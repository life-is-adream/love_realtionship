import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SEGMENT_PUNCT_CHARS,
  SEGMENT_GAP_MS,
  SEGMENT_MIN_CHARS,
  hasKana,
  splitSpeechSegments,
  shouldUseSegmentedSpeech
} from "../public/modules/voice/speech-segments.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evaluateSource = () =>
  readFileSync(path.join(root, "voice", "character_voices", "eval", "evaluate.py"), "utf8");

// ── 与评测口径的一致性 ──────────────────────────────────────────────────────

test("分段标点集与 eval/evaluate.py 的 PUNCT_CHARS 逐字一致", () => {
  const matched = evaluateSource().match(/PUNCT_CHARS\s*=\s*set\("([^"]+)"\)/);
  assert.ok(matched, "应能解析 evaluate.py 的 PUNCT_CHARS");
  assert.equal(SEGMENT_PUNCT_CHARS, matched[1], "前端切段口径不得与评测漂移");
  assert.equal(SEGMENT_GAP_MS, 400, "段间留白必须与 PROSODY.md 的 seg 变体一致");
  assert.equal(SEGMENT_MIN_CHARS, 12);
});

test("splitSpeechSegments：标点留段尾、连续标点并入同段", () => {
  assert.deepEqual(
    splitSpeechSegments("稍微休息一下也没关系的，我会在这里陪着你。"),
    ["稍微休息一下也没关系的，", "我会在这里陪着你。"],
    "zh_m01 中句应切成 2 段，与 prosody 评测一致"
  );
  assert.deepEqual(
    splitSpeechSegments("嗯……原来是这样啊。真的吗？"),
    ["嗯……", "原来是这样啊。", "真的吗？"]
  );
  assert.deepEqual(splitSpeechSegments("没有标点的长句子"), ["没有标点的长句子"]);
  assert.deepEqual(splitSpeechSegments(""), []);
  assert.deepEqual(splitSpeechSegments("  "), []);
});

test("splitSpeechSegments：中英文标点与分号/全角冒号同样切段", () => {
  assert.deepEqual(splitSpeechSegments("先坐下来,慢慢说;好吗：不着急"),
    ["先坐下来,", "慢慢说;", "好吗：", "不着急"]);
  assert.equal(SEGMENT_PUNCT_CHARS.includes(":"), false, "半角冒号不在评测标点集内");
});

// ── 门控：别把分段策略误用到其它引擎 / 日语 / 短句 ─────────────────────────

test("hasKana：识别平假名与片假名，不误判纯汉字中文", () => {
  assert.equal(hasKana("少し休んだらどうですか。"), true);
  assert.equal(hasKana("コンニチハ"), true);
  assert.equal(hasKana("稍微休息一下也没关系的，我会在这里陪着你。"), false);
  assert.equal(hasKana(""), false);
});

test("shouldUseSegmentedSpeech：只放行 character 引擎的中文多段长句", () => {
  const mid = "稍微休息一下也没关系的，我会在这里陪着你。";
  assert.equal(shouldUseSegmentedSpeech(mid, "character"), true);
  assert.equal(shouldUseSegmentedSpeech("少し休んだらどうですか。お茶を淹れますよ。", "character"), false,
    "日语 seg 的留白改善落在噪声内，不分段");
  assert.equal(shouldUseSegmentedSpeech("你好呀。", "character"), false, "短句多请求只会增加固定开销");
  assert.equal(shouldUseSegmentedSpeech("没有标点的长句子也要保持整段请求哦", "character"), false,
    "切不出 2 段就不分段");
  assert.equal(shouldUseSegmentedSpeech(mid, "chattts"), false, "ChatTTS 服务端批量更快");
  assert.equal(shouldUseSegmentedSpeech(mid, "kokoro"), false);
  assert.equal(shouldUseSegmentedSpeech(mid, "edge"), false);
  assert.equal(shouldUseSegmentedSpeech("", "character"), false);
});

// ── 播放队列行为（真实调用 speakText，桩掉网络与音频） ────────────────────

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setupStubs() {
  const state = { calls: [], payloads: [], events: [], played: [], resolvers: [], seq: 0, resolvedCount: 0 };
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  };
  globalThis.document = { querySelector: () => null };
  globalThis.URL.createObjectURL = () => "blob:s2-" + (++state.seq);
  globalThis.URL.revokeObjectURL = () => {};
  globalThis.Audio = class {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      state.played.push(url);
      state.events.push("play:" + url);
    }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    play() {
      return Promise.resolve().then(() => {
        queueMicrotask(() => this.listeners.get("ended")?.());
      });
    }
    pause() { this.paused = true; }
  };
  globalThis.fetch = (_url, options) => {
    const payload = JSON.parse(options.body);
    state.calls.push(payload.text);
    state.payloads.push(payload);
    state.events.push("fetch:" + payload.text);
    return new Promise((resolve) => {
      state.resolvers.push(() => {
        state.resolvedCount += 1;
        resolve({ ok: true, blob: async () => ({}) });
      });
    });
  };
  return state;
}

test("speakText：character 中文长句分段请求，首段先播、播放期间预取下一段", async () => {
  const st = setupStubs();
  const { speakText } = await import("../public/modules/voice/tts-client.js");
  const text = "稍微休息一下也没关系的，我会在这里陪着你。";
  const done = speakText(text, { engine: "character", voice: "char_shinobu" });

  assert.equal(st.calls.length, 1, "启动时只请求首段，不能一次性把所有段都发出去");
  assert.equal(st.calls[0], "稍微休息一下也没关系的，");
  assert.equal(st.played.length, 0, "首段未回来前不能开始播放");
  assert.equal(st.payloads[0].voice, "char_shinobu", "分段链路必须透传当前选中的角色音色");
  assert.equal(st.payloads[0].engine, "character");

  st.resolvers[0]();
  await flush();
  await flush();
  assert.equal(st.played.length, 1, "第二段仍在生成时，首段已经开始播放");
  assert.equal(st.calls.length, 2, "第二段请求已发出，与首段播放并行");
  assert.equal(st.resolvers.length, 2);
  assert.equal(st.resolvedCount, 1, "只兑现了首段请求：播放不等待后续段合成完");
  const firstFetchIdx = st.events.indexOf("fetch:稍微休息一下也没关系的，");
  const playIdx = st.events.findIndex((event) => event.startsWith("play:"));
  assert.ok(firstFetchIdx >= 0 && firstFetchIdx < playIdx, "必须先拿到首段才能开播");

  st.resolvers[1]();
  assert.equal(await done, true);
  assert.equal(st.played.length, 2, "两段都要播完");
  assert.ok(st.payloads.every((item) => item.voice === "char_shinobu"), "每一段都用同一个角色音色");
});

test("speakText：其它引擎仍整段一次请求，不改变既有批量行为", async () => {
  const st = setupStubs();
  const { speakText } = await import("../public/modules/voice/tts-client.js");
  const text = "稍微休息一下也没关系的，我会在这里陪着你。";
  const done = speakText(text, { engine: "chattts", voice: "chat_qingche" });
  assert.equal(st.calls.length, 1);
  assert.equal(st.calls[0], text, "非角色引擎不切段");
  st.resolvers[0]();
  assert.equal(await done, true);
  assert.equal(st.calls.length, 1);
});

test("stopSpeaking：打断分段队列后不再请求后续段", async () => {
  const st = setupStubs();
  const { speakText, stopSpeaking } = await import("../public/modules/voice/tts-client.js");
  const text = "如果觉得累了，就先把手里的事放一放吧。我不会催你的。";
  const done = speakText(text, { engine: "character", voice: "char_shinobu" });
  st.resolvers[0]();
  await flush();
  await flush();
  const before = st.calls.length;
  assert.ok(before >= 1);
  stopSpeaking();
  assert.equal(await done, false, "被打断的朗读应返回 false");
  assert.equal(st.calls.length, before, "停止后不得继续发出新的分段请求");
});
