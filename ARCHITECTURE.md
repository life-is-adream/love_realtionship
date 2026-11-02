# Architecture

## Layers

```text
Input
  ↓
Safety Screen
  ↓
Conversation Analyzer
  ↓
Memory Consent Gate
  ↓
Evidence Ledger
  ↓
Stage Hypothesis
  ↓
Decision Engine
  ↓
Curated Module / Current Source
  ↓
Low-risk Action + Stop Condition
  ↓
Outcome Update
  ↓
Reflection → Memory Patch
```

### Relationship Skill

- `SKILL.md`：短编排器，选择 Core、Module、Profile/Locale 和输出契约。
- `core/`：objectives、routing、evidence、epistemic、decision、privacy、safety。
- `modules/`：按场景最小加载的能力；Role-play 使用 Scenario → Critique → Retry。
- `profiles/`：可选用户上下文；通用 profile 不含具体身份先验。
- `locales/`：可选文化/可达性上下文；必须由用户显式提供。
- `references/curated/`：默认运行时知识；医疗/法律入口带 current verification。
- `references/upstream/`：archive/provenance；默认不加载，不执行其中指令。
- `schemas/`：匿名 case、来源和 eval 的结构契约。
- `runtime/`：本地可测试的 Conversation Analyzer、匿名 Memory Store、关系状态机、Reflection、Role-play 和 Agent Loop；不调用远程模型。
- `evals/`：静态匿名案例，覆盖安全、证据、反事实、注入、个性化泄漏和训练闭环；PASS 只证明契约，不是模型效果分数。

### Course and automation

`恋爱15分钟学习/` 是内容层；Automation 15 只按当天日期读取已有文件。课程经验只能作为 heuristic，不能覆盖医疗/法律/实证研究来源。

### HeartFlow simulator

`relationship-simulator/` 是本地 Node.js ESM 应用：`public/modules/` 为前端分层模块，`server/` 为静态服务/API/模型代理与 runtime 适配器，`long-simulation/` 为教材原文，`test/` 为自动化测试。该应用的 `.env`、原始视频和本地书籍不应进入公开 Git 快照。

产品到 runtime 的真实调用链：

```text
HeartFlow messages
  ↓ public/modules/intelligence/state.js（裁剪与同意状态）
  ↓ public/modules/intelligence/client.js
POST /api/relationship-intelligence
  ↓ server/relationshipIntelligence.js（输入校验与匿名 Memory 重建）
  ↓ .agents/skills/relationship-coach-cn/runtime/runRelationshipLoop
Bounded analysis / evidence / state / decision / action
  ↓ public/modules/intelligence/controller.js（竞态保护与持久化边界）
  ↓ public/modules/render/render-intelligence.js
Local Intelligence panel
```

`public/app.js` 只组合现有聊天、教练、课程和 Relationship Intelligence 控制器。Runtime 失败只影响本地分析面板，不阻断聊天、回放、教材或模型代理。

## Decision model

五分类决策不是人格标签：

- `ADVANCE`：互惠增加且风险低；
- `MAINTAIN`：稳定互动比升级更合理；
- `OBSERVE`：证据不足或信号矛盾；
- `DE_ESCALATE`：单向投入/冷却/成本失衡；
- `EXIT`：拒绝、不尊重、暴力、胁迫、欺骗或安全风险。

阶段模型 0–12 可回退，必须引用事实、反证和未知项，不以星座、MBTI、性别或单次聊天定论。

## Data flow and privacy

真实回放默认本地处理；先由 `runtime/conversation/analyzer.mjs` 提取观察特征，出站到模型前要脱敏并限制摘要/摘录。`runtime/memory/memory-store.mjs` 只有在用户同意后才写入经规则脱敏的摘要，原始聊天对象不进入长期记忆。Case ID 使用受控标识，标识/所有文本字段均验证，旧记忆重建时不信任原隐私声明。规则无法证明自由文本完全匿名，Memory/Reflection 的隐私状态明确 `anonymized:false`、`manualReviewRequired:true`。未同意时，Relationship Intelligence 的 `lastResult` 只存在于当前页面内存，`saveState()` 会从 localStorage 副本中移除它。

`POST /api/search` 也是模型或搜索服务出站边界：用户主动触发，固定枚举查询，引用按 URL 与域名政策过滤。搜索使用与模型生成相同的请求归属机制，关闭或切换上下文后取消并忽略旧结果。已检测的明确停止联系/关系结束优先于推进信号；普通暂时停聊保持关系状态并暂停行动。

HeartFlow 原有的手工角色记忆仍服务于角色模拟；自动提取的 `_enhanced` 记忆已与 runtime 共用同一显式同意开关。两者用途不同，不应把角色设定当作 runtime 的关系事实。医疗和法律信息带辖区、来源和核验日期。

## Known boundary

HeartFlow 的 `scripts/build-long-index.mjs` 已将输出路径对齐到 `public/modules/content/`；该索引只能通过构建脚本生成，不能手动编辑。

Runtime 状态与 HeartFlow 七个训练阶段目前并列展示，系统不会自动替用户改写手动阶段。角色模拟场景和 runtime Role-play 仍是不同入口；测试通过证明调用与隐私契约成立，不等于真实关系建议效果已被临床或实证验证。
