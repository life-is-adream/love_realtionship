# Regression Defect Repairs Implementation Plan

> **For agentic workers:** Implement the following tasks in parallel with exclusive file ownership, then review and run shared regression checks. User has authorized implementation; no Git commit or live API calls.

**Goal:** Repair the nine reproduced defects R1–R5 and S1–S4 without rewriting courses or discarding existing work.

**Architecture:** Keep the local Runtime and existing module boundaries. Enforce conservative decisions at the shared Runtime, sanitize every memory/reflection field, and apply the existing request-scope contract to search. Server citations must pass URL and domain checks before rendering.

**Tech Stack:** Node ESM, node:test, existing browser modules and local HTTP service; no new dependencies.

## Global Constraints

- Preserve all five initial dirty files and previous audit evidence; make no Git commits.
- Do not read real credentials or private profiles; do not call paid/remote models or search.
- Preserve 179 pre-generated lessons and Automation 15 configuration/delivery records.
- Establish failing behavioral regressions before fixes, then targeted and full regression.
- Use only synthetic examples in privacy/safety tests; isolate config fixtures and browser service.

## Task 1: Runtime decision, event identity and scene feedback

**Files:** `runtime/agent-loop.mjs`, optional `conversation/analyzer.mjs` and `state/state-machine.mjs`, `simulation/scenario-engine.mjs`, corresponding Runtime tests under `.agents/skills/relationship-coach-cn/`.

**Interfaces:** Existing `runRelationshipLoop`, `critiqueResponse` and `redact`; retain output shape. Explicit no-contact must override stale plans. New observations need stable distinct IDs while identical retries remain idempotent. Breakup scenes prioritize closure over plans.

- [x] Add refusal+stale-plan, normal-boundary, same-count/new-message, retry-idempotence, and breakup invitation/closure regressions; run to capture failures.
- [x] Derive narrowly scoped refusal/exit signals from observed messages before decision/state transitions; use a digest rather than raw message text for event identity; apply scenario-specific stopping feedback; sanitize direct Runtime goal with `redact`.
- [x] Run Runtime targeted tests and confirm regressions and existing behavior pass.

## Task 2: Memory and reflection privacy

**Files:** `runtime/memory/memory-store.mjs`, `runtime/reflection/reflection-engine.mjs`, their tests. Do not edit Task 1 files.

**Interfaces:** Existing `redact`, `appendObservation`, `recordOutcome`, `reflectOnOutcome`. Preserve valid internal identifiers. Reject or sanitize identifiers and every free-text field consistently; expose truthful privacy flags.

- [x] Add synthetic identifier, evidence ID, update/lessons and reflection redaction regressions; capture failures.
- [x] Implement controlled identifier validation, sensitive-field handling and reflection sanitation; retain consent gating and immutable writes.
- [x] Run memory/reflection tests; root verifies the product adapter also enforces the repaired behavior.

## Task 3: Search server contracts

**Files:** `relationship-simulator/server/searchProxy.js`, optional `server/config.js`, new isolated search proxy tests. Preserve the existing MiMo model branch.

**Interfaces:** Existing `handleSearch`; response `results`/`filtered` remain compatible. References require safe HTTP(S) URLs and the existing domain allowlist. Domain approval is not a scientific evidence verdict. Responses configuration must use an explicit supported adapter or fail before dispatch with a controlled unsupported-mode error.

- [x] Add mock regressions for arbitrary/default sources, unsafe protocols, filtered-summary fallback and Responses configuration; capture failures.
- [x] Validate citations in both search branches; do not return unverified model summaries when no approved citations remain; make API mode handling explicit.
- [x] Verify valid results, plugin/key errors, timeouts and disconnect cleanup with isolated fixtures.

## Task 4: Browser search lifecycle and product regression

**Files:** `public/modules/render/coach-float-search.js`, `public/modules/core/api-client.js`, `public/modules/core/request-scope.js` if needed, `public/app.js`, search/API/request-scope tests and `test/relationship-intelligence-server.test.mjs`.

**Interfaces:** `searchWeb(query, {signal})`; renderer uses a request ticket (`signal`, `isCurrent`, `finish`). App searches share the established context cancellation, and closing the panel cancels only search. Public labels say reference sources; unsafe URLs are rejected again in the browser.

- [x] Add overlap, cancellation, invalid URL, source wording, fixed-enum query and API AbortSignal regressions; capture failures.
- [x] Pass cancellation through fetch and reject all stale successes/errors before writing DOM. Keep request state scoped to each target when used without the app controller.
- [x] Add product API tests for refusal and complete memory sanitation/multi-turn identity; run targeted tests.

## Task 5: Review, regression and evidence

- [x] Review each agent diff, check integration and preserve original dirty work.
- [x] Align current README/PRIVACY/search docs with the fixed paths and network contract; retain historical audit reports.
- [x] Run full application and Runtime tests, static eval in a temp copy, dated course audit, module graph, syntax and `git diff --check`.
- [x] Walk the changed interface in an isolated browser without remote requests; stop the temporary service.
- [x] Save repair/validation evidence and report remaining live model, medical/legal, copyright and delivery evidence limitations accurately.

No implementation handoff or permission pause is required: the user's “那你修复吧” authorizes this plan's local repairs and tests. Source provenance gaps, missing historical delivery evidence and real-world effectiveness cannot be fabricated as completed by these code repairs.

