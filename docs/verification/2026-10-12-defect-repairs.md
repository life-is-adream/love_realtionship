# 缺陷修复与回归验收

> 后续运行状态：用户授权后，实际 3000 服务已于2026-10-12完成重启并通过12项 HTTP 核查，见[服务重启记录](/E:/一门给年轻人的恋爱成长课/docs/verification/2026-10-12-service-restart.md)。下文“未重启”描述保留本轮代码修复结束时的历史状态。

开始：2026-10-11；完成：2026-10-12，Asia/Shanghai。工作区：`E:\一门给年轻人的恋爱成长课`，基线 `main` / `6a225ac`。原有五个未提交文件继续保留，没有 Git 提交、依赖新增、真实上游调用或用户服务重启。

## 结论

**2026-10-11 复盘中的 R1—R5、S1—S4 九项实现缺陷已修复，新增失败回归证明修前问题可复现；最终应用 735/735、Runtime 43/43 通过。另修复了实际界面中“已经退出，旧长期路线仍建议继续推进”的整合缺陷。**

这是本地代码和软件回归验收，不是远程模型效果、完整自然语言理解、完全匿名化或真实关系效果认证。原 3000 服务未重启；已运行服务持有的后端模块需要重启后加载新实现，前端需要刷新。测试使用独立临时服务，未停止用户服务。

## 修复与可验证行为

| 原问题 | 修后行为 | 主要回归 |
| --- | --- | --- |
| R1：明确拒绝被旧计划覆盖 | 明确停止联系、自主退出、关系结束与安全信号优先；拒绝不因旧 counterOffer/datePlan 推进；暂时停聊降级但不强判永久退出 | Runtime agent-loop/state-machine，以及产品 API/旅程测试 |
| R2：敏感记忆字段穿透 | observation/outcome/prediction/evidence ID 受控校验；全部文本统一拒绝明显敏感标记或脱敏；旧记忆重建，不信传入 privacy；安全偏好/冲突/承诺逐项保留 | memory-store、reflection 与产品 API 测试；空格账号标签回归 |
| R3：自由文本冒称已匿名 | direct goal 脱敏；Reflection 验证 prediction/outcome/nextTest；自由文本明确 `anonymized:false`、`manualReviewRequired:true`，已知标识处理范围单独声明 | Reflection/Memory 测试；Schema 与真实 privacy 对象核对 |
| R4：新观察被误去重 | 用规范消息与规范布尔信号的内容指纹区分事件；新文本/信号保留新摘要，同一请求重试不重复观察或再次推进状态 | 同消息数、新信号、重试幂等与 API 回归 |
| R5：分手场景奖励再邀约 | 明确结束场景对直接/迂回再邀约不给边界或推进奖励，反馈尊重退出与恢复；其它练习仍使用原场景评分 | 原句、下周有空/明天咖啡/今晚吃饭、尊重退出和否定再联系 |
| S1：来源冒称权威 | 两搜索引擎始终域名白名单；返回 `sourcePolicy:allowlist`；UI 只称参考来源；无合格引用不透出未核验模型摘要 | 默认/显式白名单、子域名伪装、全过滤、无引用回归 |
| S2：危险/模糊链接 | 前后端仅允许明确的绝对 HTTP(S)，拒绝 userinfo、危险协议、空 authority、反斜杠、控制字符和模糊 URL | javascript/data、空 userinfo、三斜杠、换行等边界回归 |
| S3：Responses 配置被错误使用 | MiMo 模型搜索目前只支持 Chat Completions；Responses/冲突配置 dispatch 前受控 `503 search_api_mode_unsupported`，未知成功形状受控 502 | 模式/端点冲突、零 dispatch、响应结构测试；外部引擎独立可用 |
| S4：旧搜索覆盖新结果 | AbortSignal 贯穿 fetch；同目标后发替代先发；关闭、重渲染、导航、角色/上下文变化取消并禁止旧成功/错误写回 | 实际 renderer、真实 app 函数、不同通道隔离与上下文测试 |
| 补充整合：退出后仍显示路线 | EXIT 后显示停止推进，禁用生成计划，取消已在运行的计划，迟到模型计划不能复活继续联系建议 | 新 action-plan-boundary 测试及实际浏览器走查 |

R1 校准覆盖已证实的普通饮食/时间偏好、暂停时态、否定句、翻译/虚构/明确第三方讨论和单纯带引号的直接拒绝。仍是有限词法规则，不声称穷尽所有说法；含混语境应由用户核对实际意愿与安全事实。

## 隐私与接口变化

- Memory/Reflection 用户自由文本改为 `anonymized:false`、`knownIdentifiersRedacted:true`、`manualReviewRequired:true`、`thirdPartyIdentifiers:null`、`anonymizationScope:known_patterns_and_controlled_identifiers`。两个 schema、隐私文档和 UI 同步；人工匿名化的静态案例契约仍独立保留。
- 明显敏感 ID 记录会被拒绝，evidence ID 逐项过滤；含敏感标签的 summary/prediction/observedOutcome 被拒绝；update 敏感值置空、lessons 逐项过滤。`微信 ID`、`Wechat ID`、`QQ 号`、`Weixin number` 也已覆盖。
- timeline/lessons 从有效记录重建；额外未知字段不导入。偏好/冲突/承诺的安全文本经过过滤和限量后保留。默认未同意不新增记录，产品 API 未同意不返回 memory patch；关闭同意仍清除浏览器结构化记忆。
- 内容摘要用于去重，不能视为加密或完整匿名证明；未标注姓名和组合身份信息仍须人工复核，不应填写第三方个人信息。
- 搜索不支持 Responses 时受控拒绝，**主聊天的 Responses 支持保持原有范围**。外部搜索使用独立 SEARCH 配置；模型搜索复用 LLM 配置。密钥不向响应回显。
- UI 搜索仅从阶段和能力维度的固定枚举构造公开查询，未把模型任意文本、聊天原文或教材加入查询。

## 最终验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 应用完整 `npm.cmd test` | 735/735，0 fail / cancelled / skipped，exit 0；原基线 703 | `simulator-final.log` |
| Runtime 全部测试 | 43/43，0 fail / cancelled / skipped，exit 0；原基线 22 | `runtime-final.log` |
| 定向整合 | 首轮 80/80；退出计划与请求生命周期补充 18/18 | `integration-green.log`、`exit-plan-green.log` |
| 静态 Evals，临时副本 | 190 条、16 类 PASS，0 failures；没有模型生成/评分 | `static-evals.log` |
| 课程/Automation，2026-10-11 | PASS，179课完整连续，当天唯一课件与发送记忆记录 | `course-2026-10-11.log` |
| 跨日课程检查，2026-10-12 | 179课完整连续，第87课唯一匹配；PASS_WITH_WARNINGS，仅缺当天发送 memory 证据；未发课/补日志 | `course-2026-10-12.log` |
| 模块图 | 91 模块，0 个已发现循环 | `module-graph.log` |
| JS/MJS 与内联脚本语法 | 114 模块/脚本文件 + 2 非外链 HTML 脚本，0 failures | `syntax.log` |
| privacy 元数据合同 | 两种真实 privacy 输出字段、required/const/null 与相应 schema 一致 | `privacy-schema.log` |
| `git diff --check` | exit 0，仅 Windows 换行提示 | `diff-check.log` |
| 实际浏览器 | EXIT/state EXIT；计划禁用；同意默认关闭；无 key 搜索受控失败；移动端无横向溢出；观察到的 console errors 为 0 | `ui-smoke.json` |

所有修前 red 日志与后续 green 日志保留于 [修复证据目录](/E:/一门给年轻人的恋爱成长课/docs/verification/2026-10-12-defect-repairs)。初次全量曾因 UI 文案遗漏“不保存原始聊天”而 734/735；补回该明确承诺后最终 735/735，没有跳过或放松该断言。

浏览器使用最终 Runtime 的新进程、当前 public 代码、新 origin 和合成退出消息。临时配置禁止读取真实 dotenv，上游 fetch 全部禁止；搜索无密钥在 dispatch 前失败。390×844 配置的实际页面宽度观察为391、clientWidth/scrollWidth均376，无横向溢出。临时服务和标签页结束后关闭，viewport 恢复，原服务不受影响。

课程、书籍、转录和教材源码未改；179课副本/19份书/10章构建一致性沿用前一轮已保存证据，本轮另复验课程完整性。没有借修复任务重新生成课程或构建产物。

## 范围与剩余事项

实际生产改动集中在 Runtime 的决策/观察/存储/反思/场景，搜索前后端、请求 scope、退出时的计划展示；同步了 schema、隐私文字、README 和 ADR 当前说明。原始审计报告作为修前快照保留，实施计划见 `docs/superpowers/plans/2026-10-11-regression-defect-repairs.md`。未改课程、Automation 配置/发送记忆、`.env`、启动/停止脚本或端口访问权限。

以下不是本轮代码修复能证明的完成项：真实模型与搜索插件联调、任意自然语言准确识别、自由文本完全匿名、书籍版权授权/来源登记完整性、局域网访问范围核定、历史发送逐会话证据、医学法律资料当前时效、真人学习与关系结果。原报告的这些证据缺口仍保留；不伪造模型分数、发送记录或授权。

当前旧 3000 服务需要在合适时机重启才能加载后端修复；用户未要求部署或中断正在使用的服务，本轮未代为停止。无需 `npm install`，没有新增依赖。没有独立 TypeScript、lint 或应用打包命令；以实际 JS 语法、模块图、单元/HTTP、schema 元数据和浏览器检查验收，只验证本机 Node v24.16.0。
