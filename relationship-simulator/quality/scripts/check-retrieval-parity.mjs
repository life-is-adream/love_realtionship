// C/Node 课程检索契约对照：bm25 / semantic / hybrid / hybrid_rerank 排序逐条一致，
// 引用可回读真实文件；并覆盖空查询、未知词、同分排序稳定性与异常索引。
import { readFile, readdir, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = Number(process.env.HF_RETRIEVAL_PARITY_PORT || 3298);
const exe = path.join(root, "heartflow-c", "hf.exe");
const { recommendCourses } = await import(new URL("../../server/v2.js", import.meta.url));
const modes = ["bm25", "semantic", "hybrid", "hybrid_rerank"];

async function startService(servicePort, serviceRoot) {
  const child = spawn(exe, ["serve", "--port", String(servicePort), "--root", serviceRoot], { cwd: root, stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try { if ((await fetch(`http://127.0.0.1:${servicePort}/api/v2/practice/scenarios`)).ok) return child; } catch {}
  }
  child.kill();
  return null;
}
async function post(servicePort, body) {
  const response = await fetch(`http://127.0.0.1:${servicePort}/api/v2/learning/recommendations`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  return { status: response.status, json: await response.json() };
}

const child = await startService(port, root);
if (!child) { console.error("C 服务未启动"); process.exit(2); }

const cases = [];
for (const split of ["dev", "test"]) {
  const data = JSON.parse(await readFile(path.join(root, "quality", "datasets", "retrieval", split + ".json"), "utf8"));
  for (const item of data.cases) cases.push({ id: item.id, query: item.query, set: split });
}
try {
  const pending = JSON.parse(await readFile(path.join(root, "quality", "datasets-2.2", "pending", "retrieval.json"), "utf8"));
  for (const item of pending.cases) cases.push({ id: item.id, query: item.query, set: "pending-2.2", noMatch: item.relevant.length === 0 });
} catch {}
const boundary = [
  { id: "edge-whitespace", query: "   " },
  { id: "edge-unknown-words", query: "zzzz qqqq" },
  { id: "edge-punctuation", query: "？！。" },
  { id: "edge-long-mixed", query: "异地恋 父母反对 彩礼 沟通 边界 未来 计划" }
];
cases.push(...boundary);

const files = new Set(await readdir(path.join(root, "public", "love-learning", "courses")));
const bodyCache = new Map();
async function bodyOf(rel) {
  if (!bodyCache.has(rel)) bodyCache.set(rel, await readFile(path.join(root, "public", rel), "utf8"));
  return bodyCache.get(rel);
}
async function citationOk(course) {
  const rel = `love-learning/courses/${String(course.course_no).padStart(3, "0")}.md`;
  const citation = course.citation || {};
  if (citation.path !== rel || !citation.quote || !files.has(rel.split("/").pop())) return false;
  const lines = (await bodyOf(rel)).split(/\r?\n/);
  const start = Number(citation.line_start || 1), end = Number(citation.line_end || lines.length);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return false;
  const slice = lines.slice(start - 1, end).join("\n").replace(/\s+/g, " ").trim();
  return slice.includes(String(citation.quote).replace(/\s+/g, " ").trim());
}

const rows = [];
for (const mode of modes) {
  for (const item of cases) {
    const node = await recommendCourses(item.query, 10, { mode });
    const c = (await post(port, { query: item.query, limit: 10, mode })).json;
    const failures = [];
    const nRank = node.courses.map((x) => x.course_no).join(",");
    const cRank = (c.courses || []).map((x) => x.course_no).join(",");
    const expectedEffective = mode === "hybrid_rerank" ? "hybrid" : mode;
    if (nRank !== cRank) failures.push(`rank node[${nRank}] c[${cRank}]`);
    if (Boolean(node.abstained) !== Boolean(c.abstained)) failures.push(`abstain node=${Boolean(node.abstained)} c=${Boolean(c.abstained)}`);
    if (c.mode_effective !== expectedEffective) failures.push(`mode_effective ${c.mode_effective}`);
    if (mode === "hybrid_rerank" && c.fallback_reason !== "reranker_not_configured") failures.push(`fallback ${c.fallback_reason}`);
    if (mode !== "hybrid_rerank" && c.fallback_reason !== null) failures.push(`unexpected fallback ${c.fallback_reason}`);
    for (const course of c.courses || []) if (!(await citationOk(course))) failures.push(`citation ${course.course_no}`);
    rows.push({ id: item.id, set: item.set || "boundary", mode, noMatch: Boolean(item.noMatch), abstained: Boolean(c.abstained), failures });
  }
}

// 同分排序稳定性：同一请求连续两次结果必须完全一致。
{
  const first = (await post(port, { query: "父母 边界 沟通", limit: 10, mode: "hybrid" })).json;
  const second = (await post(port, { query: "父母 边界 沟通", limit: 10, mode: "hybrid" })).json;
  if (JSON.stringify(first.courses) !== JSON.stringify(second.courses)) rows.push({ id: "tie-break-repeat", set: "boundary", mode: "hybrid", failures: ["两次请求结果不同"] });
}

// 非法输入与异常索引：确定性错误码，不返回伪造结果。
{
  const empty = await post(port, { query: "", mode: "hybrid" });
  if (empty.status !== 400 || empty.json.error !== "invalid_query") rows.push({ id: "abnormal-empty-query", set: "boundary", mode: "hybrid", failures: [`${empty.status} ${empty.json.error}`] });
  const badLimit = await post(port, { query: "沟通", limit: 99 });
  if (badLimit.status !== 400 || badLimit.json.error !== "invalid_limit") rows.push({ id: "abnormal-limit", set: "boundary", mode: "bm25", failures: [`${badLimit.status} ${badLimit.json.error}`] });

  const emptyRoot = await mkdtemp(path.join(tmpdir(), "hf-parity-empty-"));
  const brokenRoot = await mkdtemp(path.join(tmpdir(), "hf-parity-broken-"));
  try {
    await mkdir(path.join(brokenRoot, "public", "love-learning"), { recursive: true });
    await writeFile(path.join(brokenRoot, "public", "love-learning", "manifest.json"), "{ not json", "utf8");
    const missing = await startService(port + 1, emptyRoot);
    const broken = await startService(port + 2, brokenRoot);
    if (missing) {
      const res = await post(port + 1, { query: "沟通" });
      if (res.status !== 503 || res.json.error !== "course_index_missing") rows.push({ id: "abnormal-index-missing", set: "boundary", mode: "bm25", failures: [`${res.status} ${res.json.error}`] });
      missing.kill();
    } else rows.push({ id: "abnormal-index-missing", set: "boundary", mode: "bm25", failures: ["服务未启动"] });
    if (broken) {
      const res = await post(port + 2, { query: "沟通" });
      if (res.status !== 503 || res.json.error !== "course_index_invalid") rows.push({ id: "abnormal-index-broken", set: "boundary", mode: "bm25", failures: [`${res.status} ${res.json.error}`] });
      broken.kill();
    } else rows.push({ id: "abnormal-index-broken", set: "boundary", mode: "bm25", failures: ["服务未启动"] });
  } finally {
    await rm(emptyRoot, { recursive: true, force: true });
    await rm(brokenRoot, { recursive: true, force: true });
  }
}
child.kill();

const labels = ["历史 dev/test", "2.2 待标注候选", "边界与异常"];
for (const set of ["dev", "test", "pending-2.2", "boundary"]) {
  const subset = rows.filter((r) => r.set === set);
  if (!subset.length) continue;
  const bad = subset.filter((r) => r.failures.length);
  console.log(`${set}：${subset.length - bad.length}/${subset.length} 一致`);
  for (const row of bad.slice(0, 10)) console.log(`- [${row.mode}] ${row.id}: ${row.failures.join("; ")}`);
}
const allBad = rows.filter((r) => r.failures.length);
console.log(`合计：${rows.length - allBad.length}/${rows.length} 通过（${labels.join(" / ")}）`);
const ood = rows.filter((r) => r.noMatch && r.mode === "hybrid");
if (ood.length) console.log(`域外弃答：${ood.filter((r) => r.abstained).length}/${ood.length}`);
process.exit(allBad.length ? 1 : 0);
