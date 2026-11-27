# HeartFlow 恋爱模拟器

本地运行的关系对话训练项目，支持把请求转发到你自己的模型服务。

## HeartFlow 2.0 关系分析与训练

启动后进入「关系分析」，可以从聊天文字或事件叙述开始，核对消息后查看原文依据、假设、课程、三种回复和多轮练习反馈；也可按关系授权保存事件及练习规则评分、查看同场景趋势、生成每周计划或使用双人问题卡。课程和评分为本地规则，不能替代对现实情况的判断。

截图识别需要先在页面同意发送图片，并配置支持图像输入的模型；可在 `.env` 中设置可选的 `VISION_MODEL`，未设置时沿用 `LLM_MODEL`。模型回复、角色及独立复核分别需要同意；浏览器语音识别可能由浏览器服务商处理。当前尚未完成真实截图模型、麦克风和人工评分验收。

新增关系档案和计划保存在此浏览器；档案默认不保存复盘，开启后仍须手动填写。旧聊天和训练记录可能另存本机，关闭新档案授权不会删除旧记录、备份、已导出文件或远端服务的数据。当前没有多用户账户与服务端资源归属保护；C 服务的旧 API 仍监听所有网卡，不应直接用于公网。

使用和验证详情见 [项目简介](docs/heartflow-2.0/PROJECT_OVERVIEW.md)、[功能状态](docs/heartflow-2.0/FEATURE_GAP_MATRIX.md)、[接口契约](docs/heartflow-2.0/API_CONTRACTS.md)、[测试报告](docs/heartflow-2.0/TEST_REPORT.md) 与 [风险说明](docs/heartflow-2.0/RISKS_AND_NEXT_STEPS.md)。原 C 启动文件已备份为 `heartflow-c/hf.pre-v2-20261113.exe`。

## 功能

- 前端对话界面
- 本地话术分析、四维评分和 A/B/C 回复建议
- 消息优化器 2.0：原文、低压力版、主动推进版、修改理由和 Diff
- 社交信号解读训练与时机感评分：多标签、置信度、证据和数据不足提示
- 对话回放分析：投入、追问、冷却、边界和误读观察
- 本地 Relationship Intelligence：调用共享 runtime，展示证据、工作状态、五分类决策和可逆下一步
- 显式结构化复盘记忆授权：默认关闭；聊天及训练记录仍另存浏览器本机，授权仅控制自动提取的增强记忆
- 模拟角色对话风格可选自然日常、轻松幽默、温柔陪伴；角色为 AI 模拟，持续显示身份标识
- 每日 5 分钟微训练、连续记录、四维成长画像和掌握度
- 可切换的角色、角色记忆和夏紫桐内置角色
- 10 章长篇教材阅读、恋爱大师复盘和节点介入练习
- 教材本地检索与教练引用：最多 3 条相关复盘点，可跳转原文
- AI 关系阶段判断（保留手动覆盖）
- 预设情境剧本、移动端聊天/教练/角色 Tab
- 兼容 OpenAI Responses API 与 Chat Completions API，以及其他 OpenAI-compatible 接口

长篇教材阅读、本地分析、消息优化、本地回放、每日训练、成长画像和本地教材检索不需要 API Key；模型生成、介入练习、行动计划、阶段判断以及用户主动请求的 MiMo 增强需要可用的模型配置。

结构化复盘记忆默认关闭；授权只控制自动提取的长期结构化记忆，关闭授权会清除该增强记忆。聊天记录、训练记录和手动场景设置仍会另存浏览器本机，不会因未授权而自动清空。已保存的时间线及摘要可查看、编辑、删除；删除记忆条目不会清除当前聊天或其他重复记录。真实聊天回放分析默认在本地处理；用户主动请求模型分析时才会向 MiMo 发送脱敏摘要和最多两条短摘录。规则脱敏不能识别所有姓名或组合信息，请勿填写第三方个人信息。

角色身份与个人事实回忆走本地确定性护栏，不交给模型自由生成。直接问「你是不是 AI」固定回答「我是 AI 模拟角色，不是真人」；追问自己的过往事实时，只引用当前对话里用户自己说过的话，以及授权后真正会被注入的最近 3 条时间线与最近 1 条摘要。找不到原话就回答「没有可靠记录」；否定句与不确定表达按原话引用，不会被改写成肯定。这一层不覆盖普通聊天中的自由生成——模型是否编造未出现过的用户事实仍由提示词约束，不能把护栏当作事实校验器。真实上游抽样：`node scripts/eval-chat-style-live.mjs`（合成场景、有界请求、不读取真实聊天）。

## 启动

### C 版服务（重构目标，已可用）

```powershell
cd heartflow-c
.\hf.exe serve --port 3000 --root ..
```

单文件、零依赖；静态资源与 7 个 API 已与 Node 版完成逐字节/逐字段对照。

一键跑完全部回归（7 组共 119 项：CLI / 服务端 / Node 对照 / chat 代理 / TTS 算法与接线 / 循环依赖门禁；用本地假上游与假推理后端，不消耗真实额度）：

```sh
cd heartflow-c
sh tests/run-all.sh
```

**真实模型端到端**另需手动跑：双击根目录「启动语音服务.cmd」加载本地语音权重，再执行 `python heartflow-c/tests/real-e2e.py`（本地 TTS 免费；加 `--with-llm` 会发 1 次最小计费请求）。脚本会自己走一遍「一键开关」链路，不必设环境变量或重启。2026-11-07 实测 ChatTTS/GPU、Kokoro/CPU、在线两个入选音色与 `mimo-v2.6-flash` 全通，真实浏览器经 C 服务调用真实上游 12/12 通过；过程中修掉一个会让前端所有 JS 模块 404 的 query 剥离 bug。细节见 `heartflow-c/README.md`。

**音色（2026-11-07 真人听感验收后收敛）**：最终主推 **2 个未经变调的微软原生中文女声**——`edge_wenrou` 温柔 · 自然（默认）/ `edge_yuanqi` 元气 · 明亮；离线 ChatTTS / Kokoro 降级为「无网络兜底」，前端各留 2 个。此前用 SSML 变调硬造的「清冷御姐 / 甜美萝莉」以及全部离线音色在真人试听中被淘汰，已移出产品下拉框，只留在试听页作反例。**默认仍是纯离线、零联网**：设置面板勾选「启用在线语音」并确认后即可听到主推音色，无需重启；关掉即恢复，服务端另有 403 兜底，未解锁时直连本机端口也发不出文本。46 个真实合成样本（2 通过 / 2 兜底 / 37 淘汰 / 5 对照）：`voice/lab-out/试听.html`；原理、隐私与端点说明见 `voice/README.md`。

构建方式、覆盖范围与验证结果见 `heartflow-c/README.md`。Node 服务保留为行为参照基准（由 `tests/parity.py` 逐字段核对）；前端 JS 不做全面 wasm 化，理由与实测数据见 `heartflow-c/README.md` 的「已知边界」。

### 一键启动（推荐）

`package.json` 的 `start` / `dev` 已指向 C 版，运行服务不再需要 Node 运行时：

```powershell
npm start          # 等价于 heartflow-c\hf.exe serve --port 3000 --root .
```

然后打开 `http://localhost:3000`，用健康检查确认配置已生效：

```powershell
curl http://localhost:3000/api/health
```

> 端口 3000 被占用时会启动失败。用 `netstat -ano | findstr :3000` 找到进程，或换端口：`heartflow-c\hf.exe serve --port 3001 --root .`。

质量门禁同样是 C 版：`npm run check:circular`。需要对照时用 `npm run start:node`（Node 参照服务）与 `npm run check:circular:js`。

### 旧启动器（legacy，不再推荐）

`scripts/start-bg.mjs`、`launch-heartflow.ps1`、`stop-heartflow.ps1`、`process-identity.ps1` 仍指向已废弃的 `node server/index.js`——它们**不会启动 C 版服务**。保留是因为 `test/background-start.test.mjs` 与 `test/windows-process-identity.test.mjs` 钉住了旧契约，删除会断 `npm test`。新部署请直接用 `npm start`。

这些脚本原有的端口占用判断与日志位置（`scripts/heartflow.out.log` / `.err.log`）说明仍适用于它们自己，但仅作历史参考。

### 首次配置

1. 复制示例配置：

```powershell
Copy-Item .env.example .env
notepad .env
```

2. 按你的服务商填写 `.env`。

OpenAI 推荐配置：

```dotenv
LLM_ENDPOINT=https://api.openai.com/v1/responses
LLM_API_MODE=responses
LLM_API_KEY=your_openai_api_key
```

本项目已切换到 MiMo token-plan，默认配置示例：

```dotenv
LLM_ENDPOINT=https://token-plan-cn.xiaomimimo.com/v1/chat/completions
LLM_API_MODE=chat_completions
LLM_MODEL=mimo-v2.5-pro
LLM_API_KEY=tp-xxxxxxxx
LLM_MAX_COMPLETION_TOKENS=2048
```

3. 启动：

```powershell
npm start
```

4. 打开：

```text
http://localhost:3000
```

## 开发命令

长篇原文位于 `long-simulation/`。修改章节后必须重新生成前端索引；生成文件 `public/modules/content/long-content-manifest.js` 与 `public/modules/content/long-content/chapter-XX.js`（按章拆分）不要手动编辑：

```powershell
npm run build:index
```

运行全部测试：

```powershell
npm test
```

如果 PowerShell 的执行策略阻止 `npm.ps1`，直接运行等价命令：

```powershell
node --test
```

## 模型说明

- 模型由 `.env` 的 `LLM_MODEL` 控制，缺省为 `mimo-v2.5-pro`（直出型，适合教练 JSON 输出）；也可设为 `mimo-v2.5`（推理型，较慢）
- 前端通过 `DEFAULT_MODEL` 引用该配置，不在界面暴露模型切换项
- 消息优化默认调用 MiMo；调用失败时自动保留本地优化结果
- 服务端通过 `.env` 中的 `LLM_ENDPOINT`、`LLM_API_MODE`、`LLM_MODEL` 和 `LLM_API_KEY` 连接兼容接口并转发

## API 格式

前端会把消息发到本地服务：

```json
{
  "model": "mimo-v2.5-pro",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "temperature": 0.7
}
```

> 前端发出的 `model` 字段仅供说明；服务端最终以 `.env` 的 `LLM_MODEL` 为准转发。

服务端会读取 `.env` 里的 `LLM_ENDPOINT`、`LLM_API_MODE`、`LLM_MODEL` 和 `LLM_API_KEY`，并以 `LLM_MODEL`（缺省 `mimo-v2.5-pro`）转发到上游模型服务。

本地服务还提供：

- `GET /api/health`：检查代理模式、模型和服务端是否配置 Key（不会返回 Key）。
- `GET /api/long-content/:chapter`：读取第 1–10 章长篇原文，章节号严格校验，供阅读视图按章懒加载。
- `POST /api/relationship-intelligence`：本地调用共享 `runRelationshipLoop`；最多读取最近 80 条有界消息，不调用远程模型，不返回原始消息。
- `POST /api/chat`：转发模型请求。API Key 只从服务端 `.env` 或当前请求的受控字段读取，前端默认不保存 Key。
- `POST /api/search`：用户主动搜索公开依据。配置 `SEARCH_ENDPOINT` / `SEARCH_API_KEY` 时优先走外部搜索；否则使用 MiMo Chat Completions 的搜索插件。模型搜索不支持 Responses，返回受控 `503 search_api_mode_unsupported`；未知成功响应结构返回 `502 search_response_unsupported`。全部引用始终检查 HTTP(S) URL 和 `SEARCH_ALLOWED_DOMAINS`，不把域名匹配声明为观点已核验，不透出无可用引用的模型摘要。

## 目录说明

- `public/app.js`：前端唯一装配控制器；状态、解析、API 边界和各领域渲染位于 `public/modules/` 子模块。
- `public/modules/core/`：`state.js`（浏览器状态唯一来源）、`api-client.js`（模型网络边界）、`config.js`、`dom.js`、`privacy.js`、`memory.js`、`stages.js` 等核心模块。
- `public/modules/intelligence/`：本地 runtime Client、同意/持久化状态和带竞态保护的控制器。
- `public/modules/coach/`：`coach.js`（本地四维评分与发送前风险检查）、`parser.js`（模型输出和离线兜底解析）、`prompts.js`（可测试的纯函数 Prompt 模块）、`replies.js`、`analysis-result.js`。
- `public/modules/render/`：`render-*.js`：角色、聊天、教练、学习、教材、介入、阶段、剧本和移动端渲染模块。
- `public/modules/training/`：`replay.js`、`micro-training.js`、`growth.js`：回放分析、每日任务和成长聚合的本地纯函数。
- `public/modules/content/`：`textbook-search.js`（基于构建索引的本地关键词检索，不上传整篇教材）、`scenarios.js`、`textbook-index.js`。
- `public/modules/content/long-content-manifest.js` 与 `public/modules/content/long-content/chapter-XX.js`：由构建脚本生成的长篇索引（manifest + 按章 chunk），不要手动编辑；消费方统一走 `long-content-loader.js`。
- `server/index.js`：后端装配入口；`relationshipIntelligence.js` 调用共享 runtime，`config.js`、`llmProxy.js`、`staticServer.js`、路由和限流模块按职责拆分。
- `docs/`：增量 PRD、设计文档、类图、时序图和评分校准基准。
- `test/`：评分基准、Prompt、长篇索引、剧本和回复建议回归测试。

第一次参与开发建议先读 `docs/初学者开发指南.md`。

循环依赖检查：

```powershell
npm run check:circular
```

浏览器端到端验收（需先 `npm start` 启动 C 版服务；使用本机已有 Chrome/Edge 或 Playwright 缓存的 Chromium，不下载浏览器）：

```powershell
npm run e2e:browser
node scripts/e2e-browser.mjs --live
```

默认把教练通道指向一个无效端点，强制本地降级，只验证确定性路径（身份直问、无记忆追问、记忆编辑/删除后重问、刷新后的风格与身份标识）；加 `--live` 才连真实上游。失败时退出码非零，报告写入 `docs/verification/`。

## 工程可靠性（2026-10-09）

- `core/state.js` 的 `mutate` 是同步事务：只修改传入的草稿，保存成功后提交；不允许嵌套事务或异步回调。异步准备工作应在事务外完成，生成回复通过纯函数 `core/conversation.js` 一起提交。
- `core/request-scope.js` 管理生成、优化和计划的取消及结果归属。上下文变化后，旧请求的成功和失败都不能写回；优化结果采用前还会核验输入版本。
- `server/http.js` 提供请求解析、CORS 和响应工具；`request-handler.js` 统一捕获异步路由异常；`upstream-request.js` 统一上游超时和客户端断开后的取消。
- Windows 启停脚本通过 `scripts/process-identity.ps1` 核验项目入口、服务标识及 PID 归属。旧的相对路径或 inline 启动方式可能无法通过严格身份核验，需要人工核实原进程。

本轮验证、回归覆盖和剩余限制见 [工程验收记录](../docs/verification/2026-10-09-engineering-hardening.md)。

## 个人恋爱能力画像

从学习目录进入“个人恋爱能力画像”（`#abilities`）。八个方面分别覆盖外形与健康管理、声音与现场表达、沟通与兴趣表达、情绪与自我稳定、社交与约会执行、边界与关系经营、生活独立与可靠性、生理心理与关系知识。

每项包含两个行为自评和一个情境题。可以部分提交；未知项不记零分，24 项全部完成后才显示等权综合分。评分是产品规则下的初评，每项可展开查看依据、对应的 0–4 级标准与下一步训练。关键题错误优先提示“关键知识待补”，不会被其它高分抵消评级。

可选择最多两个训练重点，保留首次基线和最近 29 次复评；相同提交不重复记录。默认只保留在本页，明确勾选保存后才把枚举答案存入此浏览器，撤回保存会清除评估。健身、护肤与现实复盘只作为匿名复核材料，不直接增加能力分。

实现分为 `training/ability-rubric.js`（版本化规则）、`training/ability-assessment.js`（纯评分和记录）、`training/ability-context.js`（匿名复核摘要）及 `render/render-ability-assessment.js`（界面）。状态位于 `learning.abilityAssessment`，统一复用 store、导出备份和恢复路径。

详细验证见 [能力画像验收记录](../docs/verification/2026-10-13-personal-ability-assessment.md)。
