# 语义评测（test / node-rule）

- 数据：sem-test-2.1.0（60 条，30 组）
- 标注状态：**未独立人工复核（合成单标注者）**
- Accuracy：86.7%（宽松含 alternative：88.3%）
- Macro-F1：0.890 / Micro-F1：0.867
- 不安全推进：0 / 0
- 弃判：预测 22，金标 2，弃判召回 100.0%
- Bootstrap 95% CI（按情境组重采样，n=1000, seed=42）：Accuracy [80.0%, 93.1%]，Macro-F1 [0.524, 0.934]

| 类别 | P | R | F1 | 支持 |
| --- | --- | --- | --- | --- |
| EXIT | 100.0% | 75.0% | 0.857 | 20 |
| DE_ESCALATE | 100.0% | 90.0% | 0.947 | 10 |
| OBSERVE | 63.6% | 100.0% | 0.778 | 14 |
| ADVANCE | 100.0% | 87.5% | 0.933 | 8 |
| MAINTAIN | 100.0% | 87.5% | 0.933 | 8 |

## 误判

- sem-test-001（test-direct-refusal）：金标 EXIT，实际 OBSERVE；「请你以后都别联系我。」
- sem-test-009（test-third-party）：金标 EXIT，实际 OBSERVE；「别再找我，也别联系我的朋友。」
- sem-test-013（test-physical-boundary）：金标 EXIT，实际 OBSERVE；「别再来公司堵我。」
- sem-test-016（test-stop-channel）：金标 EXIT，实际 OBSERVE；「别再给我发任何消息。」
- sem-test-017（test-relationship-end）：金标 EXIT，实际 OBSERVE；「我们已经分手了，请不要联系。」
- sem-test-025（test-time-decline）：金标 DE_ESCALATE，实际 OBSERVE；「这周不约了，我状态不好。」
- sem-test-044（test-advance）：金标 ADVANCE，实际 OBSERVE；「可以，一起去。」
- sem-test-057（test-maintain）：金标 MAINTAIN，实际 OBSERVE；「照现在的方式相处就行。」

## 口径与边界

- `ABSTAIN` 为评测补充标签；生产五类中映射为 `OBSERVE`，并单独检查 `decision.abstain`。
- 数据为原创合成样本，由单一实现者编写；不得称为独立人工标注或真实用户准确率。
- test 文件受 `quality/datasets/FREEZE.json` 哈希保护；本脚本不应用于 test 调参。
