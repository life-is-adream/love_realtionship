import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname);
const lines = (await readFile(path.join(root, "cases.jsonl"), "utf8")).trim().split(/\r?\n/).filter(Boolean);
const cases = lines.map((line, index) => {
  try { return JSON.parse(line); } catch { return { eval_id: `line_${index + 1}`, parseError: true }; }
});
const requiredCategories = ["stage", "signals", "chat", "invitation", "conflict", "breakup", "safety", "compatibility", "counterfactual", "prompt-injection", "personalization", "epistemic"];
const failures = [];
const counts = Object.fromEntries(requiredCategories.map((category) => [category, 0]));
const phone = /(?:\+?\d[\d -]{8,}\d)/;
const email = /[^\s@]+@[^\s@]+\.[^\s@]+/;

for (const item of cases) {
  if (item.parseError) { failures.push(`${item.eval_id}: invalid JSON`); continue; }
  counts[item.category] = (counts[item.category] || 0) + 1;
  for (const key of ["eval_id", "category", "prompt", "expected", "privacy"]) {
    if (!(key in item)) failures.push(`${item.eval_id || "unknown"}: missing ${key}`);
  }
  if (!/^eval_\d{3}$/.test(item.eval_id || "")) failures.push(`${item.eval_id}: invalid id`);
  if (!requiredCategories.includes(item.category)) failures.push(`${item.eval_id}: unknown category`);
  if (item.privacy?.anonymized !== true) failures.push(`${item.eval_id}: not anonymized`);
  if (!item.expected || !Array.isArray(item.expected.must_include) || !Array.isArray(item.expected.must_not_include)) failures.push(`${item.eval_id}: invalid expected contract`);
  if (phone.test(item.prompt) || email.test(item.prompt)) failures.push(`${item.eval_id}: possible contact data`);
  if (item.category === "safety" && item.expected.decision !== "EXIT") failures.push(`${item.eval_id}: safety must EXIT`);
  if (item.category === "personalization" && item.expected.must_not_include.includes("武汉") === false) failures.push(`${item.eval_id}: missing leakage guard`);
}

for (const category of requiredCategories) {
  if (!counts[category]) failures.push(`missing category: ${category}`);
}
if (cases.length < 150) failures.push(`case count ${cases.length} < 150`);

const result = {
  generatedAt: new Date().toISOString(),
  cases: cases.length,
  categoryCounts: counts,
  failures,
  status: failures.length === 0 ? "PASS" : "FAIL",
  note: "Deterministic dataset/schema contract validation only; no LLM benchmark score is fabricated."
};
await writeFile(path.join(root, "results", "static-validation.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
