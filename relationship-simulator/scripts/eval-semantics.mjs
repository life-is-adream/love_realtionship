// 中文关系语义基线评测（本地、零联网、不在 npm test 里）。
//
// 目的：用临时标注的多标签以外单标签样本，统计五类决策的 Accuracy / Precision /
// Recall / F1、混淆对与不安全回复，避免把 C/Node 双实现一致当成语义正确。
//
// 用法：
//   node scripts/eval-semantics.mjs
//   node scripts/eval-semantics.mjs --out=docs/heartflow-2.0/SEMANTIC_BASELINE.md
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeV2, repliesV2 } from "../server/v2.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const OUT = args.find((item) => item.startsWith("--out="))?.slice(6) ?? "";
const fixture = JSON.parse(await readFile(path.join(root, "test", "fixtures", "semantic-cases.json"), "utf8"));
const labels = ["EXIT", "DE_ESCALATE", "OBSERVE", "ADVANCE", "MAINTAIN"];

const rows = [];
for (const item of fixture.cases) {
  const messages = [{ speaker: "user", text: item.user }, { speaker: "other", text: item.other }];
  const actual = analyzeV2(messages).decision.category;
  const replies = repliesV2(messages).suggestions;
  const unsafe = ["EXIT", "DE_ESCALATE"].includes(item.expected) && replies.some((reply) => /再约|给我机会/u.test(reply.text));
  rows.push({ ...item, actual, unsafe });
}

const total = rows.length;
const correct = rows.filter((row) => row.actual === row.expected).length;
const perLabel = Object.fromEntries(labels.map((label) => {
  const tp = rows.filter((row) => row.expected === label && row.actual === label).length;
  const fp = rows.filter((row) => row.expected !== label && row.actual === label).length;
  const fn = rows.filter((row) => row.expected === label && row.actual !== label).length;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  return [label, { tp, fp, fn, support: tp + fn, precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0 }];
}));
const macroF1 = labels.reduce((sum, label) => sum + perLabel[label].f1, 0) / labels.length;
const errors = rows.filter((row) => row.actual !== row.expected);
const unsafeRows = rows.filter((row) => row.unsafe);
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const lines = [
  "# 中文关系语义基线",
  "",
  `- 标注状态：${fixture.reviewed_by_human === true ? "已人工复核" : "**未人工复核（临时标注集）**"}`,
  `- 用例数：${total}`,
  `- Accuracy：${percent(correct / total)}`,
  `- Macro-F1：${macroF1.toFixed(3)}`,
  `- 不安全回复：${unsafeRows.length}`,
  "",
  "## 分类指标",
  "",
  "| 类别 | Precision | Recall | F1 | 支持数 |",
  "| --- | --- | --- | --- | --- |",
  ...labels.map((label) => `| ${label} | ${percent(perLabel[label].precision)} | ${percent(perLabel[label].recall)} | ${perLabel[label].f1.toFixed(3)} | ${perLabel[label].support} |`),
  "",
  "## 误判明细",
  "",
  ...(errors.length ? errors.map((row) => `- ${row.id}（${row.tags.join("/")}）：期望 ${row.expected}，实际 ${row.actual}；原文「${row.other}」`) : ["- 无"]),
  "",
  "## 边界",
  "",
  "- 样本由实现者编写，覆盖常见改写与否定结构，但不是独立人工标注，也未覆盖反讽、方言和长对话。",
  "- 指标只反映本地规则在固定样本上的表现，不能外推为真实场景准确率。",
  ""
].join("\n");

if (OUT) {
  await writeFile(path.join(root, OUT), lines, "utf8");
  console.log(`已写入 ${OUT}`);
} else {
  console.log(lines);
}
console.log(`Accuracy=${percent(correct / total)} Macro-F1=${macroF1.toFixed(3)} 误判=${errors.length} 不安全回复=${unsafeRows.length} 未人工复核=${fixture.reviewed_by_human !== true}`);
