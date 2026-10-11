// 检索等价性验证（B2 烟雾）：旧单体索引 vs 拆包 chunk 聚合，对比 searchTextbook top 结果。
// 运行：node production/polish/b2-search-parity.mjs（验证后可删）
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(import.meta.dirname, "..", "..");

// 旧产物在 TEMP，无法用相对 import；复制到临时位置并在同目录造一个转接模块。
const tempDir = os.tmpdir();
const oldIndexPath = path.join(tempDir, "long-content-index-old.js");
const oldModule = await import(pathToFileURL(oldIndexPath).href);
const oldIndex = oldModule.longContentIndex;

const { loadAllChapters } = await import(pathToFileURL(path.join(projectRoot, "public", "modules", "content", "long-content-loader.js")).href);
const newChapters = await loadAllChapters();

const { buildTextbookSearchIndex, searchTextbook } = await import(pathToFileURL(path.join(projectRoot, "public", "modules", "content", "textbook-search.js")).href);

const oldEntries = buildTextbookSearchIndex(oldIndex);
const newEntries = buildTextbookSearchIndex({ chapters: newChapters });

console.log(`旧索引 entries: ${oldEntries.entries.length}，新聚合 entries: ${newEntries.entries.length}`);

const queries = ["邀约", "边界", "共同记忆", "连续发问", "第一次约会后怎么推进"];
let allMatch = true;
for (const q of queries) {
  const a = searchTextbook(q, oldEntries);
  const b = searchTextbook(q, newEntries);
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  const same = ja === jb;
  allMatch = allMatch && same;
  console.log(`\n查询「${q}」：top${a.length} ${same ? "一致 ✅" : "不一致 ❌"}`);
  for (const item of a) console.log(`  旧: 第${item.chapterId}章 ${item.reviewPointId} ${item.title.slice(0, 24)}`);
  if (!same) for (const item of b) console.log(`  新: 第${item.chapterId}章 ${item.reviewPointId} ${item.title.slice(0, 24)}`);
}
console.log(`\n${allMatch ? "=== 检索等价性验证通过：迁移前后 top 结果完全一致 ===" : "=== 检索结果存在差异 ❌ ==="}`);
process.exit(allMatch ? 0 : 1);
