# 任务书：验证员 Vic

- role_name: 验证员 Vic
- mission: 独立验证本轮代码质量治理的全部改动，结论三选一（PASS / FAIL / BLOCKED），不许模糊
- allowed_edit_scope: **零写权限**。只运行命令与读取文件；不得修改任何项目文件
- output_path: `.agent-runs/2026-10-21/task-001/verification-report.md`
- 项目根目录: `E:/一门给年轻人的恋爱成长课/relationship-simulator`

## 你的立场

**写代码的人不验自己的活。** 本轮实现（Max）与测试（队长代行）都已声明完成，你的职责是**用独立视角证伪**，不是复述他们的结论。发现可疑之处要深挖，不要因为"测试全绿"就盖章。

## 背景

本轮交付（详见 `.agent-runs/2026-10-21/task-001/plan.md` 与 `test-report.md`）：

1. **两个 P0 修复**
   - `public/modules/render/compliance-banner.js`：localStorage 不可用时由 fail-open 改为 **fail-closed**（合规声明必须显示）
   - `public/modules/core/state.js`：`loadState()` 解析失败时把原始串写入隔离键 `heartflow-state-quarantine` 再重置，导出 `getStateLoadIssue()`
2. **三处 `mutate` 绕过修复**（P1-1）：`intelligence/controller.js`、`app.js` 的 `setRelationshipIntelligenceConsentFromUi`、`training/training-mode-controller.js`
3. **日期口径统一**（P1-2）：新建 `public/modules/core/date.js` 的 `shanghaiDate()`，`growth.js` / `render-lifestyle.js` / `memory.js` / `micro-training.js` 四处改用它
4. **`escapeHtml` 收敛**（P2-1）：`coach-float.js` 改 import，`stage-progress.js` 的"删字符"改真转义
5. **新检查器** `scripts/check-conventions.mjs`（5 条规则 R1/R2/R3/R4/R6）+ 反向用例
6. 新增测试 38 条，修正 2 条假断言

## 必须实测的验收（逐条给出原始输出）

| # | 验收项 | 命令 | 期望 |
|---|---|---|---|
| V1 | 全量测试 | `node --test` | 840 pass / **0 fail**，总数 **≥ 801**（不得靠删测试变绿） |
| V2 | 循环依赖 | `node scripts/check-circular.mjs` | 0 环 |
| V3 | 约定检查器 | `node scripts/check-conventions.mjs` | exit 0，0 违规 |
| V4 | 语法 | 对本轮改动的每个 `.js` 跑 `node --check` | 全部通过 |
| V5 | package.json | 检查 `scripts` 含 `check:conventions`，且**无新增 dependencies/devDependencies** | 通过 |

## 独立证伪任务（重点，不能只跑上面五条）

1. **V6 检查器空转验证**：不看 `test/check-conventions.test.mjs` 的结论，自己在临时目录构造至少 3 个最小违规样例（含 R1 未转义插值、R2 mutate 外直写、R6 自拼日期），跑 `node scripts/check-conventions.mjs --root <临时目录> --json`，确认**确实报违规**。若某个规则抓不到，判定 FAIL。
2. **V7 检查器误报验证**：构造至少 2 个合规样例（mutate 回调内直写、`const x = escapeHtml(v); ... ${x}`），确认**不报违规**。
3. **V8 P0-1 行为验证**：用 Node 构造一个 `getItem` 抛错的 storage，调用 `hasAcknowledgedCompliance(storage)`，必须返回 `false`（不是 `true`）。这是合规声明 fail-closed 的关键语义。
4. **V9 P0-2 行为验证**：构造非法 JSON 的 localStorage，调用 `loadState()`，确认：不抛错、`heartflow-state-quarantine` 保留原串、`getStateLoadIssue()` 非 null。
5. **V10 日期跨零点**：`shanghaiDate(new Date("2026-10-20T16:30:00Z"))` 必须是 `"2026-10-21"`。
6. **V11 mutate 广播**：确认 `intelligence/controller.js` 的 `replace()` 在 `persist: true` 时走 `updateAppState`（即 `mutate`），从而触发 `onStateChange`。给出你判定所依据的代码行。
7. **V12 diff 范围**：用 `find <项目> -newermt "2026-10-21 23:00" -type f` 列出本轮改动文件，逐一核对是否都属预期范围；**发现越界改动要单独列出**。
8. **V13 无测试删除**：确认 `test/` 下既有测试文件没有被删除、没有整块注释掉。（可用行数对比或 grep 断言数。）

## 判定规则

- 任何一条 V1–V5 不达标 → **FAIL**，写明具体哪条、原始输出是什么
- V6/V7/V8/V9/V10 任一证伪成功 → **FAIL**（说明修复或检查器是假的）
- 命令无法运行、依赖缺失等环境性阻塞 → **BLOCKED**，写明缺什么
- 全部通过 → **PASS**

禁止用"原则上可以""基本符合"这类话。**结论只允许 PASS / FAIL / BLOCKED 三选一。**

## 报告格式（写入 output_path）

```markdown
# 验证报告

## 结论
PASS | FAIL | BLOCKED

## 验收矩阵
| # | 项 | 期望 | 实测 | 判定 |
（V1–V13 逐条，附关键原始输出）

## 独立证伪记录
（V6/V7 你构造的样例代码 + 检查器输出；V8–V11 的复现步骤与实际返回）

## 发现的问题
（按严重度，每条附绝对路径+行号；无则写"无"）

## 未能验证的项
（诚实边界，无则写"无"）
```

## 返回给队长的状态块

```
STATUS: DONE | BLOCKED
OUTPUT: <output_path>
VERDICT: PASS | FAIL | BLOCKED
FAILED_CHECKS: <编号列表，无则写 none>
NEW_ISSUES: <n>
NEXT: 等待队长调度
```
