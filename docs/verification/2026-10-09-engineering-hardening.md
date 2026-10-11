# 工程优化验收记录

完成日期：2026-10-09，Asia/Shanghai。范围：本轮代码可靠性、异步一致性和模块边界优化，承接 2026-10-05 实施计划。

本轮计划已完成，完整回归通过。修复集中在可复现的请求、状态、事件和进程管理缺陷；测试结果不代表不存在其它未覆盖的错误，也不证明真实关系实践效果。

## 完成范围

| 问题 | 改动及结果 | 主要回归覆盖 |
| --- | --- | --- |
| HTTP 通用能力与静态服务耦合，超限请求直接断开 | 抽出 `server/http.js`，旧静态模块保留兼容导出；按 UTF-8 字节限制 2,000,000 字节，非对象 JSON、非法路径和目录请求返回受控状态，超限返回 413 | `http-boundaries.test.mjs`、`server-http.test.mjs` |
| 异步路由异常可能越过外层 catch | 抽出 `server/request-handler.js`，逐路由 await；统一处理 500、已结束响应和已发送头的情况；直接入口识别兼容 Windows 路径与文件别名 | `server-lifecycle.test.mjs` |
| 上游超时和取消逻辑分散，重试遗留响应体 | 抽出 `server/upstream-request.js`；超时覆盖 fetch 与读取响应体，客户端断开取消上游；重试前释放丢弃的响应体，取消后不继续重试 | `server-lifecycle.test.mjs`、`server-modules.test.mjs` |
| 状态修改或保存失败留下部分变更 | `mutate` 使用隔离草稿，保存成功后提交，保留根对象身份；拒绝异步和嵌套事务；渲染异常与已成功保存的事务分别报告 | `state.test.mjs` |
| 事务隔离后，生成回复和训练记录仍可能嵌套写入 store 或写错对象 | 抽出纯函数 `core/conversation.js`；回复、分析、训练日志、学习事件和同意后的记忆在同一个草稿内提交 | `generation-commit.test.mjs` 使用真实 store，而非事务 mock |
| 同一回调用于不同事件时解绑冲突 | `core/events.js` 改用原生 EventTarget，按事件及每次订阅管理解绑；旧取消函数不会解绑后来创建的订阅 | `events.test.mjs` |
| 切换角色、会话或输入后，迟到结果覆盖新状态 | 抽出 `core/request-scope.js`，生成、优化、计划共用取消与结果归属核验；旧成功和旧错误均不触发写入或本地兜底；生成、重试、下一轮共用按钮锁 | `request-scope.test.mjs` |
| 旧优化仍可被采用，阶段与介入结果覆盖手动编辑 | 优化采用核验输入版本，改回原文也不会复活旧结果；阶段手动选择使旧检测失效；介入关闭、换章和编辑均使旧结果失效 | `request-scope.test.mjs`、`render-stage-async.test.mjs` |
| 非对象自定义角色或继承属性被当成有效角色 | 过滤无效自定义角色值，使用 own-property 核验角色 ID | `state.test.mjs` |
| 明确退出后仍可能建议修复或推进 | runtime 的历史 EXIT、明确退出与关系结束信号优先处理；保留既有拒绝后的降级行动契约 | runtime `state-machine.test.mjs`、`agent-loop.test.mjs` |
| 依赖检查漏掉 re-export、动态 import 和缺失文件 | 覆盖字面量 re-export、动态 import、查询参数和注释；缺失入口或依赖以非零退出，而非静默跳过 | `module-graph.test.mjs` |
| 启停或失败回滚误用可变 PID 文件 | `process-identity.ps1` 核验项目 Node 入口、服务标识和 PID 归属；失败回滚只操作原始进程对象，删除 PID 前核验归属 | `windows-process-identity.test.mjs` |
| `npm run start:bg` 仍会覆盖活 PID 与日志 | 在打开日志和 spawn 前拒绝活 PID、无效 PID、权限及未知错误；只有 ESRCH 确认旧 PID 已退出才继续 | `background-start.test.mjs`，全部使用受控 fs/process/spawn |

生产代码路径以上表模块名为准，前端位于 `relationship-simulator/public/modules/`，服务端位于 `relationship-simulator/server/`，脚本位于 `relationship-simulator/scripts/`。runtime 位于 `.agents/skills/relationship-coach-cn/runtime/`。

## 最终验证

初始基线为应用 638/638、runtime 21/21。新增回归覆盖可复现缺陷，最终应用 685/685、runtime 22/22。

| 验证 | 实际结果 | 证据 |
| --- | --- | --- |
| 应用完整 `npm test` | 685 通过，0 失败、取消、跳过 | [完整日志](2026-10-09-engineering-tests.log) |
| runtime 全部测试 | 22 通过，0 失败、取消、跳过 | [runtime 日志](2026-10-09-runtime-tests.log) |
| `npm run check:circular` | 扫描 89 个模块，0 个循环 | [依赖图日志](2026-10-09-module-graph.log) |
| 应用 public/server/scripts 与 runtime 的 JS/MJS、HTML 内联脚本语法检查 | 114 次检查，0 失败；最终改动的启动入口与新增启动测试另行 `node --check` 通过 | [语法日志](2026-10-09-syntax.log) |
| Windows PowerShell 5.1 脚本验证 | 完整测试中通过；解析真实脚本并执行受控身份、PID 归属及回滚对象 | `windows-process-identity.test.mjs` |
| 本轮代码和文档 `git diff --check` | 通过；仅有 Windows LF/CRLF 提示 | [差异检查日志](2026-10-09-diff-warnings.log) |

测试使用合成输入、模拟模型响应、临时配置及隔离本地 HTTP 服务。启动和停止回归替换了进程操作，不启动或终止用户服务，不读取实际密钥。没有远程模型调用、依赖新增或 Git 提交。

修复前的事件、状态和 runtime 回归失败证据保留于 [修复前日志](2026-10-05-regression-before.log)。后续完整日志覆盖生成提交的真实 store 集成及最后发现的后台启动入口遗漏。

## 开发契约与剩余限制

- `mutate(draft => ...)` 必须同步；业务代码只修改传入草稿，不能在事务中调用另一次 store 修改。异步准备在事务外完成。
- 请求取消之外仍须核验 `ticket.isCurrent()`；底层取消可能与响应完成同时发生，结果归属核验负责防止迟到写入。
- `app.js` 仍是较大的装配控制器。本轮抽出了共用边界和纯事务辅助函数，没有把整个界面重新架构。后续拆分应按业务域继续，避免把状态写入重新分散到渲染模块。
- 依赖图使用静态文本分析，覆盖字面量路径，不完整解析计算或模板生成的 import；0 个已发现循环不能等同于所有运行时依赖均已证明无环。
- 旧的相对路径或 inline 启动方式可能被严格进程身份核验拒绝，需人工核实原进程。本轮未重启或停止正在使用的服务。
- 未做真实浏览器走查、在线模型联调或生产部署；界面竞态通过实际模块、受控 DOM 和 Promise 回归验证。当前没有独立 TypeScript、lint 或应用打包命令；`build:index` 是教材索引生成，本轮未改其来源，未重新生成教材。
- 沿用并保留已有未提交改动；本轮不改原始配色、179 节预生成课程或 Automation 15 的投递资产。完整代码差异仍包含此前功能工作，不能全部归为本轮工程优化。
