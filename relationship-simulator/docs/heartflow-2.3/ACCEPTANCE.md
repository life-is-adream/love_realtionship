# HeartFlow 2.3 收尾练习实施与自验记录

## 当前候选 `closing-1.1`

复验日期为 2026-11-21（北京时间）。本次迭代在独立换题期间隐藏原页面的分析、课程、回复、旧练习、反馈和周计划。提交或退出后，原页面内容恢复。提交文字后用户可以自查两件事，是否接受了对方的决定，以及是否还需要对方解释或再次表态。选择停下时，复盘确认这轮可以就此结束。输入超限后焦点回到输入框，重新编辑清除上一次错误。连击第二次不会在新步骤上触发提交。

| 复验 | 当前结果 | 复现或边界 |
| --- | --- | --- |
| 新旧定向测试 | 11/11 通过，退出码 0 | `node --test test/closing-drill.test.mjs test/relationship-flow.test.mjs` |
| Edge 独立浏览器检查 | 11/11 通过 | 用下方命令生成检查页，在 Edge 打开。检查页使用当前练习模块和样式、合成页面及数据。覆盖真实 DOM、焦点、状态提示、390 像素布局、提示隔离、连击和退出清理 |
| 全量测试 | 1,073 项中 1,063 通过。余下 10 项回环连接报 `EACCES`，退出码 1 | `npm test`。本次日志为 `E:\workspace\hf-23-closing-11-unit.log` |
| 循环依赖与代码规范 | 两项通过，退出码均为 0 | `node scripts/check-circular.mjs`、`node scripts/check-conventions.mjs` |
| C 与 Node 整页联调 | 两个隔离实例均成功监听本机端口。Edge 访问两者均报 `ERR_CONNECTION_TIMED_OUT` | C 用 `hf.exe serve`、Node 用 `node server/index.js`。实例未带入 `.env`，运行后已停止 |

```powershell
node scripts/check-closing-drill-browser.mjs E:/workspace/hf-closing-check.html
```

浏览器检查为 A01、A04、A05、A08 增加了练习组件层面的实测证据。两端整页回归、网络与存储审计、性能基线及真人试验仍未验证。**功能保持默认关闭，工程试用与默认开放门禁仍未通过。**

本次更新文件 SHA-256

```text
public/modules/relationship-flow/closing-drill.js    1FB59A6F0AB94238FF3D911360E519639397A936784948516FE33CBDCB9175E0
public/relationship-flow.css                        3F4D94D47B4E27A2A0AE8416479E98BB25B7BB0A4CEF6B588B9EA276E10E5CBB
public/index.html                                   E79F7D1E7AD05A5731F1A15B926E2390E62E44209DF91A1F3D16C0AA3935E5E0
test/closing-drill.test.mjs                          E52722A6D5F5F80A391FC3A612D65CA4BAB14F62D9813400A1E7E33C9E8285BE
scripts/check-closing-drill-browser.mjs             BB01B8332C735F47CC609916BB4817679B22698E9437B36774E7BCAEBB58F5A9
```

## 首轮记录 `closing-1.0`

日期：2026-11-21（北京时间）  
范围：明确拒绝后收尾练习，内容版本 `closing-1.0`  
候选版本：工作区 `HEAD dc151140` 上的未提交改动，以文末 SHA-256 识别

**结论：候选实现已交付，工程试用门禁尚未通过。** 收尾练习和旧关系分析的定向测试 10/10 通过。全量测试 1,062 项通过，10 项在回环连接处报 `EACCES`。浏览器联调、实测性能和真人对照缺少结果，功能保持默认关闭。

## 实施与复验

- 试用入口通过 `?hf_drill=closing-v1#caseflow` 启用。初始页面可直接开始。分析后入口须通过降级类别、停联和威胁标志、原消息说话人、Unicode 码点和原文字面回读校验。
- 练习可经历初稿、自查改写、同屏对照、换题独答及结束。停下为显式选择。示例、自查项及课程入口按阶段展示。不同阶段的作答分别保存在卡片会话内存中。
- 复验修正了两个入口时序问题。解析开始时隐藏直接入口。离开关系分析、离开页面或启动旧模拟时，让迟到的分析失去显示新入口的资格，保留旧分析已有展示逻辑。静态模块加载失败时原按钮可重试。
- 第 19 课由 `public/love-learning/courses/019.md` 提供。已核对教材要求结束推进、避免追问及重复联系，并核对 manifest 中的课程编号、文件和阅读页路由。卡片对明确停联的提示为停止联系。

## 原始结果与环境

Windows，Node `v24.16.0`。本轮分析输入及练习答案均为虚构样例。

| 检查 | 结果 | 复现命令或证据 |
| --- | --- | --- |
| 新旧定向测试 | 10/10 通过，退出码 0，其中收尾练习 6 项 | `node --test test/closing-drill.test.mjs test/relationship-flow.test.mjs` |
| Node 实际分析逻辑 | 7/7 准入判断符合预期。正常降级及 emoji 前缀两例开放，其余五例关闭 | 见下一表。输入经过 `normalizeFlowMessages`，分析调用 `analyzeV2`，结果交给 `canOfferClosingDrill` |
| 全量测试 | 1,072 项中 1,062 通过，10 项报回环连接 `EACCES`，退出码 1 | `npm test`。环境日志保存在 `E:\workspace\hf-23-unit-final.log`，10 项分布在 `http-boundaries`、`relationship-intelligence-server`、`server-http` 和 `server-lifecycle` |
| 模块检查 | 112 个模块无循环依赖，122 个文件无规范违规，两项退出码均为 0 | `node scripts/check-circular.mjs`、`node scripts/check-conventions.mjs` |
| C/Node 检索回归 | 本轮未验证。脚本在 C 服务探测阶段返回「C 服务未启动」 | `node quality/scripts/check-retrieval-parity.mjs`。隔离实例直接启动时成功监听 `127.0.0.1:32483`，客户端回环仍受限 |
| C 浏览器旧流程回归 | 本轮未验证。原脚本在浏览器或服务连接阶段退出，隔离 C 实例的浏览器访问也超时 | `node scripts/e2e-heartflow-v2.mjs`，浏览器报 `net::ERR_CONNECTION_TIMED_OUT` |
| C 离线复验尝试 | 构建探针时 Zig 无法将编译产物重命名到对象缓存，未生成可运行探针 | Zig 0.17.1，隔离目录内重试仍出现 `failed to rename … Unexpected` |

Node 准入样例均以用户消息「你周末想一起看展吗？」开头，第二条按下表输入。

| 第二条及说话人 | 分类 | 新入口 | 可回读证据 |
| --- | --- | --- | --- |
| 对方「这周先不约。」 | `DE_ESCALATE` | 显示 | `msg_002` 的 `[0,5)` 为「这周先不约」 |
| 对方「🙂抱歉。先不约了。」 | `DE_ESCALATE` | 显示 | `msg_002` 的 `[4,8)` 为「先不约了」，单位 `unicode_code_point` |
| 用户「这周先不约。」 | `OBSERVE` | 隐藏 | 无 |
| 待确认「这周先不约。」 | `OBSERVE` | 隐藏 | 无 |
| 对方「请不要再联系我。」 | `EXIT` | 隐藏 | `msg_002` 的 `[0,7)` 为「请不要再联系我」 |
| 对方「先不约，我要打你。」 | `EXIT` | 隐藏 | `msg_002` 的 `[4,8)` 为「我要打你」 |
| 对方「我今天刚下班。」 | `OBSERVE` | 隐藏 | 无 |

历史 2.2 报告记录 1,066 项旧测试、C/Node 检索一致性 1,296/1,296、C 浏览器回归 30/30。当前 `hf.exe` 与历史报告的 SHA-256 相符。工作区包含 2.2 的未提交文件，接手时已有 2.3 实现，未能核实完整的改动前工作区快照。历史数字仅供版本溯源。本轮全量枚举比历史多 6 项，对应 `test/closing-drill.test.mjs` 的 6 项。

## 规范门禁

验收口径按《HeartFlow 2.3 实施与验收规范》第 9–13 节。下列状态指整个验收项，已通过的局部检查列在证据栏。

| 验收项 | 状态 | 已核实的证据与缺口 |
| --- | --- | --- |
| A01 正常路径 | 未验证 | 内存会话测试覆盖初稿、改写、同屏对照、换题、重开、停下和只完成改写。欠缺 C 浏览器动作与截图 |
| A02 准入 | 未验证 | Node 实际分析 7/7，定向断言覆盖证据错位、弃判、威胁、停联与迟到分析。欠缺 C 实际响应和双端 DOM 记录 |
| A03 教学来源 | 未验证 | 已核对两题、自查项、示例、停联提示与第 19 课源码。欠缺浏览器课程落点和实际 DOM 核对 |
| A04 输入与独答 | 未验证 | 定向测试覆盖空白、1,200/1,201 码点、emoji、组合输入、过期提交、文本转义、换题移除教学内容。欠缺真实浏览器和无障碍树验证 |
| A05 清理 | 未验证 | 定向测试覆盖关闭和重开清除哨兵、离开后迟到分析不显示入口。欠缺真实浏览器刷新、返回、切档案和迟到模块加载的记录 |
| A06 网络与数据 | 未验证 | 卡片代码的作答和教学状态仅在内存，模块只在点击时加载，课程是固定同源链接。欠缺完整网络、存储和权限观察 |
| A07 旧功能与回滚 | 未验证 | 开关唯一精确值断言通过。全量测试中 10 个依赖回环连接的用例受阻。欠缺同源基线、双端旧流程及关停实测 |
| A08 双实现与可用性 | 未验证 | C 隔离实例启动成功，浏览器未连通。欠缺双端浏览器、窄屏、键盘及读屏证据 |
| A09 性能 | 未验证 | 缺少同源旧页基线、预先冻结的性能预算和候选浏览器测量 |
| A10 故障与维护 | 未验证 | 定向测试覆盖重复初始化，模块检查和代码规范通过。欠缺真实静态模块 404、内容版本异常的故障记录 |
| A11 评分可信度 | 未验证 | 未收集两位独立评分者的盲评和仲裁记录 |
| A12 学习收益 | 未验证 | 未收集两组参与者的独立迁移作答，缺少预先冻结的统计参数和正式样本 |

**工程试用验收不通过，原因是强制项证据不足。默认开放验收不通过。** 复验需要在回环连接正常的环境重跑两条回归脚本并对两种服务分别核对 A01–A10。A11–A12 需要正式参与者和独立评审。关停试用的操作是去掉 URL 查询参数后重新加载关系分析。

## 候选文件 SHA-256

```text
public/app.js                                       D0972FF2D1344941C33BDB590E36559D03FDDC43CEED96964F08C4B7970107D9
public/index.html                                   4783242E04978FEA54737214E0FE25990AEE4F524B5AF738791380F00300EB04
public/modules/relationship-flow/flow.js             011B95D9B47475BCE6A13E28BF3857834490F57F292D06AFA88803F570AF5E79
public/modules/relationship-flow/closing-drill.js    D83C93B4E287E7E757897EBDF34DE64B07920C2775122029E31C13242485CEEE
public/relationship-flow.css                        53CCCB2261255D2F99C21CE689F2BC8170832675CF20B40FCCDDA3E3741A29B2
test/closing-drill.test.mjs                          B0B8EBEC13AB8F132DEAB52C215F4B0B7B381906A1741F7959BD8A15460C37A8
heartflow-c/hf.exe                                  E79B0B3397540BB0C131C230870EBFA3FD65C84D05DBB542A101DF012E7C171B
public/love-learning/courses/019.md                  BD6652BA0D3BC60ACD791934ACC6B508D6FCB251DE634539AA430B7AB9F4B5AB
```
