// F3 入学测试画像接入：纯函数全覆盖 + 备份白名单联动 + UI 接线源码级断言（复用 backup/reset-confirm 先例模式）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  INTAKE_ATTACHMENT_VALUES,
  INTAKE_WEAKNESS_LABELS,
  normalizeIntakeProfile,
  buildIntakeSummary,
  readIntakeProfile
} from "../public/modules/core/intake-profile.js";
import { STORAGE_KEYS } from "../public/modules/core/config.js";
import { BACKUP_KEY_WHITELIST, buildBackup } from "../public/modules/core/backup.js";
import { defaultState } from "../public/modules/core/config.js";

// ── 测试样本：与 intake-quiz.html 实际输出结构一致 ─────────────────────────────

function sampleProfile() {
  return {
    version: "1.0",
    testDate: "2026-08-03",
    questions: 15,
    attachment: { primary: "anxious", distribution: { anxious: 47, secure: 33, avoidant: 20 } },
    communicationStyle: ["反刍型", "追逐型", "稳定型"],
    emotionHandling: ["寻求确认", "分析推演", "接纳"],
    actionPattern: ["犹豫不决", "冲动行动"],
    weaknessPatterns: ["interrogation", "overthinking"],
    trainingFocus: ["练习「先回应→再分享→最后问」的三段式节奏，替代连续提问"]
  };
}

function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); }
  };
}

// ── STORAGE_KEYS 新键 + 备份白名单联动 ────────────────────────────────────────

test("STORAGE_KEYS 新增 heartflow-intake-profile 键（F3）", () => {
  assert.equal(STORAGE_KEYS.intakeProfile, "heartflow-intake-profile");
});

test("备份白名单自动包含画像键，备份 data 现在含 8 键（F1 白名单派生自 STORAGE_KEYS）", () => {
  assert.ok(BACKUP_KEY_WHITELIST.includes(STORAGE_KEYS.intakeProfile), "BACKUP_KEY_WHITELIST 应包含画像键");
  const storage = createMemoryStorage({
    [STORAGE_KEYS.intakeProfile]: JSON.stringify(sampleProfile())
  });
  const backup = buildBackup(structuredClone(defaultState), storage);
  assert.equal(Object.keys(backup.data).length, 8, "备份 data 应含 8 键（7 个旧键 + 画像键）");
  assert.deepEqual(JSON.parse(backup.data[STORAGE_KEYS.intakeProfile]).attachment.primary, "anxious");
});

// ── normalizeIntakeProfile：合法路径 ─────────────────────────────────────────

test("normalizeIntakeProfile 合法画像产出渲染友好结构", () => {
  const normalized = normalizeIntakeProfile(sampleProfile());
  assert.ok(normalized);
  assert.equal(normalized.version, "1.0");
  assert.equal(normalized.testDate, "2026-08-03");
  assert.equal(normalized.questions, 15);
  assert.equal(normalized.attachment.primary, "anxious");
  assert.equal(normalized.attachment.primaryLabel, "焦虑型");
  assert.deepEqual(normalized.attachment.distribution, { anxious: 47, secure: 33, avoidant: 20 });
  assert.deepEqual(normalized.communicationStyle, ["反刍型", "追逐型", "稳定型"]);
  assert.deepEqual(normalized.emotionHandling, ["寻求确认", "分析推演", "接纳"]);
  assert.deepEqual(normalized.actionPattern, ["犹豫不决", "冲动行动"]);
  assert.deepEqual(normalized.weaknessPatterns, ["interrogation", "overthinking"]);
  assert.equal(normalized.trainingFocus.length, 1);
});

test("normalizeIntakeProfile 三种依恋主型均被接受，边界计分 0/100 合法", () => {
  for (const primary of INTAKE_ATTACHMENT_VALUES) {
    const normalized = normalizeIntakeProfile({
      ...sampleProfile(),
      attachment: { primary, distribution: { anxious: 0, secure: 100, avoidant: 0 } }
    });
    assert.ok(normalized, `primary=${primary} 应合法`);
    assert.equal(normalized.attachment.distribution.secure, 100);
  }
});

test("normalizeIntakeProfile 缺省可选字段（weaknessPatterns/trainingFocus/version）容忍为空", () => {
  const minimal = normalizeIntakeProfile({
    testDate: "2026-08-03",
    questions: 15,
    attachment: { primary: "secure", distribution: { anxious: 10, secure: 70, avoidant: 20 } },
    communicationStyle: ["稳定型"],
    emotionHandling: ["接纳"],
    actionPattern: ["从容等待"]
  });
  assert.ok(minimal);
  assert.deepEqual(minimal.weaknessPatterns, []);
  assert.deepEqual(minimal.trainingFocus, []);
  assert.equal(minimal.version, "");
});

// ── normalizeIntakeProfile：拒绝路径 ─────────────────────────────────────────

test("normalizeIntakeProfile 拒绝非对象输入（null / 字符串 / 数组 / 数字）", () => {
  for (const bad of [null, undefined, "画像", 42, [], true]) {
    assert.equal(normalizeIntakeProfile(bad), null, `输入 ${JSON.stringify(bad) ?? String(bad)} 应被拒绝`);
  }
});

test("normalizeIntakeProfile 拒绝缺必填字段 / 坏类型", () => {
  const cases = [
    ["缺 testDate", (p) => { delete p.testDate; }],
    ["坏 testDate 格式", (p) => { p.testDate = "2026/08/03"; }],
    ["testDate 非真实日期", (p) => { p.testDate = "2026-13-40"; }],
    ["缺 questions", (p) => { delete p.questions; }],
    ["questions 非整数", (p) => { p.questions = 14.5; }],
    ["questions 非法", (p) => { p.questions = 0; }],
    ["缺 attachment", (p) => { delete p.attachment; }],
    ["attachment 非对象", (p) => { p.attachment = "anxious"; }],
    ["缺 primary", (p) => { delete p.attachment.primary; }],
    ["primary 非法值", (p) => { p.attachment.primary = "fearful"; }],
    ["缺 distribution", (p) => { delete p.attachment.distribution; }],
    ["distribution 缺键", (p) => { delete p.attachment.distribution.secure; }],
    ["communicationStyle 非数组", (p) => { p.communicationStyle = "反刍型"; }],
    ["emotionHandling 缺失", (p) => { delete p.emotionHandling; }],
    ["actionPattern 非数组", (p) => { p.actionPattern = { 0: "犹豫不决" }; }]
  ];
  for (const [name, mutateCase] of cases) {
    const profile = sampleProfile();
    mutateCase(profile);
    assert.equal(normalizeIntakeProfile(profile), null, `${name} 应被拒绝`);
  }
});

test("normalizeIntakeProfile 拒绝计分越界（>100 / <0 / 非数字 / Infinity）", () => {
  for (const badValue of [101, -1, "47", null, Number.POSITIVE_INFINITY, Number.NaN]) {
    const profile = sampleProfile();
    profile.attachment.distribution.anxious = badValue;
    assert.equal(normalizeIntakeProfile(profile), null, `distribution.anxious=${badValue} 应被拒绝`);
  }
});

test("normalizeIntakeProfile 过滤数组中的非字符串项，全空标签数组仍合法", () => {
  const profile = sampleProfile();
  profile.communicationStyle = ["反刍型", 42, null, "  "];
  const normalized = normalizeIntakeProfile(profile);
  assert.ok(normalized);
  assert.deepEqual(normalized.communicationStyle, ["反刍型"]);
});

// ── buildIntakeSummary：确定性输出 ───────────────────────────────────────────

test("buildIntakeSummary 对固定画像产出确定性中文摘要", () => {
  const summary = buildIntakeSummary(normalizeIntakeProfile(sampleProfile()));
  assert.equal(
    summary,
    "情境自检中焦虑型相关选项较多，沟通风格偏反刍型、追逐型、稳定型，行动模式偏犹豫不决、冲动行动，弱点模式重点关注查户口式追问、过度分析/犹豫；仅用于选择练习，不是心理诊断或经过校准的依恋测量"
  );
  // 确定性：同一输入两次调用输出一致
  assert.equal(summary, buildIntakeSummary(normalizeIntakeProfile(sampleProfile())));
});

test("buildIntakeSummary 无弱点模式时省略弱点从句，未知弱点键回退原文", () => {
  const noWeakness = normalizeIntakeProfile({ ...sampleProfile(), weaknessPatterns: [] });
  const summary = buildIntakeSummary(noWeakness);
  assert.ok(!summary.includes("弱点模式"));
  const unknownKey = normalizeIntakeProfile({ ...sampleProfile(), weaknessPatterns: ["future-weakness"] });
  assert.ok(buildIntakeSummary(unknownKey).includes("future-weakness"));
  assert.equal(INTAKE_WEAKNESS_LABELS.interrogation, "查户口式追问");
});

test("buildIntakeSummary 对非法/缺失输入返回空串", () => {
  for (const bad of [null, undefined, {}, { attachment: null }, { attachment: {} }]) {
    assert.equal(buildIntakeSummary(bad), "");
  }
});

// ── readIntakeProfile：读取 + 坏键自清 ───────────────────────────────────────

test("readIntakeProfile 读取合法画像", () => {
  const storage = createMemoryStorage({
    [STORAGE_KEYS.intakeProfile]: JSON.stringify(sampleProfile())
  });
  const profile = readIntakeProfile(storage);
  assert.ok(profile);
  assert.equal(profile.attachment.primaryLabel, "焦虑型");
});

test("readIntakeProfile 坏 JSON / 缺字段 / 计分越界 → 返回 null 并清键", () => {
  const badRawValues = [
    "不是 JSON",
    JSON.stringify({ foo: "bar" }),
    JSON.stringify({ ...sampleProfile(), attachment: { primary: "anxious", distribution: { anxious: 200, secure: -50, avoidant: 20 } } })
  ];
  for (const raw of badRawValues) {
    const storage = createMemoryStorage({ [STORAGE_KEYS.intakeProfile]: raw });
    assert.equal(readIntakeProfile(storage), null);
    assert.equal(storage.getItem(STORAGE_KEYS.intakeProfile), null, "坏画像键应被清除");
  }
});

test("readIntakeProfile 无键 / 空串 / storage 不可用 → null 且不抛错", () => {
  assert.equal(readIntakeProfile(createMemoryStorage()), null);
  assert.equal(readIntakeProfile(createMemoryStorage({ [STORAGE_KEYS.intakeProfile]: "" })), null);
  assert.equal(readIntakeProfile(null), null);
});

// ── UI 接线源码级断言（复用 backup.test.mjs / reset-confirm.test.mjs 的源码回归模式）──

const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const docSource = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const mistakesSource = await readFile(new URL("../public/modules/render/render-mistakes.js", import.meta.url), "utf8");
const intakeRenderSource = await readFile(new URL("../public/modules/render/render-intake.js", import.meta.url), "utf8");
const quizSource = await readFile(new URL("../public/intake-quiz.html", import.meta.url), "utf8");

test("主应用接线：入口卡挂载在错题本 section 附近并进渲染链", () => {
  assert.match(docSource, /<div id="intakePanel"><\/div>/);
  assert.ok(
    docSource.indexOf('id="intakePanel"') < docSource.indexOf('id="mistakesPanel"'),
    "intakePanel 应位于 mistakesPanel（错题本）之前"
  );
  assert.match(appSource, /import \{ renderIntake \} from "\.\/modules\/render\/render-intake\.js";/);
  assert.match(appSource, /\n  renderIntake\(\);/);
});

test("主应用接线：入口卡绑定打开/清除动作，清除走 confirm 防误触", () => {
  assert.match(intakeRenderSource, /\$\("intakeOpenQuizBtn"\)\?\.addEventListener/);
  assert.match(intakeRenderSource, /\$\("intakeClearBtn"\)\?\.addEventListener/);
  assert.match(intakeRenderSource, /const QUIZ_URL = "\/intake-quiz\.html";/);
  assert.match(intakeRenderSource, /globalThis\.open\?\.\(QUIZ_URL/);
  // 清除必须先 confirm 确认后才 removeItem（复用 RESET_CONFIRMATION 的 globalThis.confirm 模式）
  const confirmAt = intakeRenderSource.indexOf("globalThis.confirm?.(CLEAR_CONFIRMATION)");
  const removeAt = intakeRenderSource.indexOf("localStorage.removeItem(", confirmAt);
  assert.ok(confirmAt > -1 && removeAt > confirmAt, "confirm 应先于 localStorage.removeItem");
  assert.match(intakeRenderSource, /不可恢复/);
});

test("主应用接线：基线画像行挂在失误雷达摘要条下，仅当画像存在", () => {
  assert.ok(
    mistakesSource.indexOf("renderRadarSummary(mistakes)") > -1
      && mistakesSource.indexOf("renderIntakeBaselineLine()") > mistakesSource.indexOf("renderRadarSummary(mistakes)"),
    "基线画像行应渲染在雷达摘要条之后"
  );
  assert.match(mistakesSource, /if \(!profile\) return "";/);
  assert.match(mistakesSource, /radar-baseline/);
  assert.match(mistakesSource, /escapeHtml\(buildIntakeSummary\(profile\)\)/);
});

test("quiz 页接线：保存到主应用 confirm 先于 setItem，下载按钮走 Blob+anchor，复制能力保留", () => {
  assert.match(quizSource, /id="saveToAppBtn"/);
  assert.match(quizSource, /id="downloadProfileBtn"/);
  assert.match(quizSource, /id="copyBtn"/); // 原有复制/导出能力保留为手动备份路径
  assert.match(quizSource, /"heartflow-intake-profile"/);
  // confirm 先于 localStorage.setItem（覆盖旧画像提示）
  const confirmAt = quizSource.indexOf("if (!confirm(message)) return;");
  const setAt = quizSource.indexOf("localStorage.setItem(INTAKE_STORAGE_KEY", confirmAt);
  assert.ok(confirmAt > -1 && setAt > confirmAt, "quiz 页 confirm 应先于 setItem");
  assert.match(quizSource, /将覆盖它/);
  // 下载为 Blob + anchor 模式
  const downloadAt = quizSource.indexOf('getElementById("downloadProfileBtn")');
  const blobAt = quizSource.indexOf("new Blob(", downloadAt);
  const anchorDownloadAt = quizSource.indexOf("anchor.download", downloadAt);
  assert.ok(downloadAt > -1 && blobAt > downloadAt && anchorDownloadAt > blobAt, "下载按钮应绑定 Blob+anchor 导出");
});
