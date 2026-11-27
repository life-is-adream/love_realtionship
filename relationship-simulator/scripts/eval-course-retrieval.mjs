// 课程检索基线评测（本地、零联网、不在 npm test 里）。
//
// 目的：用临时标注的课程问题集量化 Recall@5 / MRR@5 与引用有效性，避免只用
// “返回了真实课程 ID” 当作检索质量。标注集尚未经独立人工复核，报告会明确标注。
//
// 用法：
//   node scripts/eval-course-retrieval.mjs
//   node scripts/eval-course-retrieval.mjs --out=docs/heartflow-2.0/COURSE_RETRIEVAL_BASELINE.md
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recommendCourses } from "../server/v2.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const OUT = args.find((item) => item.startsWith("--out="))?.slice(6) ?? "";
const fixture = JSON.parse(await readFile(path.join(root, "test", "fixtures", "course-queries.json"), "utf8"));
const manifest = JSON.parse(await readFile(path.join(root, "public", "love-learning", "manifest.json"), "utf8"));
const lookup = new Map(manifest.courses.map((course) => [Number(course.no), course]));

const rows = [];
let recallSum = 0, rrSum = 0, hitCount = 0, citationErrors = 0;
for (const item of fixture.cases) {
  const result = await recommendCourses(item.query, 5);
  const ranked = result.courses.map((course) => Number(course.course_no));
  const found = ranked.filter((no) => item.relevant.includes(no));
  const recall = found.length / item.relevant.length;
  const firstIndex = ranked.findIndex((no) => item.relevant.includes(no));
  const reciprocal = firstIndex >= 0 ? 1 / (firstIndex + 1) : 0;
  recallSum += recall;
  rrSum += reciprocal;
  if (found.length) hitCount += 1;
  for (const course of result.courses) {
    const expected = lookup.get(Number(course.course_no));
    if (!expected || expected.title !== course.title || !expected.file) citationErrors += 1;
  }
  rows.push({ ...item, ranked, recall, reciprocal });
}

const total = rows.length;
const metrics = {
  cases: total,
  recallAt5: recallSum / total,
  mrrAt5: rrSum / total,
  hitRateAt5: hitCount / total,
  citationErrors,
  humanReviewed: fixture.reviewed_by_human === true
};
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const lines = [
  "# 课程检索基线",
  "",
  `- 标注状态：${metrics.humanReviewed ? "已人工复核" : "**未人工复核（临时标注集）**"}`,
  `- 用例数：${metrics.cases}`,
  `- Recall@5：${percent(metrics.recallAt5)}`,
  `- MRR@5：${metrics.mrrAt5.toFixed(3)}`,
  `- HitRate@5：${percent(metrics.hitRateAt5)}`,
  `- 引用错误数：${metrics.citationErrors}`,
  "",
  "## 逐条结果",
  "",
  "| ID | 查询 | 期望课程 | 实际前 5 | Recall | RR |",
  "| --- | --- | --- | --- | --- | --- |",
  ...rows.map((row) => `| ${row.id} | ${row.query} | ${row.relevant.join(", ")} | ${row.ranked.join(", ") || "（空）"} | ${row.recall.toFixed(2)} | ${row.reciprocal.toFixed(2)} |`),
  "",
  "## 未命中用例",
  "",
  ...(rows.filter((row) => row.recall === 0).map((row) => `- ${row.id}：${row.query}（期望 ${row.relevant.join(", ")}，实际 ${row.ranked.join(", ") || "（空）"}）`).concat(rows.every((row) => row.recall > 0) ? ["- 无"] : [])),
  "",
  "## 边界",
  "",
  "- 指标来自实现者编写的临时标注集，不是独立人工评估；不能对外宣称真实检索质量。",
  "- 评测直接调用 Node 参照实现；C 与 Node 的同一查询一致性由 `v2-smoke.py` 覆盖，未覆盖全部用例。",
  ""
].join("\n");

if (OUT) {
  await writeFile(path.join(root, OUT), lines, "utf8");
  console.log(`已写入 ${OUT}`);
} else {
  console.log(lines);
}
console.log(`Recall@5=${percent(metrics.recallAt5)} MRR@5=${metrics.mrrAt5.toFixed(3)} 引用错误=${metrics.citationErrors} 未人工复核=${!metrics.humanReviewed}`);
