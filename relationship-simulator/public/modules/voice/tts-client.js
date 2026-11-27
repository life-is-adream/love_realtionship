import { STORAGE_KEYS } from "../core/config.js";
import { getState } from "../core/state.js";
import {
  SEGMENT_GAP_MS,
  splitSpeechSegments,
  shouldUseSegmentedSpeech
} from "./speech-segments.js";

export { splitSpeechSegments, shouldUseSegmentedSpeech };

/**
 * TTS 引擎目录。与 voice/tts_server.py、voice/voice_presets.py 中的定义保持一致。
 *
 * 2026-11-07 真人听感验收后收敛：微软免费端点只有 2 个普通话原生女声，
 * 用 SSML 变调硬造的「清冷御姐 / 甜美萝莉」会把共振峰一起搬走，听感被判定为垃圾；
 * mstts:express-as 情感风格又被端点直接拒绝。因此产品只留零/近零变调的两个原生音色。
 * 离线引擎（ChatTTS / Kokoro）降级为「无网络兜底」，各留 2 个相对能听的。
 *
 * 顺序不要改：syncOnlineEngine 在在线未启用时回退到 TTS_ENGINES[0]，
 * 它必须是一个始终可用的离线引擎。
 * online/optional 的引擎只有本机服务显式开启后才会解锁，避免静默把聊天文本送出本机。
 */
export const TTS_ENGINES = [
  {
    id: "chattts",
    label: "ChatTTS · 离线兜底（GPU）",
    hint: "约 2GB 本地模型，完全不联网；音质不如在线，仅作无网络时的备选。",
    voices: [
      { id: "chat_qingche", label: "清澈 · 自然" },
      { id: "chat_lengjing", label: "沉静 · 平稳" }
    ]
  },
  {
    id: "kokoro",
    label: "Kokoro · 离线兜底（CPU）",
    hint: "325MB 本地模型，几乎瞬时出音、不占显存；音质不如在线。",
    voices: [
      { id: "zf_xiaoxiao", label: "小晓 · 自然" },
      { id: "zf_xiaoyi", label: "小艺 · 轻快" }
    ]
  },
  {
    id: "edge",
    label: "微软神经语音 · 在线（听感验收通过）",
    hint: "2 个未经变调的原生中文女声，音质最好；需联网，朗读文本会离开本机。",
    online: true,
    optional: true,
    voices: [
      { id: "edge_wenrou", label: "温柔 · 自然（推荐）" },
      { id: "edge_yuanqi", label: "元气 · 明亮" }
    ]
  },
  {
    id: "character",
    label: "角色音色 · 本地克隆（可莉 / 蝴蝶忍）",
    hint: "Qwen3-TTS 零样本克隆，完全离线；首句加载 4.3GB 权重、单句约 20–40 秒。仅限个人非商业使用。",
    optional: true,
    voices: [
      { id: "char_klee", label: "可莉 · 中文原声" },
      { id: "char_shinobu", label: "蝴蝶忍 · 中文合成" }
    ]
  }
];

// 默认仍是纯离线：在线引擎要由用户显式点开关解锁，不替用户做隐私决定。
const DEFAULT_PREFS = { engine: "chattts", voice: "chat_qingche", autoPlay: false, speed: 1.0 };
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
    // 旧版本存过、但已被听感验收淘汰的音色，会自动落回该引擎的首选音色。
    const voice = voices.some((item) => item.id === parsed.voice) ? parsed.voice : defaultVoiceFor(engine);
    return {
      engine,
      voice,
      autoPlay: parsed.autoPlay === true,
      speed: typeof parsed.speed === "number" && parsed.speed >= 0.8 && parsed.speed <= 1.2 ? parsed.speed : DEFAULT_PREFS.speed
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** 合并写入语音偏好；切引擎时自动纠正不属于该引擎的音色。 */
export function setVoicePrefs(patch) {
  const merged = { ...getVoicePrefs(), ...patch, tuned: true };
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
let activeAbort = null;
let sessionToken = 0;
const interruptWaiters = new Set();

/** 让「等待播放 / 段间留白」能被 stopSpeaking 立即唤醒，避免留下悬挂的 Promise。 */
function interruptible(promise) {
  let waiter;
  const abort = new Promise((resolve) => {
    waiter = () => resolve(undefined);
    interruptWaiters.add(waiter);
  });
  return Promise.race([promise, abort]).finally(() => interruptWaiters.delete(waiter));
}

function releaseInterrupt() {
  for (const waiter of [...interruptWaiters]) waiter();
}

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

async function fetchChunk(text, engine, voice, speed, signal) {
  const cacheKey = `${engine}|${voice}|${speed}|${text}`;
  const cached = audioCache.get(cacheKey);
  if (cached) return cached;
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: text.slice(0, 300), engine, voice, speed }),
    signal
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

/** 预取一段；永不 reject，避免播放被打断时出现未处理的 Promise rejection。 */
function prefetchSegment(text, engine, voice, speed, signal) {
  return fetchChunk(text, engine, voice, speed, signal)
    .then((url) => ({ url }), (error) => ({ error }));
}

/**
 * S2：分段请求 + 播放队列（仅 character 引擎的中文长句）。
 *
 * 首段合成完立刻播放，播放期间并行预取下一段；段间留 400ms 静音，
 * 与 eval/PROSODY.md 的 `seg` 变体同口径。5002 的推理锁是串行的，
 * 预取不会抢首段的 GPU，只会把后续段的生成藏进播放时间。
 *
 * 代价如实记录：多次请求带来额外固定开销，总耗时约 +13%（中文实测 +21% 在
 * 服务端拼接方案下，前端队列把一部分藏进了播放），换来首响约 −38%。
 */
async function speakSegmented(clean, engine, voice, speed, button, token) {
  const segments = splitSpeechSegments(clean.slice(0, 300));
  const abort = new AbortController();
  activeAbort = abort;
  let pending = prefetchSegment(segments[0], engine, voice, speed, abort.signal);

  for (let i = 0; i < segments.length; i += 1) {
    const current = await interruptible(pending);
    if (token !== sessionToken) return false;
    if (!current || current.error) throw current?.error || new Error("分段预取被中断");
    if (i + 1 < segments.length) {
      pending = prefetchSegment(segments[i + 1], engine, voice, speed, abort.signal);
    }
    setButtonState(button, "playing");
    await interruptible(playUrl(current.url));
    if (token !== sessionToken) return false;
    if (i + 1 < segments.length) {
      await interruptible(new Promise((resolve) => setTimeout(resolve, SEGMENT_GAP_MS)));
      if (token !== sessionToken) return false;
    }
  }
  setButtonState(button, "idle");
  return true;
}

/**
 * 合成并播放一段文本。
 *
 * 默认整段一次请求：ChatTTS 是自回归模型，单句合成 RTF≈2，
 * 但把多句放进同一个 batch 几乎不增加耗时（服务端已按句批量处理，整段 RTF≈0.86）。
 * 前端切句会让总时长翻倍，所以切句放在服务端、播放放在这里。
 *
 * 只有 character 引擎例外：Qwen3-TTS 一次性返回完整波形，长句首响等于整句生成时间；
 * 按 eval/PROSODY.md 的 S2 方案改成「分段请求 + 播放队列」，首段先出声、边播边取。
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
    if (shouldUseSegmentedSpeech(clean, engine)) {
      return await speakSegmented(clean, engine, voice, speed, button, token);
    }
    const url = await fetchChunk(clean, engine, voice, speed);
    if (token !== sessionToken) return false; // 期间被新的朗读请求打断
    setButtonState(button, "playing");
    await interruptible(playUrl(url));
    if (token !== sessionToken) return false;
    setButtonState(button, "idle");
    return true;
  } catch (error) {
    if (token !== sessionToken) return false;
    // 主引擎不可用时自动退回最轻的离线引擎，朗读功能不至于整个失效。
    // 在线失败时这条尤其重要：断网也不会让朗读按钮彻底哑掉。
    if (engine !== "kokoro") {
      reportStatus(`${engine === "edge" ? "在线语音" : "ChatTTS"} 不可用（${error?.message || error}），已自动切换为 Kokoro 朗读。`);
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
  releaseInterrupt();
  if (activeAbort) {
    try { activeAbort.abort(); } catch { /* 请求已结束 */ }
    activeAbort = null;
  }
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

/**
 * 运行时切换在线语音引擎。调用方必须先让用户看到并确认「文本会离开本机」；
 * 这里只负责把那一次显式同意送到 C 服务，由 C 转发给本机 sidecar。
 */
export async function setOnlineVoiceEnabled(enabled) {
  const res = await fetch("/api/tts/online", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: Boolean(enabled) })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok !== true) {
    throw new Error(json.message || `HTTP ${res.status}`);
  }
  return json.enabled === true;
}

/** 查询 sidecar 健康状态（各引擎就绪情况、设备、模型体积、在线开关）。 */
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
