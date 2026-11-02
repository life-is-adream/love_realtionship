# P0 验收记录：工作区安全与回归基线

- 执行时间：2026-11-02
- 依据：`docs/HeartFlow-2.0-开发实施与验收规范-2026-11-02.md` §4
- 性质：**全程只读**，未修改任何生产代码

## A-01 工作区安全：通过

| 检查 | 结果 |
| --- | --- |
| `git diff --stat`（工作区 vs HEAD） | 空 —— 无未提交的跟踪文件修改 |
| `git diff -- public/modules/core/memory.js` | 空 —— 与 HEAD 一致 |
| HEAD | `b9c46f9 docs: 现状摘要扩展为自包含分析包…` |

**非本次执行创建的未跟踪项**（原样保留，未读取未修改）：
`_backup-20261101/`(76K)、`.agent-runs/`(132K)、`Kaito复苏行动手册.html`、
`../docs/verification/2026-10-1*` 一批历史验收件、`../docs/superpowers/plans/2026-10-*`、
`../pet-concept-chibi.jpg`、`../恋爱15分钟学习/每日课程-v2-样本/`、`../恋爱咨询平台/`。

**本次清理的自有产物**：`docs/verification/tmp-finish.md`
（我自己本轮 2 用例探针跑的输出，非用户数据）。

## A-02 回归基线：通过

```
npm test
ℹ tests 922   ℹ pass 922   ℹ fail 0   ℹ duration_ms 5373
扫描模块数: 103   circular: 0 ✅ 无循环依赖
扫描文件数: 110   conventions: 0 ✅ 无违规
```

基线数与规范 §0.3 引用的 922 一致，可用作后续阶段的比较基准。

## 高风险文件的既有兜底（P0 step 3 的前置情报）

| 文件 | 引用它的测试 | 备注 |
| --- | --- | --- |
| `public/app.js` | 18 个（含 `generation-commit`、`request-scope`、两个 phase 集成） | 用 VM 抽取真实函数源码执行，是接缝缺陷的主要防线 |
| `core/api-client.js` | 4 个 | 含双通道消息构造与 thinking/response_format 出站契约 |
| `core/memory.js` | 4 个 | 含 `state.test.mjs`、`reset-confirm.test.mjs` |
| `server/llmProxy.js` | 2 个 | `server-lifecycle` 覆盖 thinking 透传、response_format、取消传播 |

**P3 需注意**：`app.js` 的行为测试依赖 `source.indexOf("async function askAi(")` 之类的
**字符串锚点切片**——按名字切出真实函数源码放进 VM 执行。改动 `app.js` 时若移动或重命名这些锚点函数，
切片会静默少跑代码而不是报错，等于测试覆盖悄悄缩水。

当前锚点共 **19 个**【读码】，不要抄清单（会过期），用这条命令现取：

```bash
grep -rhoE 'indexOf\("[^"]+"' test/request-scope.test.mjs test/generation-commit.test.mjs \
  | sed 's/indexOf("//' | sort -u
```

（含 `askAi`、`nextTurn`、`preflightReply`、`localFallback`、`renderCoachFloat`、
`renderAnalysisPanel`、`renderIntelligencePanel`、`submitIntervention`、
`renderInterventionComparison`、`collectCoachMistake`、`exportSession`、`addTrainingLog`、
`renderAll`、`uiValues`、`afterChatRender`、`capturePreflightContext`、`normalizeActionPlan`、
`renderDiffHtml`、`checkHealth`。）

## 与规范的两处偏差（执行前需裁定）

1. **P1 与 P3 有顺序冲突**（规范内部）：§5.2 的 `EvidenceLedger` 要求 `sourceMessageIds`，
   而稳定 `mid` 在 §7.2.1 才引入。**建议把 mid 提前进 P1**，否则 P1 的台账要先用数组下标、
   P3 再整体迁移一遍。

2. **G1 / A-05 的 TTFC P95 ≤6s 大概率不由 SSE 决定**：本仓实测角色通道在健康上游下
   非流式即可完成于 1.5–4s，SLO 失守来自长尾（17–24s）与 504。SSE 显著改善的是 TTFV
   （实测 disabled 非流式 1.80s → disabled 流式首字 0.80s），对「完整可见」帮助有限。
   规范本身诚实（§1.2 不承诺、A-05 未测不得记通过），但**工作量分配值得先确认**：
   P2 里 SSE 解析器是新代码里风险最高的一块，却未必是达成 6 秒的关键路径。

## 回退方式

本阶段未改动生产代码，回退 = 不合并这两个文档文件即可。
