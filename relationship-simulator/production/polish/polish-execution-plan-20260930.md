# HeartFlow 打磨执行计划（汇编版）

> 汇编：主理人 游承峰 ｜ 依据：T1-QA 审计（qa-debt-audit-20260930.md）+ T2-工程方案（eng-perf-audit-20260930.md）
> 日期：2026-09-30 ｜ 评审强度：lean ｜ 本计划批准前零代码改动

## 一、当前状态（两线交叉验证后的共识）

- 测试基线：**371/371 通过**（0 fail，4.78s），较 8-10 的 333 持续增长无回归；56 模块 0 循环依赖。
- 质量门判定：**PASS 可进入打磨执行**，附 3 条 CONCERNS（intake-quiz 孤岛 / 索引未瘦身 / 双解析脚本发散）。
- 8-02 债务清单复核：当轮修复 5 项无回归；**P2-8 CORS 实际已大部分修复**（原报告低估）；P1-3 部分修；P2-6/7/10/11/13/14 未修。
- 实测：long-content-index.js = 1,134,734B（~33.4K 行），按章拆包 + manifest 后首屏可降至 **2.2KB（−99.8%）**；"压缩字段名"备选被实测否定（仅再省 −1.8%）。

## 二、执行批次（跨成员一致性合并后）

| 批次 | 内容 | 工作量 | 依赖 | 执行成员 |
|------|------|--------|------|----------|
| **B1 · server 侧修复+单测** | ① serveStatic 404 语义修正（带扩展名不存在→真 404；无扩展名→SPA 回退）+ 缓存分级（index no-cache / js,css 3600s / 图片 86400s）② CORS 剩余缺口（私有网段放行 + OPTIONS 204 + sendJson 统一注入）③ 同轮补齐服务端单测：routes-longContent 章号校验+遍历防护、serveStatic 403/404、handleChat 分支 | M（S+S+测试） | 无，立即可开工 | engineering-lead |
| **B2 · 性能拆包** | P2-13 A 方案：生成器改 compact 输出 + 按章 10 chunk + 2.2KB manifest + long-content-loader.js + 4 调用方迁移 + 教材检索链 async 化 + 2 个测试改聚合 import | M | B1 完成后（缓存收益前提） | engineering-lead |
| **B3 · 内部质量** | P2-6 store 收敛三阶段（Phase A mutate(fn)+onStateChange → Phase B 迁 6 个 render-* 约 20 写点 → Phase C 迁 app.js 约 5 处；RelationshipLLM.setState 保留兼容）；顺手清 S 级小债：buildConversationSummary 合并、timing.js 复用 STAGE_VALUES | M | 与 B2 串行（同改 render-*/app.js 防冲突） | engineering-lead |
| **P · playtest 并行线** | R1 内部烟雾（2-3 人 40min 脚本）→ R2 新玩家六任务（5-8 人）→ R3 三日纵向+反PUA边界感知（8-12 人）；含问卷与合规自查清单 | 不占工程排期 | B1 完成后开 R1 | quality-lead |

- 合规增补项（QA 提出，待确认）：index.html 首访「AI 模拟角色非真人」明示横幅（S 级，可并入 B1）。
- 每项独立 commit 可回滚；每项后跑全量 `node --test` + `check:circular`。

## 三、待审批项与推荐

| # | 决策 | 推荐 |
|---|------|------|
| 1 | 批次与顺序 | 按上表 B1→B2→B3，P 线并行 |
| 2 | intake-quiz 孤岛 | **本轮观望**（死文件不影响运行路径），playtest R2 数据决定接入或移除 |
| 3 | 合规首访明示 | **加**（S 级成本，规避《人工智能拟人化互动服务管理暂行办法》风险） |
| 4 | P2-8 私有网段 CORS 白名单 | 接受（本地工具场景合理，仍限 /api/*） |

## 四、风险与缓解

| 风险 | 缓解 |
|------|------|
| B2 教材检索 async 化是最大迁移点，可能牵出隐藏调用方 | 先 grep 全部 import 方确认清单再动手；现有 textbook-search 测试作回归锚 |
| B2/B3 同改 render-* 冲突 | 严格串行，B2 全量回归后再进 B3 |
| 单测补齐可能暴露既有行为 bug | 发现即记录进 backlog，不顺手改逻辑（保持 1 假设每轮纪律） |
| playtest 招募延迟拖长打磨期 | R1 仅需内部 2-3 人，可先行；R2 招募与 B2 并行 |

## 五、引用产物

- `production/polish/qa-debt-audit-20260930.md`（QA：基线、逐项判定表、backlog B1-B10）
- `production/polish/eng-perf-audit-20260930.md`（工程：实测数据、四项方案、实施顺序）
- `production/polish/playtest-plan-20260930.md`（QA：3 轮 playtest 计划草案）
