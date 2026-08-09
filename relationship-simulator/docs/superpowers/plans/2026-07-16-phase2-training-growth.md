# Phase 2 Training and Growth Implementation Plan

> **For the implementer:** REQUIRED SUB-SKILL: Use the `writing-plans` workflow while implementing this plan task by task. Keep each task test-first and do not mix phase 2 changes with phase 1 or phase 3 work.

**Goal:** Turn one-off coaching into a private, repeatable learning loop: users can paste a real conversation for local replay analysis, receive one five-minute daily exercise, and see evidence-based growth and mastery instead of an opaque score.

**Architecture:** Keep parsing, privacy redaction, replay metrics, task selection, and growth aggregation in pure browser modules. Persist only the minimum local state through the existing app storage abstraction. The UI consumes normalized `analysis-result.js`, `learning-state.js`, and training events from phase 1. MiMo is optional and receives only an explicit, user-approved summary; local analysis remains useful without a key.

**Tech stack:** Existing zero-dependency browser ES modules, vanilla DOM/CSS, Node's built-in `node:test`, `npm.cmd test`, and the current localStorage schema.

**Global constraints:**

- Do not upload pasted real conversations by default; parsing, redaction, scoring, and task generation run locally.
- Never show a diagnosis or personality label. Describe observable behaviors and uncertainty.
- Never treat a missing timestamp as evidence of bad timing. Timing data remains “unknown” when it cannot be inferred.
- Preserve existing chat, coach, scenario, long-content, and four-dimension data. Add versioned migration rather than replacing old state.
- Keep replay content out of durable storage unless the user explicitly saves it. Default persistence is summary/events only.
- Use `apply_patch` for source edits. Do not initialize Git or reset unrelated user changes.

## Task 1: Add replay parsing, privacy, and local analysis

**Files:**

- Create `public/js/replay.js`
- Create `test/replay.test.mjs`
- Modify `public/app.js` to open the replay workflow and render results
- Modify `public/index.html` to add the replay input/result panel
- Modify `public/styles.css` for the replay panel, redaction warnings, and metric cards

**Interfaces:**

```js
parseReplayText(raw) -> {
  messages: [{ id, speaker: 'self'|'other'|'unknown', text, line, timestamp: null|ISOString }],
  warnings: string[],
  stats: { total, parsed, unknown }
}

redactSensitiveText(text) -> {
  text: string,
  hits: [{ type: 'phone'|'email'|'url'|'id', count }]
}

analyzeReplay(messages, options = {}) -> {
  overview: { totalMessages, selfMessages, otherMessages, duration: null|number },
  dimensions: { initiative, curiosity, boundaries, timing },
  metrics: {
    selfInitiativeRate, replyRate, questionRate, avgSelfLength,
    avgOtherLength, cooldownCount, consecutiveSelfCount, boundarySignals
  },
  observations: [{ type, severity, evidence, confidence }],
  suggestions: [{ dimension, title, action }],
  source: 'local-replay-v1'
}

buildReplaySummary(analysis) -> string
```

### 1.1 Write failing parser and privacy tests

Add fixtures covering the actual formats users will paste:

```js
test('parses 我/她 speaker prefixes and preserves order', () => {
  const result = parseReplayText('我：今天还顺利吗？\n她：还好，刚下班。');
  assert.deepEqual(result.messages.map(m => [m.speaker, m.text]), [
    ['self', '今天还顺利吗？'], ['other', '还好，刚下班。']
  ]);
});

test('accepts markdown bold speaker prefixes and ignores blank lines', () => {
  const result = parseReplayText('**我：** 你明天有空吗？\n\n**夏紫桐：** 明天可能不行。');
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[1].speaker, 'other');
});

test('does not invent speakers for malformed lines', () => {
  const result = parseReplayText('这是一段没有说话人标记的文字');
  assert.equal(result.messages[0].speaker, 'unknown');
  assert.ok(result.warnings.length > 0);
});

test('redacts contact-like data without changing ordinary prose', () => {
  const result = redactSensitiveText('电话 13812345678，邮箱 a@example.com');
  assert.match(result.text, /\[已隐藏/);
  assert.ok(result.hits.some(hit => hit.type === 'phone'));
});
```

Run: `node --test test/replay.test.mjs`

Expected before implementation: the test file fails because `public/js/replay.js` and its exports do not exist.

### 1.2 Implement conservative parsing and redaction

- Normalize CRLF, trim only line edges, and retain original line numbers for evidence.
- Recognize `我`, `我方`, `男方`, `自己` as `self`; recognize `她`, `夏紫桐`, `对方`, `女生` as `other`.
- Accept both Chinese and ASCII colon separators and optional markdown emphasis.
- Parse an ISO-like or `YYYY-MM-DD HH:mm` prefix only when unambiguous; otherwise set `timestamp: null`.
- Keep unknown lines as messages so the user can correct them rather than silently dropping data.
- Redact phone numbers, email addresses, URLs, and long numeric identifiers before any optional model call.
- Return warning text that tells the user how many lines are unknown and how to correct them.

### 1.3 Write failing metric and evidence tests

```js
test('calculates initiative, questions, cooldown, and boundary observations', () => {
  const messages = parseReplayText([
    '我：最近还好吗？',
    '我：你在忙吗？',
    '她：刚下班，有点累。',
    '我：那你现在出来吗？'
  ].join('\n')).messages;
  const result = analyzeReplay(messages);
  assert.equal(result.metrics.consecutiveSelfCount, 2);
  assert.ok(result.observations.some(item => item.type === 'consecutive_follow_up'));
  assert.ok(result.suggestions.some(item => item.dimension === 'timing'));
});

test('does not claim timing problems when timestamps are absent', () => {
  const result = analyzeReplay(parseReplayText('我：你好\n她：你好').messages);
  assert.equal(result.dimensions.timing.status, 'unknown');
  assert.equal(result.metrics.cooldownCount, null);
});
```

Run: `node --test test/replay.test.mjs`

Expected before implementation: the metric assertions fail while parser tests pass.

### 1.4 Implement observable replay metrics

- Calculate reply rate by counting other-speaker messages following a self message, with no claim that a missing reply means rejection.
- Calculate question rate from Chinese question punctuation and a bounded question-word list.
- Detect consecutive self messages and repeated follow-ups within the same local block.
- Detect possible boundary cues from a transparent signal table (`忙`, `累`, `改天`, `先休息`, `不太方便`) and label them as “可能需要留出空间”, not as intent certainty.
- Calculate time gaps only from valid timestamps; expose `null` when unavailable.
- Generate each observation with short evidence snippets, confidence `low|medium|high`, and a suggested practice dimension.

### 1.5 Integrate replay UI and privacy behavior

- Add a “对话回放分析” entry near existing coach tools.
- Provide a textarea, format hint, “仅本地分析” default state, and an explicit checkbox before any model enhancement.
- Show a pre-analysis redaction preview when sensitive data is detected.
- Render overview, four dimension cards, observations, and “转为今日训练” action.
- Do not render raw pasted content after the result unless the user keeps the editor open; do not save raw replay content in localStorage.
- On malformed input, show actionable format guidance and retain the draft in the current page only.

## Task 2: Add daily five-minute micro-training

**Files:**

- Create `public/js/micro-training.js`
- Create `test/micro-training.test.mjs`
- Modify `public/app.js` to select, start, grade, and complete a daily task
- Modify `public/index.html` to add the daily training card and task modal
- Modify `public/styles.css` for task progress, completion state, and empty state

**Interfaces:**

```js
selectDailyTask(learningState, date, options = {}) -> {
  id, date, dimension, type, title, prompt, timeLimit,
  rubric: [{ key, label, pass }], source: 'micro-training-v1'
}

gradeMicroTask(task, input, context = {}) -> {
  passed, score, dimension, feedback, evidence, nextAction
}

getTrainingStreak(tasks, today = new Date()) -> number
getMasteryStatus(events, dimension) -> { level, progress, sampleSize, confidence }
```

`selectDailyTask` derives the weakest dimension from `learningState.events` in production. `options.weakestDimension` is an explicit deterministic test/feature override only; it is not persisted as a second source of truth.

### 2.1 Write failing deterministic task tests

```js
test('selects the weakest dimension and is stable for the same date', () => {
  const state = makeState({ weakestDimension: 'timing' });
  const first = selectDailyTask(state, '2026-07-16');
  const second = selectDailyTask(state, '2026-07-16');
  assert.deepEqual(first, second);
  assert.equal(first.dimension, 'timing');
});

test('rotates task type without changing the date result', () => {
  const a = selectDailyTask(makeState(), '2026-07-16');
  const b = selectDailyTask(makeState(), '2026-07-17');
  assert.notEqual(`${a.date}:${a.id}`, `${b.date}:${b.id}`);
});

test('grades a task with evidence and a next action', () => {
  const task = selectDailyTask(makeState({ weakestDimension: 'curiosity' }), '2026-07-16');
  const result = gradeMicroTask(task, '你最近最期待哪一件小事？', { context: '对方刚说今天有点累' });
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.ok(result.feedback);
  assert.ok(result.nextAction);
});
```

Run: `node --test test/micro-training.test.mjs`

Expected before implementation: the module import fails.

### 2.2 Implement task catalog and selection

- Build a small catalog across initiative, curiosity, boundaries, and timing; each task must be completable in about five minutes.
- Select the lowest-confidence or lowest-mastery dimension from normalized learning state; fall back to a balanced rotation when no history exists.
- Use a date seed so refreshes on one day return the same task, while different dates rotate type and scenario.
- Keep task copy behavioral and non-prescriptive: practice one action, not “win” the interaction.
- Support task types for rewrite, signal classification, pause decision, boundary response, and replay mini-review.

### 2.3 Implement grading and persistence

- Grade locally with the same normalized analysis shape used by the coach; model enhancement can explain but cannot be the only grader.
- Record one `training` event on completion with `taskId`, `date`, `dimension`, `score`, `passed`, `source`, and `createdAt`.
- Make completion idempotent for the same `taskId` and date.
- Expose streak only from completed tasks on consecutive local calendar dates; do not treat a missed day as failure or use gamified loss language.
- “转为今日训练” from replay analysis creates a one-off task with `source: 'replay'`, without storing the raw replay.

### 2.4 Integrate daily card and replay handoff

- Show today’s task, estimated time, target skill, and one clear start action in the coach panel.
- Show rubric criteria after submission, not before, to preserve practice value.
- Show completion feedback, current streak, and next practice suggestion.
- When localStorage contains old logs without a version, migrate them through `learning-state.js`; preserve all old records and mark their source as `legacy`.

## Task 3: Add growth path and four-dimension capability profile

**Files:**

- Create `public/js/growth.js`
- Create `test/growth.test.mjs`
- Modify `public/app.js` to render the growth summary and radar data
- Modify `public/index.html` to add growth cards, radar SVG, mastery bars, and recommendations
- Modify `public/styles.css` for responsive growth layout and accessible chart labels

**Interfaces:**

```js
aggregateGrowth(events, { windowDays = 30, now = Date.now() } = {}) -> {
  windowDays, dimensions: {
    initiative: { score, baseline, change, sampleSize, confidence },
    curiosity: { score, baseline, change, sampleSize, confidence },
    boundaries: { score, baseline, change, sampleSize, confidence },
    timing: { score, baseline, change, sampleSize, confidence }
  }, trend: [{ date, dimension, score, source }], empty: boolean
}

buildRadarData(summary) -> [{ key, label, value, baseline, confidence }]
getMastery(summary, dimension) -> { level, label, progress, explanation }
buildGrowthSummary(summary) -> { headline, strengths, focus, actions }
```

### 3.1 Write failing aggregation and empty-state tests

```js
test('separates baseline from recent change and keeps source metadata', () => {
  const summary = aggregateGrowth([
    event('initiative', 42, 'legacy', '2026-06-20'),
    event('initiative', 78, 'coach', '2026-07-15')
  ], { windowDays: 30, now: date('2026-07-16') });
  assert.equal(summary.dimensions.initiative.baseline, 42);
  assert.equal(summary.dimensions.initiative.score, 78);
  assert.equal(summary.dimensions.initiative.change, 36);
  assert.equal(summary.trend[1].source, 'coach');
});

test('returns honest empty data without fabricating a radar score', () => {
  const summary = aggregateGrowth([], { now: date('2026-07-16') });
  assert.equal(summary.empty, true);
  assert.equal(buildRadarData(summary).every(point => point.value === null), true);
});
```

Run: `node --test test/growth.test.mjs`

Expected before implementation: the module import fails.

### 3.2 Implement robust aggregation

- Normalize scores to `0..100`, discard malformed events, and preserve valid source values.
- Keep the five-score `AnalysisResult` contract from phase 1, but aggregate the four training dimensions through an explicit mapping: `initiative` uses momentum plus naturalness evidence, `curiosity` uses empathy/question evidence, `boundaries` uses boundary evidence, and `timing` uses timing evidence. Direct task scores take precedence over derived legacy scores.
- Use a fixed recent window plus the earliest comparable score as baseline; do not compare unlike event types without labeling the source.
- Require a minimum sample size before declaring a confident mastery change; otherwise expose `confidence: low` and explain that more practice is needed.
- Aggregate at dimension level only; do not infer attachment style, personality, diagnosis, or relationship outcome.
- Produce stable labels: “起步”, “练习中”, “较稳定”, “可迁移”, with progress derived from observable rubric performance.

### 3.3 Render accessible radar and growth guidance

- Use inline SVG or existing chart primitives; no new dependency.
- Pair every plotted value with text labels and a compact table so the result is usable without visual chart interpretation.
- Show 7-day and 30-day views only when data exists; otherwise show a concrete “完成一次练习后这里会出现趋势” empty state.
- Highlight one focus dimension and one next action, not a ranking against other users.
- Keep the growth card usable at the existing mobile breakpoint and preserve current coach trend content.

## Task 4: Integrate phase 2 and migrate old state

**Files:**

- Modify `public/js/learning-state.js` to expose versioned migration, event selectors, and additive `replayAnalyses`/`textbookProgress`/`settings` containers
- Modify `public/app.js` to connect replay → micro-training → growth
- Create `test/phase2-integration.test.mjs`
- Modify `test/replies.test.mjs` only where shared state behavior needs regression coverage

### 4.1 Write integration tests first

```js
test('replay analysis can become a daily task without retaining raw content', () => {
  const result = analyzeReplay(parseReplayText('我：你还好吗？\n她：今天有点累').messages);
  const task = taskFromReplay(result);
  const state = recordTrainingEvent(emptyState(), createTrainingEvent({
    taskId: task.id, dimension: task.dimension, score: 70, source: 'replay'
  }));
  assert.equal(state.events.length, 1);
  assert.equal(JSON.stringify(state).includes('今天有点累'), false);
});

test('legacy coach logs migrate without losing four dimensions', () => {
  const state = normalizeLearningState({ logs: [{ score: 60, dimension: 'timing' }] });
  assert.equal(state.version >= 1, true);
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].source, 'legacy');
});
```

Run: `node --test test/phase2-integration.test.mjs`

Expected before implementation: the integration imports or assertions fail.

### 4.2 Wire the learning loop

- After replay analysis, offer “生成一个专项练习”; use the same `DailyTask` shape as the daily card.
- After any coach reply, optimizer exercise, signal exercise, timing check, replay task, or daily task, record a normalized event exactly once.
- Refresh growth summary from events after completion without reloading the page.
- Keep current ABC reply suggestions and MiMo-generated replies unchanged when the new panels are closed.
- Add error boundaries around each new panel so a malformed local record cannot blank the existing chat UI.

### 4.3 Run phase 2 verification

Run, in order:

```powershell
node --check public/js/replay.js
node --check public/js/micro-training.js
node --check public/js/growth.js
node --test test/replay.test.mjs test/micro-training.test.mjs test/growth.test.mjs test/phase2-integration.test.mjs
npm.cmd test
```

Expected: all new tests and the existing suite pass; old localStorage data remains readable; replay raw text is absent from persisted learning state; no existing ABC/MiMo path regresses.

**Checkpoint:** If Git is later initialized by the user, review the diff and create a checkpoint commit named `feat: add replay training and growth profile`. Do not initialize Git as part of this task.
