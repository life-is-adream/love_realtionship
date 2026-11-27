// HeartFlow 2.2 标注工具：导出审阅表、逐条记录标注、统计标注者一致性。
// 用法：
//   node quality/scripts/annotate-2.2.mjs --export
//   node quality/scripts/annotate-2.2.mjs --next --annotator=alice
//   node quality/scripts/annotate-2.2.mjs --set sem-cand-001 --label=EXIT --annotator=alice --note="清晰拒绝"
//   node quality/scripts/annotate-2.2.mjs --status
//   node quality/scripts/annotate-2.2.mjs --iaa --a=alice --b=bob
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const base = path.join(root, "quality", "datasets-2.2");
const pendingDir = path.join(base, "pending");
const annotationDir = path.join(base, "annotations");
const reviewDir = path.join(base, "review");
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.join("=") || "true"]; }));
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const setId = args.set === "true" ? positional[0] : args.set;
const setLabel = args.label && args.label !== "true" ? args.label : positional[1];
const datasets = ["semantic", "retrieval", "practice"];
const labels = ["EXIT", "DE_ESCALATE", "OBSERVE", "ADVANCE", "MAINTAIN"];

const data = {};
for (const name of datasets) data[name] = JSON.parse(await readFile(path.join(pendingDir, `${name}.json`), "utf8"));
const allCases = datasets.flatMap((name) => data[name].cases.map((c) => ({ ...c, dataset: name })));
const byId = new Map(allCases.map((c) => [c.id, c]));
const annotator = args.annotator || "default";
const annotationFile = path.join(annotationDir, `${annotator}.jsonl`);

async function readAnnotations(name) {
  try {
    const text = await readFile(path.join(annotationDir, `${name}.jsonl`), "utf8");
    return text.split(/\r?\n/).filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

if (args.export) {
  await mkdir(reviewDir, { recursive: true });
  const cell = (value) => `"${String(value).replace(/"/g, '""')}"`;
  for (const name of datasets) {
    const rows = [["id", "dataset", "input", "suggested_label", "annotator_label", "note"]];
    for (const item of data[name].cases) {
      const input = name === "semantic" ? `${item.user} → ${item.other}`
        : name === "retrieval" ? item.query
        : `${item.scenario_id}/${item.branch}：${item.turns.join(" / ")}`;
      const suggested = name === "semantic" ? item.target_decision
        : name === "retrieval" ? (item.relevant.join(",") || "(no-match)")
        : JSON.stringify(item.expected_contract);
      rows.push([item.id, name, input, suggested, "", ""]);
    }
    const csv = rows.map((row) => row.map(cell).join(",")).join("\n") + "\n";
    await writeFile(path.join(reviewDir, `${name}-review.csv`), csv, "utf8");
  }
  console.log(`导出审阅表：${path.relative(root, reviewDir)}`);
  process.exit(0);
}

if (args.set) {
  const item = byId.get(setId);
  if (!item) { console.error(`未知 id：${setId}`); process.exit(2); }
  if (!setLabel) { console.error("缺少 --label"); process.exit(2); }
  if (item.dataset === "semantic" && !labels.includes(setLabel)) { console.error(`语义标签必须是 ${labels.join("/")}`); process.exit(2); }
  await mkdir(annotationDir, { recursive: true });
  const record = { id: item.id, dataset: item.dataset, label: setLabel, note: args.note || "", annotator, at: new Date().toISOString() };
  const existing = await readAnnotations(annotator);
  const kept = existing.filter((r) => r.id !== item.id);
  kept.push(record);
  await writeFile(annotationFile, kept.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  console.log(`已记录 ${item.id} = ${setLabel}（${annotator}）`);
  process.exit(0);
}

if (args.next) {
  const done = new Set((await readAnnotations(annotator)).map((r) => r.id));
  const next = allCases.find((c) => !done.has(c.id));
  if (!next) { console.log("全部条目已标注。"); process.exit(0); }
  console.log(JSON.stringify({
    id: next.id, dataset: next.dataset,
    input: next.dataset === "semantic" ? { user: next.user, other: next.other }
      : next.dataset === "retrieval" ? { query: next.query, suggested_relevant: next.relevant }
      : { scenario_id: next.scenario_id, branch: next.branch, turns: next.turns },
    suggested: next.dataset === "semantic" ? next.target_decision : next.dataset === "retrieval" ? next.relevant : next.expected_contract,
    remaining: allCases.filter((c) => !done.has(c.id)).length
  }, null, 2));
  process.exit(0);
}

if (args.status) {
  const files = await readdir(annotationDir).catch(() => []);
  const rows = [];
  for (const file of files.filter((f) => f.endsWith(".jsonl"))) {
    const name = file.replace(/\.jsonl$/, "");
    const annotations = await readAnnotations(name);
    rows.push({ annotator: name, annotated: annotations.length, total: allCases.length, percent: (annotations.length / allCases.length * 100).toFixed(1) + "%" });
  }
  console.log(rows.length ? JSON.stringify(rows, null, 2) : "还没有任何标注记录。");
  process.exit(0);
}

if (args.iaa) {
  const a = args.a, b = args.b;
  if (!a || !b) { console.error("需要 --a 与 --b"); process.exit(2); }
  const left = new Map((await readAnnotations(a)).map((r) => [r.id, r.label]));
  const right = new Map((await readAnnotations(b)).map((r) => [r.id, r.label]));
  const ids = [...left.keys()].filter((id) => right.has(id));
  if (!ids.length) { console.error("两位标注者没有共同条目"); process.exit(2); }
  const agree = ids.filter((id) => left.get(id) === right.get(id)).length;
  const counts = new Map();
  for (const id of ids) {
    const pair = [left.get(id), right.get(id)].sort().join("||");
    counts.set(pair, (counts.get(pair) || 0) + 1);
  }
  const observed = agree / ids.length;
  const leftCounts = new Map(), rightCounts = new Map();
  for (const id of ids) {
    leftCounts.set(left.get(id), (leftCounts.get(left.get(id)) || 0) + 1);
    rightCounts.set(right.get(id), (rightCounts.get(right.get(id)) || 0) + 1);
  }
  const expected = [...new Set([...leftCounts.keys(), ...rightCounts.keys()])]
    .reduce((sum, label) => sum + ((leftCounts.get(label) || 0) / ids.length) * ((rightCounts.get(label) || 0) / ids.length), 0);
  const kappa = expected === 1 ? null : (observed - expected) / (1 - expected);
  const report = { annotator_a: a, annotator_b: b, common: ids.length, agreement: observed, expected_agreement: expected, cohen_kappa: kappa, disagreements: ids.filter((id) => left.get(id) !== right.get(id)) };
  await mkdir(path.join(root, "quality", "reports"), { recursive: true });
  const out = path.join(root, "quality", "reports", `iaa-${a}-${b}.json`);
  await writeFile(out, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

console.log("用法见文件头注释：--export / --next / --set / --status / --iaa");
