# 语义评测（test / node-rule）

- 数据：sem-test-2.1.0（60 条，30 组）
- 标注状态：**未独立人工复核（合成单标注者）**
- Accuracy：96.7%（宽松含 alternative：96.7%）
- Macro-F1：0.960 / Micro-F1：0.967
- 不安全推进：0 / 0
- 弃判：预测 16，金标 2，弃判召回 100.0%
- Bootstrap 95% CI（按情境组重采样，n=1000, seed=42）：Accuracy [93.4%, 100.0%]，Macro-F1 [0.600, 0.981]

| 类别 | P | R | F1 | 支持 |
| --- | --- | --- | --- | --- |
| EXIT | 100.0% | 100.0% | 1.000 | 20 |
| DE_ESCALATE | 100.0% | 100.0% | 1.000 | 10 |
| OBSERVE | 87.5% | 100.0% | 0.933 | 14 |
| ADVANCE | 100.0% | 87.5% | 0.933 | 8 |
| MAINTAIN | 100.0% | 87.5% | 0.933 | 8 |

## 误判

- sem-test-044（test-advance）：金标 ADVANCE，实际 OBSERVE；「可以，一起去。」
- sem-test-057（test-maintain）：金标 MAINTAIN，实际 OBSERVE；「照现在的方式相处就行。」

## 口径与边界

- `ABSTAIN` 为评测补充标签；生产五类中映射为 `OBSERVE`，并单独检查 `decision.abstain`。
- 数据为原创合成样本，由单一实现者编写；不得称为独立人工标注或真实用户准确率。
- test 文件受 `quality/datasets/FREEZE.json` 哈希保护；本脚本不应用于 test 调参。
