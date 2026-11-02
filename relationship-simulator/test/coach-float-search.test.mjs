import test from "node:test";
import assert from "node:assert/strict";
import { runCoachFloatSearch } from "../public/modules/render/coach-float-search.js";
import { createRequestScope } from "../public/modules/core/request-scope.js";

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
  assert.match(target.innerHTML, /未找到可用参考来源/);
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

test("搜索后发结果优先，旧成功不能覆盖且旧请求得到取消信号", async () => {
  const target = { innerHTML: "" };
  const pending = [];
  const search = (query, options = {}) => new Promise((resolve) => pending.push({ resolve, signal: options.signal }));
  const first = runCoachFloatSearch({ target, search });
  const second = runCoachFloatSearch({ target, search });
  assert.equal(pending[0].signal?.aborted, true);
  pending[1].resolve({ results: [{ title: "latest", url: "https://apa.org/latest" }], filtered: 0 });
  await second;
  pending[0].resolve({ results: [{ title: "stale", url: "https://apa.org/stale" }], filtered: 0 });
  await first;
  assert.match(target.innerHTML, /latest/);
  assert.doesNotMatch(target.innerHTML, /stale/);
});

test("关闭或上下文切换后，迟到成功与错误均不能写搜索结果", async () => {
  for (const fail of [false, true]) {
    let context = "original";
    const requestScope = createRequestScope(() => context);
    const target = { innerHTML: "" };
    let finish;
    let signal;
    const task = runCoachFloatSearch({ target, requestScope, search: (_query, options = {}) => {
      signal = options.signal;
      return new Promise((resolve, reject) => { finish = fail ? reject : resolve; });
    } });
    context = "other";
    requestScope.cancelAll();
    target.innerHTML = "new panel";
    if (fail) finish(new Error("old failure"));
    else finish({ results: [], filtered: 0 });
    await task;
    assert.equal(signal?.aborted, true);
    assert.equal(target.innerHTML, "new panel");
  }
});

test("前端拒绝危险协议和带账号的 URL，参考来源不冒称权威", async () => {
  const target = { innerHTML: "" };
  await runCoachFloatSearch({ target, search: async () => ({ results: [
    { title: "unsafe", url: "javascript:alert(1)" },
    { title: "unsafe", url: "data:text/html,synthetic" },
    { title: "unsafe", url: "https://synthetic-user:synthetic-password@apa.org/" },
    { title: "valid", url: "https://apa.org/relationships" }
  ], filtered: 0 }) });
  assert.doesNotMatch(target.innerHTML, /javascript:|data:text|synthetic-password|权威来源/);
  assert.match(target.innerHTML, /参考来源 1 条/);
  assert.match(target.innerHTML, /域名/);
});

test("查询只允许固定阶段和评分维度，模型字段不能成为出站原文", async () => {
  const queries = [];
  await runCoachFloatSearch({ target: { innerHTML: "" }, stage: "synthetic@example.invalid",
    analysis: { coachScore: { weakestDim: "private synthetic text" } },
    search: async (query) => { queries.push(query); return { results: [], filtered: 0 }; }
  });
  assert.deepEqual(queries, ["恋爱沟通 boundary 沟通建议"]);
});

test("没有通过校验的引用时不展示未核验的模型摘要", async () => {
  const target = { innerHTML: "" };
  await runCoachFloatSearch({ target, search: async () => ({ results: [], filtered: 1, note: "unverified model claim" }) });
  assert.doesNotMatch(target.innerHTML, /unverified model claim/);
});

test("浏览器不把模糊或含控制字符的 URL 规范成可点击引用", async () => {
  const target = { innerHTML: "" };
  await runCoachFloatSearch({ target, search: async () => ({ results: [
    "https:apa.org/path", "https:///apa.org/path", "https://@apa.org/path",
    "https://apa.org/line\npath", "https://apa.org\\path", "//apa.org/path"
  ].map((url) => ({ title: "ambiguous", url })), filtered: 0 }) });
  assert.doesNotMatch(target.innerHTML, /href=/);
  assert.match(target.innerHTML, /6 条引用未通过/);
});
