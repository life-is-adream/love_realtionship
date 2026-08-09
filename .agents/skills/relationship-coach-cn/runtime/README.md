# Local Runtime

这里是 Relationship Intelligence Agent 的本地、无依赖运行时层。它不调用远程模型，也不把原始聊天自动写入长期记忆。

## 闭环

```text
messages
  ↓
Conversation Analyzer
  ↓
Evidence / State
  ↓
Decision + Action + Prediction
  ↓
Role-play 或现实结果
  ↓
Reflection
  ↓
同意门控的 Memory Patch
```

## 入口

- `conversation/analyzer.mjs`：可观察的消息统计和 evidence，不输出兴趣概率或隐藏意图。
- `memory/memory-store.mjs`：匿名 `case_`、用户同意、不可变追加、脱敏摘要。
- `state/state-machine.mjs`：可回退关系状态，不是人格标签。
- `reflection/reflection-engine.mjs`：Prediction → Outcome → Update，未知结果保持 unknown。
- `simulation/scenario-engine.mjs`：Scenario → User Response → Critique → Retry。
- `agent-loop.mjs`：组合以上模块并输出有界决策对象。
- `index.mjs`：统一导出入口。

## 运行测试

```powershell
Set-Location 'E:\一门给年轻人的恋爱成长课'
node --test .agents/skills/relationship-coach-cn/runtime/**/*.test.mjs
```

调用方若要持久化 Memory，必须自行提供私有存储、删除/导出和保留期限；本目录只提供内存对象，不负责上传或后台同步。
