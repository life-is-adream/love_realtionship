import { builtInPersonas, defaultState, STORAGE_KEYS } from "./config.js";
import { normalizeLearningState } from "./learning-state.js";
import { normalizeMistakes } from "./mistakes.js";
import {
  normalizeRelationshipIntelligenceState,
  toPersistedRelationshipIntelligenceState
} from "../intelligence/state.js";
import { normalizeLifestyle } from "../training/lifestyle.js";

/**
 * @typedef {Object} AppState
 * @property {string} personaId - 当前角色 ID
 * @property {Object} customPersonas - 自定义角色
 * @property {Object} personaMemory - 角色记忆
 * @property {Object} avatarOverrides - 头像覆盖
 * @property {Array<Object>} messages - 消息列表
 * @property {Array<Object>} trainingLog - 训练日志
 * @property {Array<Object>} mistakes - 错题本（F2，条目契约见 core/mistakes.js）
 * @property {Object|null} lastAnalysis - 最后一次分析结果
 * @property {Object} learning - 学习状态
 * @property {Object} lastGenerationMeta - 最后生成元数据
 */

/**
 * @typedef {Object} PersonaObject
 * @property {string} id - 角色 ID
 * @property {string} name - 角色名称
 * @property {string} [avatarImage] - 头像图片路径
 * @property {Array<string>} [tags] - 标签列表
 * @property {string} [logic] - 逻辑描述
 * @property {Array<Object>} [starterMessages] - 初始消息
 */

/**
 * @typedef {Object} AvatarSettings
 * @property {string} src - 头像图片源
 * @property {number} x - 头像 X 轴位置
 * @property {number} y - 头像 Y 轴位置
 * @property {boolean} isOverride - 是否为覆盖设置
 */

/**
 * @typedef {Object} MemoryObject
 * @property {string} background - 背景描述
 * @property {string} interests - 兴趣描述
 * @property {string} boundaries - 边界描述
 */

/**
 * @typedef {Object} ConversationWindow
 * @property {Array<Object>} recent - 最近消息
 * @property {Array<Object>} older - 较旧消息
 */

/**
 * @typedef {Object} MessageObject
 * @property {string} type - 消息类型（"me" | "her"）
 * @property {string} text - 消息文本
 * @property {string} [who] - 发送者名称
 * @property {string} [source] - 消息来源
 */

let currentState = null;

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

/**
 * 获取所有角色（内置角色 + 自定义角色）
 * @param {Object} [custom] - 自定义角色对象
 * @returns {Object<string, PersonaObject>}
 */
export function getAllPersonas(custom = getState().customPersonas) {
  return { ...builtInPersonas, ...(custom || {}) };
}

/**
 * 标准化状态对象，填充默认值并修复异常
 * @param {Object} [next] - 待标准化的状态
 * @returns {AppState}
 */
export function normalizeState(next) {
  const normalized = { ...clone(defaultState), ...(next || {}) };
  if (!normalized.customPersonas || typeof normalized.customPersonas !== "object") normalized.customPersonas = {};
  if (!normalized.personaMemory || typeof normalized.personaMemory !== "object") normalized.personaMemory = {};
  if (!normalized.avatarOverrides || typeof normalized.avatarOverrides !== "object") normalized.avatarOverrides = {};
  const all = getAllPersonas(normalized.customPersonas);
  if (!all[normalized.personaId]) normalized.personaId = "lin";
  if (!Array.isArray(normalized.messages) || normalized.messages.length === 0) {
    normalized.messages = clone(all[normalized.personaId].starterMessages);
  }
  if (!Array.isArray(normalized.trainingLog)) normalized.trainingLog = [];
  normalized.mistakes = normalizeMistakes(normalized.mistakes); // F2 错题本：载入时标准化 + 上限裁剪
  normalized.relationshipIntelligence = normalizeRelationshipIntelligenceState(normalized.relationshipIntelligence);
  normalized.learning = normalizeLearningState(normalized);
  normalized.lifestyle = normalizeLifestyle(normalized.lifestyle); // F5/F6 生活管理：健身+护肤记录规范化（grooming 占位容忍）
  normalized.messages = normalizeMessages(normalized.messages).map((message) => {
    if (message?.type === "me" && (!message.who || message.who === "?")) return { ...message, who: "我" };
    return message;
  });
  if (!normalized.lastGenerationMeta || typeof normalized.lastGenerationMeta !== "object") normalized.lastGenerationMeta = null;
  return normalized;
}

/**
 * 从 localStorage 加载状态，失败时返回默认状态
 * @returns {AppState}
 */
export function loadState() {
  try {
    const stored = typeof localStorage === "undefined" ? null : JSON.parse(localStorage.getItem(STORAGE_KEYS.state));
    currentState = normalizeState(stored || clone(defaultState));
  } catch {
    currentState = normalizeState(clone(defaultState));
  }
  return currentState;
}

/**
 * 保存当前状态到 localStorage
 * @returns {AppState}
 */
export function saveState() {
  const state = getState();
  if (!Array.isArray(state.trainingLog)) state.trainingLog = [];
  if (!Array.isArray(state.mistakes)) state.mistakes = [];
  if (!state.customPersonas || typeof state.customPersonas !== "object") state.customPersonas = {};
  if (!state.personaMemory || typeof state.personaMemory !== "object") state.personaMemory = {};
  if (!state.avatarOverrides || typeof state.avatarOverrides !== "object") state.avatarOverrides = {};
  state.learning = normalizeLearningState(state.learning);
  state.lifestyle = normalizeLifestyle(state.lifestyle);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEYS.state, JSON.stringify(serializeStateForStorage(state)));
  }
  return state;
}

/**
 * Build a storage-safe copy without mutating the live page state.
 * Stateless Relationship Intelligence results remain session-only.
 */
export function serializeStateForStorage(state) {
  const persisted = clone(state);
  persisted.relationshipIntelligence = toPersistedRelationshipIntelligenceState(
    persisted.relationshipIntelligence
  );
  if (!persisted.relationshipIntelligence.consent) {
    for (const memory of Object.values(persisted.personaMemory || {})) {
      if (memory && typeof memory === "object") delete memory._enhanced;
    }
  }
  return persisted;
}

/**
 * 获取当前状态，若未加载则自动加载
 * @returns {AppState}
 */
export function getState() {
  if (!currentState) loadState();
  return currentState;
}

/**
 * 设置状态并保存
 * @param {AppState} next - 新状态
 * @returns {AppState}
 */
export function setState(next) {
  currentState = normalizeState(next);
  saveState();
  return currentState;
}

// ── mutate：唯一推荐写路径（P2-6 store 收敛） ─────────────────────────────────

let changeListener = null;

/**
 * 注册状态变更回调（由 app.js 装配时注入渲染函数，core 层不 import render 层）。
 * @param {((state: AppState) => void)|null} cb - 状态变更回调，传 null 取消订阅
 */
export function onStateChange(cb) {
  changeListener = typeof cb === "function" ? cb : null;
}

/**
 * 唯一推荐写路径：fn(state) 内同步修改，返回后自动 saveState 并通知渲染回调。
 * fn 抛错时不保存、不通知（异常原样向上抛出）。
 * @template T
 * @param {(state: AppState) => T} fn - 同步变更函数
 * @returns {T} fn 的返回值
 */
export function mutate(fn) {
  const state = getState();
  const result = fn(state);
  saveState();
  changeListener?.(state);
  return result;
}

/**
 * 获取当前角色对象
 * @returns {PersonaObject}
 */
export function getCurrentPersona() {
  const state = getState();
  return getAllPersonas(state.customPersonas)[state.personaId] || builtInPersonas.lin;
}

/**
 * 获取角色头像设置（含覆盖）
 * @param {PersonaObject} [persona] - 角色对象，默认当前角色
 * @returns {AvatarSettings}
 */
export function getAvatarSettings(persona = getCurrentPersona()) {
  const state = getState();
  const override = state.avatarOverrides?.[persona.id] || {};
  return {
    src: override.src || persona.avatarImage || "",
    x: Number.isFinite(Number(override.x)) ? Number(override.x) : 50,
    y: Number.isFinite(Number(override.y)) ? Number(override.y) : (persona.avatarImage ? 72 : 50),
    isOverride: Boolean(override.src || Object.prototype.hasOwnProperty.call(override, "x") || Object.prototype.hasOwnProperty.call(override, "y"))
  };
}

/**
 * 将头像位置值限制在 0-100 范围内
 * @param {number} value - 原始位置值
 * @returns {number}
 */
export function clampAvatarPosition(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

/**
 * 生成角色的默认记忆
 * @param {PersonaObject} persona - 角色对象
 * @returns {MemoryObject}
 */
export function defaultMemoryFor(persona) {
  return {
    background: `当前和${persona.name}处于初步熟悉阶段，聊天目标是自然建立了解，不急于推进关系。`,
    interests: (persona.tags || []).filter((tag) => !/讨厌|边界|不吃/.test(tag)).join("、") || "暂未明确，需要通过低压力问题了解。",
    boundaries: "避免操控、施压、过早暧昧、查户口式连续追问；尊重对方节奏。"
  };
}

/**
 * 获取角色记忆（含自定义覆盖）
 * @param {PersonaObject} [persona] - 角色对象，默认当前角色
 * @returns {MemoryObject}
 */
export function getPersonaMemory(persona = getCurrentPersona()) {
  const state = getState();
  return { ...defaultMemoryFor(persona), ...(state.personaMemory?.[persona.id] || {}) };
}

/**
 * 获取对话窗口（最近消息 + 较旧消息）
 * @param {number} [limit=12] - 最近消息数量上限
 * @returns {ConversationWindow}
 */
export function getConversationWindow(limit = 12) {
  const usable = getState().messages.filter((message) => message && message.text);
  const recent = usable.slice(-limit);
  return { recent, older: usable.slice(0, Math.max(0, usable.length - recent.length)) };
}

/**
 * 本地构建她的回复（离线 AI 回复模板）
 * @param {PersonaObject} persona - 角色对象
 * @param {MemoryObject} memory - 角色记忆
 * @param {string} latestMine - 我最新发送的文本
 * @param {string} previousHer - 她上一条回复文本
 * @param {Object} [uiValues] - UI 设置值
 * @param {string} [uiValues.stage] - 当前阶段
 * @param {string} [uiValues.styleBias] - 回复风格偏好
 * @returns {string}
 */
export function buildLocalHerReply(persona, memory, latestMine, previousHer, uiValues = {}) {
  const stage = uiValues.stage || "";
  const style = uiValues.styleBias || "mix";
  const mine = String(latestMine || "").replace(/\s+/g, " ").trim();
  const her = String(previousHer || "").replace(/\s+/g, " ").trim();
  const topic = mine.slice(0, 18) || her.slice(0, 18) || "这个话题";
  const stageHint = stage.includes("约会") ? "今天这种氛围本来就适合顺着聊下去。" : "我们可以先轻松一点，再慢慢往深一点走。";
  const boundaryHint = String(memory.boundaries || "").includes("不") ? "我也会留意彼此的边界。" : "我会尽量让节奏舒服一点。";
  const templates = {
    A: [
      `嗯，${topic}这个点我接住了。${stageHint}${boundaryHint}`,
      `听起来你刚刚是在认真回应我，这种感觉挺舒服的。${boundaryHint}`,
      "我愿意继续聊下去，不过我更想先听听你真实的想法。"
    ],
    B: [
      `你这句接得挺自然，我差点就顺着你的节奏往下聊了。${boundaryHint}`,
      `行，那我先不为难你，继续把这个话题聊轻一点。${topic}这部分我还挺好奇的。`,
      "有点会聊，不过别急着把气氛带太满，慢慢来更舒服。"
    ],
    C: [
      `那我顺着问一句，${topic}这件事对你来说更重要的是结果，还是相处的感觉？`,
      "你刚才提到的这点挺关键的，我想再听听你为什么会这么想。",
      "如果继续往下聊，你更希望我接着这个话题，还是换个更轻松的方向？"
    ]
  };
  const pool = templates[style] || [
    `嗯，${topic}这点我记住了。${stageHint}${boundaryHint}`,
    "我能接上你的意思，不过我更想继续听你怎么想。",
    "那我们就顺着这个话题聊下去吧，先别着急下结论。"
  ];
  const cue = mine || her || memory.interests || persona.logic || "";
  return pool[cue.length % pool.length];
}

/**
 * 标准化消息列表，过滤无效消息并补充 source 字段
 * @param {Array<MessageObject>} messages - 原始消息列表
 * @returns {Array<MessageObject>}
 */
export function normalizeMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message && typeof message.text === "string")
    .map((message) => ({ ...message, source: message.source || "" }));
}

/**
 * 获取我最新发送的文本，如未传入 typed 则从消息列表中查找
 * @param {string} [typed=""] - 当前输入的文本
 * @returns {string}
 */
export function getLatestMineText(typed = "") {
  const input = String(typed || "").trim();
  if (input) return input;
  return [...getState().messages].reverse().find((message) => message.type === "me")?.text || "";
}
