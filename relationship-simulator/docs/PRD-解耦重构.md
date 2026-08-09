# PRD：HeartFlow 恋爱模拟器「前后端完整解耦重构」（增量）

- **文档类型**：增量产品需求文档（Incremental PRD）
- **作者**：许清楚（产品经理，software-product-manager）
- **版本**：v1.0 / 草稿
- **日期**：2026-07-16
- **关联演进**：7/16 已完成「内容融合 + 智能升级」演进（config / coach / replies / prompts / stages / scenarios / long-content-index 已抽为独立模块，QA 跑通 63 测试）。本轮是**在该演进之上的二次解耦**。
- **约束**：本文档**只定义需求与边界，不修改任何代码**。

---

## 1. 目标与范围

### 1.1 本次目标（要拆什么）

把两块残留的「上帝文件」按**单一职责**拆成可独立测试的原生 ES Module，**业务行为 100% 不变（用户无感）**：

- **前端 `public/app.js`（当前 2192 行）**：把状态管理、API 调用、响应解析、三栏 DOM 渲染（chat / coach / training / persona）、长篇阅读、介入练习、阶段判断、场景剧本、移动端 tab、事件绑定，从单文件中拆出。
- **后端 `server.js`（当前 405 行）**：把静态文件服务、LLM 代理（`/api/chat`）、限流、SSE、长内容接口（`/api/long-content/:chapter`）、配置/环境变量加载、健康检查，从单文件中拆出。

### 1.2 非目标（不拆什么 / 不做）

- ❌ 不改任何**业务行为、文案、UI 视觉、交互流程**（用户无感）。
- ❌ 不改已抽离的叶子模块逻辑（`config.js` / `coach.js` / `replies.js` / `prompts.js` / `stages.js` / `scenarios.js` / `long-content-index.js`）——它们已是可测试模块，本轮保持接口稳定。
- ❌ 不引入构建步骤 / 打包器 / TypeScript / 框架（保持原生 ESM，无 `npm install` 额外依赖）。
- ❌ 不新增功能（如新的教练维度、新的剧本、新的 API 端点）。
- ❌ 不迁移或重写 `long-simulation/` 长内容数据与生成脚本（`generate-long-simulation.mjs` / `scripts/build-long-index.mjs`）。
- ❌ 不修改 `dropdown.js`（已是独立模块）。
- ❌ 不改 `package.json` 中除启动脚本路径外的脚本（除非目录迁移需要，见待确认问题）。

---

## 2. 高层模块边界建议

> 以下路径为**建议**，供架构师细化精确文件名与目录。原则是：纯逻辑（state / parser / api-client）与 DOM 渲染（render-*）分离；控制器只做装配与事件绑定。

### 2.1 前端（拆 `public/app.js`）

| 建议模块 | 职责（一句话） |
|---|---|
| `public/js/state.js` | 单一可信状态源 + localStorage 持久化 + persona/记忆纯派生函数（loadState / normalizeState / saveState / getAllPersonas / getCurrentPersona / getPersonaMemory / getConversationWindow / buildConversationSummary / buildLocalHerReply / normalizeMessages / escapeHtml 等纯函数）。 |
| `public/js/api-client.js` | 封装 `/api/chat` 请求、错误兜底、本地健康检查（buildMessages / callLLM / askAi / checkHealth / getLatestMineText）；**不碰 DOM、不碰状态**。 |
| `public/js/parser.js` | 把模型/本地输出解析为 UI 数据结构（parseModelContent / extractJsonObject / normalizeReplyOptions / normalizeAnalysis / normalizeCoachScore / parsePreflightEvaluation / localAnalyze / buildLocalReplyOptions / buildLocalRewriteReason / parseStageResult / parseChapterContent / parsePlainTextFallback 等）；**纯函数，可独立单测，必须带走 localAnalyze 兜底与 coach 评分逻辑**。 |
| `public/js/render-persona.js` | 角色面板与头像交互渲染（renderPersonaControls / renderMemoryControls / savePersonaMemory / switchPersona / buildCustomPersona / saveCustomPersona / deleteCurrentPersona / 头像拖拽与上传系列）。 |
| `public/js/render-chat.js` | 聊天面板渲染与消息流（renderChat / appendMine / appendMineIfNew / appendHerIfNeeded / nextTurn）。 |
| `public/js/render-coach.js` | 教练面板渲染（renderAnalysis / renderTraining / renderActionPlan / card / scoreBar / buildSparkline / showReviewComparison 等分析/选项/计划/成长日志）。 |
| `public/js/render-longContent.js` | 长篇阅读视图（openLongReader / closeLongReader / renderChapterList / renderChapterContent / loadChapter / saveReadProgress / loadReadProgress）。 |
| `public/js/render-intervention.js` | 介入练习模态（openIntervention / closeIntervention / buildInterventionContext / renderInterventionPanel / renderInterventionComparison / saveInterventionAsLog / submitIntervention）。 |
| `public/js/render-stage.js` | 阶段自动判断与 UI 同步（autoDetectStage / parseStageResult / applyStageResult / onStageManualChange / restoreStageState）。 |
| `public/js/render-scenario.js` | 场景剧本渲染（renderScenarioList / loadScenario / REVIEW_MAPPING）。 |
| `public/js/mobile-tabs.js` | 移动端 Tab（initMobileTabs / switchTab / markCoachUnread / clearCoachUnread）。 |
| `public/js/controller.js`（或保留 `public/app.js` 作为装配入口） | **仅做装配与事件绑定**：import 上述所有模块、绑定 `$("...").addEventListener` 区块、`window.RelationshipLLM` 导出、初始渲染调用（renderPersonaControls / renderChat / renderAnalysis / renderActionPlan / renderScenarioList / initMobileTabs / restoreStageState / checkHealth）。不内联业务逻辑。 |

> 注：`render-coach.js` 逻辑量最大（约 800 行），落地时若超过单文件行数红线，架构师可进一步拆为 `render-analysis` / `render-training` / `render-actionPlan` 三个子模块。

### 2.2 后端（拆 `server.js`）

| 建议模块 | 职责（一句话） |
|---|---|
| `server/llmProxy.js` | `/api/chat` 处理：请求体校验、上游 fetch、限流通过后调用、响应归一化为 chat-completions 形状（handleChat / normalizeProxyResponse / extractModelContent / clamp 辅助）。 |
| `server/staticServer.js` | 静态文件服务：`public/` 托管、404 fallback 到 index.html、请求体读取与 JSON/Text 响应工具（serveStatic / readRequestJson / sendJson / sendText / mime 表）。 |
| `server/rateLimit.js` | 每客户端 IP 内存限流（checkRateLimit / rateBuckets / 清理定时器 / 窗口与上限常量）。 |
| `server/routes-longContent.js` | 长内容只读接口：`GET /api/long-content/:chapter`、章号文件映射、路径遍历安全校验（handleLongContent / longContentFiles）。 |
| `server/config.js` | 配置与环境变量加载：`.env` 解析（loadDotEnv）、`LLM_*` 与 `PORT` 常量、`inferApiMode` / `normalizeApiMode` / `maskEndpoint`。 |
| `server/healthRoute.js` | `GET /api/health` 健康检查响应。 |
| `server/index.js`（装配入口） | 创建 http server、路由分发（health / chat / long-content / static）、`listen` 与启动日志。**`package.json` 的 `start`/`dev` 需同步改为 `node server/index.js`**（若采用目录迁移方案，见待确认问题）。 |

---

## 3. 需求池

> 优先级：P0 = 必须拆、核心耦合；P1 = 次要但建议；P2 = 锦上添花。每条含「当前问题 / 拆后收益」。

### P0（必须拆、核心耦合）

**P0-1 前端状态管理内联在 app.js 顶部（9–160 行）**
- 当前问题：`state = loadState()` 为模块级可变单例，save/load/派生函数散落控制器顶部，无独立模块，无法单测、易与其他逻辑耦合。
- 拆后收益：状态成为可独立测试的纯模块；控制器通过导入使用，便于后续做状态快照/回放测试。

**P0-2 响应解析逻辑混在控制器（parse* / normalize* / localAnalyze，约 793–1271 行）**
- 当前问题：模型输出解析、JSON 容错、兜底 `localAnalyze`、`buildLocalReplyOptions`、`normalizeCoachScore` 等大量纯逻辑与 DOM 渲染、事件绑定混在同一文件，无法单测。
- 拆后收益：解析层纯函数化，可批量单测；**确保 localAnalyze 兜底与 coach 评分逻辑完整迁移、行为不变**（这是离线/无密钥场景的关键路径）。

**P0-3 LLM 调用与 UI 编排耦合（buildMessages / callLLM / askAi / generateHerDialogue / preflightReply / generateActionPlan，约 550–1076 行）**
- 当前问题：请求构造、fetch 调用、错误兜底与「渲染结果并写入 state」混在一起，网络层不可单独替换或 mock。
- 拆后收益：`api-client.js` 成为可 mock 的网络边界，渲染层只消费数据；便于加单元测试与后续替换引擎。

**P0-4 三栏 DOM 渲染混在控制器（render-chat 284 / render-coach 304 / render-persona 168 / training 408 行）**
- 当前问题：聊天气泡、教练分析、角色面板、成长日志渲染函数与状态/解析/事件全部耦合，单文件 2192 行。
- 拆后收益：每个 render 模块职责单一，UI 改动局部化，回归面变小。

**P0-5 后端 LLM 代理 + 静态服务 + 限流 + 长内容 + 配置 全部在 server.js（405 行）**
- 当前问题：单文件混合 HTTP 服务、代理、限流、SSE、长内容、`.env` 加载，无分层。
- 拆后收益：路由/中间件/配置分离，限流与代理可独立测试，便于后续加路由、改代理策略。

### P1（次要，建议本轮一并做）

**P1-1 长篇阅读视图 / 介入练习模态** 拆为 `render-longContent.js` / `render-intervention.js`（1443–1887 行）。
- 当前问题：阅读器与模态逻辑量大且自包含，混在控制器里。
- 拆后收益：隔离复杂 DOM 交互，降低主文件复杂度。

**P1-2 阶段自动判断 / 场景剧本 / 移动端 Tab** 拆为 `render-stage.js` / `render-scenario.js` / `mobile-tabs.js`（1888–2133 行）。
- 当前问题：自包含 UI 逻辑混入控制器。
- 拆后收益：移动端、阶段、剧本各自独立，便于针对性测试。

**P1-3 后端 `config.js` 与环境变量加载独立**（`loadDotEnv` / `inferApiMode` / `normalizeApiMode` / `maskEndpoint`）。
- 当前问题：配置逻辑与路由 handler 混写。
- 拆后收益：配置可单测、可在启动时集中校验（如缺失 API Key 的提示）。

### P2（锦上添花）

**P2-1 为 parser / 各新模块 / 各 server 模块补充单元测试**
- 当前问题：现有 63+ 测试**只覆盖叶子模块（coach / replies / scenarios / stages / long-content-index），完全不覆盖 app.js 与 server.js**；控制器与 server 无回归安全网。
- 拆后收益：新模块是纯函数边界，补单测成本低、收益高，直接降低「拆出白屏 / API 行为漂移」风险。

**P2-2 引入循环依赖检测（madge）到 CI / 本地校验**
- 当前问题：ESM 拆分后可能出现 import 环，是白屏的隐蔽来源。
- 拆后收益：自动化拦截循环依赖（见成功标准）。

**P2-3 顺手补充 `build:index` / 部署说明文档**（当前仅 `package.json` 有 `build:index` 脚本指向 `scripts/build-long-index.mjs`，无配套文档）。

---

## 4. 成功标准（可量化）

1. **单文件行数**：拆分后每个前端/后端模块 **≤ 300 行**（超出的 `render-coach` 等须再拆）；控制器/装配入口允许略超但不内联业务逻辑。
2. **循环依赖 = 0**：`madge --circular`（或等价工具）对 `public/js/` 与 `server/` 检测结果为 0 环。
3. **现有测试全过**：`npm test` 下 63+ 测试 100% 通过（叶子模块接口不变）。
4. **页面无白屏**：手动加载 + 自动化 smoke（`index.html` 加载后 `window.RelationshipLLM` 可用、三栏 DOM 渲染完成、无 console 报错）。
5. **API 契约不变**：`/api/chat`（请求体 `messages` 等字段、响应 chat-completions 形状）、`/api/health`、`/api/long-content/:chapter` 的请求/响应结构、状态码、错误体**逐字节兼容**。
6. **业务行为不变**：用户操作路径（发消息、生成女方对话、发送前测验、教练分析、ABC 回复、长期路线、阶段自动判断、剧本加载、长篇阅读、介入练习、角色切换/自定义/头像、移动端 Tab）输出与重构前一致（含 localAnalyze 兜底与 coach 评分）。
7. **无构建步骤**：仍纯原生 ESM，浏览器 `type="module"` 直接加载，无新依赖。

---

## 5. 风险与依赖

| 风险/依赖 | 说明 | 缓解 |
|---|---|---|
| **ESM 导入链白屏（前次踩过的坑）** | 拆分后若某模块顶层有副作用/抛错或路径写错，浏览器整页白屏且难定位。 | 模块顶层保持无副作用；`index.html` 入口与 `import` 路径逐一核对；加加载 smoke 测试；保留 `?v=` 缓存版本号机制。 |
| **server 迁移 `server/` 后路径基准变化** | 若采用目录迁移，`__dirname` 基准改变，`publicDir`/`longSimulationDir` 与 `loadDotEnv('.env')` 相对路径会算错，导致静态资源 404、长内容读不到、`.env` 不生效。 | 用 `path` 相对新基准重算，或统一以 `process.cwd()` 为根定位 `public/`、`long-simulation/`、`.env`；迁移后手动验证三个路径。 |
| **localAnalyze 兜底与 coach 评分必须保留** | 无 API Key / 离线时靠 `localAnalyze`、`buildLocalReplyOptions`、`buildLocalRewriteReason`、`normalizeCoachScore` 兜底，丢了会降级失败。 | 这些函数明确归入 `parser.js`，迁移后单测覆盖。 |
| **`index.html` script 入口与 import 路径需同步** | 当前 `<script type="module" src="/app.js">`；若控制器改名/改目录，路径要改。 | 决定保留 `app.js` 作装配入口或改 `controller.js` 并同步 `index.html`（见待确认）。 |
| **`window.RelationshipLLM` 全局导出必须保留** | 调试接口与潜在外部依赖（测试/控制台）引用它。 | 在控制器装配层原样重新 `export` 同一组方法。 |
| **`package.json` start/dev 脚本** | 若 server 迁移目录，`"start": "node server.js"` 失效。 | 同步改为 `node server/index.js`（需主理人确认是否迁移）。 |
| **测试不覆盖控制器/server（回归盲区）** | 当前 63 测试只覆盖叶子模块，拆 app.js/server.js 无回归安全网。 | 借 P2-1 为新模块补单测；拆分期间保留「手动冒烟清单」。 |
| **`?v=` 缓存版本号** | `index.html` 引用 `/app.js?v=20260713-2` 与 `/js/dropdown.js?v=20260713-2`；拆分后文件名/数量变化，旧缓存可能加载到旧路径。 | 拆分上线时更新版本号，避免浏览器命中旧缓存。 |

---

## 6. 待确认问题（需主理人 / 用户拍板）

1. **后端是否接受新增 `server/` 目录？** 还是原地拆 `server.js` 为同目录多个 `*.js` 模块（风险更小、路径基准不变，但根目录多文件）？影响 `package.json` start 脚本与路径基准。
2. **前端控制器入口命名**：保留 `public/app.js` 作为装配入口（内部 `import` 子模块），还是重命名为 `public/js/controller.js` 并同步更新 `index.html` 的 `<script src>`？
3. **是否顺手补充 `build:index` 与部署说明文档**？（当前仅 `package.json` 脚本，无文档）
4. **是否接受为 parser / 各新前端模块 / 各 server 模块补充单元测试**（P2-1）？这会改变「测试数量」与 CI，但能消除当前控制器/server 的回归盲区。
5. **单文件 300 行红线是否严格？** `render-coach` 类大模块是否允许临时略超，还是必须再拆到子模块。
6. **是否保留 `window.RelationshipLLM` 调试接口？**（建议保留，需确认）
7. **拆分范围是否包含 SSE**？当前 `server.js` 注释提及 SSE，但实际 `handleChat` 使用 `stream: false` 且未实现 SSE 推送——确认本轮不涉及 SSE 实现，仅迁移现有 `stream:false` 路径。

---

## 附：现状结构速览（供架构师参考）

- 根：`server.js`（405 行）、`package.json`、`public/`、`test/`（5 个 `*.test.mjs`，共 63+ 用例）。
- `public/`：`app.js`（2192 行）、`index.html`、`styles.css`、`js/`（config / coach / replies / prompts / stages / scenarios / long-content-index / dropdown 已独立）。
- `test/` 仅 import 叶子模块，**不 import `app.js` / `server.js`** —— 故「测试全过」的前提是叶子模块接口稳定；控制器/server 自身无测试覆盖。
- 启动入口：`index.html` 通过 `<script type="module" src="/app.js?v=20260713-2">` 加载控制器。
