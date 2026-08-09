# 项目交接说明（给下一位 AI）

审计时间：2026-08-09（Asia/Shanghai）  
项目根目录：`E:\一门给年轻人的恋爱成长课`

这不是一个单一的软件仓库，而是「预生成恋爱课程 + Codex 定时发送 + HeartFlow 本地关系模拟器 + 本地 Skill/素材」的组合项目。接手时以实际文件和自动化状态为准；不要以旧文档、模型记忆或 Git 假设代替现场检查。

## 1. 先看什么

核心课程：

- `恋爱15分钟学习\课程总纲.md`：全局课程规范、固定结构、七阶段顺序、安全边界和质量检查。
- `恋爱15分钟学习\每日课程\`：按日期预生成的课程文件，命名格式 `YYYY-MM-DD-第NN课-标题.md`。
- `.agents\skills\relationship-coach-cn\SKILL.md`：中文关系教练的工作流和安全规则。
- `Code-Wiki.md`：维护手册，但基线日期是 2026-07-31；其中部分 HeartFlow 路径已经过时，不能单独作为当前事实。

本地素材（通常只读）：

- `_learned_relationship_course\`：视频转录、SRT、分段 JSON 和清单。
- 根目录 `*.mp4`：原始视频课程。
- `书籍\`：本地书籍和扫描材料。扫描版没有可靠文本层时，不要编造逐页摘录。

HeartFlow 模拟器：

- `relationship-simulator\public\`：浏览器端；当前模块实际位于 `public\modules\`，不是旧文档中的 `public\js\`。
- `relationship-simulator\server\`：本地 HTTP 服务、模型代理、健康检查、长篇内容和可选搜索代理。
- `relationship-simulator\long-simulation\`：10 章长篇教材原文及角色设定。
- `relationship-simulator\test\`：Node 内置测试。
- `relationship-simulator\.env`：本机模型配置和密钥，禁止复制、回显或提交；只查看变量名和是否配置。

## 2. 当前已验证状态

### 课程和定时任务

- `每日课程` 实际文件数：160。
- 课程编号：01–160，无坏命名、无重复日期；日期范围：2026-07-18 至 2026-12-24，连续。
- 当前日期（2026-08-09）唯一匹配文件：
  `恋爱15分钟学习\每日课程\2026-08-09-第23课-用非暴力沟通说清楚一件事.md`
- 该文件包含标题、日期、目标、3/5/3/2/2 结构、练习、行动、复盘/边界提醒和依据。
- Codex Automation 15：`C:\Users\lenovo\.codex\automations\15\automation.toml`
  - `status = "ACTIVE"`
  - `rrule = RRULE:FREQ=DAILY;BYHOUR=11;BYMINUTE=0`
  - 时区按 Asia/Shanghai 执行（配置本身用每日 11:00 规则）。
  - 只读取当天唯一匹配的既有文件并完整发送；没有文件或多文件时报告问题，不生成、改写或临时补课。
  - 当前日志 `C:\Users\lenovo\.codex\automations\15\memory.md` 已记录 2026-08-09 第 23 课发送完成，时间为 `2026-08-09T20:15:55.6186935+08:00`。

### HeartFlow 代码

在 `relationship-simulator\` 中已现场验证：

- `npm test`：333/333 通过，0 fail。
- `npm run check:circular`：扫描 46 个模块，0 循环依赖。
- `node validate-long-simulation.mjs`：10 章、297,159 总字符、6,147 条对话消息、0 mojibake，`requirementMet: true`。
- 启动冒烟：`GET /api/health` 返回 `ok: true`、`apiMode: chat_completions`、模型名和 `hasApiKey: true`（密钥值未输出）。
- `GET /api/long-content/1` 返回 HTTP 200、`text/plain; charset=utf-8`、长度 69,336 字节。
- 冒烟服务已停止，当前 3000 端口空闲。

## 3. HeartFlow 运行方式

```powershell
Set-Location 'E:\一门给年轻人的恋爱成长课\relationship-simulator'
npm install                 # 仅在依赖尚未安装时执行
npm test
npm run check:circular
npm start                   # http://localhost:3000
```

健康检查：

```powershell
Invoke-RestMethod 'http://localhost:3000/api/health' | ConvertTo-Json -Compress
```

主要 API：

- `GET /api/health`
- `POST /api/chat`
- `POST /api/search`（默认关闭；只有配置 `SEARCH_ENDPOINT` 和 `SEARCH_API_KEY` 才启用）
- `GET /api/long-content/1` 至 `/api/long-content/10`

模型调用只经过本地服务；前端默认不保存 Key。回放分析、本地评分、教材阅读、训练和检索不依赖模型 Key。真实聊天回放默认留在浏览器内存，发送给模型前必须经过显式动作和脱敏边界。

## 4. 自动化和课程维护规则

定时任务的不可违反契约：

1. 先读取 `恋爱15分钟学习\课程总纲.md`。
2. 以 Asia/Shanghai 当天日期构造 `YYYY-MM-DD-第NN课-*.md`。
3. 必须恰好匹配一个文件。
4. 完整读取并发送该文件，开头说明“今日15分钟课程”。
5. 不得生成新课、改写未来课程、临时补课、截断课程结构或伪造依据。
6. 缺失或多匹配时，只报告日期、目录和匹配数量。

内容安全边界：不得把 PUA、欺骗、羞辱、吊胃口、嫉妒测试、虚假稀缺、跟踪、纠缠、隐私搜集、冷处理惩罚、性胁迫、酒精/药物状态下推进或无视拒绝变成行动指令。可以把“心理博弈”转译为可观察信号、互惠、风险、边界、BATNA、透明选择和可退出方案。

维护课程时坚持“不覆盖现有课程”：先审计数量、编号、日期、结构和安全边界；通过审计的文件保持不变。修改应使用最小范围补丁，并在修改后重新进行唯一匹配和结构检查。

## 5. 当前已知问题（交接重点）

### `build:index` 目前是坏的

`relationship-simulator\scripts\build-long-index.mjs` 的 `outputPath` 仍指向：

```text
public/js/long-content-index.js
```

但当前实际前端入口和生成文件位于：

```text
public/modules/content/long-content-index.js
```

现场执行 `npm run build:index` 已确认失败，错误为 `ENOENT`，找不到 `public\js\long-content-index.js`。因此：

- 不要把当前 `npm run build:index` 当作通过。
- 不要手动编辑 `public\modules\content\long-content-index.js`，它是生成产物。
- 后续代码维护应先统一脚本输出路径，再运行生成、测试和循环依赖检查。
- 同时修正 `README.md`、`docs\部署与构建说明.md`、脚本注释中仍写 `public/js` 的旧路径。

其他状态注意事项：

- 项目根目录和 `relationship-simulator` 当前都不是可用 Git 仓库；虽然根目录有 `.git` 目录，但现场 `git status` 报 `not a git repository`，没有可依赖的分支、提交或 diff。修改前自行备份目标文件或建立外部版本记录。
- `Code-Wiki.md` 仍是 2026-07-31 基线，且包含旧的 `public/js` 描述；本文件的 2026-08-09 现场审计优先。
- `node validate-long-simulation.mjs` 会刷新 `long-simulation\validation-summary.json` 的 `generatedAt`；这是预期的生成文件变化。

## 6. 推荐接手顺序

1. 先读取本文件、`课程总纲.md`、当前日期匹配课件和 Automation 15 配置/日志。
2. 如果目标是日常发送，只做唯一日期匹配和完整读取，不触碰课程内容。
3. 如果目标是 HeartFlow 代码维护，先修复 `build:index` 路径契约，再运行：

```powershell
npm run build:index
npm test
npm run check:circular
node validate-long-simulation.mjs
```

4. 代码重构按“最小改动、先测试后扩展、保持本地优先和隐私边界”执行。涉及 `.env`、自动化配置、课程总纲或全部课程文件的改动，先完成现场审计并明确变更范围。
5. 完成后报告：修改文件、验证命令、通过/失败结果、未解决阻塞项；不要把“配置已改”当作“运行已验证”。

## 7. 可直接粘给下一位 AI 的短交接

> 你接手的是 `E:\一门给年轻人的恋爱成长课`。这是“160 课预生成恋爱课程 + Codex Automation 15 + HeartFlow 本地关系模拟器”的组合项目。先读 `AI_HANDOFF.md`、`恋爱15分钟学习\课程总纲.md`、当天课程文件和 `C:\Users\lenovo\.codex\automations\15\automation.toml`/`memory.md`。课程当前 160/160、日期 2026-07-18—2026-12-24 连续；2026-08-09 唯一课件是第 23 课，Automation 15 已记录发送。课程只允许按日期读取已有完整文件，不得生成、改写未来课程或临时补课。HeartFlow 在 `relationship-simulator`：333/333 tests、46 modules/0 circular、长篇验证通过，Node >=18；`.env` 含敏感模型配置，禁止回显或复制。已知阻塞：`npm run build:index` 仍写入不存在的 `public/js/long-content-index.js`，实际路径是 `public/modules/content/long-content-index.js`，现场执行确认为 ENOENT；先修脚本和旧文档路径，再重建索引并跑全量验证。根目录不是可用 Git 仓库，不能依赖 git diff。所有维护都以现场文件为准、最小修改、保留安全/同意/隐私边界，并报告可复现的验证结果。>

