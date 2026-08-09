---
domain: routing
version: 1
---

# Runtime Routing

```text
INPUT
  ↓
Safety Screen
  ↓
Conversation Analyzer（有聊天记录时）
  ↓
Memory Consent Check（有长期上下文时）
  ↓
Situation Classification
  ↓
Evidence Extraction
  ↓
Stage Estimation
  ↓
Hypothesis Generation
  ↓
Decision: ADVANCE / MAINTAIN / OBSERVE / DE_ESCALATE / EXIT
  ↓
Module Retrieval
  ↓
Action Recommendation
  ↓
Optional Script
  ↓
Role-play / Retry（用户选择训练时）
  ↓
Outcome Follow-up → Reflection → Memory Update
```

## 选择规则

1. 先判断是否存在拒绝、胁迫、暴力、隐私或医疗/法律高风险。
2. 将用户原话和可观察行为拆成事实，不先写“对方真实想法”。
3. 只读取与任务相关的 Core、module、curated reference、显式 profile/locale。
4. 信息不足或信号矛盾时优先 `OBSERVE`，不要用话术填补未知。
5. 需要当前医疗、法律、政策或活动信息时进入 `current_verification_required` 路径；静态课程只能提供背景。
6. 将建议写成一个最小风险行动、一个停止条件和一个下一观察点。
7. 有聊天记录时先运行本地 Conversation Analyzer；LLM 只解释有界统计和证据，不直接从原始聊天猜心理。
8. 只有用户明确同意并使用匿名 `case_` ID 时，才生成 Memory Patch；默认不持久化原始消息。
9. 用户要求训练时进入 `runtime/simulation/` 的 Scenario → User Response → Critique → Retry 闭环。
