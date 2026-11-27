# S3 179 课分块与混合检索

- 代码：Node [server/v2.js](file:///e:/一门给年轻人的恋爱成长课/relationship-simulator/server/v2.js)（`recommendCourses`）
- 索引：`public/love-learning/semantic-index/index.json`（179 门 / 889 块 / 234,948 bytes）
- 评测：`quality/scripts/eval-retrieval.mjs`、`quality/scripts/check-retrieval-parity.mjs`

## 1. 索引与分块

- 179 个 Markdown 课程文件全部索引，0 缺失。
- 按 Markdown 标题与段落切分，目标块约 280 字；每块含 `id/section/line_start/line_end/text/length`。
- 课程记录含 `body_sha256`，可检测正文漂移。
- 运行期 Node 仍从真实 Markdown 读取正文并计算分数，索引用于审计、引用与体积基线；不做网络或数据库依赖。

## 2. 四种模式

| 模式 | 实现 | 说明 |
| --- | --- | --- |
| `bm25` | 标题+目标+正文 BM25（`k1=1.2,b=0.75`） | 保持 2.0 旧路径，作为基线 |
| `semantic` | 字段加权 BM25 + 概念扩展 BM25×2 + 分块最高分×0.8 | 本地语义近似；**不是神经网络 embedding** |
| `hybrid` | 旧 BM25 排名与 semantic 排名 RRF（k=30，权重 0.6/1.2） | 默认混合 |
| `hybrid_rerank` | 未配置重排器 → 回退 `hybrid` | 响应显式 `fallback_reason=reranker_not_configured` |

概念扩展覆盖 58 组稳定领域概念（如 压力→情绪/支持/倾听、婆媳→父母/家庭/边界、出轨→信任/修复/边界），只对 `semantic/hybrid` 生效，`bm25` 词表不变。

## 3. 冻结 test 结果（实际运行）

| 模式 | Recall@1 | Recall@3 | Recall@5 | Recall@10 | MRR@5 | nDCG@5 | 引用错误 | 零结果率 | P95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bm25 | 19.4% | 36.1% | **41.4%** | 50.6% | 0.439 | 0.357 | 0 | 3.3% | 67.9 ms |
| semantic | 30.6% | 45.6% | **53.6%** | 62.2% | 0.644 | 0.510 | 0 | 0% | 67.0 ms |
| hybrid | 29.4% | 44.7% | **53.3%** | 61.7% | 0.595 | 0.485 | 0 | 0% | 69.4 ms |
| hybrid_rerank | 29.4% | 44.7% | **53.3%** | 61.7% | 0.595 | 0.485 | 0 | 0% | 66.9 ms |

- Semantic 相对 bm25：Recall@5 **+12.2 个百分点**；Hybrid **+11.9 个百分点** → 达到 ≥10pp 门槛。
- 引用有效性：`validCitationRate=1.0`，0 个错误；每个返回课程都有 `citation.path/line_start/line_end/quote`，评测会打开文件核对 quote 是否在行范围内。
- 零结果：semantic/hybrid 为 0；bm25 有 2/60 个零结果。
- 时延：单机热进程 P95 约 67–69 ms，未做并发压力测试。

dev 结果：bm25 59.7%、semantic 64.4%、hybrid 65.8%。dev 用于调 RRF 参数。

## 4. C/Node 一致性

- `node quality/scripts/check-retrieval-parity.mjs`：**bm25 排序 120/120 完全一致**。
- C 端对 `semantic/hybrid/hybrid_rerank` 明确降级为 bm25，返回 `mode_requested`、`mode_effective="bm25"`、`fallback_reason="c_semantic_index_unavailable"`（rerank 为 `c_reranker_unavailable`）。
- 影响：**`npm start` 运行的 C 服务仍只有 bm25 召回**；semantic/hybrid 的 +12pp 只在 Node 参考实现与质量评测中生效。这是本轮最大的功能落差，不能宣称 C 生产路径已获得混合检索收益。
- 未实现 C 端概念扩展/分块评分，是为了避免在无法逐条对齐时伪造一致；降级与影响已写入响应和本文档。

## 5. 方法学与边界

- 检索 query 与 relevance 均为原创合成、单一实现者标注，`reviewed_by_human=false`，未做独立相关性判定。
- test 集在 S2/S3 迭代中被用于错误分析与 C/Node 词表对齐，**不是严格盲测**；不得外推为真实用户 Recall。
- 未实现真实本地 embedding：本机无离线中文 embedding 模型，下载模型需要额外授权。因此 `semantic` 是“概念扩展 + 字段/分块 BM25”的本地近似，不是向量语义检索。真实 embedding 验收状态 `BLOCKED_EXTERNAL_VALIDATION`。
- RRF 权重、概念表与分块大小只在 dev 上调过；test 只做最终报告。
- 引用能打开到真实行范围，但不保证该段落是最佳教学段落；仍需人工判断。

## 6. 复跑

```powershell
npm run quality:index
npm run quality:validate
node quality/scripts/eval-retrieval.mjs --split=test --mode=bm25
node quality/scripts/eval-retrieval.mjs --split=test --mode=semantic
node quality/scripts/eval-retrieval.mjs --split=test --mode=hybrid
node quality/scripts/eval-retrieval.mjs --split=test --mode=hybrid_rerank
node quality/scripts/check-retrieval-parity.mjs
```

报告：`quality/reports/retrieval-test-*-2.1.{json,md}`。
