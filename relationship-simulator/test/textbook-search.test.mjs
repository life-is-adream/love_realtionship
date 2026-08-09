import test from "node:test";
import assert from "node:assert/strict";
import {
  bigramJaccard,
  buildCoachTextbookEvidence,
  buildTextbookCoachContext,
  buildTextbookSearchIndex,
  rankTextbookResult,
  searchTextbook
} from "../public/modules/content/textbook-search.js";

function review(id, title, text, extra = {}) {
  return {
    id,
    title,
    searchText: text,
    searchTerms: text.split(/\s+/u),
    searchExcerpt: text,
    ...extra
  };
}

function chapter(id, title, reviews) {
  return { id, title, summary: `${title}相关练习`, reviewPoints: reviews };
}

const fixtureIndex = buildTextbookSearchIndex([
  chapter("c1", "邀约与被拒", [
    review("r1", "被拒后的分寸", "邀约 被拒 留出空间 尊重边界", { tags: ["邀约", "边界"] }),
    review("r2", "连续追问后的修复", "连续追问 多条消息 道歉 修复", { tags: ["追问"] })
  ]),
  chapter("c2", "初次聊天", [
    review("r3", "开启话题", "自我介绍 兴趣 轻松聊天", { tags: ["聊天"] }),
    review("r4", "误读礼貌回应", "聊天没有回应 误读 礼貌不等于兴趣", { tags: ["误读"] })
  ]),
  chapter("c3", "疲惫与收尾", [
    review("r5", "对方很忙时", "最近很忙 先忙 留出空间", { tags: ["冷却"] })
  ])
]);

test("builds a flat, bounded index without mutating source data", () => {
  const source = [chapter("c1", "边界", [review("r1", "留出空间", "尊重边界")])];
  const snapshot = structuredClone(source);
  const index = buildTextbookSearchIndex(source);

  assert.equal(index.entries.length, 1);
  assert.equal(index.entries[0].chapterId, "c1");
  assert.equal(index.entries[0].reviewPointId, "r1");
  assert.ok(Array.isArray(index.entries[0].searchTerms));
  assert.ok(index.entries[0].searchTerms.length > 0);
  assert.ok(index.entries[0].searchText.length <= 1600);
  assert.ok(index.entries[0].searchExcerpt.length <= 360);
  assert.deepEqual(source, snapshot);
});

test("matches Chinese phrases and synonyms locally", () => {
  const results = searchTextbook("约见被拒后怎么留空间", fixtureIndex);

  assert.equal(results[0].reviewPointId, "r1");
  assert.ok(results[0].matchedTerms.includes("邀约"));
  assert.ok(results[0].matchedTerms.includes("被拒"));
  assert.ok(results[0].matchedTerms.includes("留出空间"));
  assert.match(results[0].reason, /命中：/u);
});

test("supports the representative coaching queries", () => {
  assert.equal(searchTextbook("连续追问以后怎么修复", fixtureIndex)[0].reviewPointId, "r2");
  assert.equal(searchTextbook("聊天没有回应，我是不是误读了", fixtureIndex)[0].reviewPointId, "r4");
  assert.equal(searchTextbook("如何自然推进邀约", fixtureIndex)[0].reviewPointId, "r1");
  assert.equal(searchTextbook("对方说最近很忙，怎么留出空间", fixtureIndex)[0].reviewPointId, "r5");
});

test("returns no fabricated evidence when no terms match", () => {
  assert.deepEqual(searchTextbook("完全不存在的主题", fixtureIndex), []);
  assert.deepEqual(searchTextbook("怎么", fixtureIndex), []);
});

test("uses stable source-order tie breaking and returns at most three", () => {
  const many = buildTextbookSearchIndex([
    chapter("a", "聊天", [review("a1", "聊天一", "聊天")]),
    chapter("b", "聊天", [review("b1", "聊天二", "聊天")]),
    chapter("c", "聊天", [review("c1", "聊天三", "聊天")]),
    chapter("d", "聊天", [review("d1", "聊天四", "聊天")])
  ]);
  const first = searchTextbook("聊天", many, 99);
  const second = searchTextbook("聊天", many, 99);

  assert.equal(first.length, 3);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((item) => item.reviewPointId), ["a1", "b1", "c1"]);
});

test("rankTextbookResult gives matched title and tags a deterministic boost", () => {
  const relevant = {
    title: "被拒后的分寸",
    tags: ["邀约", "边界"],
    searchText: "邀约 被拒 留出空间",
    searchExcerpt: "邀约被拒后给对方空间",
    matchedTerms: ["邀约", "被拒"]
  };
  const unrelated = {
    title: "普通聊天",
    tags: ["聊天"],
    searchText: "自我介绍 兴趣",
    searchExcerpt: "轻松聊天",
    matchedTerms: []
  };
  const terms = ["邀约", "被拒"];

  assert.ok(rankTextbookResult(relevant, terms) > rankTextbookResult(unrelated, terms));
  assert.equal(rankTextbookResult(relevant, terms), rankTextbookResult(relevant, terms));
});

test("coach evidence derives a bounded query and selects a primary result", () => {
  const rawReplay = "这是不应进入检索查询的完整聊天记录";
  const evidence = buildCoachTextbookEvidence({
    summary: "对方拒绝邀约后，需要留出空间",
    suggestions: [{ dimension: "boundaries", title: "不要连续追问，尊重边界" }],
    rawReplay
  }, fixtureIndex);

  assert.equal(evidence.primary.reviewPointId, "r1");
  assert.ok(evidence.results.length <= 3);
  assert.ok(evidence.query.length <= 720);
  assert.ok(!evidence.query.includes(rawReplay));
  assert.ok(evidence.primary.searchExcerpt.length <= 360);
});

test("coach evidence stays honest when the local index has no match", () => {
  const evidence = buildCoachTextbookEvidence({ summary: "完全不存在的主题" }, fixtureIndex);

  assert.deepEqual(evidence.results, []);
  assert.equal(evidence.primary, null);
  assert.match(evidence.message, /暂未找到|关键词/u);
});

test("coach context includes at most two bounded excerpts and never rawReplay", () => {
  const context = buildTextbookCoachContext({
    summary: "用户连续追问，对方可能需要空间".repeat(100),
    rawReplay: "不应被复制到模型上下文的原始聊天",
    results: [
      { chapterId: "c1", chapterTitle: "第一章", reviewPointId: "r1", searchExcerpt: "甲".repeat(500) },
      { chapterId: "c1", chapterTitle: "第一章", reviewPointId: "r2", searchExcerpt: "乙" },
      { chapterId: "c1", chapterTitle: "第一章", reviewPointId: "r3", searchExcerpt: "丙" }
    ]
  });

  assert.equal(context.excerpts.length, 2);
  assert.ok(context.summary.length <= 360);
  assert.ok(context.excerpts.every((item) => item.text.length <= 360));
  assert.equal(Object.prototype.hasOwnProperty.call(context, "rawReplay"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(context.excerpts[0], "rawReplay"), false);
});

// ── 语义增强（bigram 排序加分）───────────────────────────────────────────────

test("bigramJaccard 对相同文本为 1、无关文本接近 0", () => {
  assert.equal(bigramJaccard("连续追问", "连续追问"), 1);
  assert.ok(bigramJaccard("完全不存在的主题", "邀约被拒留出空间") < 0.2);
  assert.equal(bigramJaccard("", "abc"), 0);
});

test("bigram 加分不改变召回集：字面不中仍为空（诚实契约不破）", () => {
  // 中文同义改写必然换字，bigram 相似度通常低于召回阈值；召回仍由关键词/同义词组决定。
  // 注意：含"忙"等词的查询会命中同义词组（这是语义召回的正确行为），此处用无关查询验证空态。
  assert.deepEqual(searchTextbook("量子力学与黑洞物理", fixtureIndex), []);
  assert.deepEqual(searchTextbook("股票行情与宏观经济", fixtureIndex), []);
});

test("bigram 加分让关键词命中相近的条目按语义相关度拉开差距", () => {
  const index = buildTextbookSearchIndex([
    chapter("s1", "冷却处理", [
      review("s1-r1", "最近很忙时的处理", "最近很忙 先忙自己的事 留出空间", { tags: ["冷却"] }),
      review("s1-r2", "追问后的修复", "连续追问 多条消息 道歉 修复", { tags: ["追问"] })
    ])
  ]);
  const results = searchTextbook("她最近很忙 没空理我", index, 3);
  assert.ok(results.length > 0);
  // 两个候选都因"最近很忙"命中；r1 的 searchText 与查询 bigram 更接近，应排更前。
  assert.equal(results[0].reviewPointId, "s1-r1");
});

test("语义加分不反转既有关键词排序（r1 仍居首）", () => {
  const results = searchTextbook("约见被拒后怎么留空间", fixtureIndex);
  assert.equal(results[0].reviewPointId, "r1");
});
