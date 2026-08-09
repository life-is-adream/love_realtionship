# Relationship Intelligence Agent Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 Relationship Intelligence Skill 从一次性咨询升级为可重复运行的 Conversation Intelligence → Evidence → Memory → Decision → Simulation → Reflection 闭环。

**Architecture:** 在 `.agents/skills/relationship-coach-cn/runtime/` 增加无外部依赖的 ESM 运行时层。Conversation Analyzer 只从已脱敏消息提取可观察统计；Memory 只保存匿名、用户授权的结构化事实；State/Decision/Reflection 使用显式状态、证据和结果更新，不模拟真实第三方人格。Role-play 使用固定场景和可解释评分，不输出“标准答案”替代用户练习。

**Tech Stack:** Node.js >=18、原生 ESM、Node `node:test`、JSON Schema、Markdown Skill 路由；不新增 npm 依赖，不调用远程模型。

## Global Constraints

- 默认不保存第三方真实身份、联系方式、住址、健康或性经历实名数据。
- 上游资料仍为 archive/provenance，不可作为运行时 Prompt。
- 统计指标是观察性信号，不是心理诊断、兴趣概率或人格结论。
- 所有决策只能是 `ADVANCE`、`MAINTAIN`、`OBSERVE`、`DE_ESCALATE`、`EXIT`。
- Role-play 必须采用 Scenario → User Response → Critique → Retry，不先给可背诵的标准答案。
- 每个新增纯函数必须有确定性测试；无模型 benchmark 时不得声称效果提升。
- 不修改本轮开始前已存在的 `relationship-simulator` 前端改动、调研报告或演示图片。

---

### Task 1: Conversation Intelligence 分析器

**Files:**
- Create: `.agents/skills/relationship-coach-cn/runtime/conversation/analyzer.mjs`
- Create: `.agents/skills/relationship-coach-cn/runtime/conversation/analyzer.test.mjs`
- Create: `.agents/skills/relationship-coach-cn/schemas/conversation.schema.json`
- Modify: `.agents/skills/relationship-coach-cn/evals/README.md`

**Interfaces:**
- `analyzeConversation(messages, options?) -> ConversationAnalysis`
- `ConversationAnalysis` 提供消息数、双方主动比例、提问比例、平均回复间隔、主题连续性、情绪标签、冲突标记和 `evidence` 数组。
- 输入消息只接受 `{speaker, text, timestamp?}`；缺少时间戳时不伪造等待时长。

- [ ] **Step 1: 写失败测试**

覆盖：消息顺序、主动比例、提问比例、时间缺失、连续追问、边界/冲突文本、普通文本不被误标。

- [ ] **Step 2: 运行测试确认失败**

运行：`node --test .agents/skills/relationship-coach-cn/runtime/conversation/analyzer.test.mjs`
预期：因 `analyzer.mjs` 尚不存在而失败。

- [ ] **Step 3: 实现最小分析器**

实现纯函数：规范化消息、按相邻消息计算回复间隔、只对可观察文本做规则标记，并在结果中记录 `insufficient_data`，不生成心理结论。

- [ ] **Step 4: 运行测试确认通过**

运行同上，预期全部 PASS；再用 `JSON.parse` 校验 `conversation.schema.json`。

- [ ] **Step 5: 更新文档并提交**

在 Evals README 中说明分析器是观察性特征提取，不是 LLM benchmark。

### Task 2: Relationship Memory 与状态机

**Files:**
- Create: `.agents/skills/relationship-coach-cn/runtime/memory/memory-store.mjs`
- Create: `.agents/skills/relationship-coach-cn/runtime/memory/memory-store.test.mjs`
- Create: `.agents/skills/relationship-coach-cn/runtime/state/state-machine.mjs`
- Create: `.agents/skills/relationship-coach-cn/runtime/state/state-machine.test.mjs`
- Create: `.agents/skills/relationship-coach-cn/schemas/memory.schema.json`
- Create: `.agents/skills/relationship-coach-cn/schemas/reflection.schema.json`
- Modify: `.agents/skills/relationship-coach-cn/core/privacy-policy.md`
- Modify: `.agents/skills/relationship-coach-cn/core/routing.md`

**Interfaces:**
- `createMemory({caseId, consent}) -> MemoryRecord`
- `appendObservation(memory, observation) -> MemoryRecord`
- `recordOutcome(memory, outcome) -> MemoryRecord`
- `summarizeMemory(memory) -> MemorySummary`
- `transitionState(currentState, signalSet) -> StateTransition`
- 状态集合：`UNKNOWN`, `INITIAL_CONTACT`, `MUTUAL_FAMILIARITY`, `GROWING_INTEREST`, `DATING_EXPLORATION`, `COMMITTED_RELATIONSHIP`, `CONFLICT`, `REPAIR`, `STABLE_RELATIONSHIP`, `EXIT`。

- [ ] **Step 1: 写失败测试**

验证：无 consent 时不能持久化第三方字段；case ID 必须匿名；时间线追加不可变；结果记录包含 prediction/outcome/update；冲突可回退到 repair，明确退出进入 EXIT。

- [ ] **Step 2: 运行测试确认失败**

运行：`node --test .agents/skills/relationship-coach-cn/runtime/memory/memory-store.test.mjs .agents/skills/relationship-coach-cn/runtime/state/state-machine.test.mjs`

- [ ] **Step 3: 实现内存记录和有限状态转换**

只保存用户明确授权的结构化事实；未知字段保持空，不从消息推断姓名、人格或第三方隐私。状态转换返回 `reason`、`evidenceIds` 和 `reversible`。

- [ ] **Step 4: 运行测试并校验 Schema**

运行上面的 Node 测试和 JSON Schema 解析；预期全部 PASS。

### Task 3: Reflection 与 Role-play Simulator

**Files:**
- Create: `.agents/skills/relationship-coach-cn/runtime/reflection/reflection-engine.mjs`
- Create: `.agents/skills/relationship-coach-cn/runtime/reflection/reflection-engine.test.mjs`
- Create: `.agents/skills/relationship-coach-cn/runtime/simulation/scenario-engine.mjs`
- Create: `.agents/skills/relationship-coach-cn/runtime/simulation/scenario-engine.test.mjs`
- Create: `.agents/skills/relationship-coach-cn/schemas/scenario.schema.json`
- Modify: `.agents/skills/relationship-coach-cn/modules/roleplay.md`

**Interfaces:**
- `createPrediction({decision, action, expectedSignal}) -> Prediction`
- `reflectOnOutcome(prediction, outcome) -> Reflection`
- `listScenarios() -> Scenario[]`
- `startScenario(scenarioId) -> Session`
- `critiqueResponse(session, response) -> Critique`
- `retryScenario(session, response) -> Session`

- [ ] **Step 1: 写失败测试**

覆盖预测与现实一致/不一致、未知结果不强行归因、场景确定性、批评只给 2–3 个优先改进点、不能替用户生成“正确答案”。

- [ ] **Step 2: 运行测试确认失败**

运行：`node --test .agents/skills/relationship-coach-cn/runtime/reflection/reflection-engine.test.mjs .agents/skills/relationship-coach-cn/runtime/simulation/scenario-engine.test.mjs`

- [ ] **Step 3: 实现 Reflection 和 Role-play**

Reflection 输出 `prediction`, `observed_outcome`, `calibration`, `update`, `next_test`；Role-play 评分维度包括自然度、问题密度、倾听、边界、推进速度和过度解释，并保留原始用户回答的脱敏摘要。

- [ ] **Step 4: 运行测试确认通过**

运行同上；预期全 PASS。

### Task 4: Agent Loop 编排与 Skill 路由

**Files:**
- Create: `.agents/skills/relationship-coach-cn/runtime/agent-loop.mjs`
- Create: `.agents/skills/relationship-coach-cn/runtime/agent-loop.test.mjs`
- Modify: `.agents/skills/relationship-coach-cn/SKILL.md`
- Modify: `.agents/skills/relationship-coach-cn/core/routing.md`
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`

**Interfaces:**
- `runRelationshipLoop({messages, memory, goal, consent}) -> {analysis, state, decision, action, prediction, memoryPatch}`
- `runRelationshipLoop` 必须先脱敏/分析，再引用 Evidence/Decision 规则；不得把原始聊天直接作为“心理真相”。

- [ ] **Step 1: 写失败测试**

验证：输入“最近忙”产生 `OBSERVE` 和多个假设；明确拒绝产生 `DE_ESCALATE` 或 `EXIT`；无时间戳不生成等待时长；记忆 patch 不含姓名、电话或原始聊天。

- [ ] **Step 2: 实现编排器**

组合 Analyzer、State Machine、Decision Policy、Prediction 和 Memory Patch；输出可审查的证据 ID 与停止条件。

- [ ] **Step 3: 运行回归测试**

运行新增 runtime 测试、已有静态 Evals，并校验不加载 `references/upstream/**`。

### Task 5: Evals、文档和发布验证

**Files:**
- Modify: `.agents/skills/relationship-coach-cn/evals/generate-dataset.mjs`
- Modify: `.agents/skills/relationship-coach-cn/evals/run-static-evals.mjs`
- Create: `.agents/skills/relationship-coach-cn/evals/roleplay/README.md`
- Create: `.agents/skills/relationship-coach-cn/evals/reasoning/README.md`
- Create: `.agents/skills/relationship-coach-cn/evals/reflection/README.md`
- Create: `.agents/skills/relationship-coach-cn/evals/privacy/README.md`
- Modify: `.agents/skills/relationship-coach-cn/evals/README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- 静态案例新增 `roleplay`, `reasoning`, `reflection`, `privacy` 类别；总数至少 190。
- 不输出 Base LLM/Full System 的虚构分数；只报告数据契约和本地 runtime 测试。

- [ ] **Step 1: 扩展数据集和契约检查**

为每个新增类别添加匿名案例、`must_include`/`must_not_include` 和相应目录 README；运行生成器后检查类别计数。

- [ ] **Step 2: 更新文档**

补充“Agent loop、Memory consent、Conversation Analyzer、Reflection calibration”章节与运行命令。

- [ ] **Step 3: 全量验证**

运行：

```powershell
node --test .agents/skills/relationship-coach-cn/runtime/**/*.test.mjs
node .agents/skills/relationship-coach-cn/evals/generate-dataset.mjs
node .agents/skills/relationship-coach-cn/evals/run-static-evals.mjs
```

预期：runtime 测试全部通过；静态 Evals 至少 190 条且 PASS。

- [ ] **Step 4: 检查差异并提交**

只暂存本计划列出的 Skill/runtime/schema/eval/docs 文件，不暂存既有 `relationship-simulator` 前端改动、调研报告或演示图片；提交消息使用 `feat: add relationship intelligence agent loop`。

- [ ] **Step 5: 推送并验证远端**

运行：`git push`、`git ls-remote origin refs/heads/refactor/relationship-intelligence-v1`、`git status --short --branch`。报告提交哈希、远端分支和保留的未提交文件。
