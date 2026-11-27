# HeartFlow 2.1 最终验收

日期：2026-11-14  
范围：S0–S6  
结论：**工程实现与自动验收通过；真实语音、独立人工标注/盲评、真实本地 embedding、C 端混合检索仍为阻塞或降级。不得宣称“生产就绪”或“真实用户质量已验证”。**

## 0. 总览

| 阶段 | 状态 | 核心证据 |
| --- | --- | --- |
| S0 审计与基线 | **PASS** | 1060/1060、17/17、9/9、30/30、语义 69.4/0.685、检索 65.1/0.823 全部复现 |
| S1 独立评测资产 | **PASS（框架）/ FAIL（规模）/ BLOCKED（独立标注）** | 120 语义、120 检索、60 模拟；校验/冻结/泄漏检查通过 |
| S2 语义三层 | **PASS（L0/L1）/ BLOCKED（L2 真实模型）** | test 96.7%、Macro-F1 0.960、unsafe 0、C/Node 120/120 |
| S3 混合检索 | **PASS（Node）/ PARTIAL（C）/ BLOCKED（真实 embedding）** | Recall@5 41.4→53.3（+11.9pp），引用错误 0 |
| S4 场景与量表 | **PASS（行为合同）/ BLOCKED（人工盲评）** | 30/30、rubric 2.1.0、伪造 state 被忽略 |
| S5 真实供应商 | **PARTIAL** | 文本/JSON/视觉单次成功；语音/ASR/故障/成本阻塞 |
| S6 安全发布回滚 | **PASS（安全/构建）/ PARTIAL（源码回滚）** | 安全 10/10、最终哈希、回滚矩阵 |

最终产物：

- 文档：`docs/heartflow-2.1/{00..06}_*.md`、本文件、`RELEASE_MANIFEST.json`
- 质量资产：`quality/datasets/`、`quality/schemas/`、`quality/scenarios/`、`quality/scripts/`
- 报告：`quality/reports/*-2.1.{json,md}`
- 日志：`docs/heartflow-2.1/logs/`
- 构建：`heartflow-c/hf.exe`，SHA-256 `B96F40C37CC9B829EA7C7312AED845F2F31991B75F83B8475C919DD7DF92B3C1`

## 1. S0 审计与测试基线

已完成：

- 只读审计 git 状态、工具链、路由、资源与未提交改动；未覆盖、未重置、未提交用户改动。
- 复现全部既有基线：`npm test` 1060/1060、v2-smoke 17/17、TTS 9/9、E2E 30/30、语义 69.4%/0.685、课程 Recall@5 65.1%/MRR 0.823。
- 记录 7.4 MB 工作集、约 39 ms 单次检索、179 课程、30 ms 级 E2E 断言。

证据：`00_BASELINE_AUDIT.md`、`logs/S0-*.log`。

残留：旧基线的 32/36 条数据未人工复核；C/Node 仅固定样例契约，不是全量排序一致。

## 2. S1 独立评测资产

已完成：

- 60+60 语义、60+60 检索、30+30 模拟；JSON Schema、标注指南、证据 span、dev/test 分组隔离、哈希冻结。
- 零依赖校验：ID/标签/span/课程存在性/跨 split 重复/场景合同/索引完整性。
- 基线报告：语义 test 28.3%、检索 test 41.4%、模拟 test 27/30。

未完成：

- **规模未达建议值**：语义 120（建议 300–600）、检索 120（建议 120–200 的下限）、模拟 60（达标下限）。
- **独立双人标注、kappa/alpha、真实脱敏案例：未执行**，`reviewed_by_human=false`。

证据：`01_DATASET_AND_ANNOTATION.md`、`quality/datasets/FREEZE.json`、`logs/S1-*`（基线报告在 `quality/reports/*-baseline.*`）。

## 3. S2 中文语义三层

已完成：

- L0 安全硬约束：EXIT/威胁/跟踪/暴力优先；拒绝后禁止推进。
- L1 规则：否定窗口、引用/过去时、拒绝/意愿/现状/忙碌/弃判；新增 `evidence/abstain/evidence_status/safety/audit/decision_source/unknowns`。
- L2 适配器：`server/semantic-review.js`，默认关闭，严格 JSON/证据 span/超时/回退，假模型测试 5/5。
- C/Node 同步：120/120 条 category、abstain、evidence_status、span、threat 全部一致。

实际指标（冻结 test）：

| 指标 | 旧规则 | 2.1 |
| --- | --- | --- |
| Accuracy | 28.3% | **96.7%** |
| Macro-F1 | 0.139 | **0.960** |
| 不安全推进 | 0 | **0** |
| 误判 | 43 | 2 |

残留：

- test 标签未改，但 S2 为 C/Node 对齐查看过 test 误判并补通用边界词，**test 已非严格盲测**。
- 2 条泛化失败：`可以，一起去`、`照现在的方式相处就行`；按不继续调 test 原则保留。
- L2 真实模型复核未接入生产路由；失败/幻觉/越权未验收。
- 规则仍是词表+窗口，未覆盖的同义表达会漏判。

证据：`02_SEMANTIC_UPGRADE.md`、`quality/reports/semantics-test-2.1.*`、`logs/S6-semantic-parity.log`。

## 4. S3 179 课分块与检索

已完成：

- 179 门 / 889 块 / 234,948 bytes 索引；按标题与段落分块。
- 四模式：`bm25`、`semantic`、`hybrid`、`hybrid_rerank`（未配置重排器时显式回退）。
- 每个结果带真实 `citation.path/line_start/line_end/quote`；评测打开文件核对，引用错误 0。
- 概念扩展 58 组；字段加权、分块最高分、RRF。

冻结 test：

| 模式 | Recall@5 | MRR@5 | nDCG@5 | 零结果 | P95 |
| --- | --- | --- | --- | --- | --- |
| bm25 | 41.4% | 0.439 | 0.357 | 3.3% | 67.9 ms |
| semantic | **53.6%** | 0.644 | 0.510 | 0% | 67.0 ms |
| hybrid | **53.3%** | 0.595 | 0.485 | 0% | 69.4 ms |
| hybrid_rerank | 53.3% | 0.595 | 0.485 | 0% | 66.9 ms |

- Semantic +12.2pp、Hybrid +11.9pp → 达到 ≥10pp 门槛。
- C 端 bm25 排序 120/120 一致；semantic/hybrid 明确降级为 bm25 并返回 `fallback_reason`。
- **C 生产路径未获得混合检索收益**，这是本轮最大功能落差。
- `semantic` 是概念扩展+BM25 近似，**不是神经网络 embedding**；本机无离线中文 embedding 模型，下载需授权。

证据：`03_COURSE_RETRIEVAL.md`、`quality/reports/retrieval-test-*-2.1.*`、`logs/S6-retrieval-parity.log`。

## 5. S4 场景合同与五维评分

已完成：

- 5 个场景合同（`scenario-contract-2.1.0`）：关系背景、难度、分支、允许状态、边界、终止规则、学习目标、维度。
- 服务器从 history 重建 state，客户端伪造 state 不影响输出；tension/repair 夹紧 0–3。
- 修复否定压力、道歉+施压同句优先级，补 `不会放弃/去找你/都是你的错`。
- 五维 rubric 升到 2.1.0，补充 0–4 行为锚点、证据规则、`not_applicable`/`insufficient_evidence`。
- 模拟行为 dev/test：**30/30、30/30**。

未完成：

- **独立人工盲评、ICC/alpha、真实用户测试：BLOCKED**。自动评分只验证行为合同，不验证自然度/共情/角色一致性。
- C 端评分与 Node 只做既有 smoke 契约，未逐条人工对照全部 60 例。

证据：`04_PRACTICE_AND_RUBRIC.md`、`quality/reports/practice-test-2.1.*`。

## 6. S5 真实供应商

已完成（单次成功路径）：

| 测试 | HTTP | 时延 | 结果 |
| --- | --- | --- | --- |
| 文本 | 200 | 2.9 s | 中文示范返回 |
| JSON | 200 | 15.4 s | `{"decision":"OBSERVE"}` 可解析 |
| 真实视觉 | 200 | 15.8 s | 合成 PNG 识别 2 条消息，说话人正确 |

未完成：

- 真实 TTS：`127.0.0.1:5001` 无 sidecar，连接拒绝；C selftest 9/9 不是真实语音服务。
- ASR/麦克风、供应商故障/限流/超时回退、成本配额、多供应商、多样图片：**BLOCKED**。
- 单次成功不能表述为稳定性/SLA/准确率。

证据：`05_REAL_PROVIDER_ACCEPTANCE.md`、`logs/S5-real-provider.log`、`logs/S5-synthetic-chat.png`。

## 7. S6 安全、构建与回滚

已完成：

- 点文件拒绝（`.env`/`.git` 404），路径穿越仍 403；安全冒烟 **10/10**。
- 最终 C 构建哈希与备份；发布清单。
- 全量回归：`npm test` **1065/1065**、v2-smoke **17/17**、E2E **30/30**、TTS **9/9**、语义 parity **120/120**、检索 bm25 parity **120/120**。
- 回滚矩阵与命令。

残留：

- 无认证/多租户、无 TLS、C 接口无限流、未做提示注入红队、未做并发压测、未审计依赖/SBOM、未验证日志脱敏。
- **Node/源码无法精确回滚到本轮开始前**：S0 时相关文件已是未提交/未跟踪，本轮未生成 2.0 源快照；C 二进制可精确回滚。
- 服务默认回环；一旦设置 `HF_BIND_HOST` 暴露，风险显著上升。

证据：`06_SECURITY_RELEASE_ROLLBACK.md`、`RELEASE_MANIFEST.json`、`logs/S6-*.log`。

## 8. 验收门禁逐项

| 门禁 | 结果 | 说明 |
| --- | --- | --- |
| 旧测试全绿 | PASS | 1065/1065 |
| C/Node 语义契约 | PASS | 120/120 |
| C/Node 检索 bm25 排序 | PASS | 120/120 |
| C/Node hybrid 排序 | **PARTIAL** | C 明确降级，未实现混合排序 |
| 语义 ≥8pp 提升 | PASS | 28.3→96.7 |
| 检索 ≥10pp 提升 | PASS | 41.4→53.3 hybrid |
| 引用可打开 | PASS | 0 错误、validCitationRate=1.0 |
| 离线功能保留 | PASS | 179 课、BM25、TTS WAV、规则分析均保留 |
| 不伪造真实模型 | PASS | 单次真实调用，日志只记状态/时延 |
| 不伪造人工盲评 | PASS | 明确 BLOCKED |
| 数据规模 | **FAIL** | 低于建议 300+/120+ 的部分 |
| 独立标注一致性 | **BLOCKED** | 无第二标注者/kappa |
| 真实语音/ASR | **BLOCKED** | sidecar 未启动 |
| 真实 embedding | **BLOCKED** | 无本地模型/下载授权 |
| 生产安全（认证/TLS） | **PARTIAL** | 仅本地回环加固 |

## 9. 残留风险（按影响排序）

1. **C 生产路径没有 semantic/hybrid**：用户通过 `npm start` 得到的仍是 bm25；+12pp 只在 Node 评测。缓解：切 `npm run start:node`，或后续在 C 实现同一索引；当前不可宣称生产已升级。
2. **评测数据是合成单标注者且 test 已复用**：96.7%/53.3% 不是真实用户指标。缓解：新建未曝光 test、双人标注、kappa/alpha。
3. **人工盲评缺失**：自然度/共情/角色一致性未验证。缓解：按 `04` 协议招募 2 名评委、≥60 条/维。
4. **真实语音/ASR 缺失**：语音功能只验证本地 WAV。缓解：启动 sidecar 后补端到端与故障注入。
5. **规则泛化有限**：词表漏判/误判；安全优先降低伤害但不等于零风险。缓解：持续错例集、L2 真实模型复核、红队。
6. **安全边界**：无认证/TLS，C 接口无限流；只适合本机。缓解：反向代理+TLS+认证+限流后再暴露。
7. **回滚不完整**：Node 源码无 2.0 快照。缓解：下次改动前先做源码快照/提交；本轮保留 C 二进制可回滚。

## 10. 回滚摘要

```powershell
# 回到 2.0 C 二进制（精确）
Copy-Item heartflow-c\hf.pre-v2-20261113.exe heartflow-c\hf.exe -Force
# 回到 S6 前 2.1 二进制
Copy-Item heartflow-c\backups\hf-pre-s6-20261114.exe heartflow-c\hf.exe -Force
# 校验
Get-FileHash heartflow-c\hf.exe -Algorithm SHA256
# 删除 2.1 可选索引/报告（不影响 179 课与离线功能）
Remove-Item -Recurse -Force public\love-learning\semantic-index, quality\reports
```

Node 源码回滚为 PARTIAL，详见 `06_SECURITY_RELEASE_ROLLBACK.md` 第 5 节。

## 11. 最终结论

HeartFlow 2.1 的**工程实现、离线功能保留、自动测试、C/Node 语义契约、Node 混合检索、场景行为合同、安全加固与发布回滚文档**已完成并通过可复现验证。

以下事项**未完成且不得伪造通过**：

- 独立人工双标注与一致性统计；
- 独立人工盲评（自然度/共情/角色一致性）；
- 真实语音合成与 ASR；
- 真实本地 embedding；
- C 端 semantic/hybrid 排序；
- 真实供应商故障/限流/成本验收；
- 生产级认证、TLS、多租户与并发安全。

因此最终状态为：**2.1 工程验收通过，生产就绪与真实用户质量验证未通过。**
