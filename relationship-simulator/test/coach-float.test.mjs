import test from "node:test";
import assert from "node:assert/strict";
import { buildCoachFloatData, buildCoachFloatHtml } from "../public/modules/render/coach-float.js";

test("buildCoachFloatData 无分析时返回 null", () => {
  assert.equal(buildCoachFloatData(null), null);
  assert.equal(buildCoachFloatData({}), null);
  assert.equal(buildCoachFloatData({ coachScore: null }), null);
});

test("buildCoachFloatData 提取总分、短板与 A/B/C", () => {
  const data = buildCoachFloatData({
    coachScore: { total: 76, weakestDim: "boundary", summary: "边界感略弱" },
    replyOptions: [
      { label: "A", text: "温柔回应", key: "A" },
      { label: "B", text: "幽默回应", key: "B" },
      { label: "C", text: "深入了解", key: "C" }
    ]
  });
  assert.equal(data.score, 76);
  assert.equal(data.weakest, "边界感");
  assert.equal(data.options.length, 3);
  assert.ok(data.hasOptions);
});

test("buildCoachFloatHtml 无数据时给出引导文案", () => {
  const html = buildCoachFloatHtml(null);
  assert.match(html, /还没有分析结果/);
});

test("buildCoachFloatHtml 渲染评分与建议并转义", () => {
  const data = buildCoachFloatData({
    coachScore: { total: 88, weakestDim: "momentum", summary: "保持节奏" },
    replyOptions: [{ label: "A", text: "<script>alert(1)</script>", key: "A" }]
  });
  const html = buildCoachFloatHtml(data);
  assert.match(html, /88 分/);
  assert.match(html, /短板：推进力/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});
