# HeartFlow 恋爱模拟器

本地运行的关系对话训练项目，支持把请求转发到你自己的模型服务。

## 功能

- 前端对话界面
- 本地话术分析、四维评分和 A/B/C 回复建议
- 消息优化器 2.0：原文、低压力版、主动推进版、修改理由和 Diff
- 社交信号解读训练与时机感评分：多标签、置信度、证据和数据不足提示
- 对话回放分析：投入、追问、冷却、边界和误读观察
- 本地 Relationship Intelligence：调用共享 runtime，展示证据、工作状态、五分类决策和可逆下一步
- 显式匿名记忆同意：默认关闭；开启后只保存结构化摘要，不保存原始聊天
- 每日 5 分钟微训练、连续记录、四维成长画像和掌握度
- 可切换的角色、角色记忆和夏紫桐内置角色
- 10 章长篇教材阅读、恋爱大师复盘和节点介入练习
- 教材本地检索与教练引用：最多 3 条相关复盘点，可跳转原文
- AI 关系阶段判断（保留手动覆盖）
- 预设情境剧本、移动端聊天/教练/角色 Tab
- 兼容 OpenAI Responses API 与 Chat Completions API，以及其他 OpenAI-compatible 接口

长篇教材阅读、本地分析、消息优化、本地回放、每日训练、成长画像和本地教材检索不需要 API Key；模型生成、介入练习、行动计划、阶段判断以及用户主动请求的 MiMo 增强需要可用的模型配置。

真实聊天回放默认只在浏览器内存中处理。输入发送给 MiMo 前必须有明确按钮动作，并且只发送脱敏后的摘要和最多两条短摘录；原始回放不会写入学习状态。Relationship Intelligence 的本地分析不调用 MiMo；未勾选复盘记忆同意时，分析结果不会写入 localStorage。规则脱敏不能识别所有姓名或组合信息，不代表自由文本已完全匿名，请勿填写第三方个人信息。没有模型、网络或索引结果时，核心训练功能仍使用本地规则运行。

## 启动

### 一键启动（已配好 `.env` 时）

如果已经填好 `.env`，直接运行即可：

```powershell
npm start
```

然后打开 `http://localhost:3000`。

后台启动（不占用当前终端，适合长期使用）：

```powershell
npm run start:bg
```

启动后用健康检查确认服务端已连通模型：

```powershell
curl http://localhost:3000/api/health
```

> 注意：用 `npm start`（前台）启动时，端口 3000 被占用会报 EADDRINUSE。先用 `netstat -ano | findstr :3000` 找到占用进程并结束，或修改 `.env` 里的 `PORT` 换端口。下面的 `launch-heartflow.ps1` 会自动检测这些情况。

### 启动器脚本（Windows）

提供一键启动/停止，自动处理端口占用与单实例判断（Windows 下使用，路径含中文也没问题）：

```powershell
# 一键启动：检测端口占用 → 后台隐藏启动 → 健康检查 → 打开浏览器
powershell -ExecutionPolicy Bypass -File scripts\launch-heartflow.ps1

# 停止后台服务（读取 scripts\.heartflow.pid）
powershell -ExecutionPolicy Bypass -File scripts\stop-heartflow.ps1
```

`launch-heartflow.ps1` 的分支行为：

- **端口空闲**：后台隐藏启动 `node server/index.js`，20 秒内 `/api/health` 返回 `ok: true` 即就绪并打开浏览器；
- **端口被本项目占用**（health 通过）：直接打开浏览器，不重复启动服务；
- **端口被其他程序占用**（health 不通过）：打印明确警告并退出，不启动、不误杀。

日志位置：`scripts/heartflow.out.log`（标准输出）与 `scripts/heartflow.err.log`（错误输出）；启动超时会在终端提示查看错误日志。

`npm run start:bg` 已改为跨平台脚本（`node scripts/start-bg.mjs`）：以隐藏后台方式启动服务、写 PID 到 `scripts/.heartflow.pid`，同样可用 `scripts\stop-heartflow.ps1` 停止。

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
