# 服务重启与实际运行核查

日期：2026-10-12，Asia/Shanghai。实际服务：`http://127.0.0.1:3000`。用户明确授权“重启然后核查”。

**重启完成，修复已在实际 3000 服务生效。新 Node 进程使用本项目绝对入口，PID 文件与唯一监听者一致，health 正常、错误日志为空；12 项本地 HTTP 核查全部通过。**

## 进程归属与重启

最初 PID 文件与实际监听进程不一致，标准停止脚本的严格绝对入口核验无法适用于该旧进程。一次顺序判断失误导致后台启动尝试，新进程因 `EADDRINUSE` 退出，原服务没有被停止；随后已完成修正。

实际旧进程是 Node 的 `server/index.js` 相对入口。仅查询其工作目录元数据，确认目录正是 `E:\一门给年轻人的恋爱成长课\relationship-simulator`，并核对完整 Node 入口参数、服务标识、当前唯一监听与原进程对象的 OS 句柄后，只停止该已确认进程。该读取不访问环境变量、密钥、聊天或一般内存内容。

工作目录的只读核验先对读取进程自身与 `os.getcwd()` 做一致性自检，再对目标进程只读取必要指针、Unicode 目录描述与目录字符。查询依据为 [Microsoft NtQueryInformationProcess 文档](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntqueryinformationprocess)、[Microsoft PEB 文档](https://learn.microsoft.com/en-us/windows/win32/api/winternl/ns-winternl-peb) 和 [System Informer 的进程参数结构定义](https://github.com/winsiderss/phnt/blob/master/ntrtl.h)。没有放宽项目停止脚本的身份规则。

旧进程退出、3000 释放后，清理已确认失效的 PID 记录，执行现有 `npm.cmd run start:bg` 后台隐藏启动。新进程按绝对 `server/index.js` 入口通过现有 `Get-VerifiedHeartFlowProcess`；之后再次确认 PID 文件、唯一监听者和 `service:heartflow` 一致。未修改 `.env` 或启动脚本，也没有处理其它进程。

## 实际服务检查

| 检查 | 结果 |
| --- | --- |
| 唯一监听、进程归属、健康标识 | 通过，`ok:true/service:heartflow` |
| 首页与四个关键 JS 资产 | HTTP 200，修复标记存在，JS 缓存为 `no-cache` |
| Runtime 实际 HTTP 请求 | 12/12 通过，0 fail |
| 明确停止联系 + 旧 date/offer | 返回 `EXIT`，旧信号不能覆盖 |
| 今日暂停联系 | 返回 `DE_ESCALATE`，不强判永久退出 |
| 显式同意的敏感记忆字段 | 已知账号、敏感标记和非法 ID 不穿透；隐私范围按新合同声明 |
| 新文本、新信号与重复请求 | 新观察/新摘要保留，同请求重试不重复或再次推进状态 |
| 未同意与非法输入 | 不返回 memory patch；空消息/非法 case ID 为受控 400 |
| 实际首页浏览器 | 页面加载成功；显示“本地服务可用 · 模型已配置，连接未核验”；console errors 0 |
| 新错误日志 | 0 字节 |

证据：[重启状态与核查文件](/E:/一门给年轻人的恋爱成长课/docs/verification/2026-10-12-service-restart)。公开证据只保留布尔状态、接口状态、测试名称和数量，不保存实际 PID、唯一标识、endpoint 或密钥值。

浏览器首次使用另一 loopback 来源连接超时；恢复为 `127.0.0.1:3000` 后首页实际加载成功。测试标签页已关闭，未编辑已有用户聊天、保存设置或真实资料。运行服务继续保留在后台。

## 依据边界与下一步

本轮只请求 health、静态资产和确定性 `relationship-intelligence`，未请求 `/api/chat` 或 `/api/search`，没有付费模型/真实搜索调用。`hasApiKey:true` 只证明模型配置存在，不能证明上游连通性或回复质量。上一轮 735 应用测试、43 Runtime 测试属于代码回归；本轮的 12 项是重启后真实服务冒烟，不将其混为全量测试计数。

用户刷新 [HeartFlow](http://127.0.0.1:3000/) 即可使用新前端。后端已重新加载修复，无需再次重启。课程、自动化、教材、源码与依赖本轮没有修改；没有 Git 提交。
