import { $, escapeHtml } from "../core/dom.js";
import {
  KNOWLEDGE_CATEGORIES, KNOWLEDGE_CARDS, KNOWLEDGE_SOURCES, KNOWLEDGE_REVIEWED_AT,
  getKnowledgeCards, evaluateKnowledgeAnswer
} from "../content/presentation-knowledge.js";

const controllers = new WeakMap();

function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function renderKnowledgeSources(ids, sources = KNOWLEDGE_SOURCES) {
  return [...new Set(ids)].map((id) => {
    const source = sources[id];
    if (!source) return "";
    const url = safeSourceUrl(source.url);
    return `<li>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.organization)} · ${escapeHtml(source.title)}</a>` : `<span>${escapeHtml(source.title)}</span>`}
      <small>${escapeHtml(source.kind)}${source.publishedAt ? ` · 页面日期：${escapeHtml(source.publishedAt)}` : " · 页面日期未录入"}</small>
      <p>${escapeHtml(source.supports)}</p></li>`;
  }).join("");
}

export function renderKnowledgeCard(card, sources = KNOWLEDGE_SOURCES) {
  const sourceIds = [...new Set(card.facts.flatMap((fact) => fact.sources))];
  const facts = card.facts.map((fact) => `<li>${escapeHtml(fact.text)} <small class="knowledge-fact-ref">依据：${fact.sources.map((id) => {
    const source = sources[id];
    const url = safeSourceUrl(source?.url);
    const label = `${source?.organization || "来源待核对"} [${sourceIds.indexOf(id) + 1}]`;
    return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>` : escapeHtml(label);
  }).join(" / ")}</small></li>`).join("");
  return `<details class="knowledge-card" name="presentation-lessons" data-knowledge-card="${escapeHtml(card.id)}">
    <summary><b>${escapeHtml(card.title)}</b><span>${escapeHtml(card.summary)}</span></summary>
    <div class="knowledge-card-body">
      <p class="knowledge-scope"><b>适用范围</b> ${escapeHtml(card.scope)}</p>
      <h3>知识依据</h3><ul class="knowledge-facts">${facts}</ul>
      <p class="knowledge-mistake"><b>常见误区</b> ${escapeHtml(card.mistake)}</p>
      <h3>试着做一次 <small>原创场景练习</small></h3>
      <ol>${card.practice.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
      <p class="knowledge-boundary"><b>使用边界</b> ${escapeHtml(card.boundary)}</p>
      <div class="knowledge-quiz" role="group" aria-label="${escapeHtml(card.title)}自测">
        <h3>理解自测</h3><p>${escapeHtml(card.quiz.question)}</p>
        <div class="knowledge-answer-options">${card.quiz.options.map((option, index) => `<button type="button" class="btn" data-knowledge-answer="${index}" data-card-id="${escapeHtml(card.id)}">${escapeHtml(option)}</button>`).join("")}</div>
        <p class="knowledge-feedback" aria-live="polite" aria-atomic="true"></p>
      </div>
      <h3>来源与支持范围</h3><ol class="knowledge-sources">${renderKnowledgeSources(sourceIds, sources)}</ol>
      <p class="note">原文核验：${KNOWLEDGE_REVIEWED_AT}（Asia/Shanghai）。以上是简短中文摘要，练习为本项目原创。</p>
    </div>
  </details>`;
}

export function renderPresentationKnowledge() {
  const panel = $("presentationKnowledgePanel");
  if (!panel) return null;
  if (controllers.has(panel)) return controllers.get(panel);
  let currentCategory = "fitness";
  panel.innerHTML = `<div class="knowledge-intro"><h2>选择一个主题</h2>
    <p>点开知识卡阅读，再做一个小练习。每条依据都可以直接查看原文。</p>
    <p class="note">${KNOWLEDGE_CARDS.length} 张知识卡 · ${Object.keys(KNOWLEDGE_SOURCES).length} 项公开依据 · 健康资料、服装设计与心理研究分别标注。</p></div>
    <nav class="knowledge-categories" aria-label="形象与身心知识分类">${KNOWLEDGE_CATEGORIES.map((category) => `<button type="button" data-knowledge-category="${category.id}" aria-pressed="false">${escapeHtml(category.title)}</button>`).join("")}</nav>
    <p class="knowledge-category-description"></p><div class="knowledge-lessons"></div>
    <p class="knowledge-privacy note">自测仅帮助理解知识，不评估吸引力或健康状况。此区不采集录音、照片、对方月经记录或心理档案；切换主题后自测反馈清空。</p>`;

  function showCategory(id, { focus = false } = {}) {
    const category = KNOWLEDGE_CATEGORIES.find((item) => item.id === id);
    if (!category) return false;
    currentCategory = id;
    panel.querySelectorAll("[data-knowledge-category]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.knowledgeCategory === id));
    });
    panel.querySelector(".knowledge-category-description").textContent = category.description;
    panel.querySelector(".knowledge-lessons").innerHTML = getKnowledgeCards(id).map((card) => renderKnowledgeCard(card)).join("");
    if (focus) panel.querySelector(`[data-knowledge-category="${id}"]`)?.focus();
    return true;
  }

  panel.addEventListener("click", (event) => {
    const categoryButton = event.target.closest("[data-knowledge-category]");
    if (categoryButton && panel.contains(categoryButton)) {
      showCategory(categoryButton.dataset.knowledgeCategory);
      return;
    }
    const answer = event.target.closest("[data-knowledge-answer]");
    if (!answer || !panel.contains(answer)) return;
    const result = evaluateKnowledgeAnswer(answer.dataset.cardId, Number(answer.dataset.knowledgeAnswer));
    const quiz = answer.closest(".knowledge-quiz");
    if (!result || !quiz) return;
    quiz.querySelector(".knowledge-feedback").textContent = `${result.correct ? "理解正确。" : "再看一下知识依据。"}${result.explanation}`;
    quiz.querySelectorAll("[data-knowledge-answer]").forEach((button) => button.setAttribute("aria-pressed", String(button === answer)));
  });

  const controller = { showCategory, get currentCategory() { return currentCategory; } };
  controllers.set(panel, controller);
  showCategory(currentCategory);
  return controller;
}
