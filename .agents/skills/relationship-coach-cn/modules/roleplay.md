---
module: roleplay
version: 1
---

# Role-play → Critique → Retry

本地确定性入口：`.agents/skills/relationship-coach-cn/runtime/simulation/scenario-engine.mjs`。

它提供 5 个不依赖性别刻板印象的场景和有限评分；它不模拟真实第三方人格，也不保存用户原始练习文本。

训练流程：

1. 给出边界清楚的 Scenario 和角色目标；
2. AI 扮演对方，只在角色能合理知道的范围内回应；
3. 等用户写出真实回复，不先给标准答案；
4. 反馈最多三个最重要改进点：自然度、问题密度、倾听、自我表达、边界、需求感、推进速度或错过窗口；
5. 用户重试；
6. 比较两次表现，指出现实中可观察的下一步。

拒绝继续扮演胁迫、灌酒、偷拍、威胁、性压力、跟踪或自杀威胁控制关系的剧本，改为安全替代训练。
