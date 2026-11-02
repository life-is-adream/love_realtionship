# 全项目复盘与回归测试

> 修复状态更新：报告中的九项实现缺陷已于2026-10-12完成本地修复与回归；本文件保留修前审计结论和复现证据。当前状态见[修复验收](/E:/一门给年轻人的恋爱成长课/docs/verification/2026-10-12-defect-repairs.md)。

日期：2026-10-11，Asia/Shanghai。审计对象：`E:\一门给年轻人的恋爱成长课` 当前工作区，`main` / `6a225ac`，包含原有 5 个未提交文件。运行环境：Node v24.16.0，npm 11.16.0。

## 结论与完成条件

**复盘和回归任务已完成。既有自动化回归全部通过，但补充探针复现了 9 项实现缺陷，因此本次不作全项目验收通过结论。优先修复拒绝处理和匿名记忆字段校验。**

本次成功标准是核实内容资产、应用与共享 Runtime、自动化契约、构建一致性和可观察的界面行为，保留可复核证据，区分文件完整、软件行为与现实效果。本次只新增这份报告和证据文件；未修改产品源码、课程、来源登记、自动化配置或发送记忆，未提交 Git，未发课，未调用真实模型或搜索服务。

## 项目复盘

项目已从课程资料集合形成四层体系：179 节预生成课程和书架；证据、边界、决策与复盘 Skill/Runtime；HeartFlow 对话、每日训练、连续约会、现实互动复盘和知识卡；按上海日期读取既有文件的日常自动化。当前资源包括 33 份视频转录条目、19 份整合阅读资料、10 章长篇教材及 123 个复盘点，补充知识区有 14 张卡、15 项显示来源。

值得保留的成果是：课程与阅读副本完全一致；规则功能可本地使用；现实复盘区分行动、回应、自身感受和未知；拒绝与自主退出在已走查的现实复盘/连续约会界面得到尊重；匿名保存默认关闭；工程已有状态事务、请求归属、懒加载、统一 HTTP 错误边界和进程归属校验。

主要短板是各层没有完整共享相同契约。界面的退出规则正确，不代表底层 Runtime 也正确；已存在的请求取消机制没有覆盖新增搜索；来源文案和隐私声明比代码实际保障更强。下一轮应以这些具体缺陷为修复对象，补充能失败的边界回归，再推进在线模型质量和真实使用评估。继续增加课程数量不能替代这些工作。

## 实际验证结果

| 范围 | 本次结果 | 证据文件 |
| --- | --- | --- |
| HeartFlow 完整 `npm.cmd test` | 703/703，0 fail / skipped / cancelled，exit 0 | `simulator-tests.log` |
| 共享 Runtime，6 个测试文件 | 22/22，0 fail / skipped / cancelled，exit 0 | `runtime-tests.log` |
| Static eval，脚本与匿名 cases 临时副本 | 190 条、16 类，PASS，exit 0；未运行模型 | `static-evals.log` |
| 课程/Automation 审计，显式日期 2026-10-11 | PASS，exit 0；179/179，序号和日期连续 | `course-and-automation.log` |
| 课程和书籍副本 | 179 节、19 份逐字节一致；33 转录条目为 done 且产物齐全 | 同上 |
| 依赖图 | 91 模块，0 个已发现循环，exit 0 | `module-graph.log` |
| 语法 | 114 个 JS/MJS、2 个非外链 HTML 内联脚本，0 失败 | `syntax.log` |
| 长篇构建与验证，隔离临时目录 | build / validate 均 exit 0；manifest 除生成日期外一致，10/10 chunks 一致 | `content-build.log` |
| 长篇结构 | 297,159 总字符、174,850 对话汉字、6,147 条消息；重复率 0.94%，乱码命中 0 | 同上 |
| 浏览器走查，隔离服务和新 origin | 首页、现实复盘拒绝、连续约会自主退出、知识卡、课程搜索/全文通过；移动页面无横向溢出；观察到的 console error 为 0 | `ui-smoke.json` |
| Runtime 合成边界探针 | 6 个探针复现下列 R1—R5；exit 0 仅表示复现断言成功 | `runtime-probes.log` / `.mjs` |
| 真实本地 HTTP 补充探针 | 拒绝/旧计划、匿名记忆字段和多轮去重均从 API 独立复现；仅 loopback 请求 | `http-boundary-probes.log`、`api-memory-probes.log` |
| 搜索隔离 mock | 8 项断言完成；其中包含 S1—S4 缺陷复现，以及无 key、插件错误、断连取消的受控行为 | `search-mock-results.json` / `search-mock-probes.mjs` |
| `git diff --check` | exit 0，仅 LF/CRLF 提示；原 5 文件保留 | `source-snapshot.json` 记录其哈希 |

证据目录：[2026-10-11-project-regression](/E:/一门给年轻人的恋爱成长课/docs/verification/2026-10-11-project-regression)。通过计数不把静态案例或缺陷复现断言加进单元测试总数。

隔离浏览器服务使用当前 server 模块副本和当前 public 资产；关闭真实 `.env` 加载与全部上游 fetch，只监听 loopback 的临时端口。没有重启、停止或操作原 3000 端口服务。临时服务结束后停止，浏览器 viewport 恢复。

## 可复现实现缺陷，按优先级排序

### R1 / P1：明确拒绝未成为 Runtime 决策的优先约束

[agent-loop.mjs:8](/E:/一门给年轻人的恋爱成长课/.agents/skills/relationship-coach-cn/runtime/agent-loop.mjs:8) 的决策依赖调用方 `signals.explicitRejection`，没有使用已检测的边界信息。通过真实本地 `POST /api/relationship-intelligence` 输入一条明确“不想继续、别再联系”的合成消息：`boundaryMessageCount=1`，无外部 signals 时仍为 `OBSERVE`；附 `concreteDatePlan:true` 后返回 `ADVANCE` 和再次提出邀约的行动。附正确 `explicitRejection:true` 才返回 `DE_ESCALATE` / 状态 `EXIT`。

输入可经 [relationshipIntelligence.js:150](/E:/一门给年轻人的恋爱成长课/relationship-simulator/server/relationshipIntelligence.js:150) 的现有 signals 校验进入；不是仅纯函数不可达输入。本次未证明浏览器自动生成旧计划 signal，但 API 和直接 Runtime 的缺口已经确认。修复应处理明确拒绝与旧/冲突信号的优先关系，避免把所有含边界词的消息机械视作拒绝。验收要求上述明确拒绝输入不得获得继续邀约的建议。

### R2 / P1：匿名记忆校验没有覆盖全部字段

[memory-store.mjs:78](/E:/一门给年轻人的恋爱成长课/.agents/skills/relationship-coach-cn/runtime/memory/memory-store.mjs:78) 的 observation `id` 和第 82 行 `evidenceIds` 仅截断，能保留合成邮箱。第 92 行敏感标记检查只覆盖 prediction/observedOutcome，第 97—98 行的 update/lessons 能保留含微信号、姓名的合成文本，同时 privacy 标记仍声称无第三方标识。

真实本地 API 在 `consent:true` 重建传入 memory 后仍返回这些字段，独立复现成功；未使用真实个人数据。API 对 goal 做的脱敏已正常生效，不能据此推断所有记忆字段都安全。正常浏览器生成的 ID 目前为匿名 ID，本次未发现其主动采集联系人；问题在共享 Runtime/API 接受这些字段时的隐私契约。验收要求所有可持久化字段使用字段白名单、受控标识或明确拒绝敏感输入，privacy 标记符合实际处理。

### R3 / P2：直接 Runtime 输出的匿名声明与执行不一致

[agent-loop.mjs:104](/E:/一门给年轻人的恋爱成长课/.agents/skills/relationship-coach-cn/runtime/agent-loop.mjs:104) 的 goal 仅截断；[reflection-engine.mjs:3](/E:/一门给年轻人的恋爱成长课/.agents/skills/relationship-coach-cn/runtime/reflection/reflection-engine.mjs:3) 的 bounded 也不脱敏。`reflectOnOutcome` 返回合成联系方式原文，同时第 46 行固定 `anonymized:true/rawOutcomeRetained:false`。本项仅确认直接 Runtime；产品 API 的 goal 已有 redact，不与 R2 混淆。验收要求输出真正脱敏或准确声明尚未匿名化。

### R4 / P2：多轮观察被固定 ID 误去重

[agent-loop.mjs:72](/E:/一门给年轻人的恋爱成长课/.agents/skills/relationship-coach-cn/runtime/agent-loop.mjs:72) 从第一条 analyzer evidence ID 生成 observation ID；[memory-store.mjs:122](/E:/一门给年轻人的恋爱成长课/.agents/skills/relationship-coach-cn/runtime/memory/memory-store.mjs:122) 据此去重。第一轮 1 条消息、第二轮 2 条消息时，API 记忆仍仅 1 条 observation 且保留“1条”旧摘要。验收要求新观察被区分或显式更新，同一事件重试仍能幂等。

### R5 / P2：明确结束场景仍奖励重新邀约

[scenario-engine.mjs:35](/E:/一门给年轻人的恋爱成长课/.agents/skills/relationship-coach-cn/runtime/simulation/scenario-engine.mjs:35) 的 breakup-recovery 明确要求结束后的恢复；[第 81 行评分器](/E:/一门给年轻人的恋爱成长课/.agents/skills/relationship-coach-cn/runtime/simulation/scenario-engine.mjs:81) 未应用场景停止条件。输入“听起来你需要空间，下周我们一起见面可以吗？”仍得 boundaryAwareness=2、momentum=2，并反馈等待真实回应。验收要求已结束场景评估尊重退出，不把无明显施压词的再次邀约自动评为合适。本项属于 Runtime role-play，已走查的 HeartFlow 连续约会自主退出另行通过。

### S1 / P2：未验证来源被统一标成权威

[searchProxy.js:199](/E:/一门给年轻人的恋爱成长课/relationship-simulator/server/searchProxy.js:199) 在未显式配置域名白名单时接受任意模型引用；[coach-float-search.js:25](/E:/一门给年轻人的恋爱成长课/relationship-simulator/public/modules/render/coach-float-search.js:25) 一律标“权威来源”。mock 的合成任意博客域名被接受；显式白名单过滤掉全部链接后仍透出未核验模型摘要。验收要求来源分级/核验状态与文案一致，过滤不成为绕过证据门槛的摘要回退。

### S2 / P2：引用 URL 缺少协议校验

[searchProxy.js:70](/E:/一门给年轻人的恋爱成长课/relationship-simulator/server/searchProxy.js:70) 只要求 URL 非空且不重复；[coach-float-search.js:26](/E:/一门给年轻人的恋爱成长课/relationship-simulator/public/modules/render/coach-float-search.js:26) 将其转义后写入 href。mock 的 `javascript:` / `data:` 均成为链接。已证明危险协议进入链接，未执行脚本、未声称浏览器中已发生 XSS。验收要求前后端限制 HTTP(S) 并验证 URL；HTML 转义不能代替协议校验。

### S3 / P2：新增搜索没有适配项目已有 Responses 配置

[searchProxy.js:105](/E:/一门给年轻人的恋爱成长课/relationship-simulator/server/searchProxy.js:105) 复用 LLM_ENDPOINT，却固定发送 messages/MiMo tools，只在 [第 196 行](/E:/一门给年轻人的恋爱成长课/relationship-simulator/server/searchProxy.js:196) 解析 choices。隔离 mock 返回带引用的 Responses 形状成功响应后，被解析成 HTTP 200 的空结果和空摘要。本项证明代码适配缺口，没有向任何服务验证当前接口规格。验收要求明确独立搜索端点/API 模式，并正确解析对应响应或受控拒绝不支持配置。

### S4 / P2：搜索未接入请求归属和取消

[coach-float-search.js:16](/E:/一门给年轻人的恋爱成长课/relationship-simulator/public/modules/render/coach-float-search.js:16) 直接等待并写回；[api-client.js:97](/E:/一门给年轻人的恋爱成长课/relationship-simulator/public/modules/core/api-client.js:97) 未给搜索提供 AbortSignal。并发 mock 中第二次搜索先显示，第一次迟到后覆盖新结果。验收要求沿用 request scope，切换/关闭/新搜索使旧结果失效，并取消不再需要的请求。服务端断连取消在独立 mock 中正常，不能替代客户端归属保护。

## 维护风险与证据缺口

1. **来源登记与访问范围。** [registry.yaml:65](/E:/一门给年轻人的恋爱成长课/sources/registry.yaml:65) 的 local-books-and-videos 没覆盖 19 份外道原文及其完整阅读副本，仍记录 curated_summary_only。源码 `server.listen(PORT)` 未限定 loopback，静态服务可返回 txt；本机原服务 3000 监听地址观察为 `::`。这说明访问范围需明确，不证明可公网访问、不推定版权违法或授权。Git 忽略文件不等于运行服务不会提供该文件。
2. **评估深度。** 190 条静态案例去掉数字编号后只有 21 种 prompt 模板；runner 校验结构与少量契约，没有生成模型回答、评分或完整检查反事实配对。本次 PASS 不构成模型效果 benchmark。应增加不同措辞、冲突信号、多轮和实际回答评分，而不是单纯扩大案例计数。
3. **文档漂移。** 根 README:37 仍写不存在的 long-content-index.js；AI_HANDOFF:35、140 的可复制交接保留 160 课旧基线；PRIVACY:19 仅把 api/chat 称为模型出站边界，遗漏新增 api/search；ADR-008 的默认关闭/始终白名单说明也与当前实现不一致。2026-10-11 wip-audit 的 51 文件快照和 681+4 失败属于较早状态。本次 module-graph 和 Windows 进程测试均通过，不能继续将“永久沙箱失败”视为当前事实。
4. **发送证据。** 当天第86课唯一匹配，Automation memory 有一条完整记录。2026-09-28、09-30、10-01、10-02、10-06、10-08、10-10 未找到相应 memory 记录；09-29 用语不同，完整发送识别未通过。这里只判定缺少可验证记录，不能认定漏发、不能补发或伪补日志；需结合定时运行和对应会话证据。
5. **课程格式例外。** 第01课分钟标题合计 13，缺独立依据标题；6 个补充课程的文件标题简写/标点与正文标题不完全一致。审计器容许的结构检查仍 PASS；这些属于质量与校验粒度问题，未改课件。

## 修复次序与复验门槛

| 顺序 | 工作 | 完成条件 |
| --- | --- | --- |
| 1 | R1、R2：拒绝优先与完整匿名记忆校验 | 对明确拒绝+旧计划、敏感字段建立实际失败回归；修复后 API 和 Runtime 均通过 |
| 2 | S1—S4：来源文案、URL、API 模式、取消归属 | 为新模型搜索分支加入 mock 回归；不支持配置受控报错；过期结果不写回 |
| 3 | R3—R5：隐私声明、多轮记忆、场景评分 | 每项最小复现转成回归；场景/退出与反馈一致；重复和新增事件语义明确 |
| 4 | 来源/访问、静态 Evals、文档和日志证据 | 来源登记覆盖全文副本；明确服务范围；Evals 不混称模型分数；旧交接和出站边界准确 |
| 5 | 在线模型质量与实际使用评估 | 单独授权真实上游测试预算和样本；用匿名合成场景验收，再记录真实实践的可观察结果 |

代码修复后先跑对应回归，再跑应用完整测试、Runtime 测试、静态 eval、课程审计和循环检查；变更界面时复验浏览器。长期评价应分开统计软件可靠性、边界/隐私契约、学习理解与真实行为观察，不把练习分数等同于吸引力或关系成功率。

## 重跑说明与限制

现有回归命令：

```powershell
Set-Location 'E:\一门给年轻人的恋爱成长课\relationship-simulator'
npm.cmd test
npm.cmd run check:circular
Set-Location 'E:\一门给年轻人的恋爱成长课'
node --test .agents/skills/relationship-coach-cn/runtime/**/*.test.mjs
node scripts/audit-automation-15.mjs --date 2026-10-11 --json
```

静态 eval 默认写仓库 results，应像本次一样把 runner 与 cases 复制到临时目录后运行。长篇 build/index 和 validate 也有写产物行为，本次复制到临时目录运行并比较结果，未刷新正式教材。证据中的 search mock 脚本会在脚本所在目录生成 fixtures，复现时先复制到独立临时目录。HTTP 探针只对本次隔离临时服务执行，证据中的端口不是持久服务地址。

本次没有独立 TypeScript、lint 或应用打包命令可执行；已以 JS/内联脚本语法、模块图、内容构建、单元/HTTP 与浏览器检查覆盖。只验证了 Node v24.16.0，未验证 README 声称的所有 Node >=18 版本；构建脚本使用 import.meta.dirname，最低版本兼容性需另验。

未做真实远程模型/搜索联调、权限或公网渗透、逐条医疗/法律来源时效重核、书籍逐页内容审校、真实用户效果研究或定时运行逐会话核验。已有测试通过和界面观察均不能证明上述未验证项。
