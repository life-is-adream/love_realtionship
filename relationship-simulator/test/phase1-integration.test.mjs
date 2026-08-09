import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeLearningState } from "../public/modules/core/learning-state.js";
import { buildLocalOptimizations, diffText } from "../public/modules/training/optimizer.js";
import { buildSignalExercise, classifySocialSignals, evaluateSignalGuess } from "../public/modules/training/signals.js";
import { scoreTiming } from "../public/modules/training/timing.js";
import { buildReplyOptionsForHer } from "../public/modules/coach/replies.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

test("阶段一运行时导入并接入三个纯模块", () => {
  assert.match(app, /from ["']\.\/modules\/core\/learning-state\.js["']/);
  assert.match(app, /from ["']\.\/modules\/training\/optimizer\.js["']/);
  assert.match(app, /from ["']\.\/modules\/training\/signals\.js["']/);
  assert.match(app, /from ["']\.\/modules\/training\/timing\.js["']/);
  assert.match(app, /buildOptimizerPrompt/);
});

test("学习状态会在 app 的加载和保存边界规范化", () => {
  assert.match(app, /normalized\.learning\s*=\s*normalizeLearningState\(normalized\)/);
  assert.match(app, /state\.learning\s*=\s*normalizeLearningState\(state\.learning\)/);
  assert.match(app, /recordTrainingEvent/);
  const legacy = normalizeLearningState({ trainingLog: [{ score: { total: 60 }, time: null }] });
  assert.equal(legacy.events[0].source, "legacy");
  assert.equal(legacy.events[0].createdAt, null);
});

test("新消息带真实创建时间，旧 seed 不会被 normalizeState 补时间", () => {
  assert.match(app, /createdAt:\s*new Date\(\)\.toISOString\(\)/);
  assert.match(app, /normalized\.messages\s*=\s*structuredClone\(all\[normalized\.personaId\]\.starterMessages\)/);
  assert.match(app, /state\.messages\s*=\s*structuredClone\(persona\.starterMessages\)/);
  assert.match(app, /state\.messages\s*=\s*\[\.\.\.scenario\.openingMessages\]/);
});

test("消息优化器 UI 契约包含原文、两个版本、理由、Diff 和采用动作", () => {
  for (const phrase of ["原文", "低压力版", "主动推进版", "修改理由", "Diff", "data-optimizer-variant"]) {
    assert.match(app, new RegExp(phrase.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(html, /id="useMiMoOptimizer"/);
  assert.doesNotMatch(html, /id="model"/);
  assert.match(app, /const MIMO_MODEL\s*=\s*DEFAULT_MODEL/);
  assert.match(html, /id="preflightPanel"/);
  assert.match(css, /\.optimizer-grid/);
  assert.match(css, /\.diff-added/);
  const result = buildLocalOptimizations("你怎么还不回我？", { stage: "隔天轻联系" });
  assert.equal(result.original, "你怎么还不回我？");
  assert.ok(result.lowPressure.text);
  assert.ok(result.proactive.text);
  assert.ok(diffText(result.original, result.lowPressure.text).length > 0);
});

test("社交信号练习展示多标签、置信度、证据和建议并记录契约", () => {
  for (const phrase of ["signalPanel", "classifySocialSignals", "evaluateSignalGuess", "signalAttempts", "confidence", "evidence", "recommendedDirection"]) {
    assert.match(app, new RegExp(phrase));
  }
  const exercise = buildSignalExercise("今天有点累，早点休息", "phase1");
  const analysis = classifySocialSignals(exercise.message);
  const evaluation = evaluateSignalGuess(analysis, analysis.labels);
  assert.ok(analysis.labels.includes("closing"));
  assert.ok(analysis.confidence);
  assert.ok(analysis.evidence.length > 0);
  assert.equal(evaluation.correct, true);
});

test("时机感评分展示数据不可用/分数和原因，并且不阻止发送", () => {
  assert.match(app, /scoreTiming/);
  assert.match(app, /data\.dataAvailable|result\.dataAvailable/);
  assert.match(app, /不会阻止发送/);
  assert.match(html, /id="timingPanel"/);
  assert.match(css, /\.timing-panel/);
  const result = scoreTiming({ messages: [{ type: "her", text: "你好" }], latestDraft: "你好" });
  assert.equal(result.dataAvailable, false);
  assert.equal(result.score, null);
  assert.ok(result.reasons.length > 0);
});

test("动态界面文本经过 escapeHtml 或 textContent，ABC 仍跟随最新女方回复", () => {
  assert.match(app, /function escapeHtml/);
  assert.match(app, /escapeHtml\(part\.text\)/);
  assert.match(app, /textContent\s*=/);
  const first = buildReplyOptionsForHer("mix", "我今天有点累，想先休息。", "你还好吗？");
  const second = buildReplyOptionsForHer("mix", "周末可以一起喝咖啡。", "你还好吗？");
  assert.equal(first.length, 3);
  assert.equal(second.length, 3);
  assert.notDeepEqual(first.map((item) => item.text), second.map((item) => item.text));
});

test("模型返回对象形式的 replyOptions 时，运行时会转换为 A/B/C 列表而不是本地兜底", () => {
  assert.match(app, /Object\.entries\(replyOptions\)/);
  assert.match(app, /replyOptionsSource:\s*useModelOptions \? "model" : "local"/);
  assert.doesNotMatch(app, /Suggestions must follow the newly generated reply[\s\S]*parsed\.replyOptions\s*=\s*buildLocalReplyOptions/);
});
