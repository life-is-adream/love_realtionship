// 数据集结构与泄漏校验（零依赖）。退出码非 0 即门禁失败。
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = async (p) => JSON.parse(await readFile(path.join(root, p), "utf8"));
const errors = [];
const fail = (msg) => errors.push(msg);
const labels = new Set(["EXIT", "DE_ESCALATE", "OBSERVE", "ADVANCE", "MAINTAIN", "ABSTAIN"]);

const manifest = await read("public/love-learning/manifest.json");
const courseIds = new Set(manifest.courses.map((c) => Number(c.no)));
const courseFiles = new Set(await readdir(path.join(root, "public", "love-learning", "courses")));
for (const no of [1, 66, 179]) if (!courseFiles.has(String(no).padStart(3, "0") + ".md")) fail(`课程文件缺失: ${no}`);

const semantic = { dev: await read("quality/datasets/semantic/dev.json"), test: await read("quality/datasets/semantic/test.json") };
const retrieval = { dev: await read("quality/datasets/retrieval/dev.json"), test: await read("quality/datasets/retrieval/test.json") };
const practice = { dev: await read("quality/datasets/practice/dev.json"), test: await read("quality/datasets/practice/test.json") };
const scenarios = new Set(["first-meeting", "low-energy-reply", "low-pressure-invitation", "conflict-repair", "breakup-recovery"]);
const contracts = JSON.parse(await readFile(path.join(root, "quality", "scenarios", "contracts-2.1.json"), "utf8"));
if (contracts.rubric_version !== "2.1.0") fail("场景合同 rubric_version 必须为 2.1.0");
if (contracts.contract_version !== "scenario-contract-2.1.0") fail("场景合同版本错误");
const contractIds = new Set(contracts.scenarios.map((item) => item.id));
for (const id of scenarios) if (!contractIds.has(id)) fail(`场景合同缺少 ${id}`);
for (const item of contracts.scenarios) {
  if (!item.version || !Array.isArray(item.branches) || !item.branches.length) fail(`场景合同字段缺失 ${item.id}`);
  if (!item.allowed_state || !Array.isArray(item.allowed_state.tension) || !Array.isArray(item.allowed_state.repair)) fail(`场景状态范围缺失 ${item.id}`);
  if (!Array.isArray(item.termination_rules) || !item.termination_rules.length) fail(`场景终止规则缺失 ${item.id}`);
}
try {
  const index = JSON.parse(await readFile(path.join(root, "public", "love-learning", "semantic-index", "index.json"), "utf8"));
  if (index.courses !== 179) fail(`课程索引应为 179 门，实际 ${index.courses}`);
  if (!index.chunks || index.chunks < 179) fail("课程索引分块异常");
} catch { fail("缺少 public/love-learning/semantic-index/index.json，请运行 npm run quality:index"); }
const groups = { semantic: {}, retrieval: {}, practice: {} };
const texts = { semantic: {}, retrieval: {}, practice: {} };

function checkIds(kind, split, cases, pattern) {
  const seen = new Set();
  for (const item of cases) {
    if (!pattern.test(item.id)) fail(`${kind}/${split}: 非法 ID ${item.id}`);
    if (seen.has(item.id)) fail(`${kind}/${split}: 重复 ID ${item.id}`);
    seen.add(item.id);
    groups[kind][item.id] = item.group;
  }
}

for (const split of ["dev", "test"]) {
  const { cases } = semantic[split];
  if (cases.length < 50) fail(`semantic/${split}: 样本过少 (${cases.length})`);
  checkIds("semantic", split, cases, new RegExp(`^sem-${split}-\\d{3}$`));
  for (const item of cases) {
    if (!labels.has(item.target_decision)) fail(`${item.id}: 非法标签`);
    if (item.speaker !== "other") fail(`${item.id}: 本集只标 other 说话人`);
    if (!item.other.includes(item.evidence_text)) fail(`${item.id}: evidence_text 不在原文`);
    if (!Array.isArray(item.evidence_spans) || item.evidence_spans.length !== 1) fail(`${item.id}: 缺少 evidence_spans`);
    const span = item.evidence_spans?.[0];
    if (span) {
      const points = Array.from(item.other);
      if (span.unit !== "unicode_code_point") fail(`${item.id}: span 单位错误`);
      if (points.slice(span.start, span.end).join("") !== item.evidence_text) fail(`${item.id}: span 与 evidence_text 不一致`);
    }
    if (item.unsafe_to_advance !== ["EXIT", "DE_ESCALATE"].includes(item.target_decision)) fail(`${item.id}: unsafe_to_advance 与标签不一致`);
    const key = item.other.trim();
    if (texts.semantic[key]) fail(`semantic: 跨 split 重复文本 ${item.id} / ${texts.semantic[key]}`);
    texts.semantic[key] = item.id;
  }
  const ret = retrieval[split];
  checkIds("retrieval", split, ret.cases, new RegExp(`^ret-${split}-\\d{3}$`));
  for (const item of ret.cases) {
    if (!item.relevant.length) fail(`${item.id}: 缺少相关课程`);
    for (const no of item.relevant) if (!courseIds.has(no)) fail(`${item.id}: 课程不存在 ${no}`);
    if (!item.candidate_pool_checked) fail(`${item.id}: 未核验候选池`);
    if (texts.retrieval[item.query]) fail(`retrieval: 跨 split 重复 query ${item.id}`);
    texts.retrieval[item.query] = item.id;
  }
  const pra = practice[split];
  checkIds("practice", split, pra.cases, new RegExp(`^pra-${split}-\\d{3}$`));
  for (const item of pra.cases) {
    if (!scenarios.has(item.scenario_id)) fail(`${item.id}: 未知场景`);
    if (item.turns.length > 6) fail(`${item.id}: 轮次过多`);
    const e = item.expect;
    if (e.ended_by_turn < 1 || e.ended_by_turn > item.turns.length) fail(`${item.id}: ended_by_turn 越界`);
    if (e.max_tension < 0 || e.max_tension > 3) fail(`${item.id}: max_tension 越界`);
    if (!e.boundary_preserved) fail(`${item.id}: 行为合同要求边界必须保持`);
    const key = item.scenario_id + "|" + item.turns.join("|");
    if (texts.practice[key]) fail(`practice: 跨 split 重复场景 ${item.id}`);
    texts.practice[key] = item.id;
  }
}

for (const kind of ["semantic", "retrieval", "practice"]) {
  const devGroups = new Set(Object.entries(groups[kind]).filter(([, g]) => g.startsWith("dev-")).map(([, g]) => g));
  const testGroups = new Set(Object.entries(groups[kind]).filter(([, g]) => g.startsWith("test-")).map(([, g]) => g));
  for (const g of devGroups) if (testGroups.has(g)) fail(`${kind}: 跨 split 组泄漏 ${g}`);
}

if (errors.length) {
  console.error("dataset validation FAILED");
  for (const error of errors) console.error("- " + error);
  process.exit(1);
}
console.log("dataset validation PASS");
console.log(`semantic dev/test = ${semantic.dev.cases.length}/${semantic.test.cases.length}`);
console.log(`retrieval dev/test = ${retrieval.dev.cases.length}/${retrieval.test.cases.length}`);
console.log(`practice dev/test = ${practice.dev.cases.length}/${practice.test.cases.length}`);
