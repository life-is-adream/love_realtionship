# Phase 3 Textbook Integration Implementation Plan

> **For the implementer:** REQUIRED SUB-SKILL: Use the `writing-plans` workflow while implementing this plan task by task. Keep generated index files generated, test retrieval against real corpus data, and do not make textbook recommendations that are not supported by an indexed excerpt.

**Goal:** Make the existing long-form relationship教材 an evidence layer inside the simulator: when a user practices a recognizable problem, the app can recommend up to three relevant chapters or review points, show a short grounded excerpt, and let the user continue practicing from that context.

**Architecture:** Extend the existing build-time long-content index with normalized searchable fields. Perform retrieval locally in the browser with transparent keyword/phrase matching. The coach panel displays the top result and links into the existing long reader. If MiMo is enabled, it receives only the current normalized analysis summary and one or two retrieved excerpts; the local path remains complete without an API key.

**Tech stack:** Existing Node build script, generated ES module index, browser ES modules, vanilla DOM/CSS, Node's built-in `node:test`, and the existing `/api/long-content/:chapter` endpoint.

**Global constraints:**

- Never hand-edit `public/js/long-content-index.js`; regenerate it through `npm.cmd run build:index`.
- Search results must come from indexed chapter/review-point data. No fabricated chapter names, quotes, or review-point IDs.
- Show excerpts with a source label and bounded length; do not copy a long section of the教材 into the UI.
- Keep search and recommendation local by default. Do not send the full教材 or raw user conversation to MiMo.
- Preserve the current long reader, intervention, stage, scenario, ABC, and coach workflows.
- Use `apply_patch` for source edits and do not initialize Git or reset unrelated user changes.

## Task 1: Extend the generated long-content index for retrieval

**Files:**

- Modify `scripts/build-long-index.mjs`
- Modify `test/long-content-parse.test.mjs`
- Modify `public/js/long-content-index.js` only through `npm.cmd run build:index`

### 1.1 Write failing index-field tests

```js
test('generated review points contain normalized retrieval fields', () => {
  const index = buildIndexFromFixture(sampleChapter());
  const point = index.chapters[0].reviewPoints[0];
  assert.equal(typeof point.searchText, 'string');
  assert.ok(Array.isArray(point.searchTerms));
  assert.ok(point.searchTerms.length > 0);
  assert.ok(point.tags.includes('复盘'));
});

test('retrieval fields exclude empty markdown and stay bounded', () => {
  const index = buildIndexFromFixture(sampleChapterWithLongText());
  const point = index.chapters[0].reviewPoints[0];
  assert.ok(point.searchText.length <= 1600);
  assert.ok(!point.searchTerms.includes(''));
});
```

Run: `node --test test/long-content-parse.test.mjs`

Expected before implementation: the new field assertions fail.

### 1.2 Implement build-time normalization

- Preserve existing chapter IDs, titles, review-point IDs, headings, excerpts, and source offsets.
- Add `searchText` from title, stage, review-point heading, tags, problem statement, and a bounded excerpt.
- Add `searchTerms` from normalized Chinese n-grams/keywords and existing stage/tag values. Keep the algorithm deterministic and dependency-free.
- Add `tags` with stable values such as `邀约`, `边界`, `冷却`, `追问`, `误读`, `复盘`, and stage labels when evidence exists in the source text.
- Add a short `searchExcerpt` suitable for a result card; it must be derived from source content and have a fixed maximum length.
- Keep raw markdown out of generated fields unless it is already part of an existing source excerpt.

### 1.3 Regenerate and verify the real corpus

Run:

```powershell
npm.cmd run build:index
node --test test/long-content-parse.test.mjs
```

Expected: the generated module imports successfully, the existing chapter/review-point count remains unchanged, and every generated result has a stable ID and bounded retrieval fields. Review the diff for accidental raw-content explosion before continuing.

## Task 2: Implement local textbook retrieval

**Files:**

- Create `public/js/textbook-search.js`
- Create `test/textbook-search.test.mjs`

**Interfaces:**

```js
buildTextbookSearchIndex(chapters) -> {
  entries: [{ chapterId, chapterTitle, reviewPointId, title, tags, searchText, searchTerms, searchExcerpt }]
}

searchTextbook(query, index, limit = 3) -> [{
  chapterId, chapterTitle, reviewPointId, title, tags, searchExcerpt,
  score, matchedTerms, reason
}]

rankTextbookResult(result, terms) -> number

buildCoachTextbookEvidence(analysis, index) -> {
  query, results, primary: null|result, message
}

buildTextbookCoachContext({ summary, results }) -> {
  summary, excerpts: [{ chapterTitle, reviewPointId, text }]
}
```

### 2.1 Write failing retrieval tests against representative fixtures

```js
test('ranks an invitation-refusal review point above unrelated content', () => {
  const index = buildTextbookSearchIndex([
    chapter('c1', '邀约与被拒', review('r1', '被拒后的分寸', '邀约 被拒 留出空间')),
    chapter('c2', '初次聊天', review('r2', '开启话题', '自我介绍 兴趣 轻松聊天'))
  ]);
  const results = searchTextbook('邀约被拒后怎么回复', index);
  assert.equal(results[0].reviewPointId, 'r1');
  assert.ok(results[0].matchedTerms.length > 0);
});

test('returns no fake evidence when query has no matching terms', () => {
  const index = buildTextbookSearchIndex([chapter('c1', '边界', review('r1', '留出空间', '尊重边界'))]);
  assert.deepEqual(searchTextbook('完全不存在的主题', index), []);
});

test('limits output and keeps source excerpt bounded', () => {
  const index = buildTextbookSearchIndex(makeManyEntries(10));
  const results = searchTextbook('聊天', index, 3);
  assert.ok(results.length <= 3);
  assert.ok(results.every(item => item.searchExcerpt.length <= 360));
});
```

Run: `node --test test/textbook-search.test.mjs`

Expected before implementation: the module import fails.

### 2.2 Implement transparent retrieval and ranking

- Normalize Chinese punctuation, whitespace, and common synonyms (`邀约/约见`, `被拒/拒绝`, `冷却/降温`, `追问/连续发问`).
- Use exact phrase, token/substring, tag, stage, and title matches with documented weights; do not call an external embedding service.
- Return `matchedTerms` and a human-readable `reason`, such as “命中：邀约、被拒、留出空间”.
- Use stable tie-breaking by score, chapter order, and review-point order so repeated queries do not reshuffle results.
- Return an empty array when no evidence crosses the minimum threshold. The UI must then say “暂未找到直接对应内容” and offer a broader query hint.
- Keep result excerpts short, source-grounded, and safe for rendering as text content rather than HTML.

### 2.3 Add retrieval regression fixtures

Cover at least these queries:

- `对方说最近很忙，怎么留出空间`
- `连续追问以后怎么修复`
- `聊天没有回应，我是不是误读了`
- `如何自然推进邀约`

Each fixture must assert the returned review-point ID, not merely that some result exists. If the real corpus does not contain a direct match, the expected result must be empty rather than a forced recommendation.

## Task 3: Surface textbook evidence in the coach panel

**Files:**

- Modify `public/app.js`
- Modify `public/index.html`
- Modify `public/styles.css`
- Create `test/textbook-integration.test.mjs`

### 3.1 Write failing integration tests

```js
test('coach evidence uses the top local result and exposes a reader target', () => {
  const evidence = buildCoachTextbookEvidence(
    { suggestions: [{ dimension: 'timing', title: '留出回应空间' }] },
    textbookIndex
  );
  assert.equal(evidence.results.length <= 3, true);
  assert.ok(evidence.primary.chapterId);
  assert.ok(evidence.primary.reviewPointId);
  assert.ok(evidence.primary.searchExcerpt);
});

test('empty retrieval renders an honest fallback state', () => {
  const evidence = buildCoachTextbookEvidence({ suggestions: [] }, emptyIndex);
  assert.equal(evidence.primary, null);
  assert.match(evidence.message, /暂未找到|关键词/);
});
```

Run: `node --test test/textbook-integration.test.mjs`

Expected before implementation: the integration helper/import fails.

### 3.2 Implement coach-to-textbook evidence mapping

- Build a query from the latest normalized analysis: dimension, observation types, suggestion title, stage, and selected scenario; exclude raw full conversation by default.
- Search locally and render a “教材依据” card in the coach area with:
  - chapter title and review-point title;
  - bounded source excerpt;
  - matched terms and reason;
  - “打开原文复盘点” action;
  - up to two secondary results in a collapsible list.
- Do not make the textbook card block ABC reply suggestions or the regular coach score.
- If no local result exists, show a neutral fallback with two query examples and retain the current coach guidance.
- Keep result insertion safe: use `textContent`, existing escaping utilities, or equivalent safe DOM construction.

### 3.3 Link evidence to the existing long reader

- Extend the existing reader entry point so it accepts `chapterId` and optional `reviewPointId` without breaking chapter-only navigation.
- Load the chapter through the existing `/api/long-content/:chapter` path, then scroll/focus the requested review point after render.
- Reuse the existing intervention/compare flow when the user opens a review point; do not create a second textbook reader.
- Show a not-found message if the indexed review point is absent from the fetched chapter instead of silently opening the wrong section.

## Task 4: Bound optional MiMo context and preserve offline behavior

**Files:**

- Modify `public/js/prompts.js`
- Modify `public/app.js`
- Modify `test/prompt-snapshot.test.mjs`
- Create `test/textbook-context.test.mjs`

### 4.1 Write context-boundary tests

```js
test('textbook context contains only summary and at most two bounded excerpts', () => {
  const context = buildTextbookCoachContext({
    summary: '用户连续追问，对方可能需要空间',
    results: makeResults(5)
  });
  assert.equal(context.excerpts.length, 2);
  assert.ok(context.excerpts.every(item => item.text.length <= 360));
  assert.equal('rawReplay' in context, false);
});

test('missing textbook index keeps prompt construction valid', () => {
  const prompt = buildCoachPrompt({ analysis: makeAnalysis(), textbookContext: null });
  assert.ok(prompt.system.includes('恋爱成长教练'));
  assert.ok(!prompt.user.includes('undefined'));
});
```

Run: `node --test test/textbook-context.test.mjs test/prompt-snapshot.test.mjs`

Expected before implementation: the new context helper is missing or the snapshot lacks the optional section.

### 4.2 Implement bounded optional context

- Keep the existing prompt sections and ordering stable when no textbook result is present.
- Add an explicitly delimited optional `教材参考` section only when the local search found evidence.
- Include only normalized analysis summary, top one or two excerpts, source titles, and review-point IDs; never include the entire chapter or raw pasted replay.
- Keep the local A/B/C fallback independent from the new prompt section. A prompt failure must not disable reply suggestions.
- Preserve prompt snapshot tests for old inputs and add a new snapshot for the populated optional context.

### 4.3 Verify error handling

- Simulate missing/invalid generated index and confirm the coach falls back to normal analysis.
- Simulate a chapter endpoint failure and confirm the result card remains visible with an “原文暂时无法打开” message.
- Confirm no secrets or raw conversation text appear in console errors or persisted state.

## Task 5: Full integration, README, and release verification

**Files:**

- Modify `README.md`
- Modify `test/long-content-parse.test.mjs` if generated-count assertions need to reflect only additive fields
- Create `test/phase3-integration.test.mjs`

### 5.1 Add end-to-end contract tests

Cover this path with fixture data:

```text
coach analysis
  -> local textbook query
  -> primary review point
  -> long reader target
  -> optional bounded MiMo context
  -> local fallback if any step fails
```

Assertions must include:

- current analysis still renders when search returns `[]`;
- a valid result opens the matching chapter/review point;
- malformed IDs cannot select a chapter outside the generated index;
- generated index counts and existing long-content review behavior remain unchanged.

### 5.2 Update user-facing documentation

Document:

- `npm.cmd run build:index` after changing long-form source content;
- how textbook evidence is selected and why results are limited to three;
- that replay text and local retrieval stay in the browser by default;
- what optional MiMo enhancement sends (summary plus one or two excerpts only);
- the empty-state behavior when no direct textbook match exists.

### 5.3 Run final verification

Run, in order:

```powershell
npm.cmd run build:index
node --check scripts/build-long-index.mjs
node --check public/js/textbook-search.js
node --test test/long-content-parse.test.mjs test/textbook-search.test.mjs test/textbook-integration.test.mjs test/textbook-context.test.mjs test/phase3-integration.test.mjs
npm.cmd test
```

If the server is available, perform a read-only smoke check:

```powershell
Invoke-WebRequest http://localhost:3000/ -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest http://localhost:3000/api/health -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest http://localhost:3000/api/long-content/1 -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest http://localhost:3000/api/long-content/10 -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest http://localhost:3000/api/long-content/0 -UseBasicParsing | Select-Object StatusCode
```

Expected: build and all tests pass; `/` and `/api/health` return 200; valid chapter endpoints return 200; invalid chapter `0` is rejected; no generated file is manually edited; the application remains usable without `LLM_API_KEY`.

**Checkpoint:** If Git is later initialized by the user, review the generated-index diff and create a checkpoint commit named `feat: connect textbook retrieval to coaching`. Do not initialize Git as part of this task.
