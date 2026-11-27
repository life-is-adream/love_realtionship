// 冻结 test 数据集哈希。冻结后任何 test 改动都会让评测门禁失败。
import { readFile, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const files = ["quality/datasets/semantic/test.json", "quality/datasets/retrieval/test.json", "quality/datasets/practice/test.json"];
const entries = {};
for (const file of files) {
  const buffer = await readFile(path.join(root, file));
  const info = await stat(path.join(root, file));
  entries[file] = { sha256: createHash("sha256").update(buffer).digest("hex"), bytes: info.size };
}
let commit = "";
try { commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch {}
const out = { frozen_at: new Date().toISOString(), git_commit: commit, note: "test 集冻结；改动必须提升 dataset_version 并重跑基线。", files: entries };
await writeFile(path.join(root, "quality", "datasets", "FREEZE.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
console.log("frozen", Object.keys(entries).length, "test files");
