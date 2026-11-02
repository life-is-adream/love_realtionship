import { STORAGE_KEYS } from "../core/config.js";
import { getState } from "../core/state.js";

/**
 * 本地 TTS 引擎目录。与 voice/tts_server.py 中的引擎/音色定义保持一致。
 * chattts 音色 = 固定随机种子采样出的说话人向量；kokoro 音色 = voices-zh.bin 中的中文女声。
 */
export const TTS_ENGINES = [
  {
    id: "chattts",
    label: "ChatTTS · 拟真（GPU）",
    hint: "约 2GB 模型，语气词与停顿更自然；首次合成要等模型加载。",
    voices: [
      { id: "chat_wenrou", label: "温柔 · 低缓" },
      { id: "chat_qingliang", label: "清亮 · 偏高" },
      { id: "chat_chenwen", label: "沉稳 · 中音" },
      { id: "chat_yuanqi", label: "元气 · 明亮" }
    ]
  },
  {
    id: "kokoro",
    label: "Kokoro · 轻量（CPU）",
    hint: "325MB 模型，几乎瞬时出音，不占显存。",
    voices: [
      { id: "zf_xiaobei", label: "小北 · 温柔" },
      { id: "zf_xiaoni", label: "小妮 · 明亮" },
      { id: "zf_xiaoxiao", label: "小晓 · 自然" },
      { id: "zf_xiaoyi", label: "小艺 · 轻快" }
    ]
  }
];

const DEFAULT_PREFS = { engine: "chattts", voice: "chat_wenrou", autoPlay: false, speed: 1.0 };
const CACHE_LIMIT = 30;

function findEngine(engineId) {
  return TTS_ENGINES.find((item) => item.id === engineId) || TTS_ENGINES[0];
}

/** 取某个引擎的音色表。 */
export function voicesFor(engineId) {
  return findEngine(engineId).voices;
}

function defaultVoiceFor(engineId) {
  return voicesFor(engineId)[0].id;
}

/** 读取语音偏好（localStorage 独立键，不进入主 state）。 */
export function getVoicePrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.voicePrefs);
    const parsed = raw ? JSON.parse(raw) : {};
    const engine = TTS_ENGINES.some((item) => item.id === parsed.engine) ? parsed.engine : DEFAULT_PREFS.engine;
    const voices = voicesFor(engine);
    return {
      engine,
      voice: voices.some((item) => item.id === parsed.voice) ? parsed.voice : defaultVoiceFor(engine),
      autoPlay: parsed.autoPlay === true,
      speed: typeof parsed.speed === "number" && parsed.speed >= 0.8 && parsed.speed <= 1.2 ? parsed.speed : DEFAULT_PREFS.speed
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** 合并写入语音偏好；切引擎时自动纠正不属于该引擎的音色。 */
export function setVoicePrefs(patch) {
  const merged = { ...getVoicePrefs(), ...patch };
  const voices = voicesFor(merged.engine);
  if (!voices.some((item) => item.id === merged.voice)) merged.voice = defaultVoiceFor(merged.engine);
  try {
    localStorage.setItem(STORAGE_KEYS.voicePrefs, JSON.stringify(merged));
  } catch {
    // 隐私模式或配额不足时静默降级为会话内偏好
  }
  return merged;
}

const audioCache = new Map();
let activeAudio = null;
let activeButton = null;
let sessionToken = 0;

function setButtonState(button, state) {
  if (!button) return;
  button.classList.toggle("is-loading", state === "loading");
  button.classList.toggle("is-playing", state === "playing");
  button.textContent = state === "loading" ? "合成中" : state === "playing" ? "朗读中" : "朗读";
}

function reportStatus(message) {
  const target = document.querySelector("#chatContext");
  if (target) target.textContent = message;
}

async function fetchChunk(text, engine, voice, speed) {
  const cacheKey = `${engine}|${voice}|${speed}|${text}`;
  const cached = audioCache.get(cacheKey);
  if (cached) return cached;
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: text.slice(0, 300), engine, voice, speed })
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.message || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  audioCache.set(cacheKey, url);
  if (audioCache.size > CACHE_LIMIT) {
    const oldestKey = audioCache.keys().next().value;
    URL.revokeObjectURL(audioCache.get(oldestKey));
    audioCache.delete(oldestKey);
  }
  return url;
}

function playUrl(url) {
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    activeAudio = audio;
    audio.addEventListener("ended", () => resolve(), { once: true });
    audio.addEventListener("error", () => reject(new Error("音频播放失败")), { once: true });
    audio.play().catch(reject);
  });
}

/**
 * 合成并播放一段文本。
 *
 * 为什么整段一次请求、而不是前端按句发：ChatTTS 是自回归模型，单句合成 RTF≈2，
 * 但把多句放进同一个 batch 几乎不增加耗时（服务端已按句批量处理，整段 RTF≈0.86）。
 * 前端切句会让总时长翻倍，所以切句放在服务端、播放放在这里。
 *
 * @param {string} text
 * @param {{engine?: string, voice?: string, speed?: number, button?: HTMLButtonElement|null}} options
 * @returns {Promise<boolean>} 是否成功播完
 */
export async function speakText(text, options = {}) {
  const prefs = getVoicePrefs();
  const engine = options.engine || prefs.engine;
  const voices = voicesFor(engine);
  const voice = voices.some((item) => item.id === options.voice) ? options.voice : (prefs.engine === engine ? prefs.voice : voices[0].id);
  const speed = typeof options.speed === "number" ? options.speed : prefs.speed;
  const button = options.button || null;

  stopSpeaking();
  const clean = String(text || "").trim();
  if (!clean) return false;
  const token = ++sessionToken;
  activeButton = button;
  setButtonState(button, "loading");
  try {
    const url = await fetchChunk(clean, engine, voice, speed);
    if (token !== sessionToken) return false; // 期间被新的朗读请求打断
    setButtonState(button, "playing");
    await playUrl(url);
    if (token !== sessionToken) return false;
    setButtonState(button, "idle");
    return true;
  } catch (error) {
    if (token !== sessionToken) return false;
    // 主引擎（ChatTTS）不可用时自动退回轻量引擎，朗读功能不至于整个失效。
    if (engine !== "kokoro") {
      reportStatus(`ChatTTS 不可用（${error?.message || error}），已自动切换为 Kokoro 朗读。`);
      return speakText(text, { engine: "kokoro", speed, button });
    }
    setButtonState(button, "idle");
    reportStatus(`语音不可用：${error?.message || error}`);
    return false;
  }
}

/** 停止当前朗读并复位按钮。 */
export function stopSpeaking() {
  sessionToken += 1;
  if (activeAudio) {
    try { activeAudio.pause(); } catch { /* 已结束时忽略 */ }
    activeAudio = null;
  }
  if (activeButton) {
    setButtonState(activeButton, "idle");
    activeButton = null;
  }
}

/** 生成回复后按偏好自动朗读。 */
export function maybeAutoSpeak(text) {
  const prefs = getVoicePrefs();
  if (!prefs.autoPlay) return;
  void speakText(text, prefs);
}

/** 查询 sidecar 健康状态（各引擎就绪情况、设备、模型体积）。 */
export async function fetchTtsHealth() {
  try {
    const res = await fetch("/api/tts/health", { headers: { Accept: "application/json" } });
    const json = await res.json().catch(() => ({}));
    return { reachable: res.ok, ...json };
  } catch (error) {
    return { reachable: false, ok: false, error: "tts_unavailable", message: String(error?.message || error) };
  }
}

/** 事件委托：朗读按钮的点击统一在聊天容器上处理，重渲染不丢监听。 */
export function bindChatSpeakDelegation(chatEl) {
  if (!chatEl || chatEl.dataset.speakBound === "1") return;
  chatEl.dataset.speakBound = "1";
  chatEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-speak-index]");
    if (!button) return;
    const index = Number(button.dataset.speakIndex);
    const message = getState().messages[index];
    if (!message || message.type !== "her") return;
    void speakText(message.text, { button });
  });
}
