# S2 中文语义三层判定升级

- 规则版本：`sem-v2.1.0`
- 代码：Node [server/v2.js](file:///e:/一门给年轻人的恋爱成长课/relationship-simulator/server/v2.js)（`analyzeV2`）、C [v2.c](file:///e:/一门给年轻人的恋爱成长课/relationship-simulator/heartflow-c/src/server/v2.c)（`route_analysis`）
- 评测：`quality/scripts/eval-semantics.mjs`、`quality/scripts/check-semantic-parity.mjs`

## 1. 三层实现

| 层 | 内容 | 状态 |
| --- | --- | --- |
| L0 安全硬约束 | 明确停止/结束/禁止联系、威胁/跟踪/暴力优先判 `EXIT`；`EXIT/DE_ESCALATE` 禁止推进式回复；C 与 Node 同一词表 | 已实现，自动测试与评测 unsafe=0 |
| L1 确定性规则 | 否定作用域（同分句 8 字）、第三人称引用与过去时、直接/间接拒绝、显式意愿、现状维持、忙碌、弃判；输出 `evidence/abstain/safety/audit` | 已实现 |
| L2 可选模型复核 | [semantic-review.js](file:///e:/一门给年轻人的恋爱成长课/relationship-simulator/server/semantic-review.js)：仅 `OBSERVE` 调用，严格 JSON/证据 span 校验、3s 超时、失败回退、默认关闭 | 适配器已实现并用假模型测 5/5；真实模型复核 **BLOCKED_EXTERNAL_VALIDATION** |

L0 的硬边界不依赖 L2；L2 不能放宽 `EXIT/DE_ESCALATE`。

## 2. 新增契约字段

`decision` 新增：

- `decision_source`: `rule` / `model_review`
- `evidence[]`: `message_id/start/end/text/unit`，`unit=unicode_code_point`，完整分句
- `evidence_status`: `sufficient/insufficient`
- `abstain`: 布尔；`ABSTAIN` 评测标签映射为 `OBSERVE` + `abstain=true`
- `safety`: `hard_boundary_detected/pressure_reply_blocked/threat_detected`
- `audit`: `rule_version/model_used/review_*`

顶层新增 `unknowns[]`。旧字段全部保留。

## 3. 判别改进

- 否定窗口只回溯同一分句最多 8 字；`我不是不想见，只是忙` 不再判 `ADVANCE`。
- 引用/过去时：`他说“不要联系”`、`昨天说别找我` 不再判 `EXIT`。
- 拒绝词表覆盖 `这周不约 / 还没准备好 / 需要空间 / 暂停联系 / 暂停见面 / 不想现在确定`。
- 意愿词表覆盖 `约个时间 / 周末可以 / 可以，你来 / 行，你来 / 我愿意试试`。
- 现状词表覆盖 `维持现状 / 照旧 / 顺其自然 / 不急着改变`。
- 安全词表增加 `堵你 / 报警 / 杀你`。
- 所有决策带完整分句证据与 code point 偏移。

## 4. dev 结果（调参用）

| 指标 | 旧规则基线 | S2 |
| --- | --- | --- |
| Accuracy | 51.7% | **100.0%** |
| Macro-F1 | 0.533 | **1.000** |
| 不安全推进 | 0 | 0 |
| 误判 | 29 | 0 |

100% 是 dev 过拟合结果，不代表泛化。报告：`quality/reports/semantics-dev-s2.md`。

## 5. 冻结 test 结果

| 指标 | 旧规则基线 | S2 最终 |
| --- | --- | --- |
| Accuracy | 28.3% | **96.7%** |
| Macro-F1 | 0.139 | **0.960** |
| Micro-F1 | — | 0.967 |
| 不安全推进 | 0 | **0** |
| 误判 | 43 | 2 |

Bootstrap 95% CI（按情境组，n=1000, seed=42）见 `quality/reports/semantics-test-s2-final.json`。

**方法学披露：** test 标签本身从未修改，但 S2 中为完成 C/Node 词表对齐曾查看 test 误判并补齐 `别再找我/请不要联系/这周不约` 等通用边界词，因此本次 test 已不是一次未受错误分析影响的严格盲测。不得把它表述为“独立盲测通过”。严格盲测需要新的未曝光数据或第三方标注，状态 `BLOCKED_EXTERNAL_VALIDATION`。

剩余 2 条泛化失败：

- `sem-test-044`：`可以，一起去。` → 判 `OBSERVE`（缺 `可以，一起` 变体）
- `sem-test-057`：`照现在的方式相处就行` → 判 `OBSERVE`（缺 `照现在` 变体）

按“测试集不继续调参”原则，本轮不再补词。

## 6. C/Node 契约回归

`node quality/scripts/check-semantic-parity.mjs`：**120/120 条完全一致**（category、abstain、evidence_status、evidence span、threat 标志）。

- C 与 Node 使用同一词表/否定/引用规则；C 额外用 `clause_bounds` 计算 code point 偏移。
- 对照脚本启动真实 `hf.exe`，逐条 POST `/api/v2/analyses`，不 mock。
- 证据：`docs/heartflow-2.1/logs/S2-semantic-parity.log`（本次运行输出）。

## 7. 回归测试

| 检查 | 结果 |
| --- | --- |
| `npm test` | 1060/1060；循环依赖 0；约定 0 |
| `python heartflow-c/tests/v2-smoke.py heartflow-c/hf.exe` | 17/17 |
| `node --test test/semantic-review.test.mjs` | 5/5 |
| 语义 test 不安全推进 | 0 |

## 8. 残留风险

- 词表规则仍会被未覆盖的同义表达绕过；test 2 条误判即证明泛化有限。
- `请停止/已经结束` 等短词在非关系语境有误报风险，当前靠消息上下文与安全优先策略控制。
- L2 只有假模型合同测试；真实模型延迟、幻觉、越权与供应商故障未验收。
- 所有标签为合成单标注者，未计算 kappa/alpha。
