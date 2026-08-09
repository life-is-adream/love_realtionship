# Relationship Intelligence Evals

本目录包含匿名、可重复的验收案例，不会自动调用远程模型，也不伪造模型 benchmark 分数。

## 数据覆盖

`cases.jsonl` 由 `generate-dataset.mjs` 生成，当前目标为 190 条，包含：

- stage / signals / chat / invitation / conflict / breakup / compatibility；
- safety / epistemic / prompt-injection / personalization leakage；
- roleplay / reasoning / reflection / privacy；
- counterfactual 成对案例。

每条案例要求事实、未知、证据、决策、停止条件和安全替代的相应字段。`privacy.anonymized` 必须为 `true`。

## 运行

```powershell
Set-Location 'E:\一门给年轻人的恋爱成长课'
node .agents/skills/relationship-coach-cn/evals/generate-dataset.mjs
node .agents/skills/relationship-coach-cn/evals/run-static-evals.mjs
```

`results/static-validation.json` 只证明数据契约、类别计数、匿名性和安全期望通过；要比较 Base LLM、Skill、curated 和完整系统，必须另行配置模型、盲评协议和校准报告，不能把静态 PASS 写成模型效果。

本地 runtime 的确定性测试位于 `runtime/**/*.test.mjs`，覆盖 Conversation Analyzer、Memory consent、状态回退、Reflection calibration 和 Role-play retry。它们同样不代表远程模型效果。
