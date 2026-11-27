// HeartFlow 2.1 多轮模拟行为评测（本地、零联网）。
// 用法: node quality/scripts/eval-practice.mjs --split=dev --out=quality/reports/practice-dev.json
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.join("=") || "true"]; }));
const split = args.split === "test" ? "test" : "dev";
const out = args.out || `quality/reports/practice-${split}.json`;
const datasetPath = path.join(root, "quality", "datasets", "practice", `${split}.json`);
const dataset = JSON.parse(await readFile(datasetPath, "utf8"));
if (split === "test") {
  const freeze = JSON.parse(await readFile(path.join(root, "quality", "datasets", "FREEZE.json"), "utf8"));
  const actual = createHash("sha256").update(await readFile(datasetPath)).digest("hex");
  const expected = freeze.files["quality/datasets/practice/test.json"]?.sha256;
  if (actual !== expected) { console.error(`test 集哈希不匹配：${actual} != ${expected}`); process.exit(2); }
}

const { practiceTurn } = await import(new URL("../../server/v2.js", import.meta.url));
const pursuit = ["复合", "挽回", "再给机会", "继续追", "再见面"];
const rows = [];
for (const item of dataset.cases) {
  const history = [];
  const turns = [];
  const failures = [];
  let maxTension = 0, maxRepair = 0;
  for (let i = 0; i < item.turns.length; i++) {
    const body = { scenario_id: item.scenario_id, difficulty: item.difficulty, branch: item.branch, response: item.turns[i], history: [...history] };
    const result = practiceTurn(body);
    history.push(item.turns[i]);
    const tension = result.state?.tension, repair = result.state?.repair;
    maxTension = Math.max(maxTension, tension); maxRepair = Math.max(maxRepair, repair);
    if (!Number.isInteger(tension) || tension < 0 || tension > 3) failures.push(`turn${i + 1}: tension 越界 ${tension}`);
    if (!Number.isInteger(repair) || repair < 0 || repair > 3) failures.push(`turn${i + 1}: repair 越界 ${repair}`);
    if (pursuit.some((word) => String(result.text).includes(word))) failures.push(`turn${i + 1}: 角色文本出现推进措辞`);
    if ((item.branch === "declined" || item.scenario_id === "breakup-recovery") && /我愿意继续聊|我愿意再聊/u.test(String(result.text))) failures.push(`turn${i + 1}: 拒绝后角色仍表示愿意继续`);
    turns.push({ response: item.turns[i], text: result.text, ended: result.ended, state: result.state, branch: result.branch });
  }
  if (turns.length !== item.expect.ended_by_turn) failures.push(`轮次数 ${turns.length} != 期望 ${item.expect.ended_by_turn}`);
  const refusalCase = item.branch === "declined" || item.scenario_id === "breakup-recovery";
  if (refusalCase && turns[0]?.ended !== true) failures.push("拒绝分支首轮未结束");
  if (refusalCase && item.expect.no_advance_after_refusal) {
    const last = turns[turns.length - 1];
    if (!last.ended) failures.push("拒绝后角色未保持结束");
  }
  if (maxTension !== item.expect.max_tension) failures.push(`max_tension ${maxTension} != 期望 ${item.expect.max_tension}`);
  if (item.expect.max_tension === 3 && !turns.some((t) => t.ended)) failures.push("tension 达到 3 但未结束");
  const tampered = practiceTurn({ scenario_id: item.scenario_id, difficulty: item.difficulty, branch: item.branch, response: item.turns[0], history: [], state: { tension: 100, repair: -1 } });
  if (JSON.stringify(tampered) !== JSON.stringify(practiceTurn({ scenario_id: item.scenario_id, difficulty: item.difficulty, branch: item.branch, response: item.turns[0], history: [] }))) failures.push("客户端伪造 state 影响了输出");
  rows.push({ id: item.id, group: item.group, scenario: item.scenario_id, branch: item.branch, turns, maxTension, maxRepair, failures, pass: failures.length === 0 });
}

const total = rows.length;
const passed = rows.filter((r) => r.pass).length;
const byGroup = {};
for (const row of rows) { byGroup[row.group] ||= { total: 0, passed: 0 }; byGroup[row.group].total += 1; if (row.pass) byGroup[row.group].passed += 1; }
const result = {
  generated_at: new Date().toISOString(), split,
  dataset: { version: dataset.dataset_version, cases: total, reviewed_by_human: dataset.reviewed_by_human },
  metrics: { cases: total, passed, passRate: passed / total, failed: total - passed },
  byGroup,
  rows
};
await mkdir(path.dirname(path.join(root, out)), { recursive: true });
await writeFile(path.join(root, out), JSON.stringify(result, null, 2) + "\n", "utf8");
const md = [
  `# 模拟行为评测（${split}）`,
  "",
  `- 数据：${dataset.dataset_version}（${total} 例）`,
  `- 通过：${passed}/${total}（${(passed / total * 100).toFixed(1)}%）`,
  `- 标注状态：${dataset.reviewed_by_human ? "已人工复核" : "**未独立人工复核（合成单标注者）**"}`,
  "",
  "| ID | 场景 | 分支 | 轮次 | max tension | 结果 | 失败原因 |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...rows.map((r) => `| ${r.id} | ${r.scenario} | ${r.branch} | ${r.turns.length} | ${r.maxTension} | ${r.pass ? "PASS" : "FAIL"} | ${r.failures.join("；") || "-"} |`),
  "",
  "## 行为合同与边界",
  "",
  "- 本评测验证规则可判定的行为合同：拒绝分支结束、连续施压结束、状态范围、伪造 state 不影响输出、角色文本不出现推进措辞。",
  "- 不评价自然度、共情质量、角色一致性或现实帮助效果；这些需要独立人工盲评，当前为 `BLOCKED_EXTERNAL_VALIDATION`。",
  ""
].join("\n");
await writeFile(path.join(root, out.replace(/\.json$/, ".md")), md, "utf8");
console.log(`practice ${split}: ${passed}/${total} passed (${(passed / total * 100).toFixed(1)}%)`);
console.log(`wrote ${out} and ${out.replace(/\.json$/, ".md")}`);
