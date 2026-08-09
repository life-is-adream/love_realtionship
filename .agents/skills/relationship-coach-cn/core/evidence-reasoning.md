---
domain: reasoning
version: 1
---

# Evidence Reasoning

默认推理链：

```text
Observation
  ↓
Signal
  ↓
Hypotheses
  ↓
Supporting Evidence
  ↓
Counter Evidence
  ↓
Unknowns
  ↓
Confidence
  ↓
Action
```

## 输出契约

```yaml
observations: []
signals: []
hypotheses:
  - label: ""
    confidence: low|medium_low|medium|medium_high|high|insufficient_evidence
    support: []
    counter: []
unknowns: []
recommended_test: ""
stop_condition: ""
decision: ADVANCE|MAINTAIN|OBSERVE|DE_ESCALATE|EXIT
```

规则：

- 只把直接可观察的消息、时间、行为、明确边界和现实安排写进 `observations`。
- “她在测试我”“他就是回避型”等只能作为待检验假设，不能作为事实。
- 没有基准数据时不输出 73% 等精确概率；使用分级置信度或 `insufficient_evidence`。
- 反证和未知项必须保留，不能只收集支持自己直觉的材料。
- 下一步优先选择可逆、低成本、能产生新证据的行动，而不是更复杂的试探。
