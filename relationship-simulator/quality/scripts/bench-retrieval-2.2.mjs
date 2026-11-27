// C/Node 检索延迟对照（本机、零联网、串行请求）。
// 用法: node quality/scripts/bench-retrieval-2.2.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = Number(process.env.HF_BENCH_PORT || 3296);
const { recommendCourses } = await import(new URL("../../server/v2.js", import.meta.url));
const dataset = JSON.parse(await readFile(path.join(root, "quality", "datasets", "retrieval", "dev.json"), "utf8"));
const queries = dataset.cases.map((c) => c.query);
const child = spawn(path.join(root, "heartflow-c", "hf.exe"), ["serve", "--port", String(port), "--root", root], { cwd: root, stdio: "ignore" });
let ready = false;
for (let i = 0; i < 60 && !ready; i++) {
  await new Promise((r) => setTimeout(r, 100));
  try { ready = (await fetch(`http://127.0.0.1:${port}/api/v2/practice/scenarios`)).ok; } catch {}
}
if (!ready) { child.kill(); console.error("C 服务未启动"); process.exit(2); }
const pct = (values, q) => { const a = [...values].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(q * a.length))]; };
const rows = [];
for (const mode of ["bm25", "semantic", "hybrid"]) {
  for (const engine of ["node", "c"]) {
    for (let i = 0; i < 5; i++) {
      if (engine === "node") await recommendCourses(queries[i], 3, { mode });
      else await fetch(`http://127.0.0.1:${port}/api/v2/learning/recommendations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: queries[i], limit: 3, mode }) });
    }
    const latencies = [];
    for (const query of queries) {
      const started = performance.now();
      if (engine === "node") await recommendCourses(query, 3, { mode });
      else await (await fetch(`http://127.0.0.1:${port}/api/v2/learning/recommendations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, limit: 3, mode }) })).json();
      latencies.push(performance.now() - started);
    }
    rows.push({ mode, engine, n: latencies.length, p50: pct(latencies, 0.5), p95: pct(latencies, 0.95), mean: latencies.reduce((a, b) => a + b, 0) / latencies.length });
  }
}
child.kill();
const out = path.join(root, "quality", "reports", "2.2-latency.json");
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify({ generated_at: new Date().toISOString(), note: "本机串行、热进程、单用户；不是并发或生产 SLA。", rows }, null, 2) + "\n", "utf8");
for (const row of rows) console.log(`${row.mode.padEnd(9)} ${row.engine.padEnd(5)} P50=${row.p50.toFixed(1)}ms P95=${row.p95.toFixed(1)}ms`);
