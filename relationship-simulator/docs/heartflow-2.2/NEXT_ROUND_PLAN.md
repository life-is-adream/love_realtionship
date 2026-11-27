# HeartFlow 2.2 BLOCKED 项下一步执行计划

日期：2026-11-15  
依据：`FINAL_ACCEPTANCE.md` 第 5 节、`EVALUATION_REPORT.md` 第 7 节  
原则：仍按“未执行 = BLOCKED、未达标 = FAIL”记录；本计划只描述解锁路径，不代表任何一项已通过。

## 0. 当前基线（执行本计划前必须保持不变）

| 项 | 当前值 | 校验方式 |
| --- | --- | --- |
| 自动测试 | 1066/1066 | `npm test` |
| E2E | 30/30 | `node scripts/e2e-heartflow-v2.mjs` |
| C/Node 一致性 | 1296/1296 | `node quality/scripts/check-retrieval-parity.mjs` |
| 域外弃答 | 20/21 | 同上 |
| 二进制 | `E79B0B33…F012E7C171B` | `Get-FileHash heartflow-c\hf.exe -Algorithm SHA256` |

任何阶段改动后，以上四项必须全部复跑；任一项回退即停止该阶段并回滚。

## 1. BLOCKED 清单与解锁条件

| 编号 | 阻塞项 | 当前证据 | 解锁条件 | 类型 |
| --- | --- | --- | --- | --- |
| B1 | 独立双人标注 / kappa / 冻结验收集 | 全部标签 `reviewed_by_human=false`；0 名标注者 | 2 名标注者完成 625 条，kappa≥0.60，仲裁完成，冻结哈希 | 外部资源 |
| B2 | 检索真实质量（绝对指标） | 独立集 R@5 31–35%，标签单人按标题判定 | B1 冻结集上出 R@5/MRR/nDCG + bootstrap CI | 依赖 B1 |
| B3 | 弃答仍 1/21 漏判、误拦未知 | 词表 + 阈值启发式 | 冻结集上域外弃答≥95%、域内误弃≤2% | 依赖 B1（开发集可先用候选） |
| B4 | 真实 embedding | `semantic` 是词面近似 | 本地离线向量模型接入，冻结集 R@5 提升≥5pp 且 CI 下界>0 | 外部资源 + 工程 |
| B5 | 真实重排器 | `hybrid_rerank` 恒回退 hybrid | 重排真实生效且优于 hybrid | 外部资源 + 工程 |
| B6 | 人工盲评（自然度/共情/角色一致性/边界） | 无评分者、无工具 | 2 人盲评 + ICC(2,k)≥0.60 | 外部资源 |
| B7 | 真实语音 / ASR | TTS 链路已有；ASR 代码不存在 | TTS 三引擎真机验收；ASR 需产品决策后新建 | 外部资源 / 产品决策 |
| B8 | 性能可信度 | 单用户串行 P95 46.7–49.7 ms | 索引缓存 + 20 并发压测 | 内部工程 |
| B9 | 真实供应商故障与成本 | 仅单次成功，无故障注入 | 429/5xx/超时/限额的确定性降级与预算上限 | 外部资源 + 工程 |

## 2. 阶段计划

### P0 人工标注与冻结（最高优先，唯一能解锁 B1/B2/B3/B6 的前提）

**前置**：确定 2 名标注者 + 1 名仲裁者；确认他们未参与 2.1/2.2 的检索调参。

**工作量**：语义 300 + 检索 200 + 独立场景 65 + 模拟 60 = 625 条 × 2 人。

**工具缺口（需先补，属内部工程）**：

1. [annotate-2.2.mjs](file:///e:/一门给年轻人的恋爱成长课/relationship-simulator/quality/scripts/annotate-2.2.mjs) 当前只读 `pending/{semantic,retrieval,practice}.json`，不含 `candidate-independent`。需支持第 4 个数据集（建议 id 前缀 `ret-ind-*`），并让 `--status` / `--iaa` 按数据集分组输出。
2. 检索标注需要“先改写成真实用户问法、再判相关性”两步，`--export` 的 CSV 增加 `rewritten_query`、`relevant_ids`、`confidence` 三列。
3. 新增 `quality/scripts/annotate-quality-2.2.mjs`：1–5 分量表盲评（自然度、共情、角色一致性、边界清晰度），随机顺序、隐藏系统来源，输出 `annotations/quality-<name>.jsonl`。
4. 新增 `quality/scripts/freeze-2.2-datasets.mjs`：把双人标注 + 仲裁结果合并为 `quality/datasets-2.2/frozen/*.json`，写入 `dataset_version`、`reviewed_by_human: true`、`annotation_status`、`iaa`，并生成 `FREEZE-2.2.json`（SHA-256）。可直接复用 [freeze-datasets.mjs](file:///e:/一门给年轻人的恋爱成长课/relationship-simulator/quality/scripts/freeze-datasets.mjs) 的结构。
5. 评测脚本增加强制校验：读 `frozen/` 时若哈希不匹配或 `reviewed_by_human !== true` 则 `exit 2`（照抄 [eval-retrieval.mjs](file:///e:/一门给年轻人的恋爱成长课/relationship-simulator/quality/scripts/eval-retrieval.mjs#L18-L24) 的写法）。

**执行顺序**：

1. 20 条校准样例（拒绝/暂停/模糊/无匹配各 5 条），只对齐口径。
2. 两人独立标注全量；禁止看对方标签与检索器排序。
3. `--iaa --a=alice --b=bob` 出 kappa；未达 0.60 的类别补培训后重标该类，不回改已冻结 test。
4. 仲裁分歧并保留原始冲突记录。
5. 冻结并计算哈希。

**验收门禁**：

| 门禁 | 门槛 |
| --- | --- |
| 语义 Cohen's kappa | ≥0.60 |
| 检索相关性 kappa | ≥0.60 |
| 模拟/质量 ICC(2,k) | ≥0.60 |
| 未裁决分歧 | 0 |
| 冻结文件哈希 | 评测脚本校验通过 |
| 标注者自述“未见过 test 标签” | 必须书面记录 |

**交付物**：`annotations/*.jsonl`、`iaa-*.json`、`frozen/*.json`、`FREEZE-2.2.json`、`docs/heartflow-2.2/ANNOTATION_REPORT.md`。

---

### P1 弃答 v2（B3）

**前置**：P0 的冻结检索集 + 单独的准备集。

**数据**：新建 `quality/datasets-2.2/abstain/{dev,frozen}.json`：各 100 条域内（覆盖全部课程主题）+ 100 条域外（生活/技术/闲聊/其他专业），域内标签必须来自 P0 冻结集或人工确认。

**三种候选方案，按成本从低到高**：

| 方案 | 做法 | 代价 | 判定 |
| --- | --- | --- | --- |
| A 词表+负例规则 | 扩领域词表，加入“换屏/修手机/写代码”等负例短语；顶分阈值网格 | 最低，C/Node 各一处 | 先做，必须达标 |
| B 本地线性分类器 | 字符 n-gram + logistic regression，离线训练，常驻内存 | 中；需 C/Node 双端同权重文件 | A 不达标时上 |
| C 向量相似度 | 依赖 P2 embedding，query 与课程最大余弦阈值 | 高；受 P2 阻塞 | P2 完成后再评估 |

**禁止**：在已冻结的 B1 验收集上调阈值；只能在 dev 上调，冻结集只跑一次。

**门禁**：域外弃答率 ≥95%；域内误弃率 ≤2%；C/Node 弃答决策 0 差异；`abstain_reason` 可区分 `no_domain_match` / `below_threshold`。

**交付物**：`quality/reports/2.2-abstain.{json,md}`、`quality/scripts/eval-abstain.mjs`、两端实现与 parity 用例。

---

### P2 真实 embedding（B4）

**前置决策（需你拍板）**：模型与运行形态。

| 选项 | 说明 | 优点 | 代价 |
| --- | --- | --- | --- |
| A 纯 Node ONNX | 本地小型中文向量模型 + onnxruntime | 不改 C、先验证收益 | 新增原生依赖；单二进制原则受影响 |
| B Python sidecar | 复用 `voice/` 的 sidecar 模式（`tts_server.py` 已证明可行） | 与现有架构一致、模型可换 | 多一个进程；需健康检查与回退 |
| C 云 API | 质量可能最好 | 无需本地模型 | 文本出本机、需密钥与成本，违反离线默认 |

**推荐顺序**：先 B（离线可换模型）验证收益 → 收益达标后再评估是否下沉到 C。

**实现步骤**：

1. `quality/scripts/build-embedding-index.mjs`：课程分块向量缓存，路径 `public/love-learning/embedding-index.json`，记录 `model_id`、`model_sha256`、每课 `body_sha256`、`dim`、`dtype`；课程正文变更即失效。
2. 新增模式 `semantic_v2` / `hybrid_v2`（不改现有 `semantic` 行为，保留回滚）；`hybrid_rerank` 仍单独存在。
3. 配置开关 `HF_EMBEDDING=off|sidecar`，默认 `off`；关闭时 `mode_effective` 必须回落并给 `fallback_reason=embedding_disabled`。
4. 一致性：浮点容差 1e-6 + 现有 `course_no` tie-break；不一致项必须可解释（模型版本、量化、归一化）。

**门禁**：

- 冻结独立集：`hybrid_v2` R@5 相对现 `hybrid` 提升 ≥5pp，bootstrap 95% CI 下界 >0。
- 引用错误 0；C/Node 排序一致率 ≥99.9%，其余差异逐条归因。
- 本地 P95 ≤300 ms（单用户）；索引构建可重复（同模型同输入同哈希）。
- 未达标则明确记 FAIL，不把新模式设为默认。

**交付物**：索引脚本、sidecar、两端实现、`quality/reports/2.2-embedding.{json,md}`、模型许可与来源记录。

---

### P3 真实重排器（B5）

**候选**：本地 cross-encoder（sidecar）优先；现有 LLM 重排仅作对照，需网络与成本预算。

**实现要点**：

1. 仅当重排真实执行时才允许 `mode_effective=hybrid_rerank`；否则维持 `fallback_reason=reranker_not_configured`。
2. 新增 `reranker_version`、`rerank_candidates`（送入重排的候选数）字段。
3. 重排只作用于 top-N（建议 20），结果可复现（同输入同输出，temperature=0 或确定性模型）。

**门禁**：相对 `hybrid` 的 R@5 提升 ≥3pp 且 nDCG@5 提升；P95 增量 ≤200 ms；否则保持回退并记 FAIL。

---

### P4 人工盲评（B6）

**数据**：100 条回复上下文（覆盖 EXIT/DE_ESCALATE/OBSERVE/ADVANCE/MAINTAIN 各 20）+ 60 段练习对话。

**流程**：2 名评分者独立打分；顺序随机、隐藏来源与模型；1 名仲裁；不允许看到系统自评分。

**门禁**：ICC(2,k) ≥0.60；每维度报告均值、方差与最低分案例；「不安全推进」出现 1 次即整批 FAIL。

**工具**：离线 HTML 盲评页（无网络请求）+ `annotate-quality-2.2.mjs` 导出/统计。

---

### P5 语音 / 视觉 / 供应商（B7、B9）

**TTS（已有实现，需真实验收）**：

1. 启动 sidecar（`voice/tts_server.py`），`GET /api/tts/health` 三引擎状态。
2. 复跑 `heartflow-c/tests/tts-parity.py`（8 组 WAV 逐字节）。
3. 真机播放 20 条最长/最短文本；断网时在线引擎回退 Kokoro 可用。
4. 门禁：三引擎健康、parity 通过、断网回退通过、无文本静默出网。

**ASR（当前代码库无实现）**：先做产品决策（是否需要用户录音转文字）。若做，单独开一轮：新路由、本地模型、麦克风权限与隐私说明、离线优先。

**视觉**：用真实模型跑 ≥30 张图片集（清晰/模糊/多语/表情包/长截图），校验只转写可见文字、`uncertain` 非空时前端提示；记录成本与失败率。

**供应商故障（B9）**：故障注入清单 429 / 500 / 超时 / 空响应 / 超长响应；要求确定性降级、不重试风暴、预算上限触发即停；密钥不写盘、不写日志。

---

### P6 性能与生产化（B8）

1. C 端索引与分块缓存：启动加载 + `mtime`/`sha256` 失效；`--no-cache` 用于对照；内存上限明确。
2. 新增 `quality/scripts/load-test-2.2.mjs`：20 并发 × 300 请求，三种模式各一轮。
3. 门禁：错误 0；P95 ≤150 ms；RSS 增长 <50 MB；冷启动 ≤1 s；缓存命中时结果与无缓存逐条一致（1296 项）。

---

## 3. 依赖与并行

```
P0 标注冻结 ──┬─→ B2 真实质量报告
              ├─→ P1 弃答 v2（dev 可先行，冻结集终验）
              ├─→ P2 embedding 终验
              ├─→ P3 重排终验
              └─→ P4 盲评
P5 语音/视觉/供应商：与 P0 并行（不依赖标注）
P6 性能：与 P0 并行（纯工程）
```

P0 是唯一的关键路径；P5、P6 可立即开始，不需要等任何外部资源。

## 4. 需要你拍板的决策

1. **标注人员来源**：内部两人 + 仲裁，还是外部标注？前者需书面确认未参与调参。
2. **embedding 形态**：Node ONNX / Python sidecar / 云 API（推荐 sidecar，默认离线）。
3. **ASR 是否立项**：当前代码库没有 ASR，属于新功能而非“解锁”。
4. **重排器形态**：本地 cross-encoder，还是接受网络与成本的 LLM 重排。

## 5. 每阶段不得宣称的内容

- P0 完成前：不得写“人工复核通过”，不得引用候选集 100% 作为质量结论。
- P2 达标前：不得把 `semantic_v2` 设为默认，不得对外称“已接入 embedding”。
- P3 达标前：`hybrid_rerank` 必须继续显式回退。
- P4 完成前：不得宣称自然度、共情或角色一致性达标。
- 任何阶段：不得用已曝光 test 调参；不得把 AI 标签冒充人工真值；不得隐藏 FAIL。

## 6. 里程碑检查表

| 里程碑 | 完成标志 | 状态 |
| --- | --- | --- |
| M0 标注工具就绪 | 4 个数据集可导出/记录/统计，CSV 含改写列 | 未开始 |
| M1 冻结验收集 | `FREEZE-2.2.json` + 评测脚本强制校验 | 未开始 |
| M2 真实质量报告 | 冻结集 R@5/MRR/nDCG + CI + 失败案例 | 未开始 |
| M3 弃答 v2 | 域外≥95%、域内误弃≤2%、双端一致 | 未开始 |
| M4 embedding 决策与验证 | 冻结集提升≥5pp 且 CI 下界>0，或明确 FAIL | 未开始 |
| M5 重排验证 | 相对 hybrid 提升≥3pp，或维持回退 | 未开始 |
| M6 盲评 | ICC≥0.60，无 unsafe 案例 | 未开始 |
| M7 语音/视觉 | TTS 三引擎 + parity + 断网回退；视觉 30 图 | 未开始 |
| M8 性能 | 20 并发 P95≤150 ms、错误 0 | 未开始 |
