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

test("全部负例：把未发生的安排写成既成事实，必须逐条报出 findings（A-03 要求 0 漏检）", () => {
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

test("全部正例：新提出的时间地点不得被误杀（A-03 门槛 ≥95%）", () => {
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

// 2026-11-03 真实抽样翻车的复盘：脚本把 extractJsonObject 的返回值当对象取 .replyOptions，
// 而它返回的是字符串 —— 于是 12 个用例审计到 0 条，白跑 24 次付费请求，
// 报告还会印出「捏造率 0%」看着像通过。这条测试用生产形状的 JSON 免费钉住取数路径。
test("评测脚本能从生产形状的教练 JSON 里取到模型原始三条", async () => {
  const { extractModelOptions } = await import("../scripts/eval-grounding.mjs");
  const coachRaw = JSON.stringify({
    herIntent: "她没有直接答应，属于留有余地的中性回应。",
    yourGoal: "把邀约说清楚",
    judgement: "阶段是初聊，她的投入程度偏低。",
    risk: "若追问那你什么时候有空，会变成查户口式施压。",
    replyOptions: [
      { key: "A", text: "那周六下午两点可以吗？" },
      { key: "B", text: "就去上次说好的那家咖啡馆吧。" },
      { key: "C", text: "你更想白天还是晚上，我配合你。" }
    ],
    recommendation: "先 A。",
    coachScore: { total: 72 },
    evidenceReasoning: { observations: ["她回复了两个字加一句补充"], unknowns: ["她周末是否真有安排"] }
  });

  const options = extractModelOptions(coachRaw);
  assert.equal(options.length, 3, `取到 ${options.length} 条，评测分母将为 0`);
  assert.deepEqual(options.map((item) => item.key), ["A", "B", "C"]);

  // 取到之后必须真的能审计：B 里的「上次说好的那家咖啡馆」是捏造。
  const ledger = buildEvidenceLedger([
    { mid: "m-1", type: "me", text: "周末有个画展，要不要一起去看？", source: "user" },
    { mid: "m-2", type: "her", text: "周末可能有点事，我先看看时间再回你", source: "model" }
  ]);
  const audits = options.map((option) => auditReplyOption(option, ledger));
  assert.equal(audits.filter((a) => a.findings.length).length, 1, JSON.stringify(audits.map((a) => a.findings)));
  assert.equal(audits[1].findings[0].type, "fabricated_place");
});

test("评测脚本遇到非 JSON 输出时返回空而不是假装有数据", async () => {
  const { extractModelOptions } = await import("../scripts/eval-grounding.mjs");
  assert.deepEqual(extractModelOptions(""), []);
  assert.deepEqual(extractModelOptions("她：好的"), []);
  assert.deepEqual(extractModelOptions('{"judgement":"没有选项字段"}'), []);
});

// ── 第一人称处境标注（2026-11-03 人工盲评抓出的第二类缺口）──────────────────
// 她只说「周四要交一个读书报告，你呢」，用户从没说过自己有别的截止日。
// 教练却写「我这边也快了，明天要交一个课程作业」—— 照抄发出去就是替用户撒谎。
// 这类句子既无回忆框架也无征询框架，旧规则把它当成合法新提议放过了。
test("替用户新增个人处境要标注，但不改原文", () => {
  const ledger = ledgerFrom(["我：这周是不是又快 deadline 了？", "她：嗯周四要交一个读书报告，你呢"]);
  const audit = auditReplyOption(
    { key: "A", text: "周四交读书报告，那这几天有的忙了。我这边也快了，明天要交一个课程作业。" },
    ledger
  );
  assert.equal(audit.needsUserConfirm, true, JSON.stringify(audit));
  assert.ok(audit.confirmations.some((c) => c.entity === "明天"), JSON.stringify(audit.confirmations));
  // 关键取舍：只提醒不改写。分不清「陈述处境」和「陈述新提议」时，误杀的代价更高。
  assert.equal(audit.text, "周四交读书报告，那这几天有的忙了。我这边也快了，明天要交一个课程作业。");
  assert.equal(audit.findings.length, 0, "标注类不该升级为拦截");
});

test("决策/征询框架不算替用户编处境（避免误杀合法新提议）", () => {
  const ledger = ledgerFrom(["我：周末有个画展，要不要一起去看？", "她：可以啊，几点的"]);
  for (const text of [
    "那就周六下午两点。",
    "周六下午两点可以吗？",
    "暂定周日，你那边方便的话我再调整。",
    "不如约个周六，我配合你的时间。"
  ]) {
    const audit = auditReplyOption({ key: "A", text }, ledger);
    assert.equal(audit.needsUserConfirm, false, `合法新提议被误标：${text} => ${JSON.stringify(audit.confirmations)}`);
  }
});

test("她的日程被复述时不该算到用户头上", () => {
  const ledger = ledgerFrom(["我：你最近忙吗", "她：周四要交读书报告"]);
  const audit = auditReplyOption({ key: "A", text: "周四那个读书报告，你写得怎么样了？" }, ledger);
  assert.equal(audit.needsUserConfirm, false, JSON.stringify(audit.confirmations));
  assert.equal(audit.findings.length, 0);
});

test("标注会汇进 confirmKeys，并在提示语里单独说明", () => {
  const ledger = ledgerFrom(["我：你下班一般几点？", "她：六点多吧，看当天事多不多"]);
  const result = groundReplyOptions(
    [
      { key: "A", text: "六点多确实算正常下班了，我们这边有时候加班到七八点。" },
      { key: "B", text: "那你到家一般还做饭吗？" },
      { key: "C", text: "我一般七点半左右能喘口气。" }
    ],
    ledger
  );
  assert.equal(result.ok, true, "标注类不该导致整套退回本地");
  assert.deepEqual(result.confirmKeys, ["A", "C"], JSON.stringify(result.confirmKeys));
  const note = groundingNote(result);
  assert.match(note, /替你新增了对话里没出现过的个人情况/, note);
  assert.match(note, /发送前请核对/, note);
});

test("同一句里已被拦截的实体不再重复标注（拦截优先于标注）", () => {
  const ledger = ledgerFrom(["我：周末有空一起坐坐", "她：好呀"]);
  const result = groundReplyOptions(
    [
      { key: "A", text: "就去上次说好的那家咖啡馆吧，我明天下午也有空。" },
      { key: "B", text: "不如找家店坐坐，你那边方便的话我来订？" },
      { key: "C", text: "我一般七点半以后才有空，到时候直接过去。" }
    ],
    ledger
  );
  const a = result.options.find((item) => item.key === "A");
  // 「上次说好」是回忆框架，整句按断言处理：咖啡馆和明天都升级为拦截。
  assert.equal(a.needsUserFill, true);
  assert.deepEqual(a.findings.map((f) => f.entity).sort(), ["明天", "咖啡馆"].sort());
  assert.deepEqual(a.confirmations, [], "已拦截的实体不该再出一份标注");

  // C 没有回忆框架，第一人称新增时间只标注、不拦。
  const c = result.options.find((item) => item.key === "C");
  assert.equal(c.needsUserFill, false, JSON.stringify(c.findings));
  assert.equal(c.needsUserConfirm, true, JSON.stringify(c));
  assert.ok(c.confirmations.some((conf) => conf.entity === "七点半"), JSON.stringify(c.confirmations));
});

// R7：渲染模块必须有行为测试。标注如果只存在于数据里而没进 UI，等于没告诉用户。
test("标注要落到具体那一条建议上，而不是只有一句汇总", async () => {
  const { choiceConfirmNote } = await import("../public/modules/render/render-coach.js");
  const ledger = ledgerFrom(["我：这周是不是又快 deadline 了？", "她：嗯周四要交一个读书报告，你呢"]);
  const [audit] = groundReplyOptions(
    [{ key: "A", text: "我这边也快了，明天要交一个课程作业。" }],
    ledger
  ).options;
  const note = choiceConfirmNote(audit);
  assert.match(note, /明天/, note);
  assert.match(note, /关于你自己的信息/, note);
  assert.match(note, /发送前请核对/, note);
  // 原文不能被改写 —— 这是标注类与拦截类的分界。
  assert.equal(audit.text, "我这边也快了，明天要交一个课程作业。");
  assert.equal(choiceConfirmNote({ key: "B", text: "正常一条", confirmations: [] }), "");
  assert.equal(choiceConfirmNote(undefined), "");
});

// ── 2026-11-03 人工盲评抓出的三类判定（P0-1 / P1-1 / P2-3）─────────────────────

const G09 = ["我：上次你说想吃日料，我一直记着。", "她：你还真记着呀，那家在哪，远不远"];

test("盲评 P0-1：虚构店址的三条真实原文必须全拦住，整套退回本地而不是原样展示", () => {
  const ledger = ledgerFrom(G09);
  const result = groundReplyOptions(
    [
      { key: "A", text: "那家在天河城那边，坐地铁三号线到体育西路站走五分钟就到，不算远，下次可以去试试。" },
      { key: "B", text: "记性好是我为数不多的优点，店在体育西路那边，离你远不远？" },
      { key: "C", text: "在体育西路那边，地铁出来走五分钟就到。你平时通勤一般在哪一片，我看看远不远。" }
    ],
    ledger
  );
  assert.equal(result.ok, false, "三条都是假地址，不该有一条原样展示给用户");
  const entities = result.findings.map((finding) => finding.entity);
  for (const entity of ["天河城", "体育西路", "地铁三号线", "走五分钟"]) {
    assert.ok(entities.includes(entity), `${entity} 未被识别：${JSON.stringify(result.findings)}`);
  }
  // 地点类 finding 必须有专门类型，否则降级骨架会选错模板。
  assert.ok(result.findings.some((finding) => finding.type === "fabricated_place"), JSON.stringify(result.findings));
});

test("盲评 P0-1：中文省略主语的裸地点框架同样算断言", () => {
  const ledger = ledgerFrom(G09);
  const audit = auditReplyOption({ key: "C", text: "在体育西路那边，地铁出来走五分钟就到。" }, ledger);
  assert.equal(audit.findings.length, 2, JSON.stringify(audit.findings));
});

test("盲评 P1-1：替用户定义「那部纪录片讲什么」要标注，且不改动原文", () => {
  const ledger = ledgerFrom(["我：最近有部纪录片挺火，回头看？", "她：什么题材的，先说来听听"]);
  const audit = auditReplyOption(
    { key: "A", text: "讲城市里普通人的生活变迁那种，节奏挺慢但看着舒服。你平时一般看什么类型的？" },
    ledger
  );
  assert.equal(audit.findings.length, 0, "内容型属于标注类，不该升级为拦截");
  assert.equal(audit.needsUserConfirm, true, JSON.stringify(audit.confirmations));
  assert.ok(audit.confirmations.some((item) => /作品或店铺/.test(item.reason)), JSON.stringify(audit.confirmations));
  // 只有前半句被标：问她的后半句是合法提问。
  assert.equal(audit.confirmations.length, 1, JSON.stringify(audit.confirmations));
  assert.equal(audit.text, "讲城市里普通人的生活变迁那种，节奏挺慢但看着舒服。你平时一般看什么类型的？");
});

test("盲评 P1-1：用户自己说过的内容被复述时不标注", () => {
  const ledger = ledgerFrom(["我：最近有部讲城市拆迁的纪录片挺火，回头看？", "她：好啊"]);
  const audit = auditReplyOption({ key: "A", text: "讲城市拆迁那种，看完挺久的。" }, ledger);
  assert.deepEqual(audit.confirmations, [], JSON.stringify(audit));
});

test("盲评 P2-3：玩笑不再被当成个人处境标注", () => {
  const ledger = ledgerFrom(["我：要不要顺路一起走一段，就当散步。", "她：可以呀，正好我也想走走"]);
  for (const text of [
    "行，那这条路上的路灯今天归我们检查了。",
    "好，那我这边忙完就过来，具体碰头点你方便的时候说一声就行。",
    "那你想从学校哪一头开始走？"
  ]) {
    const audit = auditReplyOption({ key: "B", text }, ledger);
    assert.equal(audit.needsUserConfirm, false, `不该标注：${text} => ${JSON.stringify(audit.confirmations)}`);
  }
});

test("标注措辞要跟着实际命中的类别走，不能一律写成「关于你自己的信息」", async () => {
  const { choiceConfirmNote } = await import("../public/modules/render/render-coach.js");
  const ledger = ledgerFrom(["我：最近有部纪录片挺火，回头看？", "她：什么题材的，先说来听听"]);
  const [audit] = groundReplyOptions([{ key: "A", text: "偏人文纪实的，讲一群人的真实生活。" }], ledger).options;
  const note = choiceConfirmNote(audit);
  assert.match(note, /作品或店铺/, note);
  assert.doesNotMatch(note, /关于你自己的信息/, note);
});

test("第一人称的位置陈述只标注、不拦截", () => {
  const ledger = ledgerFrom(["我：我一般七点到家", "她：这么早"]);
  const audit = auditReplyOption({ key: "A", text: "我那边走十分钟就到，你不用等太久。" }, ledger);
  assert.equal(audit.findings.length, 0, JSON.stringify(audit.findings));
  assert.ok(audit.confirmations.some((item) => item.entity === "走十分钟"), JSON.stringify(audit.confirmations));
});
