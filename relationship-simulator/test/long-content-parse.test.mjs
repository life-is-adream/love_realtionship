import test from "node:test";
import assert from "node:assert/strict";
import { loadAllChapters } from "../public/modules/content/long-content-loader.js";

/**
 * 长篇解析规则验证测试
 *
 * 验证构建脚本生成的长篇索引（manifest + 按章 chunk，P2-13 拆包格式）
 * 结构完整性和解析正确性。经 loader 聚合出与旧单体 longContentIndex 等价的对象，
 * 全部行为断言保持不变。
 */

// 聚合全部章 chunk（等价于迁移前的 longContentIndex.chapters）
const chapters = await loadAllChapters();
const longContentIndex = {
  generatedAt: "aggregated",
  totalChapters: chapters.length,
  chapters
};

// ── 索引整体结构 ──────────────────────────────────────────────────────────────

test("索引包含 10 章", () => {
  assert.equal(longContentIndex.totalChapters, 10);
  assert.equal(longContentIndex.chapters.length, 10);
});

test("每章包含必要字段", () => {
  for (const chapter of longContentIndex.chapters) {
    assert.ok(typeof chapter.id === "number", `chapter ${chapter.id} id missing`);
    assert.ok(typeof chapter.title === "string" && chapter.title.length > 0, `chapter ${chapter.id} title missing`);
    assert.ok(typeof chapter.file === "string" && chapter.file.length > 0, `chapter ${chapter.id} file missing`);
    assert.ok(typeof chapter.summary === "string", `chapter ${chapter.id} summary missing`);
    assert.ok(Array.isArray(chapter.sections), `chapter ${chapter.id} sections not array`);
    assert.ok(Array.isArray(chapter.reviewPoints), `chapter ${chapter.id} reviewPoints not array`);
  }
});

test("章节 ID 从 1 到 10 连续", () => {
  const ids = longContentIndex.chapters.map((c) => c.id);
  assert.deepEqual(ids, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

// ── 第1章复盘点验证 ───────────────────────────────────────────────────────────

test("第1章有复盘点（≥5）", () => {
  const chapter1 = longContentIndex.chapters.find((c) => c.id === 1);
  assert.ok(chapter1, "第1章未找到");
  assert.ok(chapter1.reviewPoints.length >= 5, `expected ≥5 review points, got ${chapter1.reviewPoints.length}`);
});

test("第1章第1个复盘包含四要素或 note", () => {
  const chapter1 = longContentIndex.chapters.find((c) => c.id === 1);
  const rp = chapter1.reviewPoints[0];
  assert.ok(rp, "第1章第1个复盘未找到");
  assert.ok(rp.id, "复盘 id 缺失");
  assert.ok(rp.title, "复盘 title 缺失");

  // 第1章第1个复盘（恋爱大师复盘 1）有标准四要素
  const hasFourElements = rp.intent || rp.benefit || rp.risk || rp.correction;
  const hasNote = rp.note && rp.note.length > 0;
  assert.ok(hasFourElements || hasNote, "复盘既无四要素也无 note");
});

test("第1章第1个复盘的意图包含'共同记忆'", () => {
  const chapter1 = longContentIndex.chapters.find((c) => c.id === 1);
  const rp = chapter1.reviewPoints[0];
  if (rp.intent) {
    assert.match(rp.intent, /共同记忆/);
  }
});

test("第1章复盘包含 originalMaleReply", () => {
  const chapter1 = longContentIndex.chapters.find((c) => c.id === 1);
  const rp = chapter1.reviewPoints[0];
  // 至少有一些复盘包含 originalMaleReply
  const withMaleReply = chapter1.reviewPoints.filter((r) => r.originalMaleReply);
  assert.ok(withMaleReply.length > 0, "没有任何复盘包含 originalMaleReply");
});

// ── 所有章复盘点验证 ──────────────────────────────────────────────────────────

test("所有章都有复盘点（≥1）", () => {
  for (const chapter of longContentIndex.chapters) {
    assert.ok(
      chapter.reviewPoints.length >= 1,
      `第${chapter.id}章没有复盘点`
    );
  }
});

test("所有复盘点都有 id 和 title", () => {
  for (const chapter of longContentIndex.chapters) {
    for (const rp of chapter.reviewPoints) {
      assert.ok(rp.id, `第${chapter.id}章有复盘缺少 id`);
      assert.ok(rp.title, `第${chapter.id}章有复盘缺少 title`);
    }
  }
});

test("所有复盘点都有可检索字段且摘录有界", () => {
  for (const chapter of longContentIndex.chapters) {
    for (const rp of chapter.reviewPoints) {
      assert.equal(typeof rp.searchText, "string", `${chapter.id}/${rp.id} searchText missing`);
      assert.ok(Array.isArray(rp.searchTerms), `${chapter.id}/${rp.id} searchTerms missing`);
      assert.ok(Array.isArray(rp.tags) && rp.tags.includes("复盘"), `${chapter.id}/${rp.id} tags missing`);
      assert.ok(typeof rp.searchExcerpt === "string" && rp.searchExcerpt.length <= 360, `${chapter.id}/${rp.id} excerpt too long`);
    }
  }
});

test("所有复盘点都有内容（四要素或 note）", () => {
  for (const chapter of longContentIndex.chapters) {
    for (const rp of chapter.reviewPoints) {
      const hasContent = rp.intent || rp.benefit || rp.risk || rp.correction || rp.note;
      assert.ok(hasContent, `第${chapter.id}章复盘 ${rp.id} 无任何内容`);
    }
  }
});

// ── 小节验证 ──────────────────────────────────────────────────────────────────

test("第1章有小节", () => {
  const chapter1 = longContentIndex.chapters.find((c) => c.id === 1);
  assert.ok(chapter1.sections.length > 0, "第1章没有小节");
});

test("小节包含 id/title/lineStart/lineEnd", () => {
  const chapter1 = longContentIndex.chapters.find((c) => c.id === 1);
  for (const section of chapter1.sections) {
    assert.ok(section.id, "小节缺少 id");
    assert.ok(section.title, "小节缺少 title");
    assert.ok(typeof section.lineStart === "number", "小节缺少 lineStart");
    assert.ok(typeof section.lineEnd === "number", "小节缺少 lineEnd");
  }
});

// ── stages.js 共享常量验证 ────────────────────────────────────────────────────

test("stages.js 的 STAGE_VALUES 与 index.html option 值一致", async () => {
  const { STAGE_VALUES, isValidStage } = await import("../public/modules/core/stages.js");
  const expected = [
    "刚加微信后的第一晚",
    "隔天轻联系",
    "第一次邀约",
    "第一次约会后",
    "暧昧推进",
    "表达好感",
    "确定关系"
  ];
  assert.deepEqual(STAGE_VALUES, expected);
  assert.ok(isValidStage("暧昧推进"));
  assert.ok(!isValidStage("不存在的阶段"));
});
