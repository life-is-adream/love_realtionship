// F1 全量档案备份/恢复：纯函数全覆盖 + UI 接线源码级断言（DOM 不强测）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  BACKUP_APP_ID,
  BACKUP_VERSION,
  BACKUP_KEY_WHITELIST,
  buildBackup,
  buildBackupFilename,
  validateBackup,
  applyBackup
} from "../public/modules/core/backup.js";
import { STORAGE_KEYS, defaultState } from "../public/modules/core/config.js";

function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); }
  };
}

const sampleState = {
  ...structuredClone(defaultState),
  personaId: "xu",
  messages: [{ type: "me", who: "我", text: "今天天气不错。", source: "" }],
  trainingLog: [{ time: "2026-1-1 10:00:00", mine: "a", herReply: "b", score: { total: 80 } }]
};

test("buildBackup 产出规范结构，data 覆盖全部白名单键且只含白名单键", () => {
  const storage = createMemoryStorage({
    [STORAGE_KEYS.activeTab]: "chat",
    [STORAGE_KEYS.stageValue]: "暧昧升温期",
    [STORAGE_KEYS.complianceAck]: "true",
    "heartflow-rogue-key": "不应进入备份"
  });
  const backup = buildBackup(sampleState, storage);

  assert.equal(backup.app, "heartflow");
  assert.equal(backup.version, 1);
  assert.ok(!Number.isNaN(Date.parse(backup.exportedAt)));
  for (const key of BACKUP_KEY_WHITELIST) {
    assert.ok(Object.hasOwn(backup.data, key), `data 缺少 ${key}`);
  }
  for (const key of Object.keys(backup.data)) {
    assert.ok(BACKUP_KEY_WHITELIST.includes(key), `data 出现白名单外键 ${key}`);
  }
  assert.deepEqual(JSON.parse(backup.data[STORAGE_KEYS.state]).personaId, "xu");
  assert.equal(backup.data[STORAGE_KEYS.activeTab], "chat");
  assert.equal(backup.data[STORAGE_KEYS.complianceAck], "true");
});

test("buildBackup→validateBackup→applyBackup 往返一致", () => {
  const source = createMemoryStorage({
    [STORAGE_KEYS.state]: JSON.stringify(sampleState),
    [STORAGE_KEYS.activeTab]: "coach",
    [STORAGE_KEYS.stageValue]: "熟悉建立期"
  });
  const backup = buildBackup(JSON.parse(source.getItem(STORAGE_KEYS.state)), source);

  const validation = validateBackup(backup);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.errors, []);
  assert.deepEqual(validation.ignoredKeys, []);

  const target = createMemoryStorage({ [STORAGE_KEYS.state]: "旧的会被覆盖" });
  const result = applyBackup(backup, target);
  assert.equal(result.ok, true);
  assert.deepEqual(result.applied.sort(), [...Object.keys(backup.data)].sort());
  // applyBackup 会跑 normalizeState（补默认值、迁移 learning），做语义级往返比对而非字节级比对。
  const restored = JSON.parse(target.getItem(STORAGE_KEYS.state));
  assert.equal(restored.personaId, "xu");
  assert.deepEqual(restored.messages, sampleState.messages);
  assert.deepEqual(restored.trainingLog, sampleState.trainingLog);
  assert.equal(restored.learning.schemaVersion, 2);
  assert.equal(target.getItem(STORAGE_KEYS.activeTab), "coach");
  assert.equal(target.getItem(STORAGE_KEYS.stageValue), "熟悉建立期");
});

test("applyBackup 将备份中缺失（null）的键恢复为不存在", () => {
  const backup = buildBackup(sampleState, createMemoryStorage());
  assert.equal(backup.data[STORAGE_KEYS.complianceAck], null, "空存储下该键应为 null");
  const target = createMemoryStorage({ [STORAGE_KEYS.complianceAck]: "true" });
  const result = applyBackup(backup, target);
  assert.equal(result.ok, true);
  assert.equal(target.getItem(STORAGE_KEYS.complianceAck), null);
});

test("validateBackup 拒绝缺 app 标识 / app 错误 / 非对象内容", () => {
  const valid = buildBackup(sampleState, createMemoryStorage());

  assert.equal(validateBackup({ ...valid, app: undefined }).ok, false);
  assert.equal(validateBackup({ ...valid, app: "other-app" }).ok, false);
  assert.equal(validateBackup("不是对象").ok, false);
  assert.equal(validateBackup(null).ok, false);
  assert.equal(validateBackup([valid]).ok, false);
  const missingApp = validateBackup({ ...valid, app: undefined });
  assert.ok(missingApp.errors.some((message) => message.includes("应用标识")));
});

test("validateBackup 拒绝坏 version（缺失 / 非整数 / 负数 / 未来版本）", () => {
  const valid = buildBackup(sampleState, createMemoryStorage());
  for (const version of [undefined, null, "1", 1.5, 0, -1, BACKUP_VERSION + 1]) {
    const result = validateBackup({ ...valid, version });
    assert.equal(result.ok, false, `version=${version} 应被拒绝`);
  }
  const future = validateBackup({ ...valid, version: BACKUP_VERSION + 1 });
  assert.ok(future.errors.some((message) => message.includes("版本过新")));
});

test("validateBackup 拒绝 data 非对象", () => {
  const valid = buildBackup(sampleState, createMemoryStorage());
  for (const data of [undefined, null, "字符串", 42, [STORAGE_KEYS.state]]) {
    const result = validateBackup({ ...valid, data });
    assert.equal(result.ok, false, `data=${JSON.stringify(data)} 应被拒绝`);
    assert.ok(result.errors.some((message) => message.includes("data")));
  }
});

test("白名单外键被忽略并在结果中报告（向前兼容），其余键仍可恢复", () => {
  const valid = buildBackup(sampleState, createMemoryStorage());
  const futureBackup = {
    ...valid,
    data: {
      ...valid.data,
      "heartflow-future-feature": "未来版本的新键",
      "another-unknown": { nested: true }
    }
  };
  const validation = validateBackup(futureBackup);
  assert.equal(validation.ok, true, "白名单外键不应导致整体拒绝");
  assert.deepEqual(validation.ignoredKeys.sort(), ["another-unknown", "heartflow-future-feature"]);

  const target = createMemoryStorage({});
  const result = applyBackup(futureBackup, target);
  assert.equal(result.ok, true);
  assert.equal(target.getItem("heartflow-future-feature"), null, "白名单外键不得写入");
  assert.deepEqual(result.applied.sort(), [...Object.keys(valid.data)].sort());
});

test("版本向前兼容路径：旧 schema 的主状态经 applyBackup 复用 normalizeState 迁移升级", () => {
  const legacyState = {
    personaId: "lin",
    messages: [{ type: "me", who: "我", text: "旧消息" }],
    trainingLog: [{ type: "initiative", score: 70, mine: "旧日志", herReply: "旧回复" }],
    learning: { schemaVersion: 1, events: [] }
  };
  const backup = {
    app: BACKUP_APP_ID,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: { [STORAGE_KEYS.state]: JSON.stringify(legacyState) }
  };
  const validation = validateBackup(backup);
  assert.equal(validation.ok, true);

  const target = createMemoryStorage({});
  const result = applyBackup(backup, target);
  assert.equal(result.ok, true);

  const applied = JSON.parse(target.getItem(STORAGE_KEYS.state));
  assert.equal(applied.learning.schemaVersion, 2, "learning 应迁移到当前 schema");
  assert.ok(Array.isArray(applied.learning.events) && applied.learning.events.length > 0, "legacy trainingLog 应迁移为 learning.events");
  assert.equal(applied.learning.events[0].type, "initiative");
  assert.equal(applied.learning.events[0].source, "legacy");
});

test("applyBackup 校验失败时零写入（原子性）", () => {
  const target = createMemoryStorage({ [STORAGE_KEYS.state]: "原值", [STORAGE_KEYS.activeTab]: "chat" });
  const bad = { app: "heartflow", version: 99, data: {} };
  const result = applyBackup(bad, target);
  assert.equal(result.ok, false);
  assert.deepEqual(result.applied, []);
  assert.equal(target.getItem(STORAGE_KEYS.state), "原值");
  assert.equal(target.getItem(STORAGE_KEYS.activeTab), "chat");
});

test("buildBackupFilename 生成 heartflow-backup-YYYYMMDD-HHmmss.json", () => {
  assert.equal(
    buildBackupFilename(new Date(2026, 0, 9, 8, 5, 3)),
    "heartflow-backup-20260109-080503.json"
  );
  assert.match(buildBackupFilename(new Date()), /^heartflow-backup-\d{8}-\d{6}\.json$/);
});

// ── UI 接线源码级断言（复用 reset-confirm.test.mjs 的源码回归模式）─────────────

const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const docSource = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

test("UI 接线：备份/恢复按钮存在并绑定事件，恢复走 confirm 防误触", () => {
  assert.match(docSource, /id="backupBtn"[^>]*>备份档案</);
  assert.match(docSource, /id="restoreBtn"[^>]*>恢复档案</);
  assert.match(docSource, /id="backupFileInput"[^>]*type="file"/);
  assert.match(appSource, /\$\("backupBtn"\)\?\.addEventListener/);
  assert.match(appSource, /\$\("restoreBtn"\)\?\.addEventListener/);
  // 恢复必须先 confirm 且文案明示不可撤销，确认后才 applyBackup（复用 RESET_CONFIRMATION 的 globalThis.confirm 模式）
  const confirmAt = appSource.indexOf("globalThis.confirm?.(RESTORE_CONFIRMATION)");
  const applyAt = appSource.indexOf("applyBackup(", confirmAt);
  assert.ok(confirmAt > -1 && applyAt > confirmAt, "confirm 应先于 applyBackup");
  assert.match(appSource, /将覆盖当前全部本地档案.*不可撤销/s);
});

test("UI 接线：恢复流程使用 validateBackup 门禁，动态字符串经 textContent/escapeHtml 落 DOM", () => {
  const validateAt = appSource.indexOf("validateBackup(");
  const confirmAt = appSource.indexOf("globalThis.confirm?.(RESTORE_CONFIRMATION)");
  assert.ok(validateAt > -1 && confirmAt > validateAt, "validateBackup 应先于 confirm");
  assert.match(appSource, /escapeHtml/);
  // 备份文件名走 buildBackupFilename（时间戳命名），下载模式复用 exportSession 的 Blob+anchor
  assert.match(appSource, /buildBackupFilename\(/);
  assert.match(appSource, /anchor\.download\s*=/);
});
