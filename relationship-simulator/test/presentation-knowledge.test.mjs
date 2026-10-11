import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { KNOWLEDGE_CATEGORIES, KNOWLEDGE_CARDS, KNOWLEDGE_SOURCES, KNOWLEDGE_REVIEWED_AT, getKnowledgeCards, evaluateKnowledgeAnswer } from "../public/modules/content/presentation-knowledge.js";
import { renderKnowledgeCard, renderKnowledgeSources } from "../public/modules/render/render-presentation-knowledge.js";
import { computeWeightReview, computeTrainingRhythm, buildSkincareNotice, normalizeLifestyle } from "../public/modules/training/lifestyle.js";

test("六类知识有完整练习与逐条来源，所有来源均被使用且可追溯到公开专业机构", () => {
  assert.deepEqual(KNOWLEDGE_CATEGORIES.map((category) => category.id), ["fitness", "skincare", "style", "voice", "physiology", "psychology"]);
  assert.equal(new Set(KNOWLEDGE_CARDS.map((card) => card.id)).size, KNOWLEDGE_CARDS.length);
  const used = new Set();
  for (const category of KNOWLEDGE_CATEGORIES) {
    assert.ok(getKnowledgeCards(category.id).length >= 2, category.id);
  }
  for (const card of KNOWLEDGE_CARDS) {
    assert.ok(card.scope && card.mistake && card.boundary, card.id);
    assert.ok(card.practice.length >= 3 && card.practice.every((step) => typeof step === "string" && step.length > 10), card.id);
    for (const fact of card.facts) {
      assert.ok(fact.text && fact.sources.length, card.id);
      for (const id of fact.sources) {
        const source = KNOWLEDGE_SOURCES[id];
        assert.ok(source?.organization && source.kind && source.supports, `${card.id}: ${id}`);
        const url = new URL(source.url);
        assert.equal(url.protocol, "https:");
        assert.ok(["www.cdc.gov", "www.nhs.uk", "www.aad.org", "extension.usu.edu", "www.mouthhealthy.org", "www.nidcd.nih.gov", "womenshealth.gov", "pubmed.ncbi.nlm.nih.gov"].includes(url.hostname), id);
        used.add(id);
      }
    }
  }
  assert.deepEqual([...used].sort(), Object.keys(KNOWLEDGE_SOURCES).sort());
  assert.equal(KNOWLEDGE_REVIEWED_AT, "2026-10-04");
  assert.deepEqual(getKnowledgeCards("unknown"), []);
});

test("每个自测同时提供正确与错误解释，非法答案不产生分数或诊断", () => {
  for (const card of KNOWLEDGE_CARDS) {
    assert.equal(evaluateKnowledgeAnswer(card.id, card.quiz.answer)?.correct, true);
    const other = (card.quiz.answer + 1) % card.quiz.options.length;
    assert.equal(evaluateKnowledgeAnswer(card.id, other)?.correct, false);
    assert.ok(evaluateKnowledgeAnswer(card.id, other)?.explanation);
    for (const invalid of [-1, 100, NaN, "0", null]) assert.equal(evaluateKnowledgeAnswer(card.id, invalid), null);
  }
  assert.equal(evaluateKnowledgeAnswer("unknown", 0), null);
});

test("医疗数字与适用范围保留依据，穿搭与心理研究不包装为吸引力证明", () => {
  const byId = (id) => KNOWLEDGE_CARDS.find((card) => card.id === id);
  const aerobic = byId("fitness-baseline").facts[0];
  assert.match(aerobic.text, /150.*75.*2 天/);
  assert.deepEqual(aerobic.sources, ["cdc-activity"]);
  assert.match(byId("skin-baseline").facts[2].text, /SPF 30.*2 小时/);
  assert.match(byId("cycle-literacy").facts[1].text, /24–38/);
  assert.match(byId("skin-medication").scope, /不表示你正在服药/);
  assert.match(byId("style-design").boundary, /实践建议.*没有证明/);
  assert.match(byId("psych-individual").facts[0].text, /2005.*46.*多数但非全部/);
  assert.match(byId("sexual-health").boundary, /不使用本卡计算安全日/);
});

test("知识卡转义文本与属性，来源链接拒绝脚本和带凭据 URL", () => {
  const original = KNOWLEDGE_CARDS[0];
  const hostile = '<img src=x onerror="alert(1)">';
  const card = { ...original, id: hostile, title: hostile, summary: hostile, scope: hostile, mistake: hostile, boundary: hostile, practice: [hostile], facts: [{ text: hostile, sources: ["unsafe"] }], quiz: { ...original.quiz, question: hostile, options: [hostile] } };
  const sources = { unsafe: { organization: hostile, title: hostile, kind: hostile, supports: hostile, url: "javascript:alert(1)" } };
  const html = renderKnowledgeCard(card, sources);
  assert.doesNotMatch(html, /<img|href="javascript:|data-knowledge-card="<|<script/);
  assert.match(html, /&lt;img/);
  assert.match(html, /aria-live="polite"/);
  const credentials = renderKnowledgeSources(["bad"], { bad: { title: "bad", url: "https://private:secret@example.com/" } });
  assert.doesNotMatch(credentials, /href=|private|secret/);
  assert.equal(renderKnowledgeSources(["missing"]), "");
  for (const item of KNOWLEDGE_CARDS) {
    const normal = renderKnowledgeCard(item);
    assert.match(normal, /target="_blank" rel="noopener noreferrer"/);
    assert.match(normal, /原创场景练习/);
  }
});

test("旧生活记录兼容，提示不猜测药物或开热量处方，也不强迫补练", () => {
  const date = "2026-10-04";
  const previous = { fitness: { trainings: [{ date: "2026-10-01" }], weights: [{ date: "2026-09-26", kg: 60 }, { date, kg: 61 }] }, skincare: { days: [{ date, am: { cleanser: true, moisturizer: true, sunscreen: false }, pm: { cleanser: true } }] }, grooming: { days: [{ date, items: { shoes: true } }] } };
  const state = normalizeLifestyle(previous);
  assert.equal(state.fitness.trainings.length, 1);
  assert.equal(state.fitness.weights.length, 2);
  assert.equal(state.skincare.days[0].am.moisturizer, true);
  assert.equal(state.grooming.days[0].items.shoes, true);
  assert.doesNotMatch(computeWeightReview(state.fitness.weights, date).suggestion, /kcal|每日.*热量/);
  assert.doesNotMatch(buildSkincareNotice(state.skincare.days[0]).join(""), /异维|服药|强制/);
  assert.doesNotMatch(computeTrainingRhythm(state.fitness.trainings, date).message, /必须|补回来|今天练一天/);
});

test("入口与渲染接入生活视图，知识区没有音频或私密健康数据写入接口", async () => {
  const [html, app, renderer] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/modules/render/render-presentation-knowledge.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /data-view-panel="lifestyle"[^>]*><div id="presentationKnowledgePanel"><\/div><div id="lifestylePanel">/);
  assert.match(app, /renderPresentationKnowledge\(\)/);
  assert.match(renderer, /controllers\.has\(panel\)/); // 普通状态重渲染保留阅读分类。
  assert.doesNotMatch(renderer, /localStorage|sessionStorage|getUserMedia|MediaRecorder|fetch\(/);
});
