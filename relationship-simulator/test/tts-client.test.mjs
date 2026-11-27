import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

test("TTS_ENGINES：在线引擎必须标 online+optional，默认引擎离线", () => {
  assert.ok(!TTS_ENGINES[0].online, "默认引擎必须离线，聊天文本不得默认离开本机");
  for (const engine of TTS_ENGINES.filter((item) => item.online)) {
    assert.equal(engine.optional, true, `${engine.id} 必须由 health 解锁后才能选`);
  }
});

const presetsSource = () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  return readFileSync(path.join(root, "voice", "voice_presets.py"), "utf8");
};

test("edge 产品音色表与 voice/voice_presets.py 的 EDGE_PRODUCT_IDS 一致", () => {
  const source = presetsSource();
  const block = source.match(/EDGE_PRODUCT_IDS\s*=\s*\(([^)]*)\)/);
  assert.ok(block, "应能解析 EDGE_PRODUCT_IDS");
  const productIds = [...block[1].matchAll(/"(edge_[a-z]+)"/g)].map((m) => m[1]);
  const jsIds = TTS_ENGINES.find((engine) => engine.id === "edge")?.voices.map((v) => v.id) || [];
  assert.ok(productIds.length > 0, "产品音色表不能为空");
  assert.deepEqual(jsIds, productIds, "前端音色表与 sidecar 产品预设漂移了");
  assert.equal(jsIds.length, 2, "真人听感验收只通过两个原生音色，别把反例塞回产品");
});

test("产品在线音色不得再做大幅变调（听感验收结论）", () => {
  const source = presetsSource();
  const presets = [...source.matchAll(/\{"id":\s*"(edge_[a-z]+)".*?"pitch":\s*"([+-]?\d+)Hz"/g)];
  const pitchById = new Map(presets.map((m) => [m[1], Number(m[2])]));
  const block = source.match(/EDGE_PRODUCT_IDS\s*=\s*\(([^)]*)\)/);
  for (const m of block[1].matchAll(/"(edge_[a-z]+)"/g)) {
    assert.ok(pitchById.has(m[1]), `${m[1]} 缺少 pitch 定义`);
    assert.ok(Math.abs(pitchById.get(m[1])) <= 10,
      `${m[1]} 变调 ${pitchById.get(m[1])}Hz 超过 ±10Hz：变调会连共振峰一起搬，听感已判定不可接受`);
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

test("getVoicePrefs：被听感验收淘汰的旧音色一律回落到该引擎首选", () => {
  store.clear();
  const stale = [
    ["chattts", "chat_wenrou"], ["chattts", "chat_yujie"],
    ["edge", "edge_yujie"], ["edge", "edge_luoli"]
  ];
  for (const [engine, voice] of stale) {
    store.set(STORAGE_KEYS.voicePrefs, JSON.stringify({ engine, voice, tuned: true }));
    const prefs = getVoicePrefs();
    assert.notEqual(prefs.voice, voice, `${voice} 已淘汰，不应继续生效`);
    assert.ok(voicesFor(prefs.engine).some((v) => v.id === prefs.voice), "回落后音色必须有效");
  }
});

test("getVoicePrefs：入选音色的显式选择被尊重", () => {
  store.clear();
  store.set(STORAGE_KEYS.voicePrefs, JSON.stringify({ engine: "edge", voice: "edge_yuanqi", tuned: true }));
  assert.equal(getVoicePrefs().voice, "edge_yuanqi");
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
