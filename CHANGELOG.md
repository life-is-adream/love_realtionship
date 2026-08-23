# Changelog

## 2026-08-20 — HeartFlow runtime integration refactor

- 新增 `POST /api/relationship-intelligence`，让 HeartFlow 产品正式调用共享 `runRelationshipLoop`。
- 新增浏览器 Client、匿名记忆状态、竞态安全控制器和独立的证据/决策面板。
- 匿名结构化长期记忆改为默认关闭；未同意时结果不写入 localStorage，关闭同意时清除 runtime memory。
- 原有自动增强记忆与 runtime 共用显式同意开关；手工角色设定仍保持独立用途。
- 新增服务端、Client、状态、控制器、渲染、静态接线和 HTTP 端到端测试；不新增 npm 依赖。
- 新增初学者开发指南和真实产品调用链文档。

## 2026-08-10 — Relationship Intelligence System v1

- 将通用 Skill 与个人 Profile/Locale 解耦；武汉/高校上下文改为显式可选。
- 新增 evidence、epistemic、decision、objectives、privacy、safety 和 routing Core。
- 默认运行时改为 curated；upstream 标记为 archive/provenance，禁止直接作为 Prompt。
- 聊天分析改为事实/信号/假设/反证/未知/置信度/决策/停止条件结构。
- 新增 0–12 非线性阶段、场景 modules、医疗/法律当前核验入口和 Role-play 协议。
- 新增 case/source/eval JSON Schema、170 条匿名 Evals 和静态验证 runner。
- 新增 README、ARCHITECTURE、PRIVACY、THIRD_PARTY_NOTICES、LICENSE 和来源 registry。

## 2026-08-10 — Agent loop extension

- 新增 Conversation Analyzer：主动比例、问题比例、时间戳覆盖、主题连续性、边界/冲突观察和有界 evidence。
- 新增 consent-gated Memory Store、可回退 Relationship State Machine、Prediction → Outcome → Update Reflection。
- 新增 5 个不依赖性别刻板印象的 Role-play 场景和 Critique → Retry 训练入口。
- 新增本地 `runRelationshipLoop` 编排器；不保存原始聊天，不在未同意时写入 Memory Patch。
- 静态 Evals 扩展到 190 条，新增 roleplay、reasoning、reflection、privacy 类别。

## 2026-08-09 — Public project snapshot

- 推送课程、Skill、HeartFlow 和交接文档的公开安全快照；`.env`、原始视频、书籍和 OCR 包未纳入。
