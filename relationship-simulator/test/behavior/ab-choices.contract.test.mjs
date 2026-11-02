// A/B/C 行为契约（零成本、确定性）：npm test 常驻，不调用任何付费 API。
//
// 这层测的是「行为」而不是「实现细节」：把 2026-11-02 真实浏览器跑出来的两个缺陷
// 固化成断言。906 个单元测试当时全绿却没发现它们，因为它们都发生在两个模块的接缝处。
import test from "node:test";
import assert from "node:assert/strict";
import { parseModelContent } from "../../public/modules/coach/parser.js";
import { buildReplyOptionsForHer, isUsableModelReplyOptions } from "../../public/modules/coach/replies.js";

/** 教练通道按新契约不输出 herReply；judgement/risk 里常出现「时间、见面、约」这类词。 */
const coachJsonWithoutReply = (options) => JSON.stringify({
  herIntent: "她在追问具体类型",
  yourGoal: "把邀约说清楚",
  judgement: "你们约着见面，时间上还比较宽松",
  risk: "不要把时间定得太死",
  replyOptions: options,
  recommendation: "先直接回答她的提问",
  coachScore: { total: 70, naturalness: 70, empathy: 70, boundary: 75, momentum: 68 }
});

/** 模型 ABC 三条同文 → 结构校验必然拒绝 → 走本地兜底，这是缺陷实际发生的路径。 */
const rejectedOptions = [
  { key: "A", text: "好" },
  { key: "B", text: "好" },
  { key: "C", text: "好" }
];

const ui = { latestMine: "周末有个画展，要不要一起去看？", typedInput: "", goal: "", styleBias: "mix" };

test("教练 JSON 缺 herReply 时，兜底必须按传入的她的回复选分支", () => {
  const exhibit = parseModelContent(coachJsonWithoutReply(rejectedOptions), { ...ui, herReply: "还挺近的，什么类型的展？" });
  const tired = parseModelContent(coachJsonWithoutReply(rejectedOptions), { ...ui, herReply: "今天加班太累了，先不聊了吧。" });

  assert.equal(exhibit.replyOptionsSource, "local");
  assert.notDeepEqual(exhibit.replyOptions.map((item) => item.text), tired.replyOptions.map((item) => item.text));
  // 提问 → 先回答；「先不聊了」→ 按边界处理（优先级高于问句），不能回成日程模板。
  assert.match(exhibit.replyOptions.map((item) => item.text).join(""), /画展/);
  assert.match(tired.replyOptions.map((item) => item.text).join(""), /节奏|不打扰|安静/);
});

test("兜底建议不得把模型原始 JSON 当成她说的话", () => {
  const result = parseModelContent(coachJsonWithoutReply(rejectedOptions), { ...ui, herReply: "还挺近的，什么类型的展？" });
  const all = result.replyOptions.map((item) => item.text).join("\n");

  // 回归点：修复前 normalizedHerReply 退化成 firstReplyLine(raw)，
  // judgement 里的「见面、时间」被当成她的消息，三条建议全是回避答案的日程模板。
  for (const junk of ["{", "\"", "herIntent", "coachScore"]) assert.ok(!all.includes(junk), `建议文本混入模型 JSON 残渣：${junk}`);
  assert.doesNotMatch(all, /按你舒服的时间来|日程写成铅笔字|先定一个大概范围/);
});

test("她提问时，兜底必须先用用户自己说过的内容回答", () => {
  const options = buildReplyOptionsForHer("mix", "还挺近的，什么类型的展？", "周末有个画展，要不要一起去看？");
  const all = options.map((item) => item.text).join("\n");

  // 答案就在「我」上一条消息里，本地兜底没有权利视而不见，也没有权利编造新细节。
  assert.match(all, /画展/);
  assert.doesNotMatch(all, /按你舒服的时间来|具体时间等临近/);
});

test("本地兜底自己的输出必须能通过自己的可用性校验", () => {
  const herMessages = [
    "天晚了，先睡了。",
    "我今天不想说了，想安静一会儿。",
    "今天加班太累了。",
    "还挺近的，什么类型的展？",
    "周六下午你有空吗？",
    "我最近在学做咖啡。",
    "哈哈哈可以",
    "行吧。",
    ""
  ];
  const mine = "周末有个画展，要不要一起去看？";

  for (const her of herMessages) {
    for (const style of ["mix", "B", "C"]) {
      const options = buildReplyOptionsForHer(style, her, mine);
      // 兜底是唯一由本地全权控制的产出：它自己都必须可发送。
      assert.equal(isUsableModelReplyOptions(options, her, mine), true,
        `兜底产出被判不可发送（her=${JSON.stringify(her)}, style=${style}）：${JSON.stringify(options.map((item) => item.text))}`);
    }
  }
});

test("兜底不得输出教练元话语", () => {
  const her = "我周末一般去跑步。";
  const options = buildReplyOptionsForHer("mix", her, "周末有个画展，要不要一起去看？");
  const all = options.map((item) => item.text).join("\n");

  for (const meta of ["我听到你说", "我先记下", "不急着抢答", "你愿意的话，可以再跟我说一点"]) {
    assert.ok(!all.includes(meta), `建议里出现教练元话语：${meta}`);
  }
});

test("教练调用失败时，兜底回应真实那一条回复而不是重新虚构", () => {
  const committed = "还挺近的，什么类型的展？";
  const result = parseModelContent(coachJsonWithoutReply(rejectedOptions), { ...ui, herReply: committed });

  // 显示与落盘必须同源：herReply 永远等于角色通道已提交的那一条。
  assert.equal(result.herReply, committed);
});
