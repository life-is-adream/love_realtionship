# Privacy

本项目默认采用本地优先、最小必要、可撤回和匿名化原则。

## 不默认保存

第三方真实姓名、手机号、微信号、身份证/学号、地址、宿舍、精确定位、未匿名截图、健康诊断、性经历实名记录和可识别工作/学校组合。

## Profile 与 Case

真实 profile 只能放在本地未跟踪的 `.agents/skills/relationship-coach-cn/profiles/private-profile.md`。Case 使用 `case_001`、`person_A` 等匿名标识，且 `privacy.anonymized` 必须为 `true`。没有用户明确许可，不持久化第三方资料或原始聊天。

HeartFlow 的 Relationship Intelligence 匿名结构化记忆默认关闭。未同意时，本地分析结果只在当前页面会话中显示，写入 localStorage 前会移除 `lastResult` 和 `memory`；明确同意后才保存 `case_` 匿名标识和 runtime 校验过的观察摘要。关闭同意会清除该结构化 memory。手工填写的角色设定用于模拟角色，不等同于 runtime 已确认的关系事实。

## 模型出站

发送到模型前去除联系方式、长数字、地址和原始截图，只发送必要摘要和有限短摘录，并在界面/响应中说明脱敏命中。用户可以拒绝发送，也可以要求删除本地 case。

`POST /api/relationship-intelligence` 只调用本地确定性 runtime，不访问远程模型；`POST /api/chat` 才是模型出站边界。两个接口不得共享或回显 API Key。

## 公开仓库

根 `.gitignore` 排除 `.env`、视频、书籍、OCR 依赖、备份目录和私有 profile。公开仓库仍可能包含经过改写的课程和转录文本；其来源/再分发状态见 `sources/registry.yaml`，不要将公开可见误解为第三方材料已获授权。

## 安全升级

暴力、胁迫、跟踪、性侵风险、自杀威胁控制关系等情况优先停止推进、保护必要证据并联系当地紧急/专业支持；不要把安全风险写成恋爱技巧。
