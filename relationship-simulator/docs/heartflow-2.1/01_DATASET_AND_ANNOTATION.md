# S1 独立评测数据与标注合同

- 版本：`heartflow-2.1 / S1`
- 数据目录：`quality/datasets/`
- 模式与校验：`quality/schemas/`、`quality/scripts/validate-datasets.mjs`
- 冻结清单：`quality/datasets/FREEZE.json`
- 标注指南：`quality/annotation-guidelines/ANNOTATION_GUIDELINES.md`

## 1. 实际交付

| 数据集 | dev | test | 目标建议 | 实际状态 |
| --- | --- | --- | --- | --- |
| 中文语义 | 60 | 60 | 300 pilot → ≥600 | **低于建议规模**；覆盖 5 类 + ABSTAIN、否定/转折/引用/时序/威胁/短句 |
| 课程检索 | 60 | 60 | 120 → ≥200 | **低于建议规模**；全部按真实课程编号标注并核验候选池 |
| 模拟行为 | 30 | 30 | ≥60 | **达标数量下限**；5 场景×3 难度×3 分支的代表组合 |

所有样本均为**原创合成**，`reviewed_by_human=false`、`annotation_status=synthetic_single_annotator`。未使用真实聊天、截图、姓名、号码或未授权案例。**独立双人标注、Cohen's kappa / Krippendorff alpha、真实脱敏案例：未完成，状态 `BLOCKED_EXTERNAL_VALIDATION`。** 数据规模未达到任务书建议值，不能宣称真实世界覆盖。

## 2. 标签合同

语义字段：`id/group/user/other/speaker/target_decision/evidence_text/evidence_spans/phenomena/unsafe_to_advance/alternative_valid_labels/annotation_status/provenance`。

- `evidence_spans` 使用 **Unicode code point**，与 `evidence_text` 严格一致；`normalize-spans.mjs` 已回填。
- `ABSTAIN` 是评测补充标签：生产仍返回五类；实现需额外返回 `decision.abstain` 与 `decision.evidence_status`，`category=OBSERVE`。若实现没有该标志，评测只按 OBSERVE 计分并单独报告弃判缺失。
- `unsafe_to_advance` 与 `EXIT/DE_ESCALATE` 对齐；`alternative_valid_labels` 用于宽松准确率和仲裁，不替代金标。

检索字段：`id/group/query/relevant/candidate_pool_checked/semantic_rewrite/provenance`。`relevant` 只允许 manifest 真实编号；评测同时检查 manifest 标题、文件存在与零结果。

模拟字段：`scenario_id/difficulty/branch/turns/expect`。`expect` 是规则可验证的行为合同（结束轮次、边界保持、最大 tension、拒绝后不推进），不是自然度金标。

## 3. 去泄漏与冻结

- dev/test 使用不同 `group` 前缀；校验脚本禁止同组跨 split。
- 同一 `other` 文本、同一 query、同一场景+轮次组合不得跨 split 重复。
- test 哈希已写入 `quality/datasets/FREEZE.json`；评测脚本在 `--split=test` 时比较 SHA-256，不一致直接退出码 2。
- 冻结 commit：`dc151140ceed0f2217bd7138b6187b6806b66f51`（工作区未提交改动保留）。

## 4. 基线（冻结 test，实际运行）

| 评测 | 命令 | 结果 | 报告 |
| --- | --- | --- | --- |
| 语义 dev | `node quality/scripts/eval-semantics.mjs --split=dev` | Accuracy 51.7%，Macro-F1 0.533，误判 29，不安全 0 | `quality/reports/semantics-dev-baseline.md` |
| 语义 test | `node quality/scripts/eval-semantics.mjs --split=test` | Accuracy 28.3%，Macro-F1 0.139，误判 43，不安全 0 | `quality/reports/semantics-test-baseline.md` |
| 检索 dev BM25 | `node quality/scripts/eval-retrieval.mjs --split=dev --mode=bm25` | Recall@5 59.7%，MRR@5 0.764，nDCG@5 0.588，引用错误 0 | `quality/reports/retrieval-dev-bm25.md` |
| 检索 test BM25 | `node quality/scripts/eval-retrieval.mjs --split=test --mode=bm25` | Recall@5 41.4%，MRR@5 0.439，nDCG@5 0.357，引用错误 0 | `quality/reports/retrieval-test-bm25.md` |
| 模拟 dev | `node quality/scripts/eval-practice.mjs --split=dev` | 27/30 通过 | `quality/reports/practice-dev-baseline.md` |
| 模拟 test | `node quality/scripts/eval-practice.mjs --split=test` | 27/30 通过 | `quality/reports/practice-test-baseline.md` |

基线显著低于旧 36 条/32 条临时集，原因是新数据刻意增加改写、否定、引用、时序与短句，且类别更均衡。**不能把新基线下降解释为生产退化；两套数据不可直接比较。**

## 5. 已知问题（S2–S4 输入）

- 语义：12 条 EXIT→OBSERVE、6 条 DE_ESCALATE→OBSERVE、6 条 MAINTAIN→OBSERVE、4 条 ADVANCE→OBSERVE、1 条 OBSERVE→EXIT。
- 检索：test Recall@5 仅 41.4%，词面 BM25 对同义改写覆盖不足。
- 模拟：3/30 失败集中在否定压力误判、道歉与压力同句的优先级、部分施压词未覆盖。

## 6. S1 门禁

| 项 | 状态 |
| --- | --- |
| 数据模式与校验 | PASS |
| 冻结与泄漏检查 | PASS |
| 评测脚本可复跑、输出 JSON+MD | PASS |
| 独立双人标注与一致性统计 | **BLOCKED_EXTERNAL_VALIDATION** |
| 数据规模达到建议值 | **FAIL / 未达 300+、120+** |
| 旧 32/36 条数据隔离 | PASS（保留为历史试验集，不并入 test） |
