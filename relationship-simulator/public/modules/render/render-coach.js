import { $, escapeHtml } from "../core/dom.js";
import { coachEvidenceCards } from "../coach/evidence-contract.js";
import { buildHerVoice } from "../coach/her-voice.js";
import { clampScore } from "../coach/coach.js";
import { getCurrentPersona, getLatestMineText, getPersonaMemory, getState, mutate } from "../core/state.js";
import { collectMistake } from "../core/mistakes.js";

export function card(title, text) {
  return `<div class="mini"><h3>${escapeHtml(title)}</h3><div>${escapeHtml(text || "")}</div></div>`;
}

/**
 * ① 角色回信卡：先让「她」说话（第一人称读法），分数与维度保留在后方。
 * 纯本地启发式（her-voice.js），零模型调用；纯函数导出便于测试。
 */
export function herVoiceCardHtml(score) {
  const voice = buildHerVoice(score, getCurrentPersona()?.name || "");
  if (!voice) return "";
  const signature = voice.signature ? ` —— 模拟的「${voice.signature}」` : "";
  return `<div class="mini her-voice-card"><h3>${escapeHtml(voice.headline)}</h3>
    <div>${voice.lines.map((line) => `<p>「${escapeHtml(line)}」</p>`).join("")}<p class="note">${escapeHtml(`以上是${signature || "模拟角色"}的可能读法。${voice.note}`)}</p></div></div>`;
}

function dimLabel(key) {
  return { naturalness: "自然度", empathy: "共情", boundary: "边界感", momentum: "推进力" }[key] || key;
}

function sourceBadge(source) {
  if (source === "model") return '<span class="source-badge model">MiMo</span>';
  if (source === "local") return '<span class="source-badge local">本地</span>';
  return '<span class="source-badge">其他</span>';
}

function formatDelta(current, previous) {
  if (previous == null) return "";
  const diff = current - previous;
  if (diff === 0) return '<span class="score-delta flat">→ 0</span>';
  const arrow = diff > 0 ? "↑" : "↓";
  return `<span class="score-delta ${diff > 0 ? "up" : "down"}">${arrow} ${Math.abs(diff)}</span>`;
}

function buildSparkline(totals, width = 160, height = 36) {
  if (totals.length < 2) return "";
  const min = Math.min(...totals) - 3;
  const max = Math.max(...totals) + 3;
  const range = Math.max(max - min, 1);
  const coords = totals.map((value, i) => ({ x: (i / (totals.length - 1)) * width, y: height - ((value - min) / range) * (height - 6) - 3 }));
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const last = coords.at(-1);
  return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-label="分数趋势"><path d="${path}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="3" fill="currentColor"/></svg>`;
}

export function scoreBar(label, value, { weakest = false, strongest = false } = {}) {
  const num = clampScore(value);
  const tag = weakest ? '<em class="bar-tag weak">短板</em>' : strongest ? '<em class="bar-tag strong">亮点</em>' : "";
  return `<div class="score-bar ${weakest ? "is-weak" : ""} ${strongest ? "is-strong" : ""}"><div><span>${escapeHtml(label)}${tag}</span><strong>${num}</strong></div><i style="width:${num}%"></i></div>`;
}

export function renderTraining(currentScore = null) {
  const panel = $("progressPanel");
  if (!panel) return;
  const log = Array.isArray(getState().trainingLog) ? getState().trainingLog : [];
  const score = currentScore || log[0]?.score || null;
  if (!score && log.length === 0) {
    panel.innerHTML = '<div class="mini"><h3>暂无评分</h3><div>完成一轮模型调用或本地生成后，这里会记录分数、短板和下一步训练。</div></div><div class="mini mistake-manual-row"><button class="btn small ghost" id="addMistakeBtn" type="button">✚ 加入错题本</button><small>手动收集当前回复（无论分数），供错题本复盘。</small></div>';
    $("addMistakeBtn")?.addEventListener("click", addCurrentMistake);
    return;
  }
  const isLatestInLog = log[0]?.score === score;
  const previousTotal = isLatestInLog ? log[1]?.score?.total ?? null : log[0]?.score?.total ?? null;
  const sparkTotals = log.slice(0, 7).reverse().map((item) => item.score.total);
  if (currentScore && !isLatestInLog) sparkTotals.push(currentScore.total);
  const weakestKey = score.weakestDim || "";
  const strongestKey = score.strongestDim || "";
  const historyItems = log.slice(1, 6);
  panel.innerHTML = `
    <div class="score-card"><div class="score-ring">${escapeHtml(score.total)}</div><div class="score-card-body"><h3>本轮总分 ${formatDelta(score.total, previousTotal)}</h3><p>${escapeHtml(score.summary || "保持自然、尊重和具体表达。")}</p><button class="btn small ghost" id="addMistakeBtn" type="button">✚ 加入错题本</button></div></div>
    ${herVoiceCardHtml(score)}
    <div class="score-bars">${scoreBar("自然度", score.naturalness, { weakest: weakestKey === "naturalness", strongest: strongestKey === "naturalness" })}${scoreBar("共情", score.empathy, { weakest: weakestKey === "empathy", strongest: strongestKey === "empathy" })}${scoreBar("边界感", score.boundary, { weakest: weakestKey === "boundary", strongest: strongestKey === "boundary" })}${scoreBar("推进力", score.momentum, { weakest: weakestKey === "momentum", strongest: strongestKey === "momentum" })}</div>
    <div class="training-insights"><div class="insight insight-strength"><b>本轮亮点</b><p>${escapeHtml(score.strength || "表达基本自然，没有明显硬伤。")}</p></div><div class="insight insight-shortcoming"><b>核心短板</b><p>${escapeHtml(score.shortcoming || "继续观察自己的回复是否给对方留足接话空间。")}</p></div></div>
    <div class="mini next-practice"><h3>下一步训练</h3><div>${escapeHtml(score.nextPractice || "下一轮尝试：先回应她的问题，再补一个轻松的开放问题。")}</div></div>
    ${sparkTotals.length >= 2 ? `<div class="mini trend-mini"><h3>近 ${sparkTotals.length} 轮趋势</h3>${buildSparkline(sparkTotals)}</div>` : ""}
    ${historyItems.length ? `<div class="log-section"><h4>历史记录</h4><div class="log-list">${historyItems.map((item, index) => { const prev = log[index + 2]?.score?.total ?? null; const weak = item.score.weakestDim; const strong = item.score.strongestDim; const oneLiner = item.score.shortcoming || item.score.summary || ""; const mine = String(item.mine || ""); return `<div class="log-item"><div class="log-meta"><time>${escapeHtml(item.time)}</time>${item.stage ? `<span class="stage-badge">${escapeHtml(item.stage.slice(0, 8))}</span>` : ""}${sourceBadge(item.source)}${!item.baseline ? '<span class="baseline-tag">校准前</span>' : ""}</div><div class="log-body"><div class="log-score"><strong>${escapeHtml(item.score.total)}分</strong>${formatDelta(item.score.total, prev)}</div>${mine ? `<div class="log-mine">你：${escapeHtml(mine.slice(0, 28))}${mine.length > 28 ? "…" : ""}</div>` : ""}<div class="log-dims">${weak ? `<span class="dim-pill weak">${dimLabel(weak)} 低</span>` : ""}${strong ? `<span class="dim-pill strong">${dimLabel(strong)} 高</span>` : ""}</div><p>${escapeHtml(oneLiner)}</p></div></div>`; }).join("")}</div></div>` : ""}`;
  $("addMistakeBtn")?.addEventListener("click", addCurrentMistake);
}

/** F2 手动收集：当前用户消息 + 当前评分（无论分数）收入错题本。 */
function addCurrentMistake() {
  const state = getState();
  const score = state.lastAnalysis?.coachScore || state.trainingLog?.[0]?.score || null;
  const text = getLatestMineText($("userInput")?.value || "");
  if (!text) {
    $("apiStatus").textContent = "没有可收集的用户消息，先输入或发送一条回复。";
    return;
  }
  const collected = mutate((draft) => {
    const outcome = collectMistake(draft.mistakes, {
      ts: new Date().toISOString(),
      source: "manual",
      stage: $("stage")?.value || "",
      mode: draft.trainingMode === "pua" ? "pua" : "anti",
      text,
      dims: score
        ? { naturalness: score.naturalness, empathy: score.empathy, boundary: score.boundary, drive: score.momentum }
        : null,
      issues: []
    });
    draft.mistakes = outcome.mistakes;
    return outcome.collected;
  });
  $("apiStatus").textContent = collected
    ? "已加入错题本，可在「错题本」面板重写练习。"
    : "这条消息已存在未解决的同文错题，未重复收集。";
}

export function renderAnalysis(data, { showReviewComparison = () => "", openLongReader = () => {}, onAfterRender = () => {} } = {}) {
  const analysis = $("analysis");
  const choices = $("choices");
  if (!analysis || !choices) return;
  analysis.innerHTML = "";
  choices.innerHTML = "";
  if (!data) {
    analysis.innerHTML = card("等待分析", "先发送你的回复，再点“生成女方对话”或“然后”。");
    renderTraining();
    onAfterRender(null);
    return;
  }
  analysis.innerHTML = coachEvidenceCards(data).map(([title, text]) => card(title, text)).join("");
  if (data.herReply) analysis.insertAdjacentHTML("beforeend", card(data.generationSource === "local" ? "女方下一句（本地兜底）" : "女方下一句（模型输出）", data.herReply));
  for (const choice of data.replyOptions || []) {
    const div = document.createElement("div");
    div.className = "choice";
    div.innerHTML = `<div class="choice-head"><strong>${escapeHtml(choice.label)}</strong><button class="btn small" data-choice="${escapeHtml(choice.key)}">采用</button></div><p>${escapeHtml(choice.text)}</p><div class="note">${escapeHtml(choice.effect || "")}</div>`;
    choices.appendChild(div);
  }
  if ((data.replyOptions || []).length) choices.insertAdjacentHTML("afterbegin", `<div class="note reply-source-note">${data.replyOptionsSource === "model" ? "ABC 由 MiMo 生成" : "MiMo 的 ABC 不合格，已使用本地兜底"}</div>`);
  choices.querySelectorAll("button[data-choice]").forEach((button) => button.addEventListener("click", () => {
    const picked = (data.replyOptions || []).find((item) => item.key === button.dataset.choice);
    if (picked) { $("userInput").value = picked.text; $("userInput").focus(); }
  }));
  if (data.recommendation) choices.insertAdjacentHTML("beforeend", card("推荐", data.recommendation));
  const comparison = showReviewComparison($("stage")?.value || "");
  if (comparison) {
    choices.insertAdjacentHTML("beforeend", comparison);
    const link = choices.querySelector(".review-comparison-link");
    link?.addEventListener("click", () => openLongReader(Number(link.dataset.chapter)));
  }
  renderTraining(data.coachScore);
  onAfterRender(data);
}

function splitMemoryItems(value) {
  return String(value || "").split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean);
}

export function buildActionPlan(persona, memory, score, uiValues = {}) {
  const state = getState();
  const stage = uiValues.stage || "当前阶段";
  const interests = splitMemoryItems(memory.interests);
  const latestMine = getLatestMineText(uiValues.typedInput || "");
  const latestHer = [...state.messages].reverse().find((message) => message.type === "her")?.text || "";
  const mainInterest = interests[0] || (latestHer || latestMine).slice(0, 20) || "最近让你放松的事";
  const weakBoundary = score && score.boundary < 65;
  const weakMomentum = score && score.momentum < 68;
  const total = clampScore(score?.total ?? 72);
  const pacing = total >= 82 ? "稳步建立连接" : total >= 68 ? "保持低压节奏" : "先修复安全感";
  return {
    title: `${persona.name} · ${stage}长期路线`, pacing,
    objective: `在尊重边界的前提下，围绕${mainInterest}建立持续、互相投入的互动，逐步判断是否适合从线上聊天过渡到线下见面。`,
    steps: [
      { title: "阶段一：稳定互动", detail: weakBoundary ? "先降低压力，保持普通聊天和可拒绝的空间；连续观察她是否愿意主动分享。" : "围绕已经出现的共同话题自然往返，保持轻松，不把一次聊天强行升级成暧昧。" },
      { title: "阶段二：形成共同经验", detail: `接下来 2-3 轮对话优先发展${mainInterest}等共同话题，加入你的真实经历，再观察她是否持续回应、反问和补充。` },
      { title: weakMomentum ? "阶段三：等待投入信号" : "阶段三：再考虑线下推进", detail: weakMomentum ? "只有当她的回复变得更具体、更主动时，才进入下一阶段；没有信号就维持低压，不追问。" : "当她持续给出具体回复、主动提问或愿意延续共同话题时，再提出轻量、具体且容易拒绝的邀约。" }
    ],
    topics: [...interests.slice(0, 4), "最近放松方式", "校园/工作日常", "周末安排", "活动体验"].slice(0, 4),
    decisionRules: ["她回复具体、主动提问或主动延续话题，再增加投入。", "她回复变短、回避或没有接住时，降低频率，不连续追问。", "只有双方持续投入且她表现舒适时，才提出具体、低压力、可拒绝的邀约。"],
    warning: memory.boundaries || "保持真实表达，不要让 AI 替你制造一个现实里接不住的人设。"
  };
}

export function renderPlanCard(plan) {
  const panel = $("planPanel");
  if (!panel) return;
  panel.innerHTML = `<div class="plan-card"><div class="plan-head"><strong>${escapeHtml(plan.title)}</strong><span>${escapeHtml(plan.pacing)}</span></div><div class="rewrite-box"><b>长期目标</b><p>${escapeHtml(plan.objective || "先建立稳定、轻松且互相投入的互动节奏。")}</p></div><div class="plan-grid">${plan.steps.map((step, index) => `<div class="plan-step"><b>${index + 1}</b><div><strong>${escapeHtml(step.title)}</strong><p>${escapeHtml(step.detail)}</p></div></div>`).join("")}</div><div class="topic-row">${plan.topics.map((topic) => `<span class="topic-chip">${escapeHtml(topic)}</span>`).join("")}</div><div class="rewrite-box"><b>执行判断</b><p>${escapeHtml(plan.decisionRules.join(" "))}</p></div><div class="note">${escapeHtml(plan.warning)}</div></div>`;
}

export function renderActionPlan() {
  const persona = getCurrentPersona();
  const memory = getPersonaMemory(persona);
  const state = getState();
  renderPlanCard(buildActionPlan(persona, memory, state.lastAnalysis?.coachScore || state.trainingLog?.[0]?.score || null, { stage: $("stage")?.value || "" }));
}
