# Architecture

## Layers

```text
Input
  ↓
Safety Screen
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
- `evals/`：170 条静态匿名案例，覆盖安全、证据、反事实、注入和个性化泄漏。

### Course and automation

`恋爱15分钟学习/` 是内容层；Automation 15 只按当天日期读取已有文件。课程经验只能作为 heuristic，不能覆盖医疗/法律/实证研究来源。

### HeartFlow simulator

`relationship-simulator/` 是本地 Node.js ESM 应用：`public/modules/` 为前端分层模块，`server/` 为静态服务/API/模型代理，`long-simulation/` 为教材原文，`test/` 为 333 条现有测试。该应用的 `.env`、原始视频和本地书籍不应进入公开 Git 快照。

## Decision model

五分类决策不是人格标签：

- `ADVANCE`：互惠增加且风险低；
- `MAINTAIN`：稳定互动比升级更合理；
- `OBSERVE`：证据不足或信号矛盾；
- `DE_ESCALATE`：单向投入/冷却/成本失衡；
- `EXIT`：拒绝、不尊重、暴力、胁迫、欺骗或安全风险。

阶段模型 0–12 可回退，必须引用事实、反证和未知项，不以星座、MBTI、性别或单次聊天定论。

## Data flow and privacy

真实回放默认本地处理；出站到模型前要脱敏并限制摘要/摘录。Case ID 使用匿名标识，第三方敏感信息默认不持久化。医疗和法律信息带辖区、来源和核验日期。

## Known boundary

HeartFlow 的 `scripts/build-long-index.mjs` 已将输出路径对齐到 `public/modules/content/`；该索引只能通过构建脚本生成，不能手动编辑。
