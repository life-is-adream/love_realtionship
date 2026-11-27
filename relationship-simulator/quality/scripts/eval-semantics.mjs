// HeartFlow 2.1 独立语义评测（本地、零联网）。
// 用法: node quality/scripts/eval-semantics.mjs --split=dev --out=quality/reports/semantics-dev.json
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.join("=") || "true"]; }));
const split = args.split === "test" ? "test" : "dev";
const out = args.out || `quality/reports/semantics-${split}.json`;
const seed = Number(args.seed || 42);
const bootstrapN = Number(args.bootstrap || 1000);
const labels = ["EXIT", "DE_ESCALATE", "OBSERVE", "ADVANCE", "MAINTAIN"];
const datasetPath = path.join(root, "quality", "datasets", "semantic", `${split}.json`);
const dataset = JSON.parse(await readFile(datasetPath, "utf8"));

if (split === "test") {
  const freeze = JSON.parse(await readFile(path.join(root, "quality", "datasets", "FREEZE.json"), "utf8"));
  const actual = createHash("sha256").update(await readFile(datasetPath)).digest("hex");
  const expected = freeze.files["quality/datasets/semantic/test.json"]?.sha256;
  if (actual !== expected) { console.error(`test 集哈希不匹配：${actual} != ${expected}；拒绝把结果标为冻结 test。`); process.exit(2); }
}

const { analyzeV2, repliesV2 } = await import(new URL("../../server/v2.js", import.meta.url));
const mapLabel = (value) => value === "ABSTAIN" ? "OBSERVE" : value;
const rows = [];
for (const item of dataset.cases) {
  const messages = [{ speaker: "user", text: item.user }, { speaker: "other", text: item.other }];
  const analysis = analyzeV2(messages);
  const actual = analysis?.decision?.category || "OBSERVE";
  const abstain = analysis?.decision?.abstain === true;
  const replies = repliesV2(messages).suggestions.map((s) => s.text);
  const gold = mapLabel(item.target_decision);
  const strict = actual === gold;
  const lenient = strict || item.alternative_valid_labels.map(mapLabel).includes(actual);
  const pursuit = ["再约", "给我机会", "继续追", "复合", "挽回", "再见面"].some((word) => replies.some((text) => text.includes(word)));
  const unsafe = item.unsafe_to_advance && (actual === "ADVANCE" || pursuit);
  rows.push({ id: item.id, group: item.group, gold, goldRaw: item.target_decision, actual, abstain, strict, lenient, unsafe, text: item.other, alternative: item.alternative_valid_labels });
}

const percent = (v) => `${(v * 100).toFixed(1)}%`;
const perClass = Object.fromEntries(labels.map((label) => {
  const tp = rows.filter((r) => r.gold === label && r.actual === label).length;
  const fp = rows.filter((r) => r.gold !== label && r.actual === label).length;
  const fn = rows.filter((r) => r.gold === label && r.actual !== label).length;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  return [label, { tp, fp, fn, support: tp + fn, precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0 }];
}));
const accuracy = rows.filter((r) => r.strict).length / rows.length;
const lenientAccuracy = rows.filter((r) => r.lenient).length / rows.length;
const macroF1 = labels.reduce((sum, label) => sum + perClass[label].f1, 0) / labels.length;
const microTp = labels.reduce((s, l) => s + perClass[l].tp, 0);
const microFp = labels.reduce((s, l) => s + perClass[l].fp, 0);
const microFn = labels.reduce((s, l) => s + perClass[l].fn, 0);
const microF1 = 2 * microTp / (2 * microTp + microFp + microFn || 1);
const confusion = Object.fromEntries(labels.map((g) => [g, Object.fromEntries(labels.map((a) => [a, rows.filter((r) => r.gold === g && r.actual === a).length]))]));
const abstainRows = rows.filter((r) => r.abstain);
const unsafeRows = rows.filter((r) => r.unsafe);
const abstainGold = rows.filter((r) => r.goldRaw === "ABSTAIN");

// 以情境组为重采样单位，避免同组改写被当成独立样本。
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const random = mulberry32(seed);
const groupMap = new Map();
for (const row of rows) { if (!groupMap.has(row.group)) groupMap.set(row.group, []); groupMap.get(row.group).push(row); }
const groupKeys = [...groupMap.keys()];
function stats(sample) {
  const acc = sample.filter((r) => r.strict).length / sample.length;
  const f1 = labels.reduce((sum, label) => {
    const tp = sample.filter((r) => r.gold === label && r.actual === label).length;
    const fp = sample.filter((r) => r.gold !== label && r.actual === label).length;
    const fn = sample.filter((r) => r.gold === label && r.actual !== label).length;
    const p = tp + fp ? tp / (tp + fp) : 0, rec = tp + fn ? tp / (tp + fn) : 0;
    return sum + (p + rec ? 2 * p * rec / (p + rec) : 0);
  }, 0) / labels.length;
  return { acc, f1 };
}
const bootAcc = [], bootF1 = [];
for (let i = 0; i < bootstrapN; i++) {
  const sample = [];
  for (let j = 0; j < groupKeys.length; j++) {
    const key = groupKeys[Math.floor(random() * groupKeys.length)];
    sample.push(...groupMap.get(key));
  }
  const s = stats(sample); bootAcc.push(s.acc); bootF1.push(s.f1);
}
const quantile = (arr, q) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(q * a.length))]; };
const ci = { accuracy: [quantile(bootAcc, 0.025), quantile(bootAcc, 0.975)], macroF1: [quantile(bootF1, 0.025), quantile(bootF1, 0.975)] };
const result = {
  generated_at: new Date().toISOString(),
  system: args.system || "node-rule",
  dataset: { path: `quality/datasets/semantic/${split}.json`, version: dataset.dataset_version, split, cases: rows.length, groups: groupKeys.length, reviewed_by_human: dataset.reviewed_by_human, annotation_status: dataset.annotation_status },
  metrics: { accuracy, lenientAccuracy, macroF1, microF1, unsafeReplyCount: unsafeRows.length, unsafeAdvanceRate: rows.filter((r) => r.unsafe_to_advance).length ? unsafeRows.length / rows.filter((r) => r.unsafe_to_advance).length : 0, abstainPredicted: abstainRows.length, abstainGold: abstainGold.length, abstainRecall: abstainGold.length ? abstainGold.filter((r) => r.abstain).length / abstainGold.length : null },
  perClass, confusion, bootstrap: { n: bootstrapN, seed, unit: "group", accuracy95: ci.accuracy, macroF195: ci.macroF1 },
  errors: rows.filter((r) => !r.strict).map(({ id, group, gold, actual, text, alternative, abstain }) => ({ id, group, gold, actual, abstain, text, alternative })),
  lenientOnly: rows.filter((r) => !r.strict && r.lenient).map((r) => r.id),
  unsafeRows: unsafeRows.map(({ id, gold, actual, text }) => ({ id, gold, actual, text })),
  rows
};
await mkdir(path.dirname(path.join(root, out)), { recursive: true });
await writeFile(path.join(root, out), JSON.stringify(result, null, 2) + "\n", "utf8");

const md = [
  `# 语义评测（${split} / ${result.system}）`,
  "",
  `- 数据：${dataset.dataset_version}（${rows.length} 条，${groupKeys.length} 组）`,
  `- 标注状态：${dataset.reviewed_by_human ? "已人工复核" : "**未独立人工复核（合成单标注者）**"}`,
  `- Accuracy：${percent(accuracy)}（宽松含 alternative：${percent(lenientAccuracy)}）`,
  `- Macro-F1：${macroF1.toFixed(3)} / Micro-F1：${microF1.toFixed(3)}`,
  `- 不安全推进：${unsafeRows.length} / ${rows.filter((r) => r.unsafe_to_advance).length}`,
  `- 弃判：预测 ${abstainRows.length}，金标 ${abstainGold.length}，弃判召回 ${result.metrics.abstainRecall === null ? "N/A" : percent(result.metrics.abstainRecall)}`,
  `- Bootstrap 95% CI（按情境组重采样，n=${bootstrapN}, seed=${seed}）：Accuracy [${percent(ci.accuracy[0])}, ${percent(ci.accuracy[1])}]，Macro-F1 [${ci.macroF1[0].toFixed(3)}, ${ci.macroF1[1].toFixed(3)}]`,
  "",
  "| 类别 | P | R | F1 | 支持 |",
  "| --- | --- | --- | --- | --- |",
  ...labels.map((l) => `| ${l} | ${percent(perClass[l].precision)} | ${percent(perClass[l].recall)} | ${perClass[l].f1.toFixed(3)} | ${perClass[l].support} |`),
  "",
  "## 误判",
  "",
  ...(result.errors.length ? result.errors.map((e) => `- ${e.id}（${e.group}）：金标 ${e.gold}，实际 ${e.actual}；「${e.text}」`) : ["- 无"]),
  "",
  "## 口径与边界",
  "",
  "- `ABSTAIN` 为评测补充标签；生产五类中映射为 `OBSERVE`，并单独检查 `decision.abstain`。",
  "- 数据为原创合成样本，由单一实现者编写；不得称为独立人工标注或真实用户准确率。",
  "- test 文件受 `quality/datasets/FREEZE.json` 哈希保护；本脚本不应用于 test 调参。",
  ""
].join("\n");
await writeFile(path.join(root, out.replace(/\.json$/, ".md")), md, "utf8");
console.log(`accuracy=${percent(accuracy)} macroF1=${macroF1.toFixed(3)} unsafe=${unsafeRows.length} abstain=${abstainRows.length}/${abstainGold.length} errors=${result.errors.length}`);
console.log(`wrote ${out} and ${out.replace(/\.json$/, ".md")}`);
