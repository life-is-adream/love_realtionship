# HeartFlow 2.2 基线审计

日期：2026-11-15  
范围：2.2 第一轮（C/Node 检索统一 + 独立评测基础）  
原则：只做可复现验证；未执行标记 BLOCKED，未达标标记 FAIL。

## 1. 本轮读取的 2.1 资料

- [FINAL_ACCEPTANCE.md](file:///e:/一门给年轻人的恋爱成长课/relationship-simulator/docs/heartflow-2.1/FINAL_ACCEPTANCE.md)
- [03_COURSE_RETRIEVAL.md](file:///e:/一门给年轻人的恋爱成长课/relationship-simulator/docs/heartflow-2.1/03_COURSE_RETRIEVAL.md)
- [06_SECURITY_RELEASE_ROLLBACK.md](file:///e:/一门给年轻人的恋爱成长课/relationship-simulator/docs/heartflow-2.1/06_SECURITY_RELEASE_ROLLBACK.md)
- [server/v2.js](file:///e:/一门给年轻人的恋爱成长课/relationship-simulator/server/v2.js)
- [v2.c](file:///e:/一门给年轻人的恋爱成长课/relationship-simulator/heartflow-c/src/server/v2.c)
- [text.c](file:///e:/一门给年轻人的恋爱成长课/relationship-simulator/heartflow-c/src/text.c)
- `quality/scripts/` 全部脚本

未读取、未输出、未提交 `.env` 或任何密钥文件；本轮所有命令均不加载真实模型密钥。

## 2. 改动前源码快照

快照目录：`docs/heartflow-2.2/snapshots/`

| 文件 | 快照 | SHA-256 |
| --- | --- | --- |
| `server/v2.js` | `v2.node.pre-2.2.js` | `D2A5D67C4C58EEC3A86B9877C4719A205BAAFD43F6EA131D07F360FB2D876704` |
| `heartflow-c/src/server/v2.c` | `v2.c.pre-2.2.c` | `967A1666CBF90AE065A595ED19E03E256DC8DFCB180A8708C59A943280B14BED` |
| `heartflow-c/src/text.c` | `text.c.pre-2.2.c` | `6AE78DB2E3B23E1A821ABB60E8C8753FFFC7C15A72AB43B47500BE9B9F3180DA` |
| `quality/scripts/check-retrieval-parity.mjs` | `check-retrieval-parity.mjs.pre-2.2` | `2CF02D3A2E50E2F7167F28B91B82B2BD7B278A157D18C34CAB1ED2C226BD58AF` |

## 3. 改动前基线（实际运行）

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| Node 单元测试 | `npm test` | 1065/1065 通过，循环依赖 0、规范 0 |
| C/Node bm25 检索一致性 | `node quality/scripts/check-retrieval-parity.mjs` | 120/120 一致 |
| C 服务形态 | `package.json` | `npm start` = `heartflow-c\hf.exe serve`，默认生产路径是 C |
| C 语义/混合检索 | 读 `v2.c` | 非 bm25 模式直接降级为 bm25，`fallback_reason=c_semantic_index_unavailable` / `c_reranker_unavailable` |

结论与 2.1 交接报告一致：**默认生产路径（C）没有字段加权、分块检索、概念扩展与 RRF 融合**，Node 的 `semantic/hybrid` 收益没有进入产品。

## 4. 环境与版本

- Node：v24.16.0
- C 编译器：ziglang 0.17.1（`python -m ziglang cc`，`-O2 -std=c11`）
- 构建：`D:\Git\bin\bash.exe ./build.sh hf.exe`
- 课程索引：179 门课、`public/love-learning/manifest.json`、正文位于 `public/love-learning/courses/NNN.md`
- 2.1 评测数据已被错误分析使用，**不是严格盲测**；本轮不据此宣称泛化能力。

## 5. 本轮前已知边界

1. 2.1 的 `semantic` 是“概念扩展 + 字段/分块 BM25”，不是 embedding。
2. 2.1 的 `hybrid` 用 RRF（k=30，权重 0.6/1.2），test Recall@5 53.3%，略低于 semantic 的 53.6%。
3. 旧 test 集已曝光，不能作为 2.2 的泛化证据。
4. 2.1 的人工盲评、真实语音、真实 embedding 均为 BLOCKED；本轮不改变这些阻塞状态。
5. 本轮开始前，Node 源码没有 2.1 起点的版本快照（2.1 报告已记录）；本轮已补本快照。

## 6. 复现命令

```powershell
npm test
node quality/scripts/check-retrieval-parity.mjs
node quality/scripts/eval-retrieval.mjs --split=test --mode=hybrid
```
