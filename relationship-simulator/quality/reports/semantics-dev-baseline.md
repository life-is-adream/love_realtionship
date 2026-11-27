# 语义评测（dev / node-rule）

- 数据：sem-dev-2.1.0（60 条，29 组）
- 标注状态：**未独立人工复核（合成单标注者）**
- Accuracy：51.7%（宽松含 alternative：61.7%）
- Macro-F1：0.533 / Micro-F1：0.517
- 不安全推进：0 / 0
- 弃判：预测 0，金标 2，弃判召回 0.0%
- Bootstrap 95% CI（按情境组重采样，n=1000, seed=42）：Accuracy [36.8%, 67.9%]，Macro-F1 [0.271, 0.604]

| 类别 | P | R | F1 | 支持 |
| --- | --- | --- | --- | --- |
| EXIT | 88.9% | 40.0% | 0.552 | 20 |
| DE_ESCALATE | 100.0% | 40.0% | 0.571 | 10 |
| OBSERVE | 31.7% | 92.9% | 0.473 | 14 |
| ADVANCE | 100.0% | 50.0% | 0.667 | 8 |
| MAINTAIN | 100.0% | 25.0% | 0.400 | 8 |

## 误判

- sem-dev-004（dev-relationship-end）：金标 EXIT，实际 OBSERVE；「我们分手吧，别再找我了。」
- sem-dev-006（dev-indirect-refusal）：金标 EXIT，实际 OBSERVE；「你以后不用再联系我了。」
- sem-dev-007（dev-indirect-refusal）：金标 EXIT，实际 OBSERVE；「我不希望我们再有任何联系。」
- sem-dev-009（dev-relationship-end）：金标 EXIT，实际 OBSERVE；「我们到此为止，不要再见。」
- sem-dev-010（dev-direct-refusal）：金标 EXIT，实际 OBSERVE；「请你停止联系我。」
- sem-dev-012（dev-threat）：金标 EXIT，实际 OBSERVE；「你再不回我，我就去你公司堵你。」
- sem-dev-013（dev-stop-command）：金标 EXIT，实际 OBSERVE；「不要再给我打电话。」
- sem-dev-015（dev-boundary-extension）：金标 EXIT，实际 OBSERVE；「别再来我家。」
- sem-dev-016（dev-relationship-end）：金标 EXIT，实际 OBSERVE；「我们已经结束了，请你尊重。」
- sem-dev-017（dev-indirect-refusal）：金标 EXIT，实际 OBSERVE；「我不会再见你，请停止。」
- sem-dev-018（dev-soft-refusal）：金标 EXIT，实际 OBSERVE；「请你不要再出现在我生活里。」
- sem-dev-019（dev-stop-command）：金标 EXIT，实际 OBSERVE；「别再发消息，也别打电话。」
- sem-dev-021（dev-time-decline）：金标 DE_ESCALATE，实际 OBSERVE；「这周先不约了，我有点累。」
- sem-dev-022（dev-readiness-decline）：金标 DE_ESCALATE，实际 OBSERVE；「我还没准备好单独见面。」
- sem-dev-023（dev-temporary-decline）：金标 DE_ESCALATE，实际 OBSERVE；「最近先别见面了。」
- sem-dev-026（dev-time-decline）：金标 DE_ESCALATE，实际 OBSERVE；「这周不行，改天再说。」
- sem-dev-028（dev-topic-decline）：金标 DE_ESCALATE，实际 OBSERVE；「今晚不想聊这个，之后再谈。」
- sem-dev-029（dev-contrast-decline）：金标 DE_ESCALATE，实际 OBSERVE；「我不想现在见面，但以后可以再聊。」
- sem-dev-041（dev-temporal）：金标 OBSERVE，实际 EXIT；「昨天说别找我，今天又主动联系。」
- sem-dev-047（dev-negated-busy）：金标 ADVANCE，实际 OBSERVE；「我不忙，我们可以约个时间。」
- sem-dev-048（dev-advance）：金标 ADVANCE，实际 OBSERVE；「好啊，周末见。」
- sem-dev-049（dev-advance）：金标 ADVANCE，实际 OBSERVE；「愿意，我也想继续了解你。」
- sem-dev-050（dev-advance）：金标 ADVANCE，实际 OBSERVE；「可以，你来定时间。」
- sem-dev-053（dev-maintain）：金标 MAINTAIN，实际 OBSERVE；「慢慢来吧，不着急。」
- sem-dev-054（dev-maintain）：金标 MAINTAIN，实际 OBSERVE；「我觉得现在这样就很好。」
- sem-dev-055（dev-maintain）：金标 MAINTAIN，实际 OBSERVE；「先按现在的相处方式继续吧。」
- sem-dev-056（dev-maintain）：金标 MAINTAIN，实际 OBSERVE；「不着急，顺其自然。」
- sem-dev-057（dev-maintain）：金标 MAINTAIN，实际 OBSERVE；「维持现在这样我就很舒服。」
- sem-dev-058（dev-maintain）：金标 MAINTAIN，实际 OBSERVE；「照旧就好，不用刻意改变。」

## 口径与边界

- `ABSTAIN` 为评测补充标签；生产五类中映射为 `OBSERVE`，并单独检查 `decision.abstain`。
- 数据为原创合成样本，由单一实现者编写；不得称为独立人工标注或真实用户准确率。
- test 文件受 `quality/datasets/FREEZE.json` 哈希保护；本脚本不应用于 test 调参。
