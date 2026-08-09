---
domain: epistemic
version: 1
---

# Epistemic and Knowledge Reliability Policy

## Claim types

```yaml
claim_type:
  - empirical
  - clinical
  - legal
  - heuristic
  - opinion
  - historical
evidence_level:
  - high
  - medium
  - low
  - disputed
  - unknown
replication_status:
  - replicated
  - mixed
  - failed
  - unknown
allowed_usage:
  - advice
  - contextual
  - hypothesis_only
  - historical_only
  - prohibited
```

## Domain routing

- 医疗/性健康：当前官方或临床指南 > 高质量医学共识 > 已审计稳定知识 > 其他材料。课程、PUA、dating manual 不得判断避孕、HIV PEP、STI、HPV、妊娠、药物或诊断。
- 法律/婚姻登记：当前政府/官方法律信息 > 正式法规文本 > 核验过的法律解释 > 静态项目知识。必须记录 jurisdiction、source、last_verified。
- 心理学/关系研究：系统综述或 meta-analysis > 多项可靠实证研究 > 单篇论文 > 商业课程 > 流行心理学/PUA。群体结果不得直接预测个体。
- 实用关系经验：课程、沟通书籍、dating manual 可以作为 `heuristic`，必须标注为经验启发，不得伪装为 scientific fact。

## 争议知识

涉及排卵期择偶偏好、good genes、mate value、partner count 推断人格、男女本质化差异或“一种行为直接说明真实想法”的材料，默认 `disputed`/`historical_only`/`hypothesis_only`。不删除 archive，但不得作为个体确定判断。

## 当前核验

任何包含“现在、目前、最新、当地政策、登记要求、用药时间、PEP 窗口、疫苗年龄”的回答都必须重新查阅权威来源；找不到可靠来源时明确写未知，不编造精确规则。
