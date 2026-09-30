import test from "node:test";
import assert from "node:assert/strict";
import { loadManifest, loadChapterIndex, loadAllChapters } from "../public/modules/content/long-content-loader.js";

/**
 * 长篇加载器测试（P2-13 拆包懒加载）
 *
 * 锁定 loader 与生成器之间的契约：chunk 命名（chapter-XX.js）、导出名（chapter）、
 * manifest 元信息与 chunk 数据一致、Promise 级缓存幂等、非法 ID 拒绝。
 */

test("manifest 包含 10 章，ID 从 1 到 10 连续", async () => {
  const manifest = await loadManifest();
  assert.equal(manifest.totalChapters, 10);
  assert.equal(manifest.chapters.length, 10);
  assert.deepEqual(manifest.chapters.map((c) => c.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(manifest.source, "scripts/build-long-index.mjs");
});

test("manifest 每章包含元信息与 chunk 映射", async () => {
  const manifest = await loadManifest();
  for (const chapter of manifest.chapters) {
    assert.ok(typeof chapter.title === "string" && chapter.title.length > 0, `第${chapter.id}章 title 缺失`);
    assert.ok(typeof chapter.file === "string" && chapter.file.length > 0, `第${chapter.id}章 file 缺失`);
    assert.ok(typeof chapter.summary === "string", `第${chapter.id}章 summary 缺失`);
    assert.ok(Number.isInteger(chapter.reviewCount) && chapter.reviewCount >= 1, `第${chapter.id}章 reviewCount 缺失`);
    assert.ok(Number.isInteger(chapter.sectionCount) && chapter.sectionCount >= 1, `第${chapter.id}章 sectionCount 缺失`);
    assert.equal(chapter.chunk, `long-content/chapter-${String(chapter.id).padStart(2, "0")}.js`, `第${chapter.id}章 chunk 映射与命名约定不一致`);
  }
});

test("loadManifest 缓存幂等（同一 manifest 对象）", async () => {
  const first = await loadManifest();
  const second = await loadManifest();
  assert.equal(first, second);
});

test("每个 chunk 可独立加载且 id 与文件名一致", async () => {
  for (let id = 1; id <= 10; id += 1) {
    const chapter = await loadChapterIndex(id);
    assert.equal(chapter.id, id, `chunk chapter-${String(id).padStart(2, "0")}.js 导出的 chapter.id 不匹配`);
    assert.ok(Array.isArray(chapter.sections), `第${id}章 sections 缺失`);
    assert.ok(Array.isArray(chapter.reviewPoints) && chapter.reviewPoints.length >= 1, `第${id}章 reviewPoints 缺失`);
  }
});

test("manifest 的 reviewCount/sectionCount 与 chunk 数据一致", async () => {
  const manifest = await loadManifest();
  for (const meta of manifest.chapters) {
    const chapter = await loadChapterIndex(meta.id);
    assert.equal(meta.reviewCount, chapter.reviewPoints.length, `第${meta.id}章 reviewCount 不一致`);
    assert.equal(meta.sectionCount, chapter.sections.length, `第${meta.id}章 sectionCount 不一致`);
    assert.equal(meta.title, chapter.title, `第${meta.id}章 title 不一致`);
  }
});

test("loadChapterIndex 缓存幂等（同一 chapter 对象）", async () => {
  const first = await loadChapterIndex(3);
  const second = await loadChapterIndex(3);
  const byString = await loadChapterIndex("03");
  assert.equal(first, second);
  assert.equal(first, byString);
});

test("loadAllChapters 聚合出与旧单体索引等价的 10 章", async () => {
  const chapters = await loadAllChapters();
  assert.equal(chapters.length, 10);
  assert.deepEqual(chapters.map((c) => c.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const totalReviews = chapters.reduce((n, c) => n + c.reviewPoints.length, 0);
  assert.equal(totalReviews, 123);
});

test("非法章节 ID 被拒绝", async () => {
  await assert.rejects(() => loadChapterIndex(0));
  await assert.rejects(() => loadChapterIndex(-1));
  await assert.rejects(() => loadChapterIndex("abc"));
  await assert.rejects(() => loadChapterIndex(null));
  await assert.rejects(() => loadChapterIndex(11));
});
