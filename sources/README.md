# Sources and Provenance

`sources/registry.yaml` 是来源登记表，不是事实准确性的替代品。每个来源必须记录用途、变换、许可证状态和运行时状态。

## 状态定义

- `allowed`：许可证和再分发范围已核验。
- `attribution_required`：可以使用，但必须保留署名/来源。
- `unclear`：目前无法确认，不得伪造许可证或版权结论。
- `not_redistributable`：只保留高层自写摘要或本地不可公开材料的书目描述。

默认运行时只读取 `references/curated/` 和本地 Core；`references/upstream/` 仅用于 provenance、历史比较和明确的知识审计。
