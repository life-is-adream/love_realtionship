# HeartFlow Training Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保持现有 HeartFlow Vanilla JS 和本地优先原则的前提下，落地七项训练能力，形成“分析—练习—成长—教材引用”闭环。

**Architecture:** 将新增能力拆成三个独立、可回归的子项目。共享 `analysis-result.js` 和 `learning-state.js`，由 `app.js` 做编排；本地规则负责可用性和兜底，MiMo 负责增强解释。长篇教材继续使用构建期索引和本地检索，不引入向量数据库。

**Tech Stack:** Node.js 18+、Vanilla JS ES Modules、HTML/CSS、Node built-in test runner、现有 `/api/chat` 代理、localStorage、现有长篇索引构建脚本。

## Global Constraints

- 保持零新增 npm 依赖。
- 默认本地处理真实聊天记录；发送给 MiMo 前必须有明确用户动作。
- 所有模型结果必须包含 `source`、`confidence`、`evidence`，并有本地退化路径。
- 不输出操控、PUA、焦虑制造、贬低、强迫或越界话术。
- 不把社交信号压缩为单一“喜欢度”；必须支持多标签和“不确定”。
- 没有 `createdAt` 的旧消息不参与时机评分，不伪造历史时间。
- 不破坏现有 `heartflow-state`、角色、A/B/C、七阶段、长篇阅读和介入练习。
- 真实回放原文默认只在内存中处理；用户主动保存时只保存脱敏摘要和分析结果。
- 当前工作区不是 Git 仓库；执行时不得初始化仓库。若仍无 Git，提交步骤改为保留本地检查点并记录命令。

## Plan Decomposition

由于规格包含三个独立子系统，按以下三个计划执行，每个计划都应能独立测试和交付：

1. [阶段一：即时沟通闭环](./2026-07-16-phase1-instant-coaching.md)
2. [阶段二：训练与成长闭环](./2026-07-16-phase2-training-growth.md)
3. [阶段三：教材检索与系统集成](./2026-07-16-phase3-textbook-integration.md)

## Dependency Graph

```text
阶段一 Task 1 共享分析结果与训练状态
        ↓
阶段一 Task 2/3/4：优化器、信号、时机
        ↓
阶段二 Task 1：回放分析
        ↓
阶段二 Task 2/3：每日任务、成长画像
        ↓
阶段三 Task 1：教材检索索引
        ↓
阶段三 Task 2/3：UI 联动、迁移、全量回归
```

## File Ownership Map

| 文件 | 责任 |
|---|---|
| `public/js/analysis-result.js` | 统一分析结果结构、置信度和证据格式 |
| `public/js/learning-state.js` | 学习状态版本迁移、训练事件和摘要持久化 |
| `public/js/optimizer.js` | 原文、低压力版、主动推进版、Diff 和本地兜底 |
| `public/js/signals.js` | 社交信号多标签和信号判断练习 |
| `public/js/timing.js` | 时机感评分和可解释建议 |
| `public/js/replay.js` | 回放文本解析、脱敏、投入/冷却/边界分析 |
| `public/js/micro-training.js` | 每日任务选择、评分和掌握度 |
| `public/js/growth.js` | 7/30 日聚合、雷达数据、阶段掌握度 |
| `public/js/textbook-search.js` | 长篇本地检索和结果排序 |
| `scripts/build-long-index.mjs` | 生成教材搜索字段 |
| `public/app.js` | 状态编排、模型调用、DOM 事件和视图刷新 |
| `public/index.html` | 新面板、弹窗、按钮和空状态容器 |
| `public/styles.css` | 优化器、回放、任务、画像和教材卡片样式 |
| `public/js/prompts.js` | 新增优化、信号、回放和解释 Prompt 纯函数 |
| `test/*.test.mjs` | 各模块单元测试、Prompt 快照和集成回归 |
| `README.md` | 新功能、命令和隐私行为说明 |

## Global Verification Gate

每个子计划完成后执行：

```powershell
node --check public/app.js
npm.cmd test
npm.cmd run build:index
```

最终验收还要启动 `server.js`，检查 `/`、`/api/health`、第 1/10 章接口、非法章节和路径遍历；不得输出 API Key 或 `.env` 内容。

