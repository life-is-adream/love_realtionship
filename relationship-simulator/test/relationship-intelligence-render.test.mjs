import test from "node:test";
import assert from "node:assert/strict";
import { buildRelationshipIntelligenceHtml } from "../public/modules/render/render-intelligence.js";

test("空状态说明本地分析和长期记忆边界", () => {
  const html = buildRelationshipIntelligenceHtml({ consent: false, status: "idle" });

  assert.match(html, /等待本地分析/);
  assert.match(html, /不会调用远程模型/);
  assert.match(html, /未开启匿名长期记忆/);
});

test("加载态和错误态有独立、非阻断提示", () => {
  assert.match(buildRelationshipIntelligenceHtml({ status: "loading" }), /正在运行本地确定性分析/);
  assert.match(
    buildRelationshipIntelligenceHtml({ status: "error", lastError: "服务未启动" }),
    /服务未启动/
  );
});

test("分析结果显示决策、状态、证据、动作与限制", () => {
  const html = buildRelationshipIntelligenceHtml({
    consent: true,
    status: "ready",
    lastResult: {
      decision: { value: "OBSERVE", evidenceIds: ["e1"] },
      state: { to: "INITIAL_CONTACT", reason: "出现互动" },
      action: "只做一个最小、可逆的观察。",
      analysis: {
        metrics: { messageCount: 4, dataQuality: "limited", timestampCoverage: "missing" },
        evidence: [{ id: "e1", observation: "时间戳不完整，不能把回复速度当作结论" }],
        limitations: ["指标不是心理诊断。"]
      },
      hypotheses: [{ label: "当前互惠程度仍不明确", confidence: "insufficient_evidence" }]
    }
  });

  assert.match(html, /OBSERVE/);
  assert.match(html, /INITIAL_CONTACT/);
  assert.match(html, /4 条消息/);
  assert.match(html, /时间戳不完整/);
  assert.match(html, /当前互惠程度仍不明确/);
  assert.match(html, /只做一个最小、可逆的观察/);
  assert.match(html, /不是心理诊断/);
  assert.match(html, /已开启匿名结构化记忆/);
});

test("所有 runtime 文本在插入 HTML 前转义", () => {
  const html = buildRelationshipIntelligenceHtml({
    status: "ready",
    lastResult: {
      decision: { value: "OBSERVE" },
      state: { to: "UNKNOWN", reason: "<img src=x onerror=alert(1)>" },
      action: "<script>alert(1)</script>",
      analysis: {
        metrics: { messageCount: 1, dataQuality: "limited", timestampCoverage: "missing" },
        evidence: [{ observation: "<b>evidence</b>" }],
        limitations: []
      },
      hypotheses: []
    }
  });

  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("<img"), false);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;b&gt;evidence&lt;\/b&gt;/);
});
