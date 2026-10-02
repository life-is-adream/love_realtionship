// F2 失误模式雷达：聚合规则 + 阈值边界 + 重写对比纯函数用例。
import test from "node:test";
import assert from "node:assert/strict";

import {
  MISTAKE_DIM_LABELS,
  MISTAKE_PATTERN_RULES,
  findWeakestDim,
  aggregateMistakePatterns,
  buildRewriteComparison
} from "../public/modules/training/mistake-patterns.js";
import { createMistake } from "../public/modules/core/mistakes.js";

function mistake(overrides = {}) {
  return createMistake({ source: "coach", text: `m-${Math.random()}`, ...overrides });
}

// ── findWeakestDim ───────────────────────────────────────────────────────────

test("findWeakestDim：取有分数维度中的最小值，null 维度不参与", () => {
  assert.deepEqual(findWeakestDim({ naturalness: 60, empathy: 42, boundary: null, drive: 70 }), { key: "empathy", value: 42 });
  assert.deepEqual(findWeakestDim({ naturalness: null, empathy: null, boundary: null, drive: null }), null);
  assert.equal(findWeakestDim(null), null);
  assert.equal(findWeakestDim({}), null);
});

// ── aggregateMistakePatterns：基础聚合 ───────────────────────────────────────

test("aggregateMistakePatterns：空列表返回零值且无洞察", () => {
  const result = aggregateMistakePatterns([]);
  assert.equal(result.total, 0);
  assert.equal(result.unresolvedCount, 0);
  assert.equal(result.weakestDim, null);
  assert.deepEqual(result.dimCounts, { naturalness: 0, empathy: 0, boundary: 0, drive: 0 });
  assert.deepEqual(result.sourceCounts, { preflight: 0, coach: 0, manual: 0 });
  assert.deepEqual(result.topIssues, []);
  assert.equal(result.resolvedRatio, null);
  assert.deepEqual(result.insights, []);
});

test("aggregateMistakePatterns：dimCounts 只统计未解决错题的最弱维度", () => {
  const list = [
    mistake({ resolved: false, dims: { naturalness: 90, empathy: 40, boundary: 70, drive: 60 } }), // empathy
    mistake({ resolved: false, dims: { naturalness: 90, empathy: 41, boundary: 70, drive: 60 } }), // empathy
    mistake({ resolved: true, dims: { naturalness: 90, empathy: 40, boundary: 70, drive: 60 } }),  // 已解决不计
    mistake({ resolved: false, dims: { naturalness: 30, empathy: 80, boundary: 70, drive: 60 } })  // naturalness
  ];
  const result = aggregateMistakePatterns(list);
  assert.equal(result.unresolvedCount, 3);
  assert.deepEqual(result.dimCounts, { naturalness: 1, empathy: 2, boundary: 0, drive: 0 });
  assert.equal(result.weakestDim, "empathy");
});

test("aggregateMistakePatterns：sourceCounts 统计全量，resolvedRatio 为已解决比例", () => {
  const list = [
    mistake({ source: "preflight" }),
    mistake({ source: "preflight" }),
    mistake({ source: "coach", resolved: true }),
    mistake({ source: "manual" })
  ];
  const result = aggregateMistakePatterns(list);
  assert.deepEqual(result.sourceCounts, { preflight: 2, coach: 1, manual: 1 });
  assert.equal(result.total, 4);
  assert.ok(Math.abs(result.resolvedRatio - 0.25) < 1e-9);
});

test("aggregateMistakePatterns：topIssues 按次数降序，最多 5 个", () => {
  const list = [
    mistake({ issues: ["施压词"] }),
    mistake({ issues: ["施压词"] }),
    mistake({ issues: ["施压词", "越界词"] }),
    mistake({ issues: ["越界词"] }),
    mistake({ issues: ["共情短板"] }),
    mistake({ issues: ["共情短板"] }),
    mistake({ issues: ["边界感短板"] }),
    mistake({ issues: ["自然度短板"] }),
    mistake({ issues: ["推进力短板"] }),
    mistake({ issues: ["推进力短板"] })
  ];
  const result = aggregateMistakePatterns(list);
  assert.equal(result.topIssues.length, MISTAKE_PATTERN_RULES.topIssuesLimit);
  assert.equal(result.topIssues[0].label, "施压词");
  assert.equal(result.topIssues[0].count, 3);
  // 次数并列时按标签字典序稳定排序
  const counts = result.topIssues.map((item) => item.count);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a), "次数应降序");
});

// ── 洞察规则阈值边界 ─────────────────────────────────────────────────────────

test("洞察规则①：单一未解决维度占比 ≥40% 且 ≥3 条 → 触发针对性练习建议", () => {
  // 3/5 = 60% ≥ 40% 且 count=3 ≥ 3 → 触发
  const list = [1, 2, 3].map(() => mistake({ dims: { naturalness: 90, empathy: 40, boundary: 70, drive: 60 } }))
    .concat([mistake({ dims: { naturalness: 40, empathy: 90, boundary: 70, drive: 60 } }), mistake({ dims: { naturalness: 90, empathy: 80, boundary: 30, drive: 60 } })]);
  const result = aggregateMistakePatterns(list);
  assert.ok(result.insights.some((line) => line.includes("共情")), `应点名共情：${JSON.stringify(result.insights)}`);
});

test("洞察规则①边界：占比 40% 整恰好触发（5 条中 2 条不触发，6 条中 2.4 不适用）", () => {
  // 恰好 40%：5 条中的 2 条 = 40% —— 但 count=2 < 3 不触发；验证 count 与占比双门槛
  const twoOfFive = [
    mistake({ dims: { naturalness: 90, empathy: 40, boundary: 70, drive: 60 } }),
    mistake({ dims: { naturalness: 90, empathy: 40, boundary: 70, drive: 60 } }),
    mistake({ dims: { naturalness: 40, empathy: 90, boundary: 70, drive: 60 } }),
    mistake({ dims: { naturalness: 90, empathy: 80, boundary: 30, drive: 60 } }),
    mistake({ dims: { naturalness: 90, empathy: 80, boundary: 70, drive: 30 } })
  ];
  assert.deepEqual(aggregateMistakePatterns(twoOfFive).insights, [], "count=2 未达 3 条不应点名");
  // 8 条中 3 条 = 37.5% < 40% → 不触发（其余维度的最弱计数同样分散在阈值之下）
  const threeOfEight = [1, 2, 3].map(() => mistake({ dims: { naturalness: 90, empathy: 40, boundary: 70, drive: 60 } }))
    .concat([
      mistake({ dims: { naturalness: 90, empathy: 80, boundary: 30, drive: 60 } }),
      mistake({ dims: { naturalness: 90, empathy: 80, boundary: 30, drive: 60 } }),
      mistake({ dims: { naturalness: 90, empathy: 80, boundary: 70, drive: 30 } }),
      mistake({ dims: { naturalness: 90, empathy: 80, boundary: 70, drive: 30 } }),
      mistake({ dims: { naturalness: 30, empathy: 80, boundary: 70, drive: 60 } })
    ]);
  assert.deepEqual(aggregateMistakePatterns(threeOfEight).insights, [], "37.5% 低于 40% 不应点名");
});

test("洞察规则②：同一 preflight 标签 ≥3 次 → 点名模式；coach 标签不参与点名", () => {
  const list = [
    mistake({ source: "preflight", issues: ["越界词"] }),
    mistake({ source: "preflight", issues: ["越界词"] }),
    mistake({ source: "preflight", issues: ["越界词"] }),
    mistake({ source: "coach", issues: ["共情短板"] }),
    mistake({ source: "coach", issues: ["共情短板"] }),
    mistake({ source: "coach", issues: ["共情短板"] })
  ];
  const result = aggregateMistakePatterns(list);
  assert.ok(result.insights.some((line) => line.includes("越界词")), "preflight 标签 ≥3 应点名");
  assert.ok(!result.insights.some((line) => line.includes("共情短板")), "coach 标签不参与点名规则②");
});

test("洞察规则②边界：preflight 标签恰好 2 次不点名", () => {
  const list = [
    mistake({ source: "preflight", issues: ["施压词"] }),
    mistake({ source: "preflight", issues: ["施压词"] })
  ];
  assert.deepEqual(aggregateMistakePatterns(list).insights, []);
});

test("自定义规则阈值可覆盖默认值", () => {
  const list = [
    mistake({ dims: { naturalness: 90, empathy: 40, boundary: 70, drive: 60 } }),
    mistake({ dims: { naturalness: 90, empathy: 40, boundary: 70, drive: 60 } })
  ];
  const strict = aggregateMistakePatterns(list, { ...MISTAKE_PATTERN_RULES, dimMinCount: 2, dimShare: 0.9 });
  assert.ok(strict.insights.length > 0, "2/2=100% ≥ 90% 且 count=2 ≥ 2 → 触发");
});

// ── buildRewriteComparison（重写对比纯函数）─────────────────────────────────

test("buildRewriteComparison：各维均不低于原值且无高危 → canResolve=true", () => {
  const original = { naturalness: 40, empathy: 55, boundary: 30, drive: 60 };
  const rewrite = { naturalness: 41, empathy: 55, boundary: 45, momentum: 60 }; // 教练键名 momentum
  const result = buildRewriteComparison(original, rewrite, { level: "low", warning: "" });
  assert.equal(result.allDimsImproved, true);
  assert.equal(result.hasHighRisk, false);
  assert.equal(result.canResolve, true);
  assert.deepEqual(result.dims.map((d) => d.delta), [1, 0, 15, 0]);
});

test("buildRewriteComparison：任一维低于原值 → canResolve=false", () => {
  const original = { naturalness: 40, empathy: 55, boundary: 30, drive: 60 };
  const rewrite = { naturalness: 41, empathy: 54, boundary: 45, drive: 60 };
  const result = buildRewriteComparison(original, rewrite, { level: "low", warning: "" });
  assert.equal(result.allDimsImproved, false);
  assert.equal(result.canResolve, false);
});

test("buildRewriteComparison：高危警告一票否决（即使分数全面上升）", () => {
  const original = { naturalness: 40, empathy: 55, boundary: 30, drive: 60 };
  const rewrite = { naturalness: 80, empathy: 80, boundary: 80, drive: 80 };
  const result = buildRewriteComparison(original, rewrite, { level: "high", warning: "有明显越界词" });
  assert.equal(result.hasHighRisk, true);
  assert.equal(result.canResolve, false);
  assert.equal(result.riskLevel, "high");
});

test("buildRewriteComparison：null 维度不参与比较；重写无分数时不可解决", () => {
  const original = { naturalness: 40, empathy: null, boundary: 30, drive: 60 };
  const rewrite = { naturalness: 40, empathy: 70, boundary: 35, drive: null };
  const result = buildRewriteComparison(original, rewrite, { level: "low", warning: "" });
  const empathyDim = result.dims.find((d) => d.key === "empathy");
  const driveDim = result.dims.find((d) => d.key === "drive");
  assert.equal(empathyDim.before, null);
  assert.equal(empathyDim.delta, null);
  assert.equal(driveDim.after, null);
  assert.equal(result.canResolve, true, "有分数维度均不低于原值即可");
  const empty = buildRewriteComparison(original, {}, { level: "low", warning: "" });
  assert.equal(empty.canResolve, false, "重写无任何分数时不可标记解决");
});

test("buildRewriteComparison：drive 维度对应教练引擎 momentum 键", () => {
  const result = buildRewriteComparison(
    { naturalness: 50, empathy: 50, boundary: 50, drive: 50 },
    { naturalness: 60, empathy: 60, boundary: 60, momentum: 60 },
    { level: "low", warning: "" }
  );
  const driveDim = result.dims.find((d) => d.key === "drive");
  assert.equal(driveDim.after, 60, "momentum 分数应映射到 drive 维度");
  assert.equal(driveDim.delta, 10);
});

test("MISTAKE_DIM_LABELS 契约：drive 中文标签为推进力", () => {
  assert.equal(MISTAKE_DIM_LABELS.drive, "推进力");
  assert.equal(MISTAKE_DIM_LABELS.naturalness, "自然度");
  assert.equal(MISTAKE_DIM_LABELS.empathy, "共情");
  assert.equal(MISTAKE_DIM_LABELS.boundary, "边界感");
});
