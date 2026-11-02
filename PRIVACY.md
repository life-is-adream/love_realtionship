# Privacy

本项目默认采用本地优先、最小必要、可撤回和匿名化原则。

## 不默认保存

第三方真实姓名、手机号、微信号、身份证/学号、地址、宿舍、精确定位、未匿名截图、健康诊断、性经历实名记录和可识别工作/学校组合。

## Profile 与 Case

真实 profile 只能放在本地未跟踪的 `.agents/skills/relationship-coach-cn/profiles/private-profile.md`。Case 使用 `case_001`、`person_A` 等受控标识。人工匿名化的数据集可声明 `privacy.anonymized: true`；用户自由文本仅经过已知模式脱敏，Runtime Memory/Reflection 使用 `anonymized: false`、`knownIdentifiersRedacted: true`、`manualReviewRequired: true`、`thirdPartyIdentifiers: null`。规则不能证明任意姓名或组合信息已经匿名；不要填写第三方个人信息。没有用户明确许可，不持久化关系复盘或原始聊天。

HeartFlow 的 Relationship Intelligence 结构化复盘记忆默认关闭。未同意时，本地分析结果只在当前页面会话中显示，写入 localStorage 前会移除 `lastResult` 和 `memory`；明确同意后才保存 `case_` 受控标识和 runtime 校验、脱敏后的观察摘要，旧 memory 导入时重新校验。关闭同意会清除该结构化 memory。手工填写的角色设定用于模拟角色，不等同于 runtime 已确认的关系事实。

## 模型出站

发送到模型前去除联系方式、长数字、地址和原始截图，只发送必要摘要和有限短摘录，并在界面/响应中说明脱敏命中。用户可以拒绝发送，也可以要求删除本地 case。

`POST /api/relationship-intelligence` 只调用本地确定性 runtime，不访问远程模型。`POST /api/chat` 可转发模型请求；用户点击“联网查依据”时，`POST /api/search` 也可调用外部搜索服务或已配置的 MiMo 模型搜索。搜索按钮只从固定阶段和能力维度构造公开查询，不发送聊天原文或教材；始终检查引用 URL 和域名白名单，域名符合政策不表示页面观点已核验。取消、关闭或切换上下文使旧搜索失效。模型搜索复用服务端 LLM 配置，外部搜索独立使用 SEARCH 配置；配置密钥不向响应回显。

## 公开仓库

根 `.gitignore` 排除 `.env`、视频、书籍、OCR 依赖、备份目录和私有 profile。公开仓库仍可能包含经过改写的课程和转录文本；其来源/再分发状态见 `sources/registry.yaml`，不要将公开可见误解为第三方材料已获授权。

## 安全升级

暴力、胁迫、跟踪、性侵风险、自杀威胁控制关系等情况优先停止推进、保护必要证据并联系当地紧急/专业支持；不要把安全风险写成恋爱技巧。
