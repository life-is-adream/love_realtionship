// HeartFlow 2.2 待标注候选集体检（不是验收）：只验证数据可用性与实现一致性。
// 用法: node quality/scripts/eval-2.2-candidates.mjs
// 输出: quality/reports/2.2-candidates.{json,md}
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = path.join(root, "quality", "datasets-2.2", "pending");
const out = path.join(root, "quality", "reports", "2.2-candidates.json");
const semantic = JSON.parse(await readFile(path.join(dir, "semantic.json"), "utf8"));
const retrieval = JSON.parse(await readFile(path.join(dir, "retrieval.json"), "utf8"));
const practice = JSON.parse(await readFile(path.join(dir, "practice.json"), "utf8"));
const { analyzeV2, repliesV2, practiceTurn, recommendCourses } = await import(new URL("../../server/v2.js", import.meta.url));

const percent = (v) => `${(v * 100).toFixed(1)}%`;
const mean = (rows, key) => rows.reduce((sum, row) => sum + row[key], 0) / (rows.length || 1);

// ---- 语义 ----
const labels = ["EXIT", "DE_ESCALATE", "OBSERVE", "ADVANCE", "MAINTAIN"];
const semanticRows = semantic.cases.map((item) => {
  const messages = [{ speaker: "user", text: item.user }, { speaker: "other", text: item.other }];
  const analysis = analyzeV2(messages);
  const actual = analysis?.decision?.category || "OBSERVE";
  const replies = repliesV2(messages).suggestions.map((s) => s.text);
  const pursuit = ["再约", "给我机会", "继续追", "复合", "挽回", "再见面"].some((word) => replies.some((text) => text.includes(word)));
  return { id: item.id, gold: item.target_decision, actual, strict: actual === item.target_decision, unsafe: item.unsafe_to_advance && (actual === "ADVANCE" || pursuit), span: item.evidence_spans?.[0] };
});
const perClass = Object.fromEntries(labels.map((label) => {
  const tp = semanticRows.filter((r) => r.gold === label && r.actual === label).length;
  const fp = semanticRows.filter((r) => r.gold !== label && r.actual === label).length;
  const fn = semanticRows.filter((r) => r.gold === label && r.actual !== label).length;
  const precision = tp + fp ? tp / (tp + fp) : 0, recall = tp + fn ? tp / (tp + fn) : 0;
  return [label, { tp, fp, fn, support: tp + fn, precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0 }];
}));
const semanticMetrics = {
  cases: semanticRows.length,
  accuracy: semanticRows.filter((r) => r.strict).length / semanticRows.length,
  macroF1: labels.reduce((sum, label) => sum + perClass[label].f1, 0) / labels.length,
  unsafeReplyCount: semanticRows.filter((r) => r.unsafe).length,
  invalidSpan: semanticRows.filter((r) => !r.span || r.span.start !== 0 || r.span.end !== Array.from(semantic.cases.find((c) => c.id === r.id).other).length).length
};

// ---- 检索 ----
const manifest = JSON.parse(await readFile(path.join(root, "public", "love-learning", "manifest.json"), "utf8"));
const lookup = new Map(manifest.courses.map((c) => [Number(c.no), c]));
const courseFiles = new Set(await readdir(path.join(root, "public", "love-learning", "courses")));
const bodyCache = new Map();
async function bodyOf(rel) {
  if (!bodyCache.has(rel)) bodyCache.set(rel, await readFile(path.join(root, "public", rel), "utf8"));
  return bodyCache.get(rel);
}
const modes = ["bm25", "semantic", "hybrid"];
async function evaluateRetrieval(dataset) {
  const report = {};
  for (const mode of modes) {
  const rows = [];
  for (const item of dataset.cases) {
    const started = performance.now();
    let result;
    try { result = await recommendCourses(item.query, 10, { mode }); } catch { result = { courses: [] }; }
    const latency = performance.now() - started;
    const ranked = (result.courses || []).map((c) => Number(c.course_no));
    const relevant = new Set(item.relevant);
    const found = ranked.filter((no) => relevant.has(no));
    const recallAt5 = relevant.size ? found.filter((no) => ranked.indexOf(no) < 5).length / relevant.size : null;
    const first = ranked.findIndex((no) => relevant.has(no));
    const mrr = relevant.size ? (first >= 0 && first < 5 ? 1 / (first + 1) : 0) : null;
    let dcg = 0, idcg = 0;
    for (let i = 0; i < Math.min(5, ranked.length); i++) if (relevant.has(ranked[i])) dcg += 1 / Math.log2(i + 2);
    for (let i = 0; i < Math.min(5, relevant.size); i++) idcg += 1 / Math.log2(i + 2);
    let citationErrors = 0;
    for (const course of result.courses || []) {
      const expected = lookup.get(Number(course.course_no));
      const citation = course.citation;
      if (!expected || !citation || citation.path !== expected.file || !courseFiles.has(expected.file.split("/").pop())) { citationErrors += 1; continue; }
      const lines = (await bodyOf(expected.file)).split(/\r?\n/);
      if (!citation.quote || !lines.slice(citation.line_start - 1, citation.line_end).join("\n").replace(/\s+/g, " ").includes(String(citation.quote).replace(/\s+/g, " ").trim())) citationErrors += 1;
    }
    rows.push({ id: item.id, group: item.group, relevantSize: relevant.size, recallAt5, mrr, ndcg5: idcg ? dcg / idcg : null, zero: ranked.length === 0, latency, citationErrors });
  }
  const matched = rows.filter((r) => r.relevantSize > 0);
  const noMatch = rows.filter((r) => r.relevantSize === 0);
  const sorted = rows.map((r) => r.latency).sort((a, b) => a - b);
  report[mode] = {
    cases: rows.length,
    labelled: matched.length,
    noMatch: noMatch.length,
    recallAt5: mean(matched, "recallAt5"),
    mrrAt5: mean(matched, "mrr"),
    ndcgAt5: mean(matched, "ndcg5"),
    noMatchZeroRate: noMatch.filter((r) => r.zero).length / (noMatch.length || 1),
    noMatchAnyResult: noMatch.filter((r) => !r.zero).length,
    citationErrors: rows.reduce((sum, r) => sum + r.citationErrors, 0),
    latencyP50: sorted[Math.floor(sorted.length * 0.5)],
    latencyP95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
  };
  }
  return report;
}
const retrievalReport = await evaluateRetrieval(retrieval);
let independentReport = null;
try {
  const independent = JSON.parse(await readFile(path.join(root, "quality", "datasets-2.2", "candidate-independent", "retrieval.json"), "utf8"));
  independentReport = await evaluateRetrieval(independent);
} catch {}

// ---- 模拟 ----
const practiceRows = practice.cases.map((item) => {
  const history = [], failures = [];
  let maxTension = 0;
  for (let i = 0; i < item.turns.length; i++) {
    const result = practiceTurn({ scenario_id: item.scenario_id, difficulty: item.difficulty, branch: item.branch, response: item.turns[i], history: [...history] });
    history.push(item.turns[i]);
    if (!Number.isInteger(result.state?.tension) || result.state.tension < 0 || result.state.tension > 3) failures.push(`turn${i + 1} tension 越界`);
    if (!Number.isInteger(result.state?.repair) || result.state.repair < 0 || result.state.repair > 3) failures.push(`turn${i + 1} repair 越界`);
    if (["复合", "挽回", "再给机会", "继续追", "再见面"].some((w) => String(result.text).includes(w))) failures.push(`turn${i + 1} 角色推进措辞`);
    maxTension = Math.max(maxTension, result.state?.tension || 0);
    if (item.expected_contract.refusal_ends && result.ended) break;
  }
  const lastHistory = [];
  let last;
  for (const turn of item.turns) { last = practiceTurn({ scenario_id: item.scenario_id, difficulty: item.difficulty, branch: item.branch, response: turn, history: [...lastHistory] }); lastHistory.push(turn); }
  if (item.expected_contract.refusal_ends && !last?.ended) failures.push("拒绝分支未结束");
  return { id: item.id, group: item.group, turns: item.turns.length, maxTension, ended: Boolean(last?.ended), failures, pass: failures.length === 0 };
});
const practiceMetrics = {
  cases: practiceRows.length,
  passed: practiceRows.filter((r) => r.pass).length,
  failed: practiceRows.filter((r) => !r.pass).length,
  refusalCases: practiceRows.filter((r) => practice.cases.find((c) => c.id === r.id).expected_contract.refusal_ends).length,
  refusalEnded: practiceRows.filter((r) => r.ended).length
};

const report = {
  generated_at: new Date().toISOString(),
  status: "PENDING_HUMAN_ANNOTATION",
  caveat: "全部标签为 AI 建议候选，未经独立人工标注；本报告只证明数据可运行、实现可复现，不能作为真实用户质量、泛化能力或安全验收证据。",
  counts: { semantic: semantic.cases.length, retrieval: retrieval.cases.length, practice: practice.cases.length },
  semantic: { metrics: semanticMetrics, perClass, errors: semanticRows.filter((r) => !r.strict).slice(0, 40) },
  retrieval: retrievalReport,
  independentRetrieval: independentReport,
  practice: practiceMetrics
};
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(report, null, 2) + "\n", "utf8");
const md = [
  "# 2.2 候选数据集检（非验收）",
  "",
  `- 状态：**待人工标注（PENDING_HUMAN_ANNOTATION）**，标签来源为 AI 建议，不是人工真值。`,
  `- 规模：语义 ${semantic.cases.length} / 检索 ${retrieval.cases.length} / 模拟 ${practice.cases.length}`,
  "",
  "## 语义（AI 建议标签上的实现表现）",
  "",
  `- Accuracy：${percent(semanticMetrics.accuracy)}；Macro-F1：${semanticMetrics.macroF1.toFixed(3)}`,
  `- 不安全推进：${semanticMetrics.unsafeReplyCount}；非法证据 span：${semanticMetrics.invalidSpan}`,
  "",
  "| 类别 | P | R | F1 | 支持 |", "| --- | --- | --- | --- | --- |",
  ...labels.map((l) => `| ${l} | ${percent(perClass[l].precision)} | ${percent(perClass[l].recall)} | ${perClass[l].f1.toFixed(3)} | ${perClass[l].support} |`),
  "",
  "## 检索（相关课程仅为单一建议值）",
  "",
  "| 模式 | Recall@5 | MRR@5 | nDCG@5 | 引用错误 | 域外零结果率 | P50 | P95 |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ...modes.map((mode) => { const r = retrievalReport[mode]; return `| ${mode} | ${percent(r.recallAt5)} | ${r.mrrAt5.toFixed(3)} | ${r.ndcgAt5.toFixed(3)} | ${r.citationErrors} | ${percent(r.noMatchZeroRate)} | ${r.latencyP50.toFixed(1)} ms | ${r.latencyP95.toFixed(1)} ms |`; }),
  "",
  ...(independentReport ? [
    "## 独立场景检索候选（query 不抄课程标题/目标）",
    "",
    "| 模式 | Recall@5 | MRR@5 | nDCG@5 | 引用错误 | 域外弃答率 | P50 | P95 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...modes.map((mode) => { const r = independentReport[mode]; return `| ${mode} | ${percent(r.recallAt5)} | ${r.mrrAt5.toFixed(3)} | ${r.ndcgAt5.toFixed(3)} | ${r.citationErrors} | ${percent(r.noMatchZeroRate)} | ${r.latencyP50.toFixed(1)} ms | ${r.latencyP95.toFixed(1)} ms |`; }),
    "",
    "该集共 65 条（60 条域内 + 5 条域外），query 为场景化手写、相关性按课程标题人工挑选；仍未经双人复核。",
    ""
  ] : []),
  "## 模拟（仅行为合同不变量）",
  "",
  `- 通过：${practiceMetrics.passed}/${practiceMetrics.cases}；拒绝分支结束：${practiceMetrics.refusalEnded}/${practiceMetrics.refusalCases}`,
  "",
  "## 边界",
  "",
  "- 语义标签、检索相关性、模拟期望均为脚本生成的候选值；必须由两名独立标注者复核、仲裁后才能冻结。",
  "- 检索前 179 条由课程目标改写，query 与目标同源，指标会偏高，不能外推真实用户检索体验。",
  "- 独立场景集仍由单人（AI）按课程标题判定相关性，只是去掉了 query 与课程文本的同源偏差；不能替代人工相关性判断。",
  "- 模拟只检查状态范围、拒绝分支终止与角色文本不出现推进措辞；不评价自然度、共情或角色一致性。",
  ""
].join("\n");
await writeFile(out.replace(/\.json$/, ".md"), md, "utf8");
console.log(`semantic acc=${percent(semanticMetrics.accuracy)} macroF1=${semanticMetrics.macroF1.toFixed(3)} unsafe=${semanticMetrics.unsafeReplyCount}`);
for (const mode of modes) console.log(`retrieval ${mode}: R@5=${percent(retrievalReport[mode].recallAt5)} citations=${retrievalReport[mode].citationErrors}`);
if (independentReport) for (const mode of modes) console.log(`independent ${mode}: R@5=${percent(independentReport[mode].recallAt5)} abstain=${percent(independentReport[mode].noMatchZeroRate)}`);
console.log(`practice: ${practiceMetrics.passed}/${practiceMetrics.cases}`);
console.log(`wrote ${path.relative(root, out)}`);
