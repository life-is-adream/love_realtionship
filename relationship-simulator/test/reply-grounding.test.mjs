// A-03 验收：教练回复事实约束。全部离线 fixture，零 API 成本。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildEvidenceLedger, isGroundedInLedger, sourcesFor, EVIDENCE_KIND } from "../public/modules/coach/evidence-ledger.js";
import { auditReplyOption, groundReplyOptions, groundingNote } from "../public/modules/coach/reply-grounding.js";
import { buildReplyOptionsForHer } from "../public/modules/coach/replies.js";
import { parseModelContent } from "../public/modules/coach/parser.js";

const here = dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));

const negatives = load("reply-grounding-negative.json");
const positives = load("reply-grounding-positive.json");

// fixture 里 "我：文本" 的行格式 -> 台账消息
function ledgerFrom(lines) {
  const messages = lines.map((line, index) => {
    const [speaker, ...rest] = line.split("：");
    const text = rest.join("：");
    return { mid: `m-fixture-${index}`, type: speaker === "她" ? "her" : "me", who: speaker, text, source: speaker === "她" ? "model" : "user" };
  });
  return buildEvidenceLedger(messages);
}

test("负例 50 条：把未发生的安排写成既成事实，必须全部报出 findings（A-03 要求 0 漏检）", () => {
  const misses = [];
  for (const item of negatives.cases) {
    const ledger = ledgerFrom(item.conversation);
    const audit = auditReplyOption(item.option, ledger);
    if (!audit.findings.length) misses.push(`${item.id}: ${item.option.text}`);
  }
  assert.deepEqual(misses, [], `漏检 ${misses.length}/${negatives.cases.length} 条：\n${misses.join("\n")}`);
});

test("负例的每条都确实缺少台账支持（防止 fixture 与对话自相矛盾）", () => {
  for (const item of negatives.cases) {
    const ledger = ledgerFrom(item.conversation);
    const audit = auditReplyOption(item.option, ledger);
    for (const finding of audit.findings) {
      assert.equal(isGroundedInLedger(ledger, finding.entity), false, `${item.id} 的 ${finding.entity} 其实有出处`);
      assert.ok(/fabricated_/.test(finding.type), `${item.id} 出现未知 finding 类型 ${finding.type}`);
    }
  }
});

test("正例 20 条：新提出的时间地点不得被误杀（A-03 门槛 ≥95%）", () => {
  const blocked = [];
  for (const item of positives.cases) {
    const ledger = ledgerFrom(item.conversation);
    const audit = auditReplyOption(item.option, ledger);
    if (audit.findings.length) blocked.push(`${item.id}: ${item.option.text} => ${JSON.stringify(audit.findings)}`);
  }
  const passRate = (positives.cases.length - blocked.length) / positives.cases.length;
  assert.ok(passRate >= 0.95, `正例通过率 ${(passRate * 100).toFixed(0)}% < 95%\n${blocked.join("\n")}`);
});

test("台账只从真实消息构建，条目带 kind/scope/mid，教练文本不回填为证据", () => {
  const ledger = buildEvidenceLedger([
    { mid: "m-1", type: "me", text: "周六有空吗", source: "user" },
    { mid: "m-2", type: "her", text: "有呀", source: "model" }
  ]);
  assert.equal(ledger.entries.length, 2);
  assert.equal(ledger.entries[0].kind, EVIDENCE_KIND.USER_ASSERTED);
  assert.equal(ledger.entries[0].scope, "real");
  assert.equal(ledger.entries[1].kind, EVIDENCE_KIND.CHARACTER_ASSERTED);
  assert.equal(ledger.entries[1].scope, "simulation");
  assert.equal(ledger.byMid.get("m-1").text, "周六有空吗");

  // 台账不含任何生成内容：审计只能对照用户和她真正说过的话。
  assert.equal(isGroundedInLedger(ledger, "那家咖啡馆"), false);
});

test("剧情事件强制 simulation 作用域，不得混入现实证据", () => {
  const ledger = buildEvidenceLedger([{ mid: "m-1", type: "me", text: "今天下雨", source: "user" }], {
    scenarioEvents: [{ mid: "m-e1", text: "她在咖啡店打翻了拿铁" }]
  });
  const event = ledger.entries.find((entry) => entry.mid === "m-e1");
  assert.equal(event.kind, EVIDENCE_KIND.SIMULATION_EVENT);
  assert.equal(event.scope, "simulation");
});

test("sourcesFor 返回可追溯出处，供 UI 展示证据来源", () => {
  const ledger = buildEvidenceLedger([{ mid: "m-9", type: "me", text: "我周六要加班", source: "user" }]);
  const found = sourcesFor(ledger, ["周六"]);
  assert.equal(found.length, 1);
  assert.equal(found[0].mid, "m-9");
  assert.equal(found[0].kind, EVIDENCE_KIND.USER_ASSERTED);
});

test("捏造的既成事实被改成待确认骨架，且肯定措辞一并抹掉", () => {
  const ledger = ledgerFrom(["我：最近有空一起坐坐", "她：好呀"]);
  const result = groundReplyOptions(
    [
      { key: "A", text: "那周六下午两点可以吗？" },
      { key: "B", text: "就去上次说的那家咖啡馆吧。" },
      { key: "C", text: "要不要改天再约，看你方便。" }
    ],
    ledger
  );
  assert.equal(result.ok, true);
  assert.equal(result.needsUserFill, true);
  assert.deepEqual(result.blockedKeys, ["B"]);

  const degraded = result.options.find((item) => item.key === "B").text;
  assert.ok(degraded.includes("【地点待你确认】"), degraded);
  assert.ok(!/上次/.test(degraded), `骨架仍保留既成事实措辞：${degraded}`);
  assert.ok(!/咖啡馆/.test(degraded), `骨架仍保留捏造的地点：${degraded}`);
  // 合法提议原样保留，不做无差别改写。
  assert.equal(result.options.find((item) => item.key === "A").text, "那周六下午两点可以吗？");
});

test("三条全含捏造 => 整套拒绝，交回本地兜底而不是留三份骨架", () => {
  const ledger = ledgerFrom(["我：在干嘛", "她：刷手机"]);
  const result = groundReplyOptions(
    [
      { key: "A", text: "上次说好的咖啡馆我订好了。" },
      { key: "B", text: "老地方周六晚上六点见，票买好了。" },
      { key: "C", text: "按原计划周日下午去美术馆吧。" }
    ],
    ledger
  );
  assert.equal(result.ok, false);
  assert.ok(result.rejectReason.includes("既成事实"), result.rejectReason);
  assert.equal(result.blockedKeys.length, 3);
});

test("groundingNote 说清是哪几条需要用户补信息", () => {
  const ledger = ledgerFrom(["我：想吃点好的", "她：走起"]);
  const result = groundReplyOptions(
    [
      { key: "A", text: "不如找家日料，你想吃寿司吗？" },
      { key: "B", text: "那家早就说好的湘菜馆周六去。" },
      { key: "C", text: "或者先随便吃点，看你时间。" }
    ],
    ledger
  );
  const note = groundingNote(result);
  assert.ok(note.includes("B"), note);
  // 有实体被换成占位符时，必须告诉用户「发送前填进去」。
  assert.match(note, /【待你确认】/, note);
  assert.match(note, /发送前/, note);
  assert.equal(groundingNote({ needsUserFill: false, blockedKeys: [] }), "");

  // 只捏造了「约定」本身时没有占位符可填，措辞不能承诺一个不存在的占位。
  const noEntity = groundReplyOptions(
    [
      { key: "A", text: "那先这样，你方便的时候说一声？" },
      { key: "B", text: "老规矩，我按原计划走。" },
      { key: "C", text: "或者你定，我都行。" }
    ],
    ledger
  );
  const noEntityNote = groundingNote(noEntity);
  assert.ok(noEntityNote.includes("B"), noEntityNote);
  assert.ok(!noEntityNote.includes("【待你确认】"), `没有占位符却承诺占位：${noEntityNote}`);
  assert.match(noEntityNote, /先向你确认/, noEntityNote);
});

test("审计不改动通过校验的选项，也不吞掉原有字段", () => {
  const ledger = ledgerFrom(["我：周六下午两点我有空", "她：好"]);
  const option = { key: "A", text: "那就周六下午两点。", effect: "承接已定的时间", label: "A 温柔高情商" };
  const [out] = groundReplyOptions([option], ledger).options;
  assert.equal(out.text, option.text);
  assert.equal(out.effect, option.effect);
  assert.equal(out.label, option.label);
  assert.deepEqual(out.assertedFacts.sort(), ["下午两点", "周六"].sort());
  assert.equal(out.needsUserFill, false);
});

test("空输入与非数组不抛错", () => {
  const ledger = buildEvidenceLedger([]);
  assert.equal(groundReplyOptions(null, ledger).ok, true);
  assert.equal(groundReplyOptions([], ledger).options.length, 0);
  assert.deepEqual(auditReplyOption(undefined, ledger).findings, []);
});

// ── 接缝：审计必须真的接在教练解析路径上，不只是存在的纯函数 ──────────────────

const coachJson = (options) => JSON.stringify({
  herIntent: "她在等你定时间。",
  yourGoal: "把见面定下来。",
  judgement: "她给出了积极回应。",
  risk: "无明确风险。",
  recommendation: "先选 A。",
  replyOptions: options
});

const cleanOptions = [
  { key: "A", text: "那周六下午两点可以吗？" },
  { key: "B", text: "不如先找个地方坐坐，你那边方便的话我来订？" },
  { key: "C", text: "你更想白天还是晚上？我按你的时间来。" }
];

test("接缝：模型只有一条捏造 => 保留另两条，那条降级为待确认骨架", () => {
  const context = {
    herReply: "好呀",
    latestMine: "最近有空一起坐坐",
    messages: [{ mid: "m-1", type: "me", text: "最近有空一起坐坐", source: "user" }, { mid: "m-2", type: "her", text: "好呀", source: "model" }]
  };
  const result = parseModelContent(coachJson([
    cleanOptions[0],
    { key: "B", text: "就去上次说好的那家咖啡馆吧。" },
    cleanOptions[2]
  ]), context);

  assert.equal(result.replyOptionsSource, "model");
  assert.equal(result.grounding.needsUserFill, true);
  assert.deepEqual(result.grounding.blockedKeys, ["B"]);
  const b = result.replyOptions.find((item) => item.key === "B");
  assert.ok(!b.text.includes("咖啡馆"), `捏造地点仍在：${b.text}`);
  assert.ok(b.text.includes("【"), `没有留下待确认占位：${b.text}`);
});

test("接缝：模型三条全捏造 => 整套退回本地兜底，并说明原因", () => {
  const context = {
    herReply: "刷手机呢",
    latestMine: "在干嘛",
    messages: [{ mid: "m-1", type: "me", text: "在干嘛", source: "user" }, { mid: "m-2", type: "her", text: "刷手机呢", source: "model" }]
  };
  const result = parseModelContent(coachJson([
    { key: "A", text: "上次说好的咖啡馆我订好了。" },
    { key: "B", text: "老地方周六晚上六点见，票买好了。" },
    { key: "C", text: "按原计划去美术馆吧。" }
  ]), context);

  assert.equal(result.replyOptionsSource, "local");
  assert.equal(result.grounding.ok, false, JSON.stringify(result.grounding.rejectReason));
});

// 本地模板的职责是「只复述用户说过的话」。这条一旦破功，就是兜底路径自己在编事实，
// 而它过去真出过同类问题（default 分支自产自发被自己的校验否掉），所以钉住。
test("本地兜底模板自身必须通过事实审计（0 findings）", () => {
  const herLines = ["好呀", "周六下午两点可以吗", "那家咖啡馆我也想去", "明天可能加班", "哈哈你真有意思", "我最近挺累的", "算了改天吧", "你喜欢吃什么", "晚安啦"];
  for (const her of herLines) {
    for (const style of ["A", "B", "C", "mix"]) {
      const messages = [
        { mid: "m-me", type: "me", text: "周末有空一起吃饭", source: "user" },
        { mid: "m-her", type: "her", text: her, source: "model" }
      ];
      const ledger = buildEvidenceLedger(messages);
      const options = buildReplyOptionsForHer(style, her, "周末有空一起吃饭");
      const result = groundReplyOptions(options, ledger);
      assert.equal(result.grounding?.ok !== false, true);
      assert.deepEqual(
        result.findings.map((f) => `${f.type}:${f.entity}`),
        [],
        `本地模板编造了事实：her="${her}" style=${style} => ${JSON.stringify(result.findings)}`
      );
    }
  }
});

test("被认可的既成事实必须带可追溯的 sourceMessageIds", () => {
  const ledger = buildEvidenceLedger([
    { mid: "m-77", type: "me", text: "那就周六下午两点", source: "user" },
    { mid: "m-78", type: "her", text: "好", source: "model" }
  ]);
  const audit = auditReplyOption({ key: "A", text: "那就周六下午两点见。" }, ledger);
  assert.equal(audit.findings.length, 0);
  assert.ok(audit.assertedFacts.length > 0, JSON.stringify(audit));
  assert.deepEqual(audit.sourceMessageIds, ["m-77"]);

  // 纯提议不主张任何事实，出处应为空。
  const proposal = auditReplyOption({ key: "A", text: "那周六下午两点可以吗？" }, buildEvidenceLedger([{ mid: "m-1", type: "me", text: "周末有空吗", source: "user" }]));
  assert.deepEqual(proposal.assertedFacts, []);
  assert.deepEqual(proposal.sourceMessageIds, []);
});

// 降级后的三条仍然是「可以直接发出去的东西」：互不相同、至多一条问句、不残留任何被判定为捏造的实体。
// 只看降级前的输入不足以证明这点 —— 两条同 kind 的捏造曾经塌成一字不差的两条。
test("降级结果本身仍满足 A/B/C 契约：互不相同、至多一条问句、捏造实体不残留", () => {
  const emptyLedger = buildEvidenceLedger([
    { mid: "m-1", type: "me", text: "在干嘛", source: "user" },
    { mid: "m-2", type: "her", text: "刷手机", source: "model" }
  ]);
  const texts = negatives.cases.map((item) => item.option.text);

  for (let i = 0; i + 2 < texts.length; i += 3) {
    const triple = [
      { key: "A", text: texts[i] },
      { key: "B", text: texts[i + 1] },
      { key: "C", text: texts[i + 2] }
    ];
    const result = groundReplyOptions(triple, emptyLedger);
    if (!result.ok) continue; // 三条全灭本来就整套丢弃，不进入展示

    const finalTexts = result.options.map((item) => item.text);
    assert.equal(new Set(finalTexts).size, 3, `降级后出现重复：${finalTexts.join(" / ")}`);
    assert.ok(finalTexts.filter((text) => /[？?]\s*$/.test(text)).length <= 1, `降级后问句过多：${finalTexts.join(" / ")}`);

    for (const option of result.options) {
      for (const finding of option.findings || []) {
        assert.ok(!option.text.includes(finding.entity),
          `降级后仍保留捏造实体 ${finding.entity}：${option.text}`);
      }
    }
  }
});

// 上一轮的契约扫描其实抓不到重复问题：它按 fixture 顺序取三条， kinds 天然分散。
// 真正的坑是「同一种捏造出现两次」，所以这里按骨架种类配对，必然造出同 kind 的降级对。
test("两条同一种捏造同时被降级时，不得塌成一字不差的两句", () => {
  const emptyLedger = buildEvidenceLedger([
    { mid: "m-1", type: "me", text: "在干嘛", source: "user" },
    { mid: "m-2", type: "her", text: "刷手机", source: "model" }
  ]);
  const kindOf = (text) => {
    const audit = auditReplyOption({ key: "A", text }, emptyLedger);
    const types = new Set(audit.findings.map((finding) => finding.type));
    if (types.has("fabricated_time") && types.has("fabricated_place")) return "time+place";
    if (types.has("fabricated_time")) return "time";
    if (types.has("fabricated_place")) return "place";
    if (types.has("fabricated_arrangement")) return "arrangement";
    return null;
  };

  const buckets = new Map();
  for (const item of negatives.cases) {
    const kind = kindOf(item.option.text);
    if (!kind) continue;
    if (!buckets.has(kind)) buckets.set(kind, []);
    buckets.get(kind).push(item.option.text);
  }

  // 两条被降级时，第一条本可以用问句式骨架避开重复；但保留下来那条自己就是问句时，
  // 两条都只能用陈述式模板 —— 这才是会撞车的真实场景，必须覆盖。
  const cleanVariants = ["我按你的时间来，不急。", "那先这样，你方便的时候说一声？"];

  const checked = [];
  for (const [kind, group] of buckets) {
    if (group.length < 2) continue;
    for (const clean of cleanVariants) {
      const result = groundReplyOptions(
        [{ key: "A", text: group[0] }, { key: "B", text: group[1] }, { key: "C", text: clean }],
        emptyLedger
      );
      assert.equal(result.ok, true, `${kind} 组只降级两条，不应整套丢弃`);
      const finalTexts = result.options.map((item) => item.text);
      assert.equal(new Set(finalTexts).size, 3,
        `${kind} 两条同种捏造降级后重复（clean="${clean}"）：${finalTexts.join(" / ")}`);
      assert.ok(finalTexts.filter((text) => /[？?]\s*$/.test(text)).length <= 1,
        `${kind} 降级后问句超过一条：${finalTexts.join(" / ")}`);
    }
    checked.push(kind);
  }
  assert.ok(checked.length >= 3, `只覆盖了 ${checked.length} 种捏造类型，测试没有真正铺开：${checked.join(",")}`);
});
