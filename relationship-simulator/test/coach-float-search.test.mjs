import test from "node:test";
import assert from "node:assert/strict";
import { runCoachFloatSearch } from "../public/modules/render/coach-float-search.js";

test("悬浮搜索只发送阶段与短板，不发送分析或对话原文", async () => {
  const target = { innerHTML: "" };
  const queries = [];
  await runCoachFloatSearch({
    analysis: { coachScore: { weakestDim: "boundary" }, rawChat: "不应发送" },
    stage: "第一次邀约",
    target,
    search: async (query) => {
      queries.push(query);
      return { results: [], filtered: 0 };
    }
  });

  assert.deepEqual(queries, ["第一次邀约 boundary 沟通建议"]);
  assert.equal(queries[0].includes("不应发送"), false);
  assert.match(target.innerHTML, /未找到权威来源结果/);
});

test("搜索结果标题、摘要和链接在渲染前转义", async () => {
  const target = { innerHTML: "" };
  await runCoachFloatSearch({
    analysis: {},
    stage: "",
    target,
    search: async () => ({
      results: [{ title: "<b>标题</b>", url: "https://example.com/?x=\"bad\"", snippet: "<script>x</script>" }],
      filtered: 1
    })
  });

  assert.equal(target.innerHTML.includes("<script>"), false);
  assert.equal(target.innerHTML.includes("<b>标题</b>"), false);
  assert.match(target.innerHTML, /&lt;b&gt;标题&lt;\/b&gt;/);
  assert.match(target.innerHTML, /过滤 1 条/);
});

test("搜索失败显示局部错误，不向外抛出", async () => {
  const target = { innerHTML: "" };
  const result = await runCoachFloatSearch({
    target,
    search: async () => { throw new Error("未配置"); }
  });

  assert.equal(result, null);
  assert.match(target.innerHTML, /联网搜索不可用：未配置/);
});
