// A-03 验收证据本身也要有测试：报告少报一层，读报告的人就会把「审计放行」读成「模型没错」。
// 2026-11-03 人工盲评发现的原缺陷正是这个 —— 6 条被标注的选项在报告里全印成「通过」。
import test from "node:test";
import assert from "node:assert/strict";

import { summarize, renderReport, extractModelOptions } from "../scripts/eval-grounding.mjs";

const record = (id, audits, extra = {}) => ({
  id,
  seed: `我：种子 ${id}`,
  herReply: "她：好的",
  errors: [],
  ms: { her: 100, coach: 200 },
  audits,
  shownSource: "model",
  shownOptions: [],
  ...extra
});

test("summarize 把拦截 / 标注 / 放行三种状态分开计数", () => {
  const stats = summarize([
    record("x1", [
      { key: "A", text: "拦", findings: [{ type: "fabricated_place", entity: "天河城", severity: "block" }], confirmations: [] },
      { key: "B", text: "标", findings: [], confirmations: [{ entity: "明天", reason: "关于你自己" }] },
      { key: "C", text: "过", findings: [], confirmations: [] }
    ])
  ]);
  assert.equal(stats.options, 3);
  assert.equal(stats.fabricatedOptions, 1);
  assert.equal(stats.confirmedOptions, 1);
  assert.equal(stats.passedOptions, 1);
  assert.equal(stats.measurementValid, true);
});

test("renderReport 不得把被标注的选项印成「通过」", () => {
  const records = [
    record("x1", [
      { key: "A", text: "那家在天河城那边。", findings: [{ type: "fabricated_place", entity: "天河城", severity: "block" }], confirmations: [] },
      { key: "B", text: "我明天要交个作业。", findings: [], confirmations: [{ entity: "明天", reason: "关于你自己" }] },
      { key: "C", text: "那你方便的时候说一声。", findings: [], confirmations: [] }
    ])
  ];
  const report = renderReport(records, summarize(records));
  assert.match(report, /\*\*拦截\*\* fabricated_place→天河城/, report);
  assert.match(report, /\*\*标注\*\* 明天/, report);
  assert.match(report, /放行/, report);
  assert.doesNotMatch(report, /判定捏造|     - 通过/, report);
  // 表头必须把「放行」定义成审计器没意见，而不是模型没错。
  assert.match(report, /审计\*\*放行\*\*（既不拦也不标）/, report);
  assert.match(report, /不等于模型没说错/, report);
});

test("零分母仍然显式标失效，比率不许冒充 0%", () => {
  const stats = summarize([record("x1", [])]);
  assert.equal(stats.measurementValid, false);
  assert.equal(stats.fabricationRate, "n/a");
  assert.match(renderReport([record("x1", [])], stats), /本次测量失效/);
});

test("extractModelOptions 忽略嵌在 replyOptions 里的元信息（P2-1 回归）", () => {
  const raw = JSON.stringify({
    replyOptions: { A: "第一条正文", B: "第二条正文", C: "第三条正文", recommendation: "B", coachScore: 8 }
  });
  const options = extractModelOptions(raw);
  assert.deepEqual(options.map((item) => item.key), ["A", "B", "C"], JSON.stringify(options));
});
