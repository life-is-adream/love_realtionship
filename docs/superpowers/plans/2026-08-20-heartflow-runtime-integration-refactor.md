# HeartFlow Runtime Integration Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改写课程与素材、不覆盖现有前端改动的前提下，让 HeartFlow 产品真正调用已通过测试的 Relationship Intelligence runtime，并建立默认不持久化、显式同意后才保存匿名结构化记忆的产品契约。

**Architecture:** 浏览器只负责采集当前会话、展示有界分析并保存用户明确同意的匿名结构化状态；本地 Node 服务通过独立适配器调用 `.agents/skills/relationship-coach-cn/runtime/`，不会把原始聊天返回给浏览器记忆层，也不会调用远程模型。产品入口继续作为组合层，运行时调用、状态规范化和渲染分别放入独立模块。

**Tech Stack:** Node.js >=18、原生 ESM、Node `node:test`、浏览器 Fetch API、原生 HTML/CSS；不新增 npm 依赖。

## Global Constraints

- 不修改 `恋爱15分钟学习/`、`_learned_relationship_course/`、`书籍/`、根目录视频或预生成课程。
- 保留本轮开始前已有的 7 个前端修改文件和 3 个未跟踪文件，不回退、不覆盖其功能。
- 默认 `consent=false`；未同意时不得生成或返回 `memoryPatch`，本轮分析只在当前页面会话中展示。
- 同意后只保存匿名 `case_` 标识和经过 runtime 校验的结构化观察；永不保存原始聊天到 Relationship Intelligence memory。
- Runtime 输出是观察性建议，不是兴趣概率、人格判断、心理诊断或关系事实。
- 新接口不得接收、返回或记录 API key；真实模型调用仍只走现有 `/api/chat`。
- 不执行 Git commit、push、reset、checkout 或删除操作。

---

### Task 1: 产品到 Runtime 的服务端适配器

**Files:**
- Create: `relationship-simulator/server/relationshipIntelligence.js`
- Modify: `relationship-simulator/server/index.js`
- Test: `relationship-simulator/test/relationship-intelligence-server.test.mjs`

**Interfaces:**
- Consumes: HeartFlow 消息 `{type: "me"|"her", text, createdAt?}` 或 runtime 消息 `{speaker: "user"|"other", text, timestamp?}`。
- Produces: `runProductRelationshipIntelligence(body) -> RuntimeResult` 和 `POST /api/relationship-intelligence`。
- Limits: 最多 80 条消息，每条最多 2,000 字；空消息返回 `400 bad_request`。

- [x] **Step 1: 写失败测试**

```js
test("stateless analysis never returns raw messages or a memory patch", () => {
  const result = runProductRelationshipIntelligence({
    messages: [{ type: "me", text: "你好" }, { type: "her", text: "你好呀" }],
    consent: false
  });
  assert.equal(result.memoryPatch, null);
  assert.equal(JSON.stringify(result).includes("你好呀"), false);
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test test/relationship-intelligence-server.test.mjs`  
Expected: FAIL，提示 `relationshipIntelligence.js` 不存在。

- [x] **Step 3: 实现消息规范化、匿名 Memory 重建和路由处理器**

适配器只把 `type/speaker`、有界 `text` 和合法时间戳交给 runtime；客户端传回的 memory 必须通过 `createMemory`、`appendObservation`、`recordOutcome` 重建，不能原样信任。

- [x] **Step 4: 接入主路由并验证**

Run: `node --test test/relationship-intelligence-server.test.mjs`  
Expected: PASS；接口返回 `version`, `analysis`, `state`, `decision`, `action`, `prediction`, `privacy`，但不返回原始消息。

### Task 2: 浏览器状态与 API Client

**Files:**
- Create: `relationship-simulator/public/modules/intelligence/state.js`
- Create: `relationship-simulator/public/modules/intelligence/client.js`
- Modify: `relationship-simulator/public/modules/core/config.js`
- Modify: `relationship-simulator/public/modules/core/state.js`
- Test: `relationship-simulator/test/relationship-intelligence-state.test.mjs`
- Test: `relationship-simulator/test/relationship-intelligence-client.test.mjs`

**Interfaces:**
- `normalizeRelationshipIntelligenceState(value) -> {schemaVersion, consent, caseId, memory, lastResult, lastError}`
- `setRelationshipIntelligenceConsent(value, granted) -> nextState`
- `buildRelationshipIntelligenceRequest({messages, goal, intelligence}) -> request`
- `analyzeRelationshipIntelligence(input, {fetchImpl?}) -> RuntimeResult`
- `serializeStateForStorage(state)` 必须在未同意时移除 `memory` 与 `lastResult`。

- [x] **Step 1: 写状态与 Client 失败测试**

```js
test("consent defaults off and revocation clears structured memory", () => {
  const current = normalizeRelationshipIntelligenceState({ consent: true, memory: { version: 1 } });
  const revoked = setRelationshipIntelligenceConsent(current, false);
  assert.equal(revoked.consent, false);
  assert.equal(revoked.memory, null);
});
```

- [x] **Step 2: 实现最小纯函数与 Client**

Client 固定调用 `/api/relationship-intelligence`，不接受 `apiKey` 字段；HTTP 非 2xx 时抛出带服务端中文信息的 Error。

- [x] **Step 3: 接入默认状态与持久化边界**

`defaultState.relationshipIntelligence` 默认关闭同意；`saveState()` 序列化前执行隐私裁剪，不改变当前内存中的页面展示结果。

- [x] **Step 4: 运行单测**

Run: `node --test test/relationship-intelligence-state.test.mjs test/relationship-intelligence-client.test.mjs`  
Expected: PASS。

### Task 3: 有界 UI、显式同意与产品主流程

**Files:**
- Create: `relationship-simulator/public/modules/render/render-intelligence.js`
- Create: `relationship-simulator/public/modules/intelligence/controller.js`
- Modify: `relationship-simulator/public/app.js`
- Modify: `relationship-simulator/public/index.html`
- Modify: `relationship-simulator/public/styles.css`
- Test: `relationship-simulator/test/relationship-intelligence-render.test.mjs`
- Test: `relationship-simulator/test/relationship-intelligence-integration.test.mjs`

**Interfaces:**
- `buildRelationshipIntelligenceHtml(state) -> escaped HTML`
- `createRelationshipIntelligenceController(dependencies) -> {refresh, setConsent, reset}`
- 产品流程：发送/生成消息 → 本地 runtime 分析 → 展示证据、决策、动作、状态与限制。

- [x] **Step 1: 写渲染与控制器失败测试**

验证 HTML 转义、缺省态、加载态、错误态、同意状态、请求竞态保护，以及调用结果不会写回 `lastAnalysis` 的模型字段。

- [x] **Step 2: 实现独立渲染和控制器**

UI 显示“本地确定性分析”，决策值保留英文枚举并附中文说明；显式标注“不是心理诊断”。复选框只控制匿名结构化长期记忆，不影响当前会话分析。

- [x] **Step 3: 接入 app 主流程**

在 `commitAnalysis`、用户发送、角色/剧本切换和重置边界触发刷新或清理；任何 runtime 错误都只影响该面板，不阻断原有聊天、教练和课程功能。

- [x] **Step 4: 运行集成测试**

Run: `node --test test/relationship-intelligence-render.test.mjs test/relationship-intelligence-integration.test.mjs`  
Expected: PASS。

### Task 4: 文档与初学者入口

**Files:**
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `relationship-simulator/README.md`
- Create: `relationship-simulator/docs/初学者开发指南.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- 文档必须区分课程内容层、Skill/runtime、HeartFlow 浏览器层、本地服务层和测试层。
- 明确 `/api/relationship-intelligence` 是本地确定性运行时，不调用远程模型；`/api/chat` 才可能调用配置的模型服务。

- [x] **Step 1: 更新架构和启动说明**

加入真实数据流、隐私边界、目录职责和常用验证命令。

- [x] **Step 2: 写初学者指南**

给出“改哪里、如何验证、哪些文件不要手改、遇到失败先看什么”的可执行说明，不要求读者理解全部源码。

### Task 5: 全量验证与自审

**Files:**
- Verify only: all files above plus existing tests/evals.

**Interfaces:**
- 完成条件：新旧测试全过、0 循环依赖、构建索引成功、静态 eval PASS、服务冒烟通过、`git diff --check` 无新增空白错误、无密钥进入 diff。

- [x] **Step 1: 全量自动验证**

```powershell
npm test
npm run check:circular
npm run build:index
node --test ..\.agents\skills\relationship-coach-cn\runtime\**\*.test.mjs
node ..\.agents\skills\relationship-coach-cn\evals\run-static-evals.mjs
```

- [x] **Step 2: 本地服务冒烟**

在随机空闲端口启动导出的 server，验证 `/api/health`、`/api/relationship-intelligence` 和 `/`；测试结束后关闭服务。

- [x] **Step 3: 差异与隐私复核**

运行 `git diff --check`、敏感字段扫描和修改文件清单检查；确认原有未提交文件仍存在且未被回退。

- [x] **Step 4: 计划自审**

核对所有任务均有测试与完成证据；移除占位内容，确认接口字段在服务端、Client、控制器、UI 和文档中一致。
