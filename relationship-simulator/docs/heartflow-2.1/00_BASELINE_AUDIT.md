# HeartFlow 2.1 S0 基线审计

- 审计时间：2026-11-14，Asia/Shanghai
- 审计方式：只读检查 + 原命令复现；未覆盖、未重置、未提交任何用户未提交改动。
- 结论：现有 2.0 自动测试与两套临时质量基线均可在本机复现；真实模型、视觉、麦克风、独立人工标注与盲评未运行，相关项按 `BLOCKED_EXTERNAL_VALIDATION` 记录。

## 1. 起始版本与环境

| 项 | 实际值 |
| --- | --- |
| 仓库根 | `e:\一门给年轻人的恋爱成长课` |
| 项目根 | `relationship-simulator/` |
| 分支 | `main`（相对 `origin/main` ahead 46） |
| 起始 commit | `dc151140ceed0f2217bd7138b6187b6806b66f51`（2026-11-03 22:45:59 +0800） |
| 未提交改动 | 审计时 `git status --porcelain` 共 107 项，含已修改文件和未跟踪的 `heartflow-c/`、`docs/heartflow-2.0/`、`server/v2.js` 等。本轮全部保留，不删除、不重置、不纳入提交。 |
| 操作系统 | Windows（PowerShell 7+） |
| Node | v24.16.0（要求 ≥18） |
| npm | 11.16.0 |
| Python | 3.10.11 |
| C 编译器 | `python -m ziglang version` → 0.17.1（C11，`-O2 -std=c11`） |
| Git Bash | `D:\Git\bin\bash.exe` 存在 |
| 浏览器 E2E | 脚本自动使用本机 Chrome/Edge；本轮通过 |

未提交改动属于用户既有工作区状态。按任务书要求，本轮新增文件只写 `docs/heartflow-2.1/`、`quality/` 及完成 S2–S4 所必需的最小源码/测试文件。

## 2. 启动与构建命令

```powershell
# 生产式启动（C）
npm start
# 等价于
heartflow-c\hf.exe serve --port 3000 --root .

# Node 参考实现
npm run start:node

# 重新构建 C（Git Bash）
cd heartflow-c
& 'D:\Git\bin\bash.exe' ./build.sh hf-v2-build.exe
```

当前 `heartflow-c/hf.exe`：505,344 bytes，SHA-256 `01659CA8746D1841495E37F47CACC2E1B4ABF4EF7EFFDDE040655352CD30E427`。构建前另有 `hf.pre-v2-20261113.exe` 备份。S6 会重新构建并记录新哈希。

## 3. 测试基线复现（实际输出）

| 检查 | 命令 | 实际结果 | 日志 |
| --- | --- | --- | --- |
| 全量单元测试 | `npm test` | **1060/1060 通过**，0 failed/skipped；循环依赖扫描 112 模块，0 处；约定扫描 120 文件，0 违规 | `docs/heartflow-2.1/logs/S0-npm-test.log` |
| C/Node v2 契约 | `python heartflow-c\tests\v2-smoke.py heartflow-c\hf.exe` | **17/17 通过** | `docs/heartflow-2.1/logs/S0-v2-smoke.log` |
| TTS 自检 | `.\heartflow-c\hf.exe tts selftest` | **9 通过，0 失败** | `docs/heartflow-2.1/logs/S0-tts-selftest.log` |
| 浏览器 E2E | `node scripts\e2e-heartflow-v2.mjs` | **30/30 通过**，仅合成数据 + 本地假模型 | `docs/heartflow-2.1/logs/S0-e2e-browser.log` |
| 语义基线 | `npm run eval:semantics` | Accuracy **69.4%**，Macro-F1 **0.685**，误判 11，不安全回复 0，36 条临时标注、未人工复核 | `docs/heartflow-2.1/logs/S0-eval-semantics.log` |
| 课程检索基线 | `npm run eval:courses` | Recall@5 **65.1%**，MRR@5 **0.823**，引用错误 0，32 条临时标注、未人工复核 | `docs/heartflow-2.1/logs/S0-eval-courses.log` |

上述结果与 `docs/heartflow-2.0/TEST_REPORT.md` 的数量和指标一致，属于**已复现**，不是 `NOT_REPRODUCED`。E2E 使用假模型，不能当作真实供应商验收。

## 4. 真实路由与实现映射（审计核对）

| 路由 | Node | C |
| --- | --- | --- |
| `POST /api/v2/imports/chat` | `server/v2.js: importChat` | `heartflow-c/src/server/v2.c: route_import` |
| `POST /api/v2/imports/screenshot` | `screenshot` | `route_screenshot` |
| `POST /api/v2/analyses` | `analyzeV2` | `route_analysis` |
| `POST /api/v2/replies` | `repliesV2` | `route_replies` |
| `POST /api/v2/learning/recommendations` | `recommendCourses` | `route_courses` |
| `GET /api/v2/practice/scenarios` | `listScenarios` | `hf_scenario_*` |
| `POST /api/v2/practice/sessions` | `startScenario` | `route_practice_start` |
| `POST /api/v2/practice/turns` | `practiceTurn` | `route_practice_turn` |
| `POST /api/v2/practice/feedback` | `practiceFeedback` | `route_practice_feedback` |
| `POST /api/v2/learning/weekly-plan` | `weeklyPlan` | `route_weekly_plan` |
| `POST /api/v2/voice/feedback` | `voiceFeedback` | `route_voice_feedback` |

路由入口：Node `server/v2.js: handleV2`；C `heartflow-c/src/server/v2.c: hf_v2_route`；旧接口在 `server/request-handler.js` 与 `heartflow-c/src/server/routes.c`。响应 `schema_version` 当前为 `2.0`，评分 `rubric_version` 为 `1.1.0`。

语义决策的当前生产逻辑位于 Node `server/v2.js:117-155` 与 C `v2.c:443-516`，均使用「同分句否定窗口 + 关键词优先级」：`EXIT > DE_ESCALATE > ADVANCE > MAINTAIN > OBSERVE`。课程检索位于 Node `server/v2.js:267-303` 与 C `v2.c:594-705`，使用标题+目标+正文 BM25（`k1=1.2, b=0.75`），查询词由 `retrievalKeywords` / `hf_retrieval_terms` 生成。

## 5. 资源与性能基线（单次实测，不是压力测试）

| 指标 | 实测 |
| --- | --- |
| C 服务冷启动后工作集 | 约 7.4 MB |
| 单次课程推荐（本机、热进程、3–5 条） | 约 39 ms |
| 课程数 / manifest | 179 个 Markdown 文件，manifest 179 条 |
| 全量单元测试耗时 | 9.56 s（Node 测试框架自报） |
| E2E | Chrome headless，本机 C + 假模型 |

39 ms 与 7.4 MB 只用于 S3 设定本机预算，不构成跨机器性能承诺。

## 6. 与 2.0 文档的差异和已知限制

1. `docs/heartflow-2.0/TEST_REPORT.md` 的数字全部复现；但其中的「17/17」只覆盖固定样例的 C/Node 一致性，不是全部 32 条课程查询或全部语义样本的逐条 parity。
2. 课程检索基线由 Node 实现评测；C 与 Node 对同一查询的完整排序未逐条对照，S3 将增加逐条 parity 检查。
3. 语义基线标签由实现者编写、`reviewed_by_human=false`；36 条中有 11 条误判，不能作为真实世界准确率。
4. 课程基线 32 条查询同样未经独立人工复核；Recall@5=65.1%，MRR@5=0.823 高于 Recall@5 的原因是 Recall 允许多个相关课程、MRR 只取首个相关项，口径不同，需在 2.1 评测中同时报告并固定分母。
5. 真实模型、真实截图 OCR、真实麦克风/在线语音识别、独立人工盲评、多用户认证、TLS/公网加固均未验收。E2E 的「模型」是本机假服务。
6. 当前工作区有大量未提交改动和未跟踪文件；本轮不得覆盖用户未提交内容。

## 7. S0 门禁结论

- 自动测试基线：**PASS（已复现）**。
- 真实模型/人工标注/盲评：**BLOCKED_EXTERNAL_VALIDATION**（未运行，不伪造）。
- 可以进入 S1；S1 的数据与评测脚本将独立于生产输出先落地。
