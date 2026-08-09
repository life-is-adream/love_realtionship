// 零依赖循环依赖检测：解析 ES Module 的 import 语句，DFS 判环。
// 用法：node scripts/check-circular.mjs [入口1 入口2 ...]
//   默认扫描 public/app.js 与 server/index.js 两个装配入口的整张导入图。
// 退出码：0 = 无环；1 = 发现环（并打印环路径）。
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const DEFAULT_ENTRIES = [
  path.join(ROOT, "public", "app.js"),
  path.join(ROOT, "server", "index.js")
];

const entries = process.argv.slice(2).length
  ? process.argv.slice(2).map((p) => path.resolve(p))
  : DEFAULT_ENTRIES;

// 用 .js 相对/绝对 import 解析为磁盘路径
function resolveImport(fromFile, spec) {
  if (!spec.startsWith(".")) return null; // 跳过 node: / 裸包（本轮零依赖，可忽略）
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, base + ".js", path.join(base, "index.js")];
  return candidates.find((c) => existsSync(c)) || base + ".js";
}

function parseImports(file) {
  const text = readFileSync(file, "utf8");
  const specs = [];
  const re = /(?:import\s+[^'"]*?\s+from\s+|import\s+)(['"])(.+?)\1/g;
  let m;
  while ((m = re.exec(text))) specs.push(m[2]);
  return specs;
}

// 构建有向图：module -> [dep module]
const graph = new Map();
const visited = new Set();

function walk(file) {
  const abs = path.resolve(file);
  if (visited.has(abs)) return;
  visited.add(abs);
  graph.set(abs, []);
  let specs = [];
  try {
    specs = parseImports(abs);
  } catch {
    return; // 语法解析失败交由 node --check 兜底，这里跳过
  }
  for (const spec of specs) {
    const dep = resolveImport(abs, spec);
    if (!dep) continue;
    graph.get(abs).push(dep);
    walk(dep);
  }
}

for (const e of entries) {
  if (existsSync(e)) walk(e);
  else console.warn(`[warn] 入口不存在，跳过: ${e}`);
}

// DFS 判环
const WHITE = 0, GRAY = 1, BLACK = 2;
const color = new Map();
const stack = [];
let cycles = [];

for (const node of graph.keys()) color.set(node, WHITE);

function dfs(node) {
  color.set(node, GRAY);
  stack.push(node);
  for (const nxt of graph.get(node) || []) {
    if (!graph.has(nxt)) continue;
    const c = color.get(nxt);
    if (c === GRAY) {
      const idx = stack.indexOf(nxt);
      cycles.push(stack.slice(idx).concat(nxt));
    } else if (c === WHITE) {
      dfs(nxt);
    }
  }
  stack.pop();
  color.set(node, BLACK);
}

for (const node of graph.keys()) if (color.get(node) === WHITE) dfs(node);

const rel = (p) => path.relative(ROOT, p);
console.log(`扫描模块数: ${graph.size}`);
if (cycles.length === 0) {
  console.log("circular: 0 ✅ 无循环依赖");
  process.exit(0);
} else {
  console.error("circular: 发现循环依赖 ❌");
  for (const cyc of cycles) console.error("  环: " + cyc.map(rel).join(" -> "));
  process.exit(1);
}
