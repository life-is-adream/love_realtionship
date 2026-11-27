# HeartFlow 自然对话与可控记忆实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留现有训练流程的前提下，让用户选择模拟对话风格、管理授权后的长期记忆，并明确 AI 身份，使用同一组合成场景验证。

**Architecture:** 前端沿用现有角色回复 / 教练分析双通道。对话风格是受限枚举并进入角色生成提示词；长期记忆继续沿用现有显式同意开关，面板编辑及删除直接作用于实际注入的条目；角色身份在聊天界面和生成约束中明确。保留现有角色设定、训练模式和用户已有数据。

**Tech Stack:** Node.js >= 18、ES modules、原生 HTML/CSS/DOM、node:test、现有 MiMo 兼容模型代理。

## Global Constraints

- 默认自然日常；其他选项为轻松幽默、温柔陪伴。无效或旧状态回退自然日常。
- 风格影响角色回复，不改变教练建议风格和安全边界；按输入需要调整长度，不强制每轮追问。
- 最近一条用户消息及相关上下文优先；先回应对方的实际内容或问题，不凭空补全未出现的用户事实。
- 结构化长期记忆默认关闭、显式授权；关闭后不生成、不注入，并清除既有增强记忆。可见的记忆可以编辑、删除。
- 原始聊天记录与角色场景设定现有行为独立于结构化记忆授权：当前会保存在浏览器本地；明确说明，禁止误称未授权就自动清空，禁止默默删除已有用户数据。
- AI 身份需要在界面持续可见；直接询问身份应明确答复，不冒充真人。角色扮演不得覆盖该要求。
- 不读取或输出 API key、真实聊天记录；不更改模型配置或删除用户已有改动；不提交代码。
- 模型体验测试使用合成场景；网络不可用时如实报告，不把离线/模拟结果说成真实模型效果。

---

### Task 1: 角色对话风格与身份

**Files:**
- Modify: `public/index.html`（聊天区选择器与常驻 AI 标识）
- Modify: `public/styles.css` / `public/shell.css`（仅在现有布局需要时）
- Modify: `public/modules/core/config.js`, `public/modules/core/state.js`（默认值及旧状态兼容）
- Modify: `public/app.js`（UI 取值、保存、变更时取消过期请求）
- Modify: `public/modules/core/api-client.js`, `public/modules/coach/prompts.js`（将选定风格只传入角色提示词）
- Test: `test/api-client.test.mjs`, `test/prompt-snapshot.test.mjs` 与必要的用户交互测试。

**Interfaces:** `state.chatStyle` 的规范值是 `daily`、`humorous`、`gentle`；`buildHerMessages(persona, memory, messages, uiValues)` 从 `uiValues.chatStyle` 获取风格；原有 `mode` 保持不变。

- [x] 先检查现有未提交修改，保留文件中不属于本任务的内容；增加行为测试，覆盖三个风格、旧状态和非法值回退、角色与教练提示词隔离。
- [x] 在聊天界面增加有标签的风格选择器与常驻“AI 模拟角色”标识；变化后持久化选择并取消依赖旧上下文的请求；允许键盘访问。
- [x] 角色提示词优先直接回应用户最近输入；根据输入长短和话题调整回复，不强行复述、提问或推进，不推断/编造用户信息。三种风格在语气、表达和适量幽默上区分，同时保留角色性格及现有安全/训练约束。
- [x] 明确角色为 AI 模拟，用户直接问是否真人/AI 时必须诚实回答；对常见的明确身份询问提供可靠处理，并保持正常非身份问题的角色对话流程及教练结果。
- [x] 运行 `node --test test/api-client.test.mjs test/prompt-snapshot.test.mjs` 和针对新增交互的测试，全部通过；旧断言若与授权的新行为冲突，只更新相关断言。

### Task 2: 记忆真实可控

**Files:**
- Modify: `public/modules/render/render-persona.js`（保存场景字段时保留 `_enhanced` 及其他已有字段）
- Modify: `public/modules/render/render-memory-panel.js`（编辑、删除和真实存储说明）
- Modify: `public/modules/core/memory.js`, `public/app.js`（用户看得见的记忆与实际注入保持一致，授权变更及编辑取消在途请求）
- Test: `test/memory-panel.test.mjs`, `test/memory.test.mjs`, `test/render-persona.test.mjs`。

**Interfaces:** `removeMemoryEntry(personaId, kind, index)` 保持兼容；新增经边界检查的 `updateMemoryEntry(personaId, kind, index, text)`，其中 `kind` 仅为 `timeline` 或 `summary`。时间线编辑 `content`，摘要编辑 `summary`；空值不保存，长度有界，HTML 必须转义。

- [x] 增加测试：编辑/删除后，下一次角色记忆注入读取新内容；未授权既不新增也不注入增强记忆；撤销授权清除增强记忆；保存角色场景不破坏增强记忆；非法条目和 HTML 输入安全处理。
- [x] 面板提供明确的编辑、保存、取消、删除操作；不得依赖浏览器全局 prompt。限定长度且输出转义，支持多次编辑和删除；变化后令旧生成请求失效。
- [x] 审核 `buildMemoryInjection` 及 `buildPatternInjection`：角色提示词不得偷偷注入用户无法查看或管理的其他长期记忆字段。允许保留统计用于既有非注入功能；所有确实进入角色生成的长期记忆都应可见、可管理。
- [x] 修正未授权说明：自动提取的长期复盘记忆默认关闭；现有聊天记录与手动场景设置仍会保存在本机。提醒删除某条不会自动擦除当前聊天或其他重复记录。
- [x] 运行上述三个测试及授权/状态/生成相关测试，确保旧功能兼容。

### Task 3: 同一组合成场景与端到端验证

**Files:**
- Create: `test/fixtures/chat-style-cases.json`（同一批非个人数据的合成场景）
- Create: 可复用的测试或脚本，遵循现有 `test/` 与 `scripts/` 风格。
- Modify: `README.md`（风格、AI 身份、记忆授权与聊天记录的真实行为）。

**Interfaces:** 场景至少覆盖普通寒暄、负面情绪、直接提问、用户要求停聊、直接询问 AI 身份、未知个人事实及用户修改/删除记忆；所有风格复用同样场景。每个场景记录输入与可人工判断的预期，不把规则测试误报成真实模型质量得分。

- [x] 使用合成场景测试请求构造、风格选择、最近上下文、身份标识、记忆授权与变更的可观察行为。
- [x] 若已有可用本机服务和模型配置，在不输出凭证且不读取真实聊天的前提下，选择有界数量的同场景请求测试真实 `mimo-v2.6-flash` 上游，记录模型、样本、成功/失败和脱敏结果；服务不可用时报告具体阻碍，不假称通过。
- [x] 运行 `npm test`；若有失败，区分与当前变更相关的回归及预先存在的问题，给出原因和复现命令。
- [x] 交付文件清单、测试结果、真实模型测试情况与未解决限制，不提交代码。

---

## 审计修复记录（2026-11-07）

上一轮执行中断后，独立测试发现四处实际错误，已按下列方式修复：

| 问题 | 根因 | 修复 |
| --- | --- | --- |
| 否定事实被说反 | `resolveMemoryRecall` 用正则直接断言结论，没有保留原句与极性 | 改为**只引用原话**：否定句原样引用，不确定表达原样保留；前后冲突时并列呈现 |
| 读取用户看不到的字段 | 对 `JSON.stringify(memory)` 整体匹配 | 事实来源收敛为用户自己发的消息 + `selectInjectedMemoryEntries()` 选出的条目（与 `buildMemoryInjection` 同源）；`_enhancedInjection`、统计字段一律不作证据 |
| 保护只针对城市测试题 | 硬编码城市表 + 单一问法 | 改为「时间锚 + 谓词 + 内容词」通用匹配，删除城市白名单；覆盖买什么、见了谁、哪家店等 |
| 身份识别两套实现 | `app.js` 与 `api-client.js` 各写一份正则，测试只覆盖后者 | 删除 `app.js` 本地副本，两条生成路径统一走 `resolveDeterministicReply()` |

**未解决限制（如实记录）：**

- 普通聊天里模型是否编造用户事实，仍由提示词约束；护栏只覆盖「追问自己过往」这一类可判定问法。
- 谓词归并表与时间锚是有限枚举，非典型说法会退化为「没有可靠记录」（漏报，不会误报）。
- 开放式「我之前说过什么」交回模型，不强行回答。
- 已在 Node `v22.22.2` 验证；声明支持的 Node 18 未复测。
- 本次未提交代码。

## 提示词收敛（2026-11-07，PROMPT_VERSION 1.8.0）

上一轮真实上游抽样留下两条提示词层观察，本轮处理如下：

| 观察 | 处理 | 复测 |
| --- | --- | --- |
| `greeting` 三种风格都追问「哪家店」 | her 通道新增：对方只是陈述时先给反应或补自己的细节，问句不是默认接法；一条回复最多一个问句，并写入反例「哪家店？在你上班路上吗」算两个 | 未消除。两次运行合计 30 条抽样中出现 1 条连问 |
| `memory-edit-delete` 出现「我这边看到的已经是更新后的内容」 | her 通道新增：不得用后台视角谈论记忆是否被更新或删除，不得声称核对过；按现在知道的信息说话 | 该场景两轮共 6 次，0 次核对口吻；回复变为「嗯，那我按现在知道的来」 |

**判定修正（如实记录）：** `greeting` 的追问经复核不属于事实或身份类错误。fixture 写的是「不必追问」（允许性表述），不是「不要追问」；对「路上看到一家新开的咖啡店」追问一句是自然的人类反应。因此该项按**风格偏好**处理：约束已写入提示词，但不设硬门禁，也不再为通过单次采样继续堆规则。真正可判定的缺陷只有「一个回合连问两件事」，而这个计数本身是启发式的。

**新增可复现指标**（`npm run eval:chat-style-live`）：

- `questionCount`：按分句计数（问号结尾 + 疑问词/语气词收尾），只观察「连问」倾向；对「在哪条路上」这类无问号问句会漏计，不能当门禁。
- `memoryClaim`：识别「我这边看到的……更新/修改/删除」「按新的记忆」「记忆已更新」等句式；命中即脚本以非零退出。
- 报告头写入 `PROMPT_VERSION`，便于跨版本对比同一场景。


## 浏览器端到端（2026-11-07）

新增 `scripts/e2e-browser.mjs`（`npm run e2e:browser`）：CDP 直连本机 Chromium，零第三方依赖、不下载浏览器。
覆盖四条只能在真实 DOM 上验证的行为。离线模式 11 项、live 模式 12 项，全部通过。

| 检查 | 离线（强制本地降级） | live（真实 `/api/chat`） |
| --- | --- | --- |
| 身份直问 → 固定答复 + 来源标为本地 | 通过 | 通过 |
| 无记忆追问 → 承认没有记录 | 通过 | 通过 |
| 记忆可见 / 引用 / 编辑后重问 / 删除后重问 | 通过 | 通过 |
| 刷新后风格选中项与可见标签一致 | 通过 | 通过 |
| 刷新后 AI 模拟标识仍在 | 通过 | 通过 |
| 页面无未捕获异常 | 通过 | 通过 |
| 教练通道真实调用上游成功 | 不适用（故意失败） | 通过 |

报告：`docs/verification/2026-11-07-browser-e2e.md`（11/11）、`docs/verification/2026-11-07-browser-e2e-live.md`（12/12）。
离线模式连跑 4 次均通过，用来排除偶然。

**过程中踩到的两个测试陷阱（已修正，记录以备复用）：**

1. 种子写 localStorage 再刷新，会被在途的关系智能刷新落盘覆盖。真实上游模式请求慢，只有它会暴露这个问题；
   改用页面已暴露的状态入口注入，断言只回读面板里的时间线文本。
2. 直接用状态入口把 `consent` 置 true 不会推进 controller 的请求序号，晚到的刷新会把 `consent` 翻回旧值，
   面板退回「未授权」。改为先点真实授权开关（走 `setConsent`），再注入条目。

第 2 点顺带确认了一个边界：真实用户授权/撤销走 `setConsent`，会推进序号作废旧刷新，不会出现这个翻转；
问题只存在于绕过 controller 直接改状态。
