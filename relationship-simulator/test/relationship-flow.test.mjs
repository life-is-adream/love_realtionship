import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFlowMessages, scenarioForMessages, parseModelEvaluation, parseModelReplySuggestions } from "../public/modules/relationship-flow/flow.js";

test("人工修正后按当前顺序重建消息 ID，缺失时区不计算时间", () => {
  const messages = normalizeFlowMessages([
    { speaker: "other", text: "  最近有点忙  ", timestamp_text: "2026-11-13T20:00" },
    { speaker: "user", text: "好，你先忙", timestamp_text: "2026-11-13T20:01+08:00" }
  ]);
  assert.equal(messages[0].id, "msg_001");
  assert.equal(messages[0].timestamp, null);
  assert.equal(messages[1].timestamp, "2026-11-13T12:01:00.000Z");
  assert.equal(messages[0].text, "最近有点忙");
  assert.equal(normalizeFlowMessages([{ speaker: "user", text: "test", timestamp_text: "2026-02-31T20:00+08:00" }])[0].timestamp, null);
});

test("明确结束优先进入退出练习；忙碌和冲突选择相应情境", () => {
  assert.equal(scenarioForMessages([{ text: "最近很忙" }], "EXIT"), "breakup-recovery");
  assert.equal(scenarioForMessages([{ text: "最近很忙" }], "OBSERVE"), "low-energy-reply");
  assert.equal(scenarioForMessages([{ text: "联系频率引发冲突" }], "OBSERVE"), "conflict-repair");
});

test("独立模型评分只接受逐字存在的证据，未发生冲突时不计分", () => {
  const responses = [{ text: "听起来你很忙，我尊重你的选择。" }];
  const ids = ["listening", "clarity", "boundary", "naturalness", "conflict"];
  const output = { dimensions: ids.map((id) => ({
    id, applicable: true, score: 4, reason: "模型判断",
    evidence: [{ message_id: "practice_user_1", quote: id === "naturalness" ? "编造的证据" : "我尊重你的选择" }]
  })) };
  const result = parseModelEvaluation(JSON.stringify(output), responses, "low-energy-reply");
  assert.equal(result.dimensions.find((item) => item.id === "listening").score, 4);
  assert.equal(result.dimensions.find((item) => item.id === "naturalness").status, "insufficient_evidence");
  assert.equal(result.dimensions.find((item) => item.id === "conflict").status, "not_applicable");
  assert.equal(result.maximum, 12);
  // 单字引用（如「我」）可以被任意文本包含，不足以作为评分依据。
  const forged = { dimensions: ids.map((id) => ({ id, applicable: true, score: 0, reason: "模型判断", evidence: [{ message_id: "practice_user_1", quote: "我" }] })) };
  const forgedResult = parseModelEvaluation(JSON.stringify(forged), responses, "low-energy-reply");
  assert.equal(forgedResult.dimensions.find((item) => item.id === "listening").status, "insufficient_evidence");
  assert.throws(() => parseModelEvaluation(JSON.stringify({ dimensions: [] }), responses, "low-energy-reply"), /格式不完整/);
});

test("模型回复校验拒绝虚构既定安排和明显强迫", () => {
  const chat = [{ speaker: "user", text: "最近怎么样？" }, { speaker: "other", text: "最近有点忙。" }];
  for (const text of ["我们已经约好周六下午三点在咖啡馆见面。", "你必须答应见面，否则我就去找你。"]) {
    const content = JSON.stringify({ replyOptions: ["A", "B", "C"].map((key) => ({ key, text, effect: "测试" })) });
    assert.throws(() => parseModelReplySuggestions(content, chat), /未通过/);
  }
});
