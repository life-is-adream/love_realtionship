/**
 * F1 全量档案备份/恢复（纯函数模块，不触碰 DOM）。
 *
 * 备份结构：
 * {
 *   app: "heartflow",
 *   version: 1,
 *   exportedAt: ISO 时间戳,
 *   data: { [STORAGE_KEYS 的键名字面量]: localStorage 中的原始字符串值 }
 * }
 *
 * 设计决策（ADR 精神）：
 * - 白名单外键「忽略并报告」而非整体拒绝：向前兼容——未来版本新增键名的备份
 *   仍可被旧代码恢复，只是丢弃不认识的键。
 * - 恢复前对主状态键复用 state.js 的 normalizeState（内含 learning-state.js
 *   的 normalizeLearningState 迁移），旧 schemaVersion 数据在写回时自动升级，
 *   不在备份模块内重写任何迁移逻辑。
 */

import { STORAGE_KEYS } from "./config.js";
import { normalizeState, serializeStateForStorage } from "./state.js";

export const BACKUP_APP_ID = "heartflow";
export const BACKUP_VERSION = 1;

/** 白名单：允许进入备份/恢复流程的 localStorage 键名字面量集合。 */
export const BACKUP_KEY_WHITELIST = Object.freeze(Object.values(STORAGE_KEYS));

const STATE_STORAGE_KEY = STORAGE_KEYS.state;

/**
 * 生成备份文件名（本地时间，精确到秒），独立导出以便测试。
 * @param {Date} [now]
 * @returns {string} heartflow-backup-YYYYMMDD-HHmmss.json
 */
export function buildBackupFilename(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = [
    now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
    "-", pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())
  ].join("");
  return `heartflow-backup-${stamp}.json`;
}

/**
 * 从持久化接口读取 STORAGE_KEYS 全部键值，组装备份对象。
 * @param {object} state - 已可序列化的应用状态（主键 'heartflow-state' 的值）
 * @param {Storage|null} [storage] - 默认 globalThis.localStorage；测试可注入内存实现
 * @returns {{app: string, version: number, exportedAt: string, data: Object<string, string>}}
 */
export function buildBackup(state, storage = globalThis.localStorage) {
  const data = {};
  for (const key of BACKUP_KEY_WHITELIST) {
    let raw = null;
    try {
      raw = storage ? storage.getItem(key) : null;
    } catch {
      raw = null; // localStorage 不可用时该键按缺失处理
    }
    if (key === STATE_STORAGE_KEY) {
      // 主状态以调用方传入的 state 为准（调用方已跑 serializeStateForStorage）。
      data[key] = JSON.stringify(state ?? null);
      continue;
    }
    // 全量快照：白名单内每个键都出现在 data 中，缺失的键记为 null（恢复时按删除处理）。
    data[key] = raw === null || raw === undefined ? null : raw;
  }
  return {
    app: BACKUP_APP_ID,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data
  };
}

/**
 * 校验备份 JSON。白名单外的 data 键不拒绝，收集进 ignoredKeys（向前兼容）。
 * @param {unknown} json - 已 JSON.parse 的备份内容
 * @returns {{ok: boolean, errors: string[], ignoredKeys: string[]}}
 */
export function validateBackup(json) {
  const errors = [];
  const ignoredKeys = [];

  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, errors: ["备份内容不是合法的备份对象"], ignoredKeys };
  }
  if (json.app !== BACKUP_APP_ID) {
    errors.push(`缺少应用标识：期望 app === "${BACKUP_APP_ID}"`);
  }
  if (typeof json.version !== "number" || !Number.isInteger(json.version) || json.version < 1) {
    errors.push("备份版本号缺失或非法");
  } else if (json.version > BACKUP_VERSION) {
    errors.push(`备份版本过新（v${json.version}），当前应用最高支持 v${BACKUP_VERSION}`);
  }
  if (json.data === null || typeof json.data !== "object" || Array.isArray(json.data)) {
    errors.push("备份缺少有效的 data 键值快照");
  } else {
    const whitelist = new Set(BACKUP_KEY_WHITELIST);
    for (const key of Object.keys(json.data)) {
      if (!whitelist.has(key)) ignoredKeys.push(key);
    }
    if (json.version === BACKUP_VERSION && ignoredKeys.length === Object.keys(json.data).length) {
      // 允许空 data（极端情况下没有可恢复内容），由调用方决定提示；不算错误。
    }
  }

  return { ok: errors.length === 0, errors, ignoredKeys };
}

/**
 * 校验通过后把备份逐键写回持久化接口。
 * 主状态键写回前先跑 normalizeState（复用现有 normalize/迁移路径，旧版本数据自动升级）。
 * 校验失败时不写任何键。
 * @param {unknown} json - 已 JSON.parse 的备份内容
 * @param {Storage} persistence - 持久化接口（如 localStorage；测试可注入内存实现）
 * @returns {{ok: boolean, errors: string[], ignoredKeys: string[], applied: string[]}}
 */
export function applyBackup(json, persistence) {
  const validation = validateBackup(json);
  const applied = [];
  if (!validation.ok) {
    return { ...validation, applied };
  }
  if (!persistence || typeof persistence.setItem !== "function") {
    return { ok: false, errors: [...validation.errors, "持久化接口不可用"], ignoredKeys: validation.ignoredKeys, applied };
  }

  for (const [key, raw] of Object.entries(json.data)) {
    if (!BACKUP_KEY_WHITELIST.includes(key)) continue; // 白名单外：忽略并报告
    if (raw === null || raw === undefined) {
      // 备份里该键原本不存在：恢复为「不存在」。
      if (typeof persistence.removeItem === "function") persistence.removeItem(key);
      applied.push(key);
      continue;
    }
    if (key === STATE_STORAGE_KEY) {
      let stored = null;
      try {
        stored = normalizeState(typeof raw === "string" ? JSON.parse(raw) : raw);
      } catch {
        stored = normalizeState(null);
      }
      persistence.setItem(key, JSON.stringify(serializeStateForStorage(stored)));
    } else {
      persistence.setItem(key, typeof raw === "string" ? raw : JSON.stringify(raw));
    }
    applied.push(key);
  }

  return { ok: true, errors: [], ignoredKeys: validation.ignoredKeys, applied };
}
