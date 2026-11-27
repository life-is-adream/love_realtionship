# HeartFlow 2.2 独立标注协议

状态：**协议已就绪；独立人工标注未执行（BLOCKED）**。  
现有 `quality/datasets-2.2/pending/` 中 300 条语义、200 条检索、60 段模拟均为**脚本生成的候选**，标签来源 `ai_suggested_candidate`，不是人工真值。

## 1. 目标与不可妥协的边界

1. 建立严格未曝光的最终验收集，用于判断 2.2 是否真的提升，而不是证明已有实现。
2. 候选集只用于降低标注成本；任何 AI 建议标签都必须由两名独立标注者重新判断。
3. 冻结后的 test 集不得参与词表扩展、提示词调整、阈值选择或错误驱动修复。
4. 若最终 test 已被用于开发，必须在报告中标注“已曝光”，并重新准备未曝光的验收集。
5. 没有第二名独立标注者时，只能交付 `PENDING_HUMAN_ANNOTATION`，不得写“人工复核通过”。

## 2. 数据集与任务定义

### 2.1 语义（目标 ≥300，当前候选 300）

- 输入：`user`（用户一句话）+ `other`（对方一句话）。
- 标签：`EXIT`、`DE_ESCALATE`、`ADVANCE`、`MAINTAIN`、`OBSERVE`。
- 必填：`evidence_text`（支持判断的最短原文）、`evidence_spans`（码点区间）、`unsafe_to_advance`。
- 允许：`alternative_valid_labels`（确实存在第二种合理解释时）、歧义时标 `OBSERVE`。
- 判定口径：只看文本证据，不推断人格、动机或“真实想法”；拒绝与暂停优先于吸引力目标。

### 2.2 课程检索（目标 ≥200，当前候选 200）

- 标注对象：`query` + 候选课程集合（179 门）。
- 相关性：二值；判断“该课程是否直接帮助回答这个问题”，不是“主题沾边”。
- 每题 1–4 门相关课程；无合适课程时标 `relevant: []`（允许弃答）。
- 标注者必须先读课程正文，不得只看标题；不得参考检索器返回结果排序。
- 候选 query 由课程目标改写，存在同源偏差；标注者应改写为真实用户问法后再判定。

### 2.2.1 独立场景检索候选（`candidate-independent/retrieval.json`，65 条）

- 为消除“query 抄课程目标”的同源偏差单独构建：60 条域内场景化问法（如“她总在忙，我还该继续找她吗”）+ 5 条域外问法。
- 相关性由单人按课程标题挑选，`label_source: "curated_from_course_titles_unreviewed"`，`reviewed_by_human: false`。
- 用途：在没有人工标签前，至少能得到一个不与课程文本同源的相对比较（bm25/semantic/hybrid 谁更好）。
- 仍不能替代人工相关性判断：标题匹配可能漏掉正文更合适的课程，也可能高估同名主题。标注者应按 2.2 的规则重新判定 `relevant`。

### 2.3 模拟对话（目标 ≥60，当前候选 60）

- 行为合同：拒绝分支是否结束、拒绝后是否不再推进、`tension/repair` 是否在 0–3。
- 人工质量维度（需独立盲评，1–5 分）：自然度、共情、角色一致性、边界清晰度。
- 只评价“这段对话作为练习是否有帮助”，不评价“能否预测现实中某个人”。

### 2.4 回复质量（建议 100 个上下文，尚未建集）

- 维度：自然度、边界、可用性、是否错误假定对方意图。
- 本协议预留结构，本轮**未创建**该数据集，状态 BLOCKED。

## 3. 人员与流程

1. 两名标注者互不可见对方标签，独立完成同一批条目。
2. 每批先做 20 条校准样例（含拒绝、暂停、模糊、无匹配各 5 条），只讨论口径，不讨论具体答案。
3. 使用 `quality/scripts/annotate-2.2.mjs` 记录；每条可附 `note`。
4. 分歧条目由第三名仲裁者裁决，保留原始分歧与裁决理由；不得删除冲突记录。
5. 标注完成后计算一致性；未达标则补充口径培训并重标，不回改已冻结的 test。

## 4. 一致性指标

| 数据类型 | 指标 | 建议门槛（研发建议值，不是已达成值） |
| --- | --- | --- |
| 语义单标签 | Cohen's kappa | ≥0.60 可接受，≥0.80 良好 |
| 语义多标签/多类 | Krippendorff's alpha（nominal） | ≥0.60 |
| 课程相关性 | Cohen's kappa（二值） | ≥0.60 |
| 模拟 1–5 分 | ICC(2,k) 或 Krippendorff's alpha（ordinal） | ≥0.60 |

工具内已实现 Cohen's kappa 与百分比一致率；alpha/ICC 需在标注完成后补算并写入报告。

## 5. 工具

```powershell
# 导出 CSV 审阅表（不含检索器排序，避免锚定）
node quality/scripts/annotate-2.2.mjs --export

# 查看下一条未标注条目
node quality/scripts/annotate-2.2.mjs --next --annotator=alice

# 记录一条标签（语义标签必须是五类之一）
node quality/scripts/annotate-2.2.mjs --set sem-cand-001 EXIT --annotator=alice --note="明确拒绝"

# 进度
node quality/scripts/annotate-2.2.mjs --status

# 两人一致性
node quality/scripts/annotate-2.2.mjs --iaa --a=alice --b=bob
```

标注记录写入 `quality/datasets-2.2/annotations/<annotator>.jsonl`，每条含 `id/dataset/label/note/annotator/at`。

## 6. 冻结流程

1. 两人标注完成 → 仲裁完成 → 生成 `quality/datasets-2.2/frozen/{semantic,retrieval,practice}.json`。
2. 冻结文件写入 `dataset_version`、`reviewed_by_human: true`、`annotation_status: "independent_double_annotation"`、`iaa` 结果。
3. 计算 SHA-256，写入 `quality/datasets-2.2/FREEZE-2.2.json`。
4. 冻结后修改任何样本都必须提升版本号并重新计算哈希；评测脚本应拒绝哈希不匹配的 test。
5. 冻结集的访问只保留给验收者；开发过程只使用 dev 集。

## 7. 当前阻塞与证据

- 独立标注者：**0 名**（本轮无法引入第二名独立人工）。
- 一致性统计：**未执行**（没有双人标签）。
- 人工盲评：**未执行**。
- 已交付：候选数据（300/200/60）、独立场景检索 65 条、CSV 导出、逐条记录、进度与 kappa 工具。
- 已自测：工具可导出、可写入、可统计；自测记录已删除，未留在仓库中冒充标注。

因此当前状态：`PENDING_HUMAN_ANNOTATION` = **BLOCKED**，不得标记为通过。
