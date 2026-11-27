# 语义评测（test / node-rule）

- 数据：sem-test-2.1.0（60 条，30 组）
- 标注状态：**未独立人工复核（合成单标注者）**
- Accuracy：28.3%（宽松含 alternative：46.7%）
- Macro-F1：0.139 / Micro-F1：0.283
- 不安全推进：0 / 0
- 弃判：预测 0，金标 2，弃判召回 0.0%
- Bootstrap 95% CI（按情境组重采样，n=1000, seed=42）：Accuracy [15.6%, 46.5%]，Macro-F1 [0.081, 0.204]

| 类别 | P | R | F1 | 支持 |
| --- | --- | --- | --- | --- |
| EXIT | 80.0% | 20.0% | 0.320 | 20 |
| DE_ESCALATE | 0.0% | 0.0% | 0.000 | 10 |
| OBSERVE | 23.6% | 92.9% | 0.377 | 14 |
| ADVANCE | 0.0% | 0.0% | 0.000 | 8 |
| MAINTAIN | 0.0% | 0.0% | 0.000 | 8 |

## 误判

- sem-test-001（test-direct-refusal）：金标 EXIT，实际 OBSERVE；「请你以后都别联系我。」
- sem-test-002（test-relationship-end）：金标 EXIT，实际 OBSERVE；「我们结束吧，别再发消息。」
- sem-test-003（test-stop-channel）：金标 EXIT，实际 OBSERVE；「别再打电话给我。」
- sem-test-004（test-direct-refusal）：金标 EXIT，实际 OBSERVE；「我不想再和你有任何来往。」
- sem-test-005（test-physical-boundary）：金标 EXIT，实际 OBSERVE；「请离我远一点，不要再来找我。」
- sem-test-006（test-physical-boundary）：金标 EXIT，实际 OBSERVE；「以后不要再出现在我面前。」
- sem-test-007（test-relationship-end）：金标 EXIT，实际 OBSERVE；「到此为止吧，别再纠缠。」
- sem-test-008（test-indirect-refusal）：金标 EXIT，实际 OBSERVE；「我不会再回复你，请停止。」
- sem-test-009（test-third-party）：金标 EXIT，实际 OBSERVE；「别再找我，也别联系我的朋友。」
- sem-test-010（test-indirect-refusal）：金标 EXIT，实际 OBSERVE；「我们没有任何可能了，请停止联系。」
- sem-test-011（test-threat）：金标 EXIT，实际 OBSERVE；「你再纠缠我，我就报警。」
- sem-test-013（test-physical-boundary）：金标 EXIT，实际 OBSERVE；「别再来公司堵我。」
- sem-test-014（test-direct-refusal）：金标 EXIT，实际 OBSERVE；「我不想见你，也不会见你。」
- sem-test-015（test-soft-refusal）：金标 EXIT，实际 OBSERVE；「请你从我的生活里消失。」
- sem-test-016（test-stop-channel）：金标 EXIT，实际 OBSERVE；「别再给我发任何消息。」
- sem-test-017（test-relationship-end）：金标 EXIT，实际 OBSERVE；「我们已经分手了，请不要联系。」
- sem-test-021（test-time-decline）：金标 DE_ESCALATE，实际 OBSERVE；「这个月先不见面了，我想休息。」
- sem-test-022（test-readiness-decline）：金标 DE_ESCALATE，实际 OBSERVE；「我还没准备好约会。」
- sem-test-023（test-temporary-decline）：金标 DE_ESCALATE，实际 OBSERVE；「最近不想出来，过阵子再说。」
- sem-test-024（test-pause-request）：金标 DE_ESCALATE，实际 OBSERVE；「我们先暂停联系吧。」
- sem-test-025（test-time-decline）：金标 DE_ESCALATE，实际 OBSERVE；「这周不约了，我状态不好。」
- sem-test-026（test-space-request）：金标 DE_ESCALATE，实际 OBSERVE；「我需要空间，暂时别联系。」
- sem-test-027（test-topic-decline）：金标 DE_ESCALATE，实际 OBSERVE；「现在不想谈，改天吧。」
- sem-test-028（test-contrast-decline）：金标 DE_ESCALATE，实际 OBSERVE；「先别见面，我还没想清楚。」
- sem-test-029（test-pace-decline）：金标 DE_ESCALATE，实际 OBSERVE；「我不想现在确定关系，但可以继续了解。」
- sem-test-030（test-topic-decline）：金标 DE_ESCALATE，实际 OBSERVE；「今天不想聊，之后再约。」
- sem-test-040（test-quotation）：金标 OBSERVE，实际 EXIT；「他跟我说‘别再联系’，我就没回。」
- sem-test-043（test-advance）：金标 ADVANCE，实际 OBSERVE；「我也挺想见你的，找个时间吧。」
- sem-test-044（test-advance）：金标 ADVANCE，实际 OBSERVE；「可以，一起去。」
- sem-test-045（test-advance）：金标 ADVANCE，实际 OBSERVE；「我愿意试试看。」
- sem-test-046（test-advance）：金标 ADVANCE，实际 OBSERVE；「好啊，我们定个时间。」
- sem-test-047（test-negated-busy）：金标 ADVANCE，实际 OBSERVE；「我不忙，周末可以。」
- sem-test-048（test-advance）：金标 ADVANCE，实际 OBSERVE；「愿意继续了解，约个时间吧。」
- sem-test-049（test-advance）：金标 ADVANCE，实际 OBSERVE；「听起来很好，我们去吧。」
- sem-test-050（test-advance）：金标 ADVANCE，实际 OBSERVE；「行，你来安排。」
- sem-test-051（test-maintain）：金标 MAINTAIN，实际 OBSERVE；「我觉得现在这样很舒服。」
- sem-test-052（test-maintain）：金标 MAINTAIN，实际 OBSERVE；「按现在的节奏继续就好。」
- sem-test-053（test-maintain）：金标 MAINTAIN，实际 OBSERVE；「不着急，慢慢来。」
- sem-test-054（test-maintain）：金标 MAINTAIN，实际 OBSERVE；「维持现状挺好的。」
- sem-test-055（test-maintain）：金标 MAINTAIN，实际 OBSERVE；「现在这样我就满意了。」
- sem-test-056（test-maintain）：金标 MAINTAIN，实际 OBSERVE；「顺其自然吧，不用变。」
- sem-test-057（test-maintain）：金标 MAINTAIN，实际 OBSERVE；「照现在的方式相处就行。」
- sem-test-058（test-maintain）：金标 MAINTAIN，实际 OBSERVE；「慢慢处着看，不急着改变。」

## 口径与边界

- `ABSTAIN` 为评测补充标签；生产五类中映射为 `OBSERVE`，并单独检查 `decision.abstain`。
- 数据为原创合成样本，由单一实现者编写；不得称为独立人工标注或真实用户准确率。
- test 文件受 `quality/datasets/FREEZE.json` 哈希保护；本脚本不应用于 test 调参。
