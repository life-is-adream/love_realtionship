// HeartFlow 2.1 课程检索评测（本地、零联网）。
// 用法: node quality/scripts/eval-retrieval.mjs --split=test --mode=hybrid --out=quality/reports/retrieval-test-hybrid.json
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.join("=") || "true"]; }));
const split = args.split === "test" ? "test" : "dev";
const mode = args.mode || "bm25";
const out = args.out || `quality/reports/retrieval-${split}-${mode}.json`;
const seed = Number(args.seed || 42);
const bootstrapN = Number(args.bootstrap || 1000);
const datasetPath = path.join(root, "quality", "datasets", "retrieval", `${split}.json`);
const dataset = JSON.parse(await readFile(datasetPath, "utf8"));

if (split === "test") {
  const freeze = JSON.parse(await readFile(path.join(root, "quality", "datasets", "FREEZE.json"), "utf8"));
  const actual = createHash("sha256").update(await readFile(datasetPath)).digest("hex");
  const expected = freeze.files["quality/datasets/retrieval/test.json"]?.sha256;
  if (actual !== expected) { console.error(`test 集哈希不匹配：${actual} != ${expected}`); process.exit(2); }
}

const manifest = JSON.parse(await readFile(path.join(root, "public", "love-learning", "manifest.json"), "utf8"));
const lookup = new Map(manifest.courses.map((c) => [Number(c.no), c]));
const files = new Set(await readdir(path.join(root, "public", "love-learning", "courses")));
const bodyCache = new Map();
async function bodyOf(rel) {
  if (!bodyCache.has(rel)) bodyCache.set(rel, await readFile(path.join(root, "public", rel), "utf8"));
  return bodyCache.get(rel);
}
const { recommendCourses } = await import(new URL("../../server/v2.js", import.meta.url));
const percent = (v) => `${(v * 100).toFixed(1)}%`;

const rows = [];
for (const item of dataset.cases) {
  const started = performance.now();
  let result;
  try { result = await recommendCourses(item.query, 10, { mode }); }
  catch (error) { result = { courses: [], error: String(error?.code || error?.message || error) }; }
  const latency = performance.now() - started;
  const ranked = (result.courses || []).map((c) => Number(c.course_no));
  const relevant = new Set(item.relevant);
  const found = ranked.filter((no) => relevant.has(no));
  const recallAt = (k) => found.filter((no) => ranked.indexOf(no) < k).length / relevant.size;
  const first = ranked.findIndex((no) => relevant.has(no));
  const mrr = first >= 0 && first < 5 ? 1 / (first + 1) : 0;
  let dcg = 0, idcg = 0;
  for (let i = 0; i < Math.min(5, ranked.length); i++) if (relevant.has(ranked[i])) dcg += 1 / Math.log2(i + 2);
  for (let i = 0; i < Math.min(5, relevant.size); i++) idcg += 1 / Math.log2(i + 2);
  let citationErrors = 0;
  for (const course of result.courses || []) {
    const expected = lookup.get(Number(course.course_no));
    const expectedFile = expected ? expected.file : "";
    const citation = course.citation;
    if (!expected || !citation || citation.path !== expectedFile || !files.has(expectedFile.split("/").pop())) { citationErrors += 1; continue; }
    try {
      const lines = (await bodyOf(expectedFile)).split(/\r?\n/);
      const start = Number(citation.line_start || 1), end = Number(citation.line_end || lines.length);
      const slice = (end >= start ? lines.slice(start - 1, end).join("\n") : "").replace(/\s+/g, " ").trim();
      if (!citation.quote || !slice.includes(String(citation.quote).replace(/\s+/g, " ").trim())) citationErrors += 1;
    } catch { citationErrors += 1; }
  }
  rows.push({ id: item.id, group: item.group, query: item.query, relevant: item.relevant, ranked, recallAt1: recallAt(1), recallAt3: recallAt(3), recallAt5: recallAt(5), recallAt10: recallAt(10), mrr, ndcg5: idcg ? dcg / idcg : 0, latency, citationErrors, zero: ranked.length === 0, modeEffective: result.mode_effective || result.source || mode, fallbackReason: result.fallback_reason || null });
}

const mean = (key) => rows.reduce((s, r) => s + r[key], 0) / rows.length;
const pct = (values, q) => { const a = [...values].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(q * a.length))]; };
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const random = mulberry32(seed);
const groups = new Map();
for (const row of rows) { if (!groups.has(row.group)) groups.set(row.group, []); groups.get(row.group).push(row); }
const keys = [...groups.keys()];
const boot = [];
for (let i = 0; i < bootstrapN; i++) {
  const sample = [];
  for (let j = 0; j < keys.length; j++) sample.push(...groups.get(keys[Math.floor(random() * keys.length)]));
  boot.push(sample.reduce((s, r) => s + r.recallAt5, 0) / sample.length);
}
const quantile = (arr, q) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(q * a.length))]; };
let indexBytes = 0;
try { indexBytes = (await stat(path.join(root, "public", "love-learning", "semantic-index", "index.json"))).size; } catch {}
const metrics = {
  cases: rows.length, groups: keys.length,
  recallAt1: mean("recallAt1"), recallAt3: mean("recallAt3"), recallAt5: mean("recallAt5"), recallAt10: mean("recallAt10"),
  mrrAt5: mean("mrr"), ndcgAt5: mean("ndcg5"),
  citationErrors: rows.reduce((s, r) => s + r.citationErrors, 0),
  validCitationRate: rows.reduce((s, r) => s + (r.ranked.length ? (r.ranked.length - r.citationErrors) / r.ranked.length : 1), 0) / rows.length,
  zeroResultRate: rows.filter((r) => r.zero).length / rows.length,
  latencyP50: pct(rows.map((r) => r.latency), 0.5), latencyP95: pct(rows.map((r) => r.latency), 0.95),
  indexBytes,
  fallbackRows: rows.filter((r) => r.fallbackReason).length
};
const result = {
  generated_at: new Date().toISOString(), mode, split,
  dataset: { version: dataset.dataset_version, cases: rows.length, reviewed_by_human: dataset.reviewed_by_human, annotation_status: dataset.annotation_status },
  metrics,
  bootstrap: { unit: "group", n: bootstrapN, seed, recallAt5_95: [quantile(boot, 0.025), quantile(boot, 0.975)] },
  rows
};
await mkdir(path.dirname(path.join(root, out)), { recursive: true });
await writeFile(path.join(root, out), JSON.stringify(result, null, 2) + "\n", "utf8");
const md = [
  `# 课程检索评测（${split} / ${mode}）`,
  "",
  `- 数据：${dataset.dataset_version}（${rows.length} query，${keys.length} 组）`,
  `- 标注状态：${dataset.reviewed_by_human ? "已人工复核" : "**未独立人工复核（合成单标注者）**"}`,
  `- Recall@1/3/5/10：${percent(metrics.recallAt1)} / ${percent(metrics.recallAt3)} / ${percent(metrics.recallAt5)} / ${percent(metrics.recallAt10)}`,
  `- MRR@5：${metrics.mrrAt5.toFixed(3)}；nDCG@5：${metrics.ndcgAt5.toFixed(3)}`,
  `- 引用错误：${metrics.citationErrors}；零结果率：${percent(metrics.zeroResultRate)}`,
  `- P50/P95：${metrics.latencyP50.toFixed(1)} / ${metrics.latencyP95.toFixed(1)} ms；索引体积：${(metrics.indexBytes / 1024).toFixed(1)} KB`,
  `- Recall@5 Bootstrap 95% CI（组重采样）：[${percent(result.bootstrap.recallAt5_95[0])}, ${percent(result.bootstrap.recallAt5_95[1])}]`,
  "",
  "| ID | Query | 期望 | 实际前 10 | R@5 | MRR | nDCG@5 |", "| --- | --- | --- | --- | --- | --- | --- |",
  ...rows.map((r) => `| ${r.id} | ${r.query} | ${r.relevant.join(",")} | ${r.ranked.join(",") || "（空）"} | ${r.recallAt5.toFixed(2)} | ${r.mrr.toFixed(2)} | ${r.ndcg5.toFixed(2)} |`),
  "",
  "## 口径与边界",
  "",
  "- Relevance 为二值多目标；Recall 分母为标注相关课程数，MRR/nDCG 只看前 5。",
  "- 引用有效性检查 course_no/title 与本地文件存在性；不检查段落级跳转（S3.1 另测）。",
  "- 数据为原创合成 query，未经独立人工复核；不能外推真实用户检索体验。",
  ""
].join("\n");
await writeFile(path.join(root, out.replace(/\.json$/, ".md")), md, "utf8");
console.log(`mode=${mode} R@5=${percent(metrics.recallAt5)} MRR@5=${metrics.mrrAt5.toFixed(3)} nDCG@5=${metrics.ndcgAt5.toFixed(3)} citations=${metrics.citationErrors} P95=${metrics.latencyP95.toFixed(1)}ms`);
console.log(`wrote ${out} and ${out.replace(/\.json$/, ".md")}`);
