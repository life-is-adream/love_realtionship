// F4 会话级复盘报告：纯函数聚合全覆盖 + 事件幂等 + UI 接线源码级断言。
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { r1ViolationsFor } from "./helpers/conventions.mjs";

import {
  REPORT_DIM_KEYS,
  REPORT_TEXTBOOK_REF_LIMIT,
  SESSION_REPORT_RULES,
  buildAnalysesFromTrainingLog,
  buildSessionReport,
  buildReportMarkdown
} from "../public/modules/training/session-report.js";
import { recordTrainingEvent, normalizeLearningState } from "../public/modules/core/learning-state.js";

const NOW = Date.parse("2026-02-01T12:00:00.000Z");

// ── buildAnalysesFromTrainingLog：trainingLog → 报告输入 ─────────────────────

test("buildAnalysesFromTrainingLog：momentum 映射为 drive，文本 trim，保留 stage/source", () => {
  const analyses = buildAnalysesFromTrainingLog([
    { time: "2026-02-01T10:00:00.000Z", stage: "熟悉期", source: "model", mine: "  今天聊得挺舒服的。 ", score: { total: 82.4, naturalness: 80, empathy: 90, boundary: 70, momentum: 65 } }
  ]);
  assert.equal(analyses.length, 1);
  assert.equal(analyses[0].text, "今天聊得挺舒服的。");
  assert.equal(analyses[0].overall, 82);
  assert.equal(analyses[0].stage, "熟悉期");
  assert.deepEqual(analyses[0].dims, { naturalness: 80, empathy: 90, boundary: 70, drive: 65 });
});

test("buildAnalysesFromTrainingLog：无文本 / 无 score / 总分非法 的条目跳过", () => {
  const analyses = buildAnalysesFromTrainingLog([
    { mine: "只有文本没有分数" },
    { score: { total: 80 }, mine: "" },
    { mine: "总分非法", score: { total: "abc" } },
    null,
    { mine: "有效", score: { total: 70, naturalness: 60, empathy: 60, boundary: 60, momentum: 60 } }
  ]);
  assert.equal(analyses.length, 1);
  assert.equal(analyses[0].text, "有效");
});

// ── buildSessionReport：覆盖与取数口径 ───────────────────────────────────────

const MSG = (text) => ({ type: "me", text });

test("空会话：messageCount 0、coverage 0、best/worst null、洞察给空会话提示", async () => {
  const report = await buildSessionReport([], [], { now: NOW });
  assert.equal(report.messageCount, 0);
  assert.equal(report.analyzedCount, 0);
  assert.equal(report.coverage, 0);
  assert.equal(report.best, null);
  assert.equal(report.worst, null);
  assert.deepEqual(report.dimAverages, { naturalness: null, empathy: null, boundary: null, drive: null });
  assert.deepEqual(report.textbookRefs, []);
  assert.equal(report.insights.length, 1);
  assert.match(report.insights[0], /还没有有效的用户消息/);
  assert.equal(report.generatedAt, "2026-02-01T12:00:00.000Z");
});

test("全部未分析：跳过并如实反映 coverage，洞察提示先完成一轮分析", async () => {
  const report = await buildSessionReport([MSG("你好"), MSG("在干嘛"), MSG("周末有空吗")], [], { now: NOW });
  assert.equal(report.messageCount, 3);
  assert.equal(report.analyzedCount, 0);
  assert.equal(report.coverage, 0);
  assert.match(report.insights[0], /暂无已评分消息/);
});

test("部分覆盖：撤回/残留评分（文本对不上消息）不算覆盖，coverage 如实反映", async () => {
  const messages = [MSG("你好"), MSG("在干嘛"), MSG("周末有空吗"), MSG("那下次吧")];
  const analyses = [
    { text: "在干嘛", ts: "2026-02-01T09:00:00.000Z", overall: 72, dims: { naturalness: 70, empathy: 60, boundary: 80, drive: 66 } },
    { text: "已撤回的旧消息", ts: "2026-02-01T08:00:00.000Z", overall: 50, dims: { naturalness: 50, empathy: 50, boundary: 50, drive: 50 } }
  ];
  const report = await buildSessionReport(messages, analyses, { now: NOW });
  assert.equal(report.messageCount, 4);
  assert.equal(report.analyzedCount, 1);
  assert.equal(report.coverage, 0.25);
  assert.equal(report.best.text, "在干嘛");
  assert.equal(report.worst.text, "在干嘛");
  // 覆盖率 < 0.5 时给样本不足提示
  assert.ok(report.insights.some((line) => line.includes("样本不足")));
});

test("并列最优/最差：同 overall 取 ts 最新的一条", async () => {
  const messages = [MSG("甲"), MSG("乙"), MSG("丙")];
  const analyses = [
    { text: "甲", ts: "2026-02-01T08:00:00.000Z", overall: 90, dims: { naturalness: 90, empathy: 90, boundary: 90, drive: 90 } },
    { text: "乙", ts: "2026-02-01T10:00:00.000Z", overall: 90, dims: { naturalness: 88, empathy: 88, boundary: 88, drive: 88 } },
    { text: "丙", ts: "2026-02-01T07:00:00.000Z", overall: 40, dims: { naturalness: 40, empathy: 40, boundary: 40, drive: 40 } }
  ];
  const report = await buildSessionReport(messages, analyses, { now: NOW });
  assert.equal(report.best.text, "乙");
  assert.equal(report.worst.text, "丙");
});

test("最差消息带短板标签：维度 < 55 逐维点名，仅总分 < 65 时点名最弱维度", async () => {
  const dims = { naturalness: 45, empathy: 80, boundary: 70, drive: 30 };
  const report = await buildSessionReport([MSG("低分消息")], [{ text: "低分消息", ts: "2026-02-01T09:00:00.000Z", overall: 62, dims }], { now: NOW });
  assert.deepEqual(report.worst.issues, ["自然度短板", "推进力短板"]);

  const report2 = await buildSessionReport([MSG("中庸低分")], [{ text: "中庸低分", ts: "2026-02-01T09:00:00.000Z", overall: 62, dims: { naturalness: 62, empathy: 62, boundary: 62, drive: 62 } }], { now: NOW });
  // 各维 >= 55 但总分 < 65：点名最弱维度（并列取 drive 之前的键序——reduce 取第一个最小值，即 naturalness）
  assert.deepEqual(report2.worst.issues, ["自然度短板"]);

  const report3 = await buildSessionReport([MSG("高分消息")], [{ text: "高分消息", ts: "2026-02-01T09:00:00.000Z", overall: 90, dims: { naturalness: 90, empathy: 90, boundary: 90, drive: 90 } }], { now: NOW });
  assert.deepEqual(report3.worst.issues, []);
});

test("均值计算边界：null/undefined/\"\" 维度显式排除（Number(null)===0 陷阱），某维全无评分则均值为 null", async () => {
  const analyses = [
    { text: "消息一", ts: "2026-02-01T08:00:00.000Z", overall: 70, dims: { naturalness: null, empathy: 80, boundary: "", drive: undefined } },
    { text: "消息二", ts: "2026-02-01T09:00:00.000Z", overall: 80, dims: { naturalness: 60, empathy: 70, boundary: 90, drive: null } }
  ];
  const report = await buildSessionReport([MSG("消息一"), MSG("消息二")], analyses, { now: NOW });
  assert.equal(report.dimAverages.naturalness, 60); // 只算消息二的 60，null 不当 0 拉低
  assert.equal(report.dimAverages.empathy, 75); // (80+70)/2
  assert.equal(report.dimAverages.boundary, 90); // "" 不当 0
  assert.equal(report.dimAverages.drive, null); // 两个都无评分 → null，不虚构 0
});

test("同文本重复评分去重：保留 ts 更新的一条（防重发重复计分）", async () => {
  const analyses = [
    { text: "同一句", ts: "2026-02-01T08:00:00.000Z", overall: 40, dims: { naturalness: 40, empathy: 40, boundary: 40, drive: 40 } },
    { text: "同一句", ts: "2026-02-01T10:00:00.000Z", overall: 80, dims: { naturalness: 80, empathy: 80, boundary: 80, drive: 80 } }
  ];
  const report = await buildSessionReport([MSG("同一句")], analyses, { now: NOW });
  assert.equal(report.analyzedCount, 1);
  assert.equal(report.best.overall, 80);
  assert.equal(report.worst.overall, 80);
  assert.equal(report.dimAverages.naturalness, 80);
});

test("stage/mode 透传，mode 非法回退 anti", async () => {
  const report = await buildSessionReport([], [], { stage: "暧昧期", mode: "pua", now: NOW });
  assert.equal(report.stage, "暧昧期");
  assert.equal(report.mode, "pua");
  const report2 = await buildSessionReport([], [], { mode: "nonsense", now: NOW });
  assert.equal(report2.mode, "anti");
});

// ── insights 规则阈值 ────────────────────────────────────────────────────────

test("insights：覆盖率阈值（<0.5 样本不足 / ≥0.5<0.8 不提 / ≥0.8 可信）", async () => {
  const messages = Array.from({ length: 10 }, (_, index) => MSG(`消息${index}`));
  const mk = (count) => Array.from({ length: count }, (_, index) => ({
    text: `消息${index}`, ts: `2026-02-01T${String(index + 1).padStart(2, "0")}:00:00.000Z`, overall: 75,
    dims: { naturalness: 75, empathy: 75, boundary: 75, drive: 75 }
  }));
  const low = await buildSessionReport(messages, mk(4), { now: NOW });
  assert.ok(low.insights.some((line) => line.includes("样本不足")));
  const mid = await buildSessionReport(messages, mk(6), { now: NOW });
  assert.ok(!mid.insights.some((line) => line.includes("覆盖率")));
  const high = await buildSessionReport(messages, mk(9), { now: NOW });
  assert.ok(high.insights.some((line) => line.includes("具备参考价值")));
  assert.equal(SESSION_REPORT_RULES.coverageLowBelow, 0.5);
  assert.equal(SESSION_REPORT_RULES.coverageHighAbove, 0.8);
});

test("insights：最弱维度 < 60 点名、最强维度 > 80 点名（并列取键序靠前）", async () => {
  const messages = [MSG("甲"), MSG("乙")];
  const analyses = [
    { text: "甲", ts: "2026-02-01T08:00:00.000Z", overall: 55, dims: { naturalness: 50, empathy: 70, boundary: 70, drive: 50 } },
    { text: "乙", ts: "2026-02-01T09:00:00.000Z", overall: 55, dims: { naturalness: 52, empathy: 72, boundary: 72, drive: 52 } }
  ];
  const report = await buildSessionReport(messages, analyses, { now: NOW });
  assert.ok(report.insights.some((line) => line.includes("「自然度」均分 51，是本场最弱维度")));
  assert.ok(!report.insights.some((line) => line.includes("最强维度")));

  const strong = await buildSessionReport(messages, [
    { text: "甲", ts: "2026-02-01T08:00:00.000Z", overall: 90, dims: { naturalness: 90, empathy: 90, boundary: 90, drive: 90 } },
    { text: "乙", ts: "2026-02-01T09:00:00.000Z", overall: 90, dims: { naturalness: 92, empathy: 92, boundary: 92, drive: 92 } }
  ], { now: NOW });
  assert.ok(strong.insights.some((line) => line.includes("「自然度」均分 91，是本场最强维度")));
});

test("insights：最佳 ≥ 80 提范本、最差 < 65 提复盘练习", async () => {
  const messages = [MSG("甲"), MSG("乙")];
  const analyses = [
    { text: "甲", ts: "2026-02-01T08:00:00.000Z", overall: 85, dims: { naturalness: 85, empathy: 85, boundary: 85, drive: 85 } },
    { text: "乙", ts: "2026-02-01T09:00:00.000Z", overall: 60, dims: { naturalness: 60, empathy: 60, boundary: 60, drive: 60 } }
  ];
  const report = await buildSessionReport(messages, analyses, { now: NOW });
  assert.ok(report.insights.some((line) => line.includes("最佳一条消息拿到 85 分")));
  assert.ok(report.insights.some((line) => line.includes("最差一条仅 60 分")));
});

test("insights：与上一份报告对比，变化 |Δ| ≥ 3 点名，含退步提示", async () => {
  const messages = [MSG("甲")];
  const analyses = [{ text: "甲", ts: "2026-02-01T09:00:00.000Z", overall: 70, dims: { naturalness: 70, empathy: 75, boundary: 60, drive: 70 } }];
  const lastReport = { generatedAt: "2026-01-31T09:00:00.000Z", dimAverages: { naturalness: 74, empathy: 71, boundary: 64, drive: 70 } };
  const report = await buildSessionReport(messages, analyses, { now: NOW, lastReport });
  const trend = report.insights.find((line) => line.includes("与上一份报告相比"));
  assert.ok(trend, "应有环比洞察句");
  assert.match(trend, /共情 \+4/);
  assert.match(trend, /自然度 -4/);
  assert.match(trend, /关注退步维度/);
  assert.ok(!trend.includes("推进力"), "变化小于阈值的维度不点名");

  const flat = await buildSessionReport(messages, analyses, { now: NOW, lastReport: { generatedAt: NOW, dimAverages: { naturalness: 71, empathy: 74, boundary: 61, drive: 69 } } });
  assert.ok(!flat.insights.some((line) => line.includes("与上一份报告相比")));
});

// ── textbookRefs：gate 降级与命中结构 ────────────────────────────────────────

test("textbookRefs：未注入检索函数 / 检索抛错 / 返回空 → 空数组降级（报告卡显示未命中文案而非报错）", async () => {
  const messages = [MSG("甲")];
  const analyses = [{ text: "甲", ts: "2026-02-01T09:00:00.000Z", overall: 60, dims: { naturalness: 60, empathy: 60, boundary: 60, drive: 60 } }];
  const none = await buildSessionReport(messages, analyses, { now: NOW });
  assert.deepEqual(none.textbookRefs, []);
  const thrown = await buildSessionReport(messages, analyses, { now: NOW, searchTextbook: async () => { throw new Error("index offline"); } });
  assert.deepEqual(thrown.textbookRefs, []);
  const empty = await buildSessionReport(messages, analyses, { now: NOW, searchTextbook: async () => [] });
  assert.deepEqual(empty.textbookRefs, []);
});

test("textbookRefs：worst 优先 best 补足、合计 ≤3、按 chapter:reviewPointId 去重、结构含 chapter/title/excerpt", async () => {
  const messages = [MSG("甲"), MSG("乙")];
  const analyses = [
    { text: "甲", ts: "2026-02-01T08:00:00.000Z", overall: 90, dims: { naturalness: 90, empathy: 90, boundary: 90, drive: 90 } },
    { text: "乙", ts: "2026-02-01T09:00:00.000Z", overall: 50, dims: { naturalness: 50, empathy: 50, boundary: 50, drive: 50 } }
  ];
  const queries = [];
  const searchTextbook = async (query, limit) => {
    queries.push({ query, limit });
    if (query.includes("乙")) {
      return [
        { chapterId: 3, chapterTitle: "留出空间", reviewPointId: "r1", title: "先别追问", searchExcerpt: "被冷处理时先留空间。" },
        { chapterId: 3, chapterTitle: "留出空间", reviewPointId: "r1", title: "先别追问", searchExcerpt: "重复条目应去重。" }
      ];
    }
    return [
      { chapterId: 5, chapterTitle: "邀约", reviewPointId: "r9", title: "具体化邀约", searchExcerpt: "约见要给出时间地点。" }
    ];
  };
  const report = await buildSessionReport(messages, analyses, { now: NOW, searchTextbook });
  assert.ok(queries[0].query.includes("乙"), "worst 文本先检索");
  assert.equal(report.textbookRefs.length, 2);
  assert.deepEqual(report.textbookRefs[0], { chapter: 3, chapterTitle: "留出空间", reviewPointId: "r1", title: "先别追问", excerpt: "被冷处理时先留空间。" });
  assert.equal(report.textbookRefs[1].chapter, 5);
  assert.ok(queries[0].limit >= 1 && queries[0].limit <= REPORT_TEXTBOOK_REF_LIMIT);
});

// ── buildReportMarkdown：复制文本快照 ────────────────────────────────────────

test("buildReportMarkdown：报告渲染为 Markdown 纯文本，无教材命中显示「未命中教材复盘」", async () => {
  const messages = [MSG("甲"), MSG("乙")];
  const analyses = [
    { text: "甲", ts: "2026-02-01T08:00:00.000Z", overall: 85, dims: { naturalness: 85, empathy: 85, boundary: 85, drive: 85 } },
    { text: "乙", ts: "2026-02-01T09:00:00.000Z", overall: 52, dims: { naturalness: 45, empathy: 60, boundary: 70, drive: 52 } }
  ];
  const report = await buildSessionReport(messages, analyses, { stage: "熟悉期", mode: "anti", now: NOW });
  const markdown = buildReportMarkdown(report);
  assert.match(markdown, /^# 会话复盘报告\n/);
  assert.match(markdown, /- 生成时间：2026-02-01T12:00:00\.000Z/);
  assert.match(markdown, /- 阶段：熟悉期/);
  assert.match(markdown, /- 模式：反操控/);
  assert.match(markdown, /- 消息：共 2 条 · 已评分 2 条 · 覆盖率 100%/);
  assert.match(markdown, /## 四维均值\n- 自然度：\d+\n- 共情：\d+\n- 边界感：\d+\n- 推进力：\d+/);
  assert.match(markdown, /## 最佳消息（85 分）/);
  assert.match(markdown, /## 最差消息（52 分）/);
  assert.match(markdown, /短板：自然度短板/);
  assert.match(markdown, /## 教材复盘\n- 未命中教材复盘/);
  assert.match(markdown, /## 洞察\n- /);
  // 快照：固定输入 → 固定输出（确定性校验）
  const again = await buildSessionReport(messages, analyses, { stage: "熟悉期", mode: "anti", now: NOW });
  assert.equal(buildReportMarkdown(again), markdown);
});

test("buildReportMarkdown：有教材命中时逐条列出；维度缺分显示 —；空报告返回空串", async () => {
  const messages = [MSG("甲")];
  const analyses = [{ text: "甲", ts: "2026-02-01T09:00:00.000Z", overall: 70, dims: { naturalness: null, empathy: 70, boundary: 70, drive: 70 } }];
  const report = await buildSessionReport(messages, analyses, {
    now: NOW,
    searchTextbook: async () => [{ chapterId: 8, chapterTitle: "边界", reviewPointId: "r2", title: "分寸感", searchExcerpt: "尊重节奏。" }]
  });
  const markdown = buildReportMarkdown(report);
  assert.match(markdown, /## 教材复盘\n- 第8章 · 分寸感：尊重节奏。/);
  assert.match(markdown, /## 最佳消息（70 分）/);
  assert.match(markdown, /> 甲/);
  assert.match(markdown, /自然度 —/);
  assert.equal(buildReportMarkdown(null), "");
});

// ── 训练事件落账幂等（recordTrainingEvent 同 id 去重） ───────────────────────

test("session-report 事件落账：同 generatedAt 的 id 重复记录只落一条（重复点击不重复落账）", () => {
  const reportId = "session-report-2026-02-01T12:00:00.000Z";
  const metadata = { messageCount: 2, analyzedCount: 2, coverage: 1, dimAverages: { naturalness: 80, empathy: 80, boundary: 80, drive: 80 }, bestOverall: 85, worstOverall: 52, textbookRefCount: 0 };
  let learning = normalizeLearningState({});
  learning = recordTrainingEvent(learning, {
    id: reportId, type: "session-report", source: "local", dimension: null,
    createdAt: "2026-02-01T12:00:00.000Z", metadata
  });
  learning = recordTrainingEvent(learning, {
    id: reportId, type: "session-report", source: "local", dimension: null,
    createdAt: "2026-02-01T12:05:00.000Z", metadata
  });
  const events = learning.events.filter((event) => event.type === "session-report");
  assert.equal(events.length, 1);
  assert.equal(events[0].id, reportId);
  assert.equal(events[0].createdAt, "2026-02-01T12:00:00.000Z");
  assert.deepEqual(events[0].metadata, metadata);
  assert.equal(events[0].dimension, null);
  // 已知怪癖（learning-state 既有行为，非本批引入，不在 F4 内修改）：
  // createTrainingEvent 的 normalizeScore(Number(null)===0) 会把显式 null 分数在
  // 重新标准化时归一为 0。本事件 dimension 为 null，buildLearningSummary 按
  // 「dimension 不在四维桶内」直接跳过聚合，因此 0 分不会污染维度均值。
  assert.ok(events[0].score === null || events[0].score === 0);
});

// ── UI 接线源码级断言 ────────────────────────────────────────────────────────

const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const docSource = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const reportModuleSource = await readFile(new URL("../public/modules/render/render-session-report.js", import.meta.url), "utf8");
const pureModuleSource = await readFile(new URL("../public/modules/training/session-report.js", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

test("UI 接线：按钮与报告卡容器存在于学习工具区，app.js 挂载渲染并绑定生成", () => {
  assert.match(docSource, /id="sessionReportBtn"/);
  assert.match(docSource, /id="sessionReportPanel"/);
  assert.match(appSource, /renderSessionReport\(\)/);
  assert.match(appSource, /\$\("sessionReportBtn"\)\?\.addEventListener/);
  assert.match(appSource, /generateSessionReport\(\{ openLongReader \}\)/);
  // 报告卡复用错题本布局先例
  assert.match(reportModuleSource, /mistakes-box/);
  assert.match(stylesSource, /session-report-box/);
});

test("UI 接线：教材链走既有 gate 不绕过（先 enableTextbookIndexLoad 再取共享索引 + searchTextbook）", () => {
  // gate 放开必须先于索引构建
  const enableAt = reportModuleSource.indexOf("enableTextbookIndexLoad();");
  const indexAt = reportModuleSource.indexOf("getSharedTextbookIndex()", enableAt);
  assert.ok(enableAt > -1 && indexAt > enableAt, "报告按钮点击应先放开懒加载 gate");
  assert.match(reportModuleSource, /import \{ searchTextbook \} from "\.\.\/content\/textbook-search\.js";/);
  assert.match(reportModuleSource, /import \{ enableTextbookIndexLoad \} from "\.\/render-learning\.js";/);
  // 纯模块不得直接触碰索引/loader
  assert.doesNotMatch(pureModuleSource, /getSharedTextbookIndex|loadAllChapters|long-content-loader/);
});

test("UI 接线：复制/保存动作齐备，保存走 mutate + recordTrainingEvent 且 id 用 generatedAt 时间戳", () => {
  assert.match(reportModuleSource, /data-report-action="copy"/);
  assert.match(reportModuleSource, /data-report-action="save"/);
  assert.match(reportModuleSource, /navigator\.clipboard\?\.writeText/);
  assert.match(reportModuleSource, /buildReportMarkdown\(/);
  assert.match(reportModuleSource, /mutate\(\(state\) =>/);
  assert.match(reportModuleSource, /recordTrainingEvent\(state\.learning/);
  assert.match(reportModuleSource, /id = `session-report-\$\{report\.generatedAt\}`/);
  assert.match(reportModuleSource, /type: "session-report"/);
  // 教材引用跳转复用阅读器既有实现
  assert.match(reportModuleSource, /data-report-chapter/);
  assert.match(reportModuleSource, /openLongReader\(/);
});

test("UI 接线：render-session-report 全部插值过 escapeHtml 且零 LLM", () => {
  // 同 mistakes.test.mjs：转义由 R1 实际执行，源码正则断言只保留零 LLM 检查。
  assert.deepEqual(r1ViolationsFor("public/modules/render/render-session-report.js"), [], "render-session-report 存在未转义的 HTML 插值");
  assert.doesNotMatch(reportModuleSource, /callLLM|api-client/);
  assert.doesNotMatch(pureModuleSource, /callLLM|fetch\(|localStorage\.|document\./);
});

// ── ② 对方视角回放 + 题眼句 ──────────────────────────────────────────────────

test("herReplay：按时间正序回放、上限 6 条，标签来自维度规则的启发式", async () => {
  const mk = (ts, text, total, dims) => ({ ts, text, overall: total, dims });
  const analyses = [
    mk("2026-02-01T10:05:00.000Z", "第七条", 70, { naturalness: 70, empathy: 70, boundary: 70, drive: 70 }),
    mk("2026-02-01T09:00:00.000Z", "最早的自说自话", 60, { naturalness: 70, empathy: 50, boundary: 70, drive: 70 }),
    mk("2026-02-01T09:10:00.000Z", "追问连击", 55, { naturalness: 70, empathy: 70, boundary: 50, drive: 70 }),
    mk("2026-02-01T09:20:00.000Z", "快速推进", 75, { naturalness: 70, empathy: 70, boundary: 70, drive: 85 }),
    mk("2026-02-01T09:30:00.000Z", "自然表达", 85, { naturalness: 85, empathy: 70, boundary: 70, drive: 70 }),
    mk("2026-02-01T09:40:00.000Z", "普通一条", 70, { naturalness: 70, empathy: 70, boundary: 70, drive: 70 }),
    mk("2026-02-01T09:50:00.000Z", "第八条被截断", 70, { naturalness: 70, empathy: 70, boundary: 70, drive: 70 })
  ];
  const messages = analyses.map((item) => ({ type: "me", text: item.text }));
  const report = await buildSessionReport(messages, analyses, { now: NOW });
  const lines = report.herReplay.lines;
  assert.equal(lines.length, 6, "回放上限 6 条");
  assert.equal(lines[0].text, "最早的自说自话", "按时间正序");
  // 正序排列后取前 6 条：最新的 10:05 一条被排除，09:50 的入选
  assert.equal(lines[5].text, "第八条被截断");
  const byText = new Map(lines.map((line) => [line.text, line]));
  assert.deepEqual(byText.get("最早的自说自话").tags, ["这条更多在说你自己，先接住对方再表达"]);
  assert.deepEqual(byText.get("追问连击").tags, ["这条留给对方的拒绝空间很小"]);
  assert.deepEqual(byText.get("快速推进").tags, ["这条在明显推进节奏"]);
  assert.deepEqual(byText.get("自然表达").tags, ["这条读起来自然"]);
  assert.deepEqual(byText.get("普通一条").tags, []);
  assert.match(report.herReplay.note, /不等于对方的真实感受/);
});

test("markdown：含对方视角回放节与题眼句，空回放给明确提示", async () => {
  const messages = [{ type: "me", text: "今天聊得挺舒服的。" }];
  const analyses = [{ mine: "今天聊得挺舒服的。", score: { total: 82, naturalness: 80, empathy: 90, boundary: 70, momentum: 65 } }];
  const report = await buildSessionReport(messages, analyses, { now: NOW });
  const md = buildReportMarkdown(report);
  assert.match(md, /## 对方视角回放/);
  assert.match(md, /不等于对方的真实感受/);
  assert.match(md, /今天聊得挺舒服的/);
  assert.match(md, /游戏可以重来，现实没有存档/);

  const empty = buildReportMarkdown(await buildSessionReport([], [], { now: NOW }));
  assert.match(empty, /暂无已评分消息，无法回放对方视角/);
  assert.match(empty, /游戏可以重来，现实没有存档/, "题眼句在空会话也要出现");
});

test("UI 接线：报告卡渲染对方视角回放区块、题眼句收尾", () => {
  assert.match(reportModuleSource, /renderHerReplay\(report\.herReplay\)/);
  assert.match(reportModuleSource, /session-report-replay/);
  assert.match(reportModuleSource, /游戏可以重来，现实没有存档/);
  assert.match(reportModuleSource, /report-closing-line/);
});
