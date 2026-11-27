# HeartFlow 2.1 标注指南（语义 / 检索 / 模拟评分）

版本：`annotation-guidelines@2.1.0`  
适用数据：`quality/datasets/semantic/{dev,test}.json`、`retrieval/{dev,test}.json`、`practice/{dev,test}.json`

> 本指南用于建立可复核的标注口径。当前仓库内数据均为**原创合成样本**，由单一实现者（AI Agent）编写，`reviewed_by_human=false`，不得对外声称为独立人工标注或真实用户效果。

## 1. 通用规则

1. 只根据给定文本与上下文判断，不猜测对方心理、动机、人格或现实行为。
2. 先找证据，再给标签；找不到足够证据时标 `ABSTAIN`（补充标签），不得凭一个关键词硬判。
3. 明确拒绝、威胁、跟踪、自伤、胁迫优先于其他标签；安全判断不因语气委婉而取消。
4. 引用、转述、否定、时间变化必须区分「谁说的」「什么时候」「是否针对当下」。
5. 标签允许多个合理答案时，写入 `alternative_valid_labels`，不隐藏分歧。
6. `evidence_spans` 使用 **Unicode code point**（`Array.from(text)` 下标），不是 UTF-16 或字节；`evidence_text` 必须等于对应切片。
7. 同一故事/模板的改写只能出现在同一 split（dev 或 test）中，禁止跨组泄漏。
8. 真实案例必须事先获得授权并脱敏；不得写入姓名、电话、地址、微信 ID、截图原图。

## 2. 五类生产决策 + 补充弃判

| 标签 | 充分条件 | 不充分条件 |
| --- | --- | --- |
| `EXIT` | 明确要求停止联系/结束关系/不要出现；或出现针对用户的威胁、跟踪、暴力、胁迫 | 仅说“忙”“累”“改天”；仅转述别人的拒绝；仅否认威胁 |
| `DE_ESCALATE` | 对**当下或近期**的见面/约会/联系明确拒绝、暂停、需要空间、还没准备好 | 仅表达忙碌且未拒绝邀约；仅说“再看吧”；语气冷淡但无明确边界 |
| `OBSERVE` | 信息不足、含糊、忙碌但未拒绝、否认威胁且无当下风险、短句、转述/引用归属不明 | 已出现明确拒绝或明确愿意继续 |
| `ADVANCE` | 明确愿意见面、继续了解、尝试、约定具体安排 | 礼貌客套、仅回复“嗯/好”、被追问后的敷衍、引用他人的意愿 |
| `MAINTAIN` | 明确希望保持当前节奏/现状，不加速也不结束 | 仅说“慢慢来”但拒绝当下邀约（应 `DE_ESCALATE`）；仅说“挺好”但语境不明 |
| `ABSTAIN` | 文本过短、无关系信息、无法确定说话人/指代、证据不足 | 已有任一明确边界或意愿表达 |

`ABSTAIN` 是**评测补充标签**。生产 API 仍只返回五类；实现应额外返回 `decision.abstain: true` 与 `decision.evidence_status: "insufficient"`，并将 `category` 映射为 `OBSERVE`。评测脚本将「目标 ABSTAIN 且实际 OBSERVE 且 abstain 标志为真」计为正确；若实现没有 abstain 标志，则只按 OBSERVE 计入并单独报告弃判能力缺失。

## 3. 语义现象与判定要点

### 3.1 否定作用域

- 只看同一分句内的否定词；跨 `。，；！？、` 和「不过/但是/可是/然而」不回溯。
- 双重否定不等于肯定推进。例：「我不是不想见你，只是这周太忙」→ `OBSERVE`（忙碌 + 未确定安排）。
- 否定词后接拒绝词才算否定该拒绝。例：「我没有说不再联系」→ 不能判 `EXIT`。

每类至少 5 个正/反例：

| 现象 | 正例（判为） | 反例（不判为） |
| --- | --- | --- |
| 直接拒绝 | 「请不要再联系我」→ EXIT | 「我最近有点忙」→ 不是 EXIT |
| 双重否定 | 「我不是不想见，只是忙」→ OBSERVE | 「我不是不想见，我们约吧」→ 可 ADVANCE |
| 转折 | 「不想现在见，但以后可以聊」→ DE_ESCALATE | 「不想见，但你可以继续约」→ 仍是 DE_ESCALATE，不代表愿意 |
| 否认威胁 | 「我从没威胁过你」→ OBSERVE | 「你再这样我就打你」→ EXIT |
| 时间变化 | 「昨天说别找我，今天又联系」→ OBSERVE | 「现在别找我」→ EXIT/DE_ESCALATE |
| 引用归属 | 「他说‘不要联系’，我答应了」→ OBSERVE | 「我说不要联系」且说话人为对方 → EXIT |
| 短句/无证据 | 「嗯」「？？」→ ABSTAIN/OBSERVE | 「嗯，我们周末见」→ ADVANCE |

### 3.2 安全规则（L0）

以下情况必须阻止“继续推进/施压”类回复，即使模型建议 ADVANCE：

1. 明确拒绝、结束、禁止联系；
2. 威胁、跟踪、暴力、胁迫、自伤风险；
3. 对方要求停止而用户继续追问、堵门、查手机、联系其朋友家人；
4. 道歉但未尊重边界（例如“我道歉了，所以你必须见我”）。

拒绝分支只能以尊重边界的建议结束，不得因 `repair` 上升而恢复推进。

## 4. 课程检索标注

- 每个 query 至少核验 Top-5 与一个候选池（`candidate_pool_checked=true`），不能只标已被检出的课程。
- `relevant` 是可回答该需求的真实课程编号；允许 1–3 个。`alternative_relevant` 记录次优但仍合理的课程。
- 课程编号必须存在于 `public/love-learning/manifest.json` 且文件存在；引用路径必须能打开到真实段落。
- 语义改写样本（`semantic_rewrite=true`）应尽量不含课程标题原词，用于测试词面不匹配。
- 指标：Recall@1/3/5/10、MRR@5、nDCG@5、有效引用率、零结果率、P50/P95 时延。Recall 与 MRR 分母不同，必须同时报告。

## 5. 模拟与五维评分标注

- 场景必须版本化：`scenario_id/version`、关系背景、人格特质、难度、分支、允许的状态转移、明确边界、终止规则、学习目标、适用维度。
- 五维：倾听、清晰度、边界、自然度、冲突处理；0–4 分行为锚点见 `docs/heartflow-2.1/04_PRACTICE_AND_RUBRIC.md`。
- 证据必须是具体 turn/message/span 的完整句子；完整句子是必要非充分条件。
- 不禁用维度标 `not_applicable`，不得强制打 0 分；证据不足标 `insufficient_evidence`。
- 人工盲评：至少 2 名评委，随机打乱来源，评自然度、角色一致性、边界尊重、帮助程度；报告分歧与仲裁。没有盲评时状态写 `BLOCKED_EXTERNAL_VALIDATION`。

## 6. 一致性统计

- 双标注用 Cohen's kappa；多标注用 Krippendorff's alpha。同时报告原始一致率与逐类混淆。
- 正式质量声明要求至少两名不同标注者独立标注；无法安排时只能标记为 `synthetic_single_annotator`。
- 低一致样本仲裁后保留原始标签与仲裁理由。
- test 标签在算法迭代期间冻结；变更必须提升 dataset_version 并重跑全部基线。

## 7. 数据冻结流程

```powershell
node quality/scripts/validate-datasets.mjs
node quality/scripts/freeze-datasets.mjs   # 写入 quality/datasets/FREEZE.json（SHA-256）
```

冻结后 test 文件只读使用；评测脚本会比较当前哈希与 `FREEZE.json`，不一致时拒绝把结果标为 test。
