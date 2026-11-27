# HeartFlow 2.2 第一轮最终验收

日期：2026-11-15  
范围：生产路径 C/Node 检索统一 + 弃答门禁 + 语义词表修正 + 独立质量评测基础  
结论：**C/Node 检索能力已统一并通过 1296/1296 一致性与引用校验；域外弃答 20/21；E2E 30/30；自动测试 1066/1066。独立人工标注/盲评、真实 embedding、真实语音仍为 BLOCKED。不得宣称生产就绪或真实用户质量已验证。**

## 1. 任务逐项状态

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 任务一：确认基线 | **PASS** | 1065/1065（改动前）；改动前 bm25 parity 120/120；源码快照与哈希；未读取 `.env` |
| 任务二：统一 C/Node 检索 | **PASS** | 1296/1296 排序与弃答一致；四模式；引用错误 0；异常确定性错误码 |
| 任务三：独立人工标注集 | **PARTIAL / BLOCKED** | 候选 300/200/60 + 独立场景 65 条与工具、协议已交付；无独立标注者，未冻结人工真值 |
| 任务四：比较质量 | **PASS（实现）/ BLOCKED（真实质量）** | 历史集回归 + 候选体检 + 独立场景集三模式对比；无人工验收集，不宣称泛化 |
| 任务五：最终交付 | **PASS** | 本文件 + 其余 4 份文档 |

## 2. 任务二验收明细

| 要求 | 结果 |
| --- | --- |
| 不删除现有 BM25 | PASS：`bm25` 路径与 2.1 完全一致 |
| 不破坏旧 API | PASS：路径、请求字段不变，仅新增 `mode_effective`、`abstained`、`abstain_reason` |
| 支持 bm25 / semantic / hybrid | PASS |
| 支持 hybrid_rerank | PASS：无重排器时 `mode_effective=hybrid`、`fallback_reason=reranker_not_configured` |
| 真实返回 `mode_effective` | PASS：C 不再声称 bm25 是 semantic |
| 同索引同参数可解释一致排序 | PASS：1296/1296 |
| 引用真实文件校验 | PASS：`line_start/line_end/quote` 回读 Markdown，0 错误 |
| 无匹配时弃答 | PASS（启发式）：21 条域外 20 条返回空列表并标记 `abstain_reason: no_domain_match`；1 条漏判（含领域词「手机」） |
| 异常索引/空查询/服务异常确定性 | PASS：`invalid_query` 400、`invalid_limit` 400、`course_index_missing` 503、`course_index_invalid` 503 |

复现：

```powershell
npm test
node quality/scripts/check-retrieval-parity.mjs
node quality/scripts/eval-retrieval.mjs --split=test --mode=semantic
node quality/scripts/eval-retrieval.mjs --split=test --mode=hybrid
node quality/scripts/bench-retrieval-2.2.mjs
node quality/scripts/eval-2.2-candidates.mjs
node scripts/e2e-heartflow-v2.mjs
```

## 3. 验收门禁

| 门禁 | 结果 | 说明 |
| --- | --- | --- |
| C/Node 排序一致性（旧 120 用例） | PASS | 240/240（4 模式） |
| 新增边界/异常用例 | PASS | 16/16 |
| 2.2 候选查询一致性 | PASS | 800/800 |
| 课程引用有效率 | PASS | 本轮所有返回结果引用错误 0 |
| 域外无匹配弃答 | PASS（启发式） | 20/21；C/Node 决策 0 差异 |
| 检索独立测试集相对 BM25 提升 | **BLOCKED（方向性证据存在）** | 独立场景 60 条：hybrid 34.7% > semantic 33.6% > bm25 31.1%，但标签非人工真值 |
| 语义安全边界 | **PARTIAL / BLOCKED** | 候选集 0 不安全推进、300/300；无人工标注的拒绝场景集 |
| 训练自然度 ≥4/5 | **BLOCKED** | 无人工盲评 |
| 角色一致性 | **BLOCKED**（人工）/ PASS（规则合同） | 候选 60/60 行为合同 |
| 本地离线功能 | PASS | 179 课、BM25/语义/混合、规则分析均无网络依赖 |
| 响应延迟 | PASS（本地） | C P50 39.7–41.9 ms、P95 46.7–49.7 ms；真实模型未测 |
| 自动测试 | PASS | `npm test` 1066/1066；`e2e-heartflow-v2.mjs` 30/30 |
| 不伪造真实模型/人工 | PASS | 未调用真实模型，未生成人工标签 |

## 4. 本轮产出

新增：

- `docs/heartflow-2.2/BASELINE_AUDIT.md`
- `docs/heartflow-2.2/RETRIEVAL_IMPLEMENTATION.md`
- `docs/heartflow-2.2/ANNOTATION_PROTOCOL.md`
- `docs/heartflow-2.2/EVALUATION_REPORT.md`
- `docs/heartflow-2.2/FINAL_ACCEPTANCE.md`（本文件）
- `docs/heartflow-2.2/snapshots/`：改动前源码快照
- `quality/datasets-2.2/pending/{semantic,retrieval,practice}.json` + `CANDIDATES.json`
- `quality/datasets-2.2/candidate-independent/retrieval.json`：65 条独立场景检索集
- `quality/datasets-2.2/review/*.csv`：标注审阅表
- `quality/scripts/build-2.2-candidates.mjs`
- `quality/scripts/eval-2.2-candidates.mjs`
- `quality/scripts/annotate-2.2.mjs`
- `quality/scripts/bench-retrieval-2.2.mjs`
- `quality/reports/2.2-*`、`retrieval-parity-2.2.log`、`e2e-heartflow-v2-2.2.log`

修改：

- [v2.c](file:///e:/一门给年轻人的恋爱成长课/relationship-simulator/heartflow-c/src/server/v2.c)：`route_courses` 重写为字段加权 + 分块 + 概念扩展 + RRF；引用改为真实段落行号；新增 `COURSE_DOMAIN_TERMS`/`course_query_in_domain` 弃答门禁；补「还没有准备好」。
- [v2.js](file:///e:/一门给年轻人的恋爱成长课/relationship-simulator/server/v2.js)：同步弃答门禁（`inCourseDomain` + `COURSE_ABSTAIN_SCORE`）；导出 `retrievalKeywords`/`conceptTerms` 供评测复用；补「还没有准备好」。
- [relationship-cases.js](file:///e:/一门给年轻人的恋爱成长课/relationship-simulator/public/modules/core/relationship-cases.js)：评分 rubric 版本改为白名单 `["1.1.0","2.1.0"]`，修复 2.1 量表评分无法保存。
- [check-retrieval-parity.mjs](file:///e:/一门给年轻人的恋爱成长课/relationship-simulator/quality/scripts/check-retrieval-parity.mjs)：四模式、引用回读、弃答等价、边界与异常索引校验。
- `test/fixtures/semantic-cases.json`、`test/relationship-cases.test.mjs`：新增语义与 rubric 版本回归用例。

未修改：`text.c` 的分词规则、课程正文、manifest。

## 5. 已知失败与阻塞（不得隐藏）

1. **独立人工标注未执行**：候选集与独立场景集标签全部为 AI 建议，`reviewed_by_human=false`；未计算 kappa/alpha/ICC；未冻结最终验收集。
2. **检索真实质量未知**：旧 test 已曝光；候选 query 与标签同源，R@5 99.4% 无信息量；独立场景集只提供模式间相对高低（31–35%），绝对值仍低，不能作为验收结论。
3. **弃答仍有 1/21 漏判**：「更换手机屏幕」含领域词「手机」而被判为课程域内；启发式门禁无法根治，需意图分类或人工确认口径。
4. **语义词表为规则驱动**：本轮按候选集补「还没有准备好」；其他未覆盖说法仍可能漏判，需人工标注后继续收敛。
5. **C 每次请求重建分块**：未做索引缓存与并发压测；延迟只覆盖单用户串行。
6. **真实 embedding / 重排器 / 语音 / 视觉模型未接入**：全部 BLOCKED。
7. **回滚缺口**：2.1 最终二进制 `B96F40...` 在本轮替换前未单独备份，已用 2.1 源码快照重建功能等价二进制；哈希不同（构建非确定性）。

> 更正（2026-11-27 复核）：「构建非确定性」不成立。对当前源码实测：同目录、同输出名连续构建两次逐字节相同；换输出文件名或目录后哈希会变，差异只有 30 多个字节，全在调试目录（调试时间戳、PDB GUID、PDB 文件名），代码段与数据段逐字节相同。本轮用源码快照重建时换了输出名，哈希不同属于同一现象；`B96F40...` 已丢失，两者无法直接比对。详见 `heartflow-c/README.md`「编译」。

## 6. 回滚方式

当前 2.2 构建：

- `heartflow-c/hf.exe` SHA-256：`E79B0B3397540BB0C131C230870EBFA3FD65C84D05DBB542A101DF012E7C171B`（2026-11-15，526848 bytes）

可用回滚文件：

| 目标 | 文件 | SHA-256 |
| --- | --- | --- |
| 2.1 功能等价（源码快照重建） | `heartflow-c/backups/hf-2.1-final-rebuilt.exe` | `F26119FD78119D1F516F8FD1BE5B5716355A0776C61669130C9D94B9F60E3AC8` |
| 2.1 安全加固前 | `heartflow-c/backups/hf-pre-s6-20261114.exe` | 2.1 验收记录内 |
| 2.0 | `heartflow-c/hf.pre-v2-20261113.exe` | 2.1 验收记录内 |

```powershell
# 回到 2.1 功能等价二进制
Copy-Item heartflow-c\backups\hf-2.1-final-rebuilt.exe heartflow-c\hf.exe -Force
Get-FileHash heartflow-c\hf.exe -Algorithm SHA256

# 回到 2.2 源码前的 C 实现并重建
Copy-Item docs\heartflow-2.2\snapshots\v2.c.pre-2.2.c heartflow-c\src\server\v2.c -Force
Copy-Item docs\heartflow-2.2\snapshots\text.c.pre-2.2.c heartflow-c\src\text.c -Force
Push-Location heartflow-c; D:\Git\bin\bash.exe ./build.sh hf.exe; Pop-Location

# 删除 2.2 新增候选数据与报告（不影响 179 课与既有功能）
Remove-Item -Recurse -Force quality\datasets-2.2,quality\reports\2.2-*,quality\reports\retrieval-parity-2.2.log,quality\reports\e2e-heartflow-v2-2.2.log
```

## 7. 下一步建议

详细执行计划、工具补齐清单、门禁与决策点见 [NEXT_ROUND_PLAN.md](file:///e:/一门给年轻人的恋爱成长课/relationship-simulator/docs/heartflow-2.2/NEXT_ROUND_PLAN.md)。

1. 先引入两名独立标注者，按 `ANNOTATION_PROTOCOL.md` 完成 300/200/60 与独立场景 65 条的复核、仲裁与 kappa，再冻结验收集；优先复核「更换手机屏幕」的弃答口径。
2. 在冻结集上评估弃答门禁的误拦/漏拦，并决定是否引入意图分类器替代词表。
3. 用独立场景集做模式选择的正规依据（当前 hybrid 最优），但不得引用其绝对值作为对外指标。
4. C 端增加常驻索引/分块缓存与并发压测，再报告 P95。
5. 真实中文 embedding 与重排器仍为 BLOCKED，需模型选型、许可证与离线部署授权。
