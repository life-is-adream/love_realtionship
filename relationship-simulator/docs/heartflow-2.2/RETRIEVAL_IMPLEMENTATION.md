# HeartFlow 2.2 C/Node 检索实现统一

- 生产入口：`npm start` → `heartflow-c\hf.exe serve`
- Node 参考实现：[server/v2.js](file:///e:/一门给年轻人的恋爱成长课/relationship-simulator/server/v2.js)（`recommendCourses`）
- C 实现：[v2.c](file:///e:/一门给年轻人的恋爱成长课/relationship-simulator/heartflow-c/src/server/v2.c)（`route_courses`）
- 分词：`server/v2.js` 的 `retrievalKeywords` ↔ [text.c](file:///e:/一门给年轻人的恋爱成长课/relationship-simulator/heartflow-c/src/text.c) 的 `hf_retrieval_terms`

## 1. 统一的检索规则

| 环节 | 规则（两端一致） |
| --- | --- |
| 查询词 | 锚点整词（最多 24 个）→ `约会` 领域词 → 26 组同义扩展 → 中文字符二元组；上限 24，顺序固定 |
| 文档文本 | `title + " " + goal + " " + body` |
| 文档长度 | `chars(title + " " + goal + " " + body)`（与 Node 一致） |
| BM25 | `k1=1.2`、`b=0.75`，`idf=ln(1+(N-df+0.5)/(df+0.5))`，`df=0` 不计分 |
| 字段加权 | `title×3 + goal×2 + body`，长度按 `3·chars(title)+2·chars(goal)+chars(body)` |
| 概念扩展 | 57 组稳定领域概念（压力→情绪/支持/倾听 等），最多 24 个，仅 semantic/hybrid 生效 |
| 分块 | 按 Markdown 标题切段；每段按 UTF-8 码点，步长 320、窗口 420，片段长度 ≥20；块文本 = `title + " " + goal + " " + 片段` |
| 分块得分 | 每课取 `max(chunk) + 0.25 × sum(top3)` |
| semantic 得分 | `field + concept×2 + passage×0.8` |
| hybrid | `rank_bm25` 权重 0.6、`rank_semantic` 权重 1.2，`score += w/(30+rank)` |
| tie-break | 分数降序；分数相同按 `course_no` 升序 |
| 引用 | 在命中课程正文中找分块段落：按词频×词长选出最佳章节，返回 `path/section/line_start/line_end/quote` |
| 降级 | `hybrid_rerank` 无重排器 → `mode_effective=hybrid`、`fallback_reason=reranker_not_configured` |
| 弃答 | 查询不含任何课程领域词（209 词表）且 BM25 顶分 `< 8` → 返回 `courses: []`、`abstained: true`、`abstain_reason: "no_domain_match"` |
| 错误 | 空查询 400 `invalid_query`；limit 越界 400 `invalid_limit`；索引缺失 503 `course_index_missing`；索引损坏 503 `course_index_invalid` |

`bm25` 模式的查询词表、文档文本与 2.1 完全相同，旧行为保留（弃答门禁只在“无领域词 + 低分”时触发，历史 120 条查询 0 触发）。

## 2. C 侧实现要点

- `SEMANTIC_CONCEPTS[]`：与 Node `SEMANTIC_CONCEPTS` 逐条同序。
- `concept_terms()`：与 Node `conceptTerms` 同样的去重与 24 上限。
- `bm25_scores()`：文档级与分块级共用，`df/idf/长度归一化` 与 Node 公式一致。
- `build_doc_chunks()` / `flush_chunks()`：按标题切段、码点切片，块长按 Node 口径计算。
- `best_passage()`：按章节统计词频×词长，返回真实行号区间；`quote` 去标题行、折叠空白、截 120 码点。
- `rank_indices()` 与 RRF 排序都实现了确定性的 `course_no` 升序 tie-break。
- `COURSE_DOMAIN_TERMS[]` / `course_query_in_domain()`：与 Node `COURSE_DOMAIN_TERMS` / `inCourseDomain` 同表同序（209 词，含子串匹配），在排序后、截断前判断是否弃答。
- 响应字段：`source`、`mode_requested`、`mode_effective`、`fallback_reason`、`index_version`、`courses[].citation`、`abstained`、`abstain_reason`。

## 3. 真实一致性验证

脚本：[check-retrieval-parity.mjs](file:///e:/一门给年轻人的恋爱成长课/relationship-simulator/quality/scripts/check-retrieval-parity.mjs)

覆盖：

- 2.1 历史 dev/test 共 120 条查询 × 4 模式；
- 2.2 待标注候选 200 条 × 4 模式；
- 边界：空白查询、未知词、标点、长混合查询；
- 同分排序重复请求稳定性；
- 异常：空查询、非法 limit、索引缺失、索引损坏；
- 弃答等价：每条的 `abstained` 必须与 Node 一致，并统计 21 条域外查询的弃答数；
- 每条 C 结果都回读真实 Markdown，校验 `line_start/line_end` 区间内确实包含 `quote`。

实际结果（本轮）：**dev 240/240、test 240/240、2.2 候选 800/800、边界与异常 16/16，合计 1296/1296 一致，引用错误 0；域外弃答 20/21**。日志：`quality/reports/retrieval-parity-2.2.log`。

复跑：

```powershell
node quality/scripts/check-retrieval-parity.mjs
```

## 4. 已知限制

1. `semantic` 仍是词面 + 预置概念的本地近似，不是神经网络 embedding；真实 embedding 为 **BLOCKED**。
2. C 端每次请求重新读取 179 个 Markdown 并构建分块，未做常驻索引缓存；延迟见评测报告。
3. 概念表与 RRF 参数来自 2.1 dev 调试；2.1 test 已曝光，不能据此宣称泛化。
4. 引用只保证行号与原文一致，不保证该段落是最佳教学段落。
5. C 端未实现 `hybrid_rerank` 的重排器，只做显式回退，不隐瞒降级。
6. 弃答是启发式门禁（领域词表 + 顶分阈值），不是分类器：域外 21 条中仍有 1 条未弃答（「更换手机屏幕」，因含领域词「手机」）；领域词表也可能漏掉新词。

## 5. 回滚

```powershell
# 回到 2.1 源码（本轮快照）
Copy-Item docs\heartflow-2.2\snapshots\v2.c.pre-2.2.c heartflow-c\src\server\v2.c -Force
Copy-Item docs\heartflow-2.2\snapshots\text.c.pre-2.2.c heartflow-c\src\text.c -Force
D:\Git\bin\bash.exe ./build.sh hf.exe   # 工作目录 heartflow-c
```

C 二进制回滚见 `FINAL_ACCEPTANCE.md` 第 6 节。
