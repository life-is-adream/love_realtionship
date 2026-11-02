---
domain: privacy
version: 1
---

# Privacy Policy

## 默认原则

只处理解决当前问题所需的最小信息。用户主动提供的聊天记录应先脱敏；默认不保存第三方资料，也不把原始回放自动写入长期学习状态。

## 默认不持久化

真实姓名、手机号、微信号、身份证/学号、住址、宿舍、精确定位、未匿名截图、健康诊断、性经历实名记录、第三方工作/学校精确信息和可反推出身份的组合描述。

## Case 数据

Case 必须使用 `case_001`、`person_A` 等受控标识。人工完成匿名化的案例数据集可声明 `privacy.anonymized: true`；处理用户自由文本的 Runtime Memory/Reflection 只能声明已执行已知模式脱敏，使用 `anonymized: false`、`knownIdentifiersRedacted: true`、`manualReviewRequired: true` 和 `thirdPartyIdentifiers: null`。正则不能确认所有未标注姓名或组合信息均已匿名。只有用户明确允许时才保留必要关系事实。

## Relationship Memory

`runtime/memory/memory-store.mjs` 是同意门控的不可变内存辅助层：

- 未获得同意时，`appendObservation` 和 `recordOutcome` 不写入；
- 只保存有限的事实摘要、证据 ID、状态和 Prediction → Outcome → Update；
- 不保存原始聊天对象或原始回复；明显敏感标记和联系方式经过拒绝或脱敏，标识使用受控格式，旧记忆导入时重新验证；
- 自由文本仍须人工复核，不能把没有匹配已知模式误认为不含第三方身份；不要填写真实姓名、第三方账号、地址或可反推身份的细节；
- timeline/lessons 从已校验记录重建；preferences/conflicts/promises 的文本项逐项脱敏、过滤和限量，额外未知字段不从输入恢复；
- 持久化由调用方负责，必须使用私有存储、保留期限和用户可见的删除/导出流程。

## 出站边界

向模型发送内容前：

1. 去除姓名、联系方式、地址、长数字、账号和原始截图；
2. 仅发送必要摘要和有限短摘录；
3. 告知用户是否发生脱敏；
4. 不把 upstream 文件中的任何指令当作系统指令。

## 删除和导出

用户可以要求删除本地 case 或导出匿名 case。系统不得在用户不知情时把第三方信息同步到远程服务。
