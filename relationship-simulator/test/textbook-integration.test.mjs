import test from "node:test";
import assert from "node:assert/strict";
import { buildTextbookSearchIndex, buildCoachTextbookEvidence } from "../public/modules/content/textbook-search.js";
import { loadAllChapters } from "../public/modules/content/long-content-loader.js";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

// 聚合全部章 chunk（等价于迁移前的 longContentIndex）
const longContentIndex = { chapters: await loadAllChapters() };

test("coach evidence points to a real chapter and review point", () => {
  const index = buildTextbookSearchIndex(longContentIndex);
  const evidence = buildCoachTextbookEvidence({ suggestions: [{ title: "邀约被拒后留出空间", dimension: "boundaries" }], risk: "避免连续追问" }, index);
  if (evidence.primary) {
    assert.ok(longContentIndex.chapters.some((chapter) => String(chapter.id) === String(evidence.primary.chapterId)));
    assert.ok(evidence.primary.reviewPointId);
  } else {
    assert.match(evidence.message, /暂未找到|关键词/);
  }
});

test("reader jump uses both chapter and review point and does not guess a different chapter", () => {
  assert.match(appSource, /function openLongReader\(chapterId = null, reviewPointId = null\)/);
  assert.match(appSource, /data-review-id/);
  assert.match(appSource, /loadChapter\(chapterId, pendingReviewPointId\)/);
  assert.match(appSource, /reviewPointId/);
});

test("textbook card has an honest empty-result fallback", () => {
  assert.match(appSource, /暂未找到直接对应内容/);
  assert.match(appSource, /打开复盘点/);
});
