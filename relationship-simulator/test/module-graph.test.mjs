import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const checker = fileURLToPath(new URL("../scripts/check-circular.mjs", import.meta.url));
async function fixture(t, files) {
  const prefix = path.resolve(tmpdir(), "heartflow-module-graph-");
  const dir = await mkdtemp(prefix);
  t.after(async () => {
    assert.ok(path.resolve(dir).startsWith(prefix) && path.dirname(dir) === path.resolve(tmpdir()));
    await rm(dir, { recursive: true, force: true });
  });
  for (const [name, source] of Object.entries(files)) await writeFile(path.join(dir, name), source);
  return path.join(dir, "a.mjs");
}

test("依赖检查覆盖 re-export 和字面量动态 import 中的环", async (t) => {
  const entry = await fixture(t, {
    "a.mjs": 'export { value } from "./b.mjs";',
    "b.mjs": 'export const value = () => import("./a.mjs");'
  });
  const result = spawnSync(process.execPath, [checker, entry], { encoding: "utf8" });
  assert.equal(result.status, 1, result.stdout + result.stderr);
});

test("缺失依赖或入口导致非零退出，不会误报无循环依赖即通过", async (t) => {
  const entry = await fixture(t, { "a.mjs": 'import "./missing.mjs";' });
  for (const target of [entry, path.join(path.dirname(entry), "missing-entry.mjs")]) {
    const result = spawnSync(process.execPath, [checker, target], { encoding: "utf8" });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /\[error\]/);
  }
});

test("正常模块图和注释里的示例不会触发错误", async (t) => {
  const entry = await fixture(t, {
    "a.mjs": '/* import("./fake.mjs") */\n// import "./other.mjs";\nexport { value } from "./b.mjs";',
    "b.mjs": 'export const value = 1;'
  });
  const result = spawnSync(process.execPath, [checker, entry], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
