# 语义评测（dev / node-rule）

- 数据：sem-dev-2.1.0（60 条，29 组）
- 标注状态：**未独立人工复核（合成单标注者）**
- Accuracy：95.0%（宽松含 alternative：95.0%）
- Macro-F1：0.957 / Micro-F1：0.950
- 不安全推进：0 / 0
- 弃判：预测 17，金标 2，弃判召回 100.0%
- Bootstrap 95% CI（按情境组重采样，n=1000, seed=42）：Accuracy [87.7%, 100.0%]，Macro-F1 [0.560, 0.990]

| 类别 | P | R | F1 | 支持 |
| --- | --- | --- | --- | --- |
| EXIT | 100.0% | 90.0% | 0.947 | 20 |
| DE_ESCALATE | 100.0% | 100.0% | 1.000 | 10 |
| OBSERVE | 82.4% | 100.0% | 0.903 | 14 |
| ADVANCE | 100.0% | 87.5% | 0.933 | 8 |
| MAINTAIN | 100.0% | 100.0% | 1.000 | 8 |

## 误判

- sem-dev-013（dev-stop-command）：金标 EXIT，实际 OBSERVE；「不要再给我打电话。」
- sem-dev-018（dev-soft-refusal）：金标 EXIT，实际 OBSERVE；「请你不要再出现在我生活里。」
- sem-dev-047（dev-negated-busy）：金标 ADVANCE，实际 OBSERVE；「我不忙，我们可以约个时间。」

## 口径与边界

- `ABSTAIN` 为评测补充标签；生产五类中映射为 `OBSERVE`，并单独检查 `decision.abstain`。
- 数据为原创合成样本，由单一实现者编写；不得称为独立人工标注或真实用户准确率。
- test 文件受 `quality/datasets/FREEZE.json` 哈希保护；本脚本不应用于 test 调参。
