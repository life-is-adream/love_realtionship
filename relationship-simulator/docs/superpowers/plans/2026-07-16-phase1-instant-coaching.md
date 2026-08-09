# HeartFlow Phase 1 Instant Coaching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现消息优化器 2.0、社交信号解读训练和时机感评分，形成可离线使用的即时沟通训练闭环。

**Architecture:** 先建立统一分析结果和学习事件格式，再分别实现三个纯函数模块。`app.js` 只编排输入、MiMo 请求、状态写入和 UI；本地规则保证没有 API Key 时仍可运行。

**Tech Stack:** Vanilla JS ES Modules、HTML/CSS、Node built-in test runner、现有 `coach.js`/`prompts.js`。

## Global Constraints

- 零新增 npm 依赖。
- 本地规则先返回，MiMo 结果只能增强或覆盖有验证的字段。
- 所有结果含 `source`、`confidence`、`evidence`。
- A/B/C 和优化版本不得出现操控、PUA、施压或越界内容。
- 旧消息没有 `createdAt` 时，时机评分返回 `dataAvailable: false`。
- 不破坏现有 `askAi`、`localAnalyze`、`preflightReply` 和回复选项流程。

---

### Task 1: 建立统一分析结果与学习事件基础

**Files:**
- Create: `public/js/analysis-result.js`
- Create: `public/js/learning-state.js`
- Modify: `public/app.js:1-48`
- Test: `test/analysis-result.test.mjs`
- Test: `test/learning-state.test.mjs`

**Interfaces:**
- `createAnalysisResult(input) -> AnalysisResult`
- `normalizeAnalysisResult(value, fallback) -> AnalysisResult`
- `normalizeLearningState(value) -> LearningState`
- `createTrainingEvent(input) -> TrainingEvent`
- `recordTrainingEvent(state, event) -> LearningState`
- `buildLearningSummary(state, now) -> LearningSummary`

- [ ] **Step 1: Write failing tests for result normalization.**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { createAnalysisResult, normalizeAnalysisResult } from "../public/js/analysis-result.js";

test("analysis result contains source, confidence, evidence and five scores", () => {
  const result = createAnalysisResult({ source: "local", summary: "测试" });
  assert.equal(result.source, "local");
  assert.equal(result.confidence, "low");
  assert.deepEqual(result.evidence, []);
  assert.deepEqual(Object.keys(result.scores), ["naturalness", "empathy", "boundary", "momentum", "timing"]);
});

test("malformed model result falls back without throwing", () => {
  const result = normalizeAnalysisResult({ source: "wrong", scores: { boundary: "bad" } }, { summary: "fallback" });
  assert.equal(result.source, "local");
  assert.equal(result.summary, "fallback");
  assert.equal(result.scores.boundary, 0);
});
```

- [ ] **Step 2: Run the focused test and verify it fails.**

Run: `node --test test/analysis-result.test.mjs`  
Expected: FAIL because `analysis-result.js` does not exist.

- [ ] **Step 3: Implement the smallest pure normalization module.**

```javascript
const SCORE_KEYS = ["naturalness", "empathy", "boundary", "momentum", "timing"];
const SOURCES = new Set(["local", "model", "mixed"]);
const CONFIDENCES = new Set(["high", "medium", "low"]);

export function createAnalysisResult(input = {}) {
  const scores = Object.fromEntries(SCORE_KEYS.map((key) => [key, clampScore(input.scores?.[key])])) ;
  return {
    source: SOURCES.has(input.source) ? input.source : "local",
    confidence: CONFIDENCES.has(input.confidence) ? input.confidence : "low",
    summary: String(input.summary || ""),
    evidence: Array.isArray(input.evidence) ? input.evidence.filter(Boolean) : [],
    risks: Array.isArray(input.risks) ? input.risks.filter(Boolean) : [],
    suggestions: Array.isArray(input.suggestions) ? input.suggestions.filter(Boolean) : [],
    scores
  };
}

export function normalizeAnalysisResult(value, fallback = {}) {
  const normalized = createAnalysisResult(value);
  return normalized.summary || normalized.evidence.length
    ? normalized
    : createAnalysisResult({ ...fallback, source: "local" });
}

function clampScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
}
```

- [ ] **Step 4: Implement versioned learning state and event recording.**

```javascript
export const LEARNING_SCHEMA_VERSION = 2;

export function normalizeLearningState(value = {}) {
  return {
    schemaVersion: LEARNING_SCHEMA_VERSION,
    events: Array.isArray(value.events) ? value.events.slice(-200) : [],
    dailyTasks: Array.isArray(value.dailyTasks) ? value.dailyTasks.slice(-60) : [],
    signalAttempts: Array.isArray(value.signalAttempts) ? value.signalAttempts.slice(-200) : [],
    growthSnapshots: Array.isArray(value.growthSnapshots) ? value.growthSnapshots.slice(-90) : []
  };
}

export function createTrainingEvent(input = {}) {
  return {
    id: input.id || `event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: String(input.type || "unknown"),
    source: String(input.source || "local"),
    dimension: input.dimension || null,
    score: Number.isFinite(Number(input.score)) ? Number(input.score) : null,
    createdAt: input.createdAt || new Date().toISOString(),
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {}
  };
}

export function recordTrainingEvent(state, event) {
  const next = normalizeLearningState(state);
  next.events.push(createTrainingEvent(event));
  next.events = next.events.slice(-200);
  return next;
}
```

- [ ] **Step 5: Integrate `learning` into `normalizeState`, `saveState` and `loadState`.**

Use `normalized.learning = normalizeLearningState(normalized.learning)` and preserve all existing state fields. Do not migrate or rewrite existing chat messages beyond adding the missing `learning` object.

- [ ] **Step 6: Run focused and existing tests.**

Run: `node --test test/analysis-result.test.mjs test/learning-state.test.mjs`  
Expected: all focused tests PASS.

- [ ] **Step 7: Record a checkpoint.**

Run in a Git checkout: `git add public/js/analysis-result.js public/js/learning-state.js public/app.js test/analysis-result.test.mjs test/learning-state.test.mjs && git commit -m "feat: add learning state foundation"`  
In the current non-Git workspace, retain the files as an uncommitted checkpoint and record the command output instead of initializing Git.

---

### Task 2: 实现消息优化器 2.0

**Files:**
- Create: `public/js/optimizer.js`
- Modify: `public/js/prompts.js:40-180`
- Modify: `public/app.js` imports, `preflightReply`, `renderAnalysis` and event binding
- Modify: `public/index.html` composer/preflight area
- Modify: `public/styles.css` optimizer cards and diff segments
- Test: `test/optimizer.test.mjs`
- Modify: `test/prompt-snapshot.test.mjs`

**Interfaces:**
- `buildLocalOptimizations(original, context) -> OptimizationResult`
- `normalizeOptimizationResult(value, original, fallback) -> OptimizationResult`
- `diffText(before, after) -> Array<{type:"same"|"added"|"removed", text:string}>`
- `buildOptimizerPrompt(context) -> {systemPrompt:string,userPrompt:string}`

- [ ] **Step 1: Add failing tests for three versions, intent preservation and Diff.**

```javascript
test("local optimizer returns original, low-pressure and proactive versions", () => {
  const result = buildLocalOptimizations("你怎么还不回我？你是不是不高兴？", { stage: "隔天轻联系" });
  assert.equal(result.original, "你怎么还不回我？你是不是不高兴？");
  assert.notEqual(result.lowPressure.text, result.original);
  assert.notEqual(result.proactive.text, result.original);
  assert.match(result.lowPressure.reason, /压力|追问|空间/);
});

test("diff marks inserted and removed text", () => {
  const diff = diffText("今天忙吗", "今天是不是有点忙？");
  assert.ok(diff.some((part) => part.type === "added"));
  assert.ok(diff.some((part) => part.type === "removed"));
});
```

- [ ] **Step 2: Run `node --test test/optimizer.test.mjs` and verify failure.**
- [ ] **Step 3: Implement local transformations for pressure, repeated questions, generic questions and overlong text.**
- [ ] **Step 4: Implement `diffText` using character-level matching without a package; ensure Chinese text and punctuation are handled.**
- [ ] **Step 5: Add `buildOptimizerPrompt` with strict JSON fields and preserve-user-intent rules.**
- [ ] **Step 6: Normalize MiMo output and merge it only when both versions contain non-empty text and no forbidden-risk flag.**
- [ ] **Step 7: Replace the current single rewrite card with three cards, a Diff renderer and “采用此版本” buttons.**
- [ ] **Step 8: Add local fallback when the model times out, returns invalid JSON or returns duplicate versions.**
- [ ] **Step 9: Run `node --test test/optimizer.test.mjs test/prompt-snapshot.test.mjs`; expected: PASS.**
- [ ] **Step 10: Record a checkpoint with `feat: add message optimizer v2`.**

---

### Task 3: 实现社交信号解读训练

**Files:**
- Create: `public/js/signals.js`
- Modify: `public/js/prompts.js`
- Modify: `public/app.js` imports, signal exercise rendering and submit handlers
- Modify: `public/index.html` coach panel signal-training container
- Modify: `public/styles.css`
- Test: `test/signals.test.mjs`
- Modify: `test/replies.test.mjs`

**Interfaces:**
- `SOCIAL_SIGNAL_LABELS -> readonly array`
- `classifySocialSignals(message, context) -> SignalAnalysis`
- `buildSignalExercise(message, seed) -> SignalExercise`
- `evaluateSignalGuess(expected, guess) -> {correct,partial,explanation}`

- [ ] **Step 1: Add failing tests for closing, low-energy, boundary, polite and ambiguous messages.**
- [ ] **Step 2: Run `node --test test/signals.test.mjs`; expected: FAIL.**
- [ ] **Step 3: Implement multi-label local classification in priority order: `boundary`, `closing`, `lowEnergy`, `polite`, `positive`, `ambiguous`.**
- [ ] **Step 4: Implement deterministic exercise selection using a stable hash of message text and date; do not use `Math.random()` for daily repeatability.**
- [ ] **Step 5: Implement partial-credit evaluation: exact labels score highest, overlapping labels score partial, and “ambiguous” is valid when confidence is low.**
- [ ] **Step 6: Add MiMo explanation as optional enhancement; the local result and evidence remain visible if the call fails.**
- [ ] **Step 7: Render the exercise so the answer is hidden until submission, then show labels, evidence, uncertainty and recommended response direction.**
- [ ] **Step 8: Add regression cases ensuring “早点休息”“哈哈还好吧”“我现在不想聊” never default to romantic interest.**
- [ ] **Step 9: Run focused tests and `npm.cmd test`; expected: PASS.**
- [ ] **Step 10: Record a checkpoint with `feat: add social signal practice`.**

---

### Task 4: 实现时机感评分

**Files:**
- Create: `public/js/timing.js`
- Modify: `public/app.js` message creation, composer analysis and render flow
- Modify: `public/index.html` timing result container
- Modify: `public/styles.css`
- Test: `test/timing.test.mjs`

**Interfaces:**
- `scoreTiming({messages, latestDraft, stage, now}) -> TimingAnalysis`
- `hasUsableTimestamps(messages) -> boolean`
- `getTimingReasons(input) -> string[]`

- [ ] **Step 1: Add failing tests for missing timestamps, repeated messages, closing messages, late-night messages and unanswered turns.**
- [ ] **Step 2: Run `node --test test/timing.test.mjs`; expected: FAIL.**
- [ ] **Step 3: Implement timestamp availability detection; return `score: null` and `dataAvailable: false` when required timestamps are absent.**
- [ ] **Step 4: Implement interpretable penalties for multiple questions, immediate repeated sending, late-night fatigue and explicit closing.**
- [ ] **Step 5: Implement positive signals for a single concise response, a clear return point and stage-appropriate pacing.**
- [ ] **Step 6: Render timing advice beside the optimizer without blocking “发送”.**
- [ ] **Step 7: Add `createdAt` only to newly created user/model messages; preserve `null` for old seed messages.**
- [ ] **Step 8: Run `node --test test/timing.test.mjs test/replies.test.mjs`; expected: PASS.**
- [ ] **Step 9: Run `npm.cmd test` and `node --check public/app.js`; expected: PASS.**
- [ ] **Step 10: Record a checkpoint with `feat: add timing analysis`.**

---

### Task 5: 阶段一集成回归

**Files:**
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Create: `test/phase1-integration.test.mjs`

- [ ] **Step 1: Write an integration contract test that verifies the three modules are imported and the shared result keys are present.**
- [ ] **Step 2: Run it and verify failure if the contract is not wired.**
- [ ] **Step 3: Wire the user flow: draft → signal/timing analysis → optimizer → adopt version → existing send flow.**
- [ ] **Step 4: Ensure MiMo errors do not clear local optimizer, signal or timing panels.**
- [ ] **Step 5: Add empty states for no previous female message, no timestamp and no draft.**
- [ ] **Step 6: Run `npm.cmd test`, `node --check public/app.js` and `npm.cmd run build:index`; expected: all PASS.**
- [ ] **Step 7: Record a checkpoint with `test: verify phase one instant coaching`.**

