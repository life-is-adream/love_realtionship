import { $, escapeHtml } from "../core/dom.js";
import { buildStageDetectionPrompt } from "../coach/prompts.js";
import { isValidStage } from "../core/stages.js";
import { getCurrentPersona, getState } from "../core/state.js";
import { callLLM } from "../core/api-client.js";
import { parseStageResult } from "../coach/parser.js";
import { buildStageProgressHtml } from "./stage-progress.js";

const STAGE_OVERRIDE_KEY = "heartflow-stage-override";
const STAGE_AUTO_RESULT_KEY = "heartflow-stage-auto-result";
const STAGE_VALUE_KEY = "heartflow-stage-value";

export function renderStageProgress(stageValue = $("stage")?.value || "") {
  const panel = $("stageProgress");
  if (!panel) return;
  panel.innerHTML = buildStageProgressHtml(stageValue);
}

function persistStageValue(value = $("stage")?.value || "") {
  if (!isValidStage(value)) return;
  try { localStorage.setItem(STAGE_VALUE_KEY, value); } catch { /* localStorage unavailable */ }
}

function restoreStageValue() {
  try {
    const savedStage = localStorage.getItem(STAGE_VALUE_KEY);
    if (savedStage && isValidStage(savedStage) && $("stage")) $("stage").value = savedStage;
  } catch { /* localStorage unavailable */ }
}

export function persistCurrentStage() {
  persistStageValue();
}

export async function autoDetectStage({ model = "mimo-v2.5", endpoint = "/api/chat", apiKey = "", onStatus = () => {} } = {}) {
  const btn = $("autoStageBtn");
  if (btn) { btn.disabled = true; btn.textContent = "判断中..."; }
  try {
    const conversation = getState().messages.filter((m) => m && m.text).map((m) => ({ speaker: m.type === "her" ? "她" : "我", text: m.text }));
    if (!conversation.length) { onStatus("没有对话内容，无法判断阶段。"); return; }
    const { systemPrompt, userPrompt } = buildStageDetectionPrompt(conversation, $("stage")?.value || "");
    const result = await callLLM({ endpoint, apiKey, model, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], temperature: 0.3 });
    const parsed = parseStageResult(result.content);
    if (!parsed || !isValidStage(parsed.stage)) { onStatus("阶段判断失败，保留当前阶段。"); return; }
    localStorage.removeItem(STAGE_OVERRIDE_KEY);
    applyStageResult({ ...parsed, isAuto: true });
    onStatus(`阶段已自动判断：${parsed.stage}（置信度：${parsed.confidence}）`);
  } catch (error) {
    onStatus(`阶段判断失败：${error.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "🤖 自动判断"; }
  }
}

export function applyStageResult(result) {
  if (result.stage && isValidStage(result.stage) && $("stage")) {
    $("stage").value = result.stage;
    persistStageValue(result.stage);
  }
  const badge = $("stageBadge");
  if (badge) {
    badge.textContent = `${result.isAuto ? "自动" : "手动"}${result.confidence ? ` · ${escapeHtml(result.confidence)}` : ""}`;
    badge.className = `stage-badge ${result.isAuto ? "auto" : "manual"}`;
  }
  renderStageProgress($("stage")?.value || "");
  try { localStorage.setItem(STAGE_AUTO_RESULT_KEY, JSON.stringify(result)); } catch { /* localStorage unavailable */ }
}

export function onStageManualChange() {
  persistStageValue();
  try { localStorage.setItem(STAGE_OVERRIDE_KEY, "true"); } catch { /* localStorage unavailable */ }
  const badge = $("stageBadge");
  if (badge) { badge.textContent = "手动"; badge.className = "stage-badge manual"; }
  renderStageProgress($("stage")?.value || "");
}

export function restoreStageState() {
  restoreStageValue();
  let override = false;
  try { override = localStorage.getItem(STAGE_OVERRIDE_KEY) === "true"; } catch { /* localStorage unavailable */ }
  if (override) {
    const badge = $("stageBadge");
    if (badge) { badge.textContent = "手动"; badge.className = "stage-badge manual"; }
    return;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STAGE_AUTO_RESULT_KEY));
    if (saved?.stage) applyStageResult(saved);
  } catch { /* no saved result */ }
}
