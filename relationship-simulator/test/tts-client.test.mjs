import test from "node:test";
import assert from "node:assert/strict";

// ── localStorage 桩（本文件独立进程运行） ────────────────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};

const { TTS_ENGINES, voicesFor, getVoicePrefs, setVoicePrefs } = await import("../public/modules/voice/tts-client.js");
const { STORAGE_KEYS } = await import("../public/modules/core/config.js");

// ── 引擎与音色表 ────────────────────────────────────────────────────────────

test("TTS_ENGINES：每个引擎都有 id/label 且至少一个音色", () => {
  assert.ok(TTS_ENGINES.length >= 1);
  for (const engine of TTS_ENGINES) {
    assert.equal(typeof engine.id, "string");
    assert.equal(typeof engine.label, "string");
    assert.ok(engine.id.length > 0);
    assert.ok(Array.isArray(engine.voices) && engine.voices.length >= 1, `${engine.id} 至少要有一个音色`);
  }
});

test("TTS_ENGINES：id 唯一，音色 id 在本引擎内唯一", () => {
  const ids = TTS_ENGINES.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "引擎 id 不得重复");
  for (const engine of TTS_ENGINES) {
    const voiceIds = engine.voices.map((v) => v.id);
    assert.equal(new Set(voiceIds).size, voiceIds.length, `${engine.id} 的音色 id 不得重复`);
  }
});

test("voicesFor：未知引擎回退到默认引擎而非抛错", () => {
  assert.doesNotThrow(() => voicesFor("不存在的引擎"));
  assert.ok(voicesFor("不存在的引擎").length >= 1);
});

// ── 偏好读写 ────────────────────────────────────────────────────────────────

test("getVoicePrefs：无记录时返回默认偏好", () => {
  store.clear();
  const prefs = getVoicePrefs();
  assert.equal(typeof prefs.engine, "string");
  assert.equal(typeof prefs.voice, "string");
  assert.equal(prefs.autoPlay, false);
  assert.equal(typeof prefs.speed, "number");
});

test("getVoicePrefs：非法 JSON 静默降级为默认，不抛错", () => {
  store.clear();
  store.set(STORAGE_KEYS.voicePrefs, "{bad json");
  assert.doesNotThrow(() => getVoicePrefs());
  const prefs = getVoicePrefs();
  assert.equal(prefs.autoPlay, false);
});

test("getVoicePrefs：越界 speed 与未知引擎/音色被纠正", () => {
  store.clear();
  const defaults = getVoicePrefs();
  store.set(STORAGE_KEYS.voicePrefs, JSON.stringify({
    engine: "不存在",
    voice: "也不存在",
    autoPlay: "yes",       // 非布尔，必须被拒
    speed: 5               // 超出 0.8–1.2
  }));
  const prefs = getVoicePrefs();
  assert.ok(TTS_ENGINES.some((e) => e.id === prefs.engine), "未知引擎应回退到默认引擎");
  assert.ok(voicesFor(prefs.engine).some((v) => v.id === prefs.voice), "音色必须属于当前引擎");
  assert.equal(prefs.autoPlay, false, "autoPlay 只接受 true");
  assert.equal(prefs.speed, defaults.speed, "越界 speed 回退到默认");
});

test("getVoicePrefs：合法 speed 被保留", () => {
  store.clear();
  store.set(STORAGE_KEYS.voicePrefs, JSON.stringify({ engine: TTS_ENGINES[0].id, speed: 1.2 }));
  assert.equal(getVoicePrefs().speed, 1.2);
});

test("setVoicePrefs：合并写入并落盘", () => {
  store.clear();
  const merged = setVoicePrefs({ autoPlay: true });
  assert.equal(merged.autoPlay, true);
  const persisted = JSON.parse(store.get(STORAGE_KEYS.voicePrefs));
  assert.equal(persisted.autoPlay, true);
  assert.equal(typeof persisted.engine, "string");
});

test("setVoicePrefs：切引擎时自动纠正不匹配的音色", () => {
  store.clear();
  const first = TTS_ENGINES[0];
  const other = TTS_ENGINES.find((e) => e.id !== first.id) || first;
  setVoicePrefs({ engine: first.id, voice: first.voices[0].id });
  const afterSwitch = setVoicePrefs({ engine: other.id });
  assert.equal(afterSwitch.engine, other.id);
  assert.ok(
    other.voices.some((v) => v.id === afterSwitch.voice),
    "切引擎后音色必须落在新引擎的音色表内"
  );
});

test("setVoicePrefs：写入失败（配额/隐私模式）仍返回合并结果", () => {
  store.clear();
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => { throw new Error("QuotaExceeded"); },
    removeItem: () => {}
  };
  const merged = setVoicePrefs({ autoPlay: true });
  assert.equal(merged.autoPlay, true, "持久化失败不应影响会话内偏好");
});
