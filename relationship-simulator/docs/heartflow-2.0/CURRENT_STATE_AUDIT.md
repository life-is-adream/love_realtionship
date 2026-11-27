# HeartFlow 2.0 现状审计

审计与本机验证日期：2026-11-13，Asia/Shanghai。下文区分原有能力和本次新增；目录内存在用户原有未提交改动，本次没有清理或提交。

## 现有结构与复用

| 部分 | 实际依据 | 状态与影响 |
| --- | --- | --- |
| 启动 | `package.json` 的 `start` / `dev` 启动 `heartflow-c/hf.exe`；`start:node` 启动 `server/index.js` | 生产路径是 Windows C 主服务，Node 为参考实现。 |
| 页面 | `public/index.html`、`public/app.js`、`public/modules/render/workspace-nav.js` | 原有聊天、课程、教练、训练和设置界面继续保留；本次增加「关系分析」面板。 |
| HTTP 服务 | `heartflow-c/src/server/routes.c`、`httpd.c`、`config.c` | 沿用原有 `/api/chat`、`/api/relationship-intelligence`、TTS 等；新增 `v2.c` 路由。服务默认只绑定 `127.0.0.1`，可用 `HF_BIND_HOST`/`--bind` 显式改绑；全部路由校验 Host（阻止 DNS rebinding），`/api/*` 校验页面来源，v2 另检查本机连接。 |
| 关系智能 | `heartflow-c/src/server/coach.c`、`coach_analyze.c`；Node 的 `server/relationshipIntelligence.js` 和 `.agents/skills/relationship-coach-cn/runtime/` | 原有证据、关系状态与决策逻辑可复用。本次 v2 将输入原文定位展示，假设单列，强制不请求引擎写长期记忆。 |
| 场景与评分 | `heartflow-c/src/server/coach.c` 的 `hf_scenario_start`、`hf_scenario_critique`；对应 runtime 中的场景函数 | 原有场景、会话和规则反馈可复用；本次增加多轮前端、预设分支、由历史累积的紧张/修复状态、可选模型角色与独立的五维证据反馈。可见的五维量表仍是启发式规则，不是经人工校准的评价。 |
| 课程 | `public/love-learning/manifest.json`、`public/love-learning/courses/001.md` 至 `179.md`；`public/love-learning.html` | 读取真实课程正文，用锚点+二元组+通用同义词查询词做 BM25（k1=1.2、b=0.75）排序，默认返回 3 条、`limit` 可调到 10。临时标注集实测 Recall@5=65.1%、MRR@5=0.823；标注未经人工复核，仍不是段落级语义检索。 |
| TTS | `public/modules/voice/tts-client.js`、`heartflow-c/src/server/routes.c`、`voice/tts_server.py` | 原有 C 代理及 Python 推理 sidecar 继续使用；页面增加情境及反馈朗读。音频输入使用浏览器能力，本次只测试数值停顿接口。 |
| 关系与备份 | `public/modules/core/state.js`、`config.js`、`state-reset.js`、`backup.js` | 原有主状态存放浏览器本机。本次按关系分别保存匿名名称、手动授权摘要、事件和用户主动保存的规则评分；不等于独立用户账户或加密数据库。 |
| 模型出站 | `public/modules/core/api-client.js` 的 `callLLM`；`heartflow-c/src/server/v2.c` 的截图适配 | 文本模型调用沿用规则脱敏，但姓名和组合信息不能保证去除；截图经同意后压缩并发送所配置服务，图片内容仍可能包含敏感信息。取消等待不保证远端停止。 |

## 本次修改位置

- C：`heartflow-c/src/server/v2.c`、`v2.h`、`routes.c`、`config.c`、`config.h`、`coach.c`，在现有服务上增加接口和边界处理。
- Node 参考：`server/v2.js`、`server/index.js`、`server/request-handler.js`。
- 页面：`public/modules/relationship-flow/`、`public/modules/core/relationship-cases.js`、`public/modules/training/weekly-plan.js`、`public/relationship-flow.css`，以及导航、入口、状态的必要接线。
- 配置示例：`.env.example` 增加可选 `VISION_MODEL`；没有修改真实凭证文件。
- 验证：`heartflow-c/tests/v2-smoke.py`、`scripts/e2e-heartflow-v2.mjs` 和四个新增的 `test/*.test.mjs` 文件。
- 启动程序：已编译更新 `heartflow-c/hf.exe`，原版本保留为 `heartflow-c/hf.pre-v2-20261113.exe`；构建副本为 `hf-v2-build.exe`。

原有文件中还有此前产生的未提交差异；上述列表只描述本次相关改动，不代表整个工作区的全部差异。

## 数据与授权的实际边界

新增页面原始聊天在页面内存及本机请求中使用；默认不把它自动写入新关系档案。用户可以逐个档案开启保存，手动写入事实、推测、结果和摘要，或主动保存练习规则分数；关闭该档案授权会清除其事件、评分与摘要。档案标签、授权状态、保存的计划和复盘位于该浏览器的本地存储，导出文件由用户自行保管。

已有聊天、训练日志和手动设置可能独立保存在浏览器，不受新增档案开关控制。旧备份和已导出文件也不会随撤销自动删除。`memory.persisted=false` 仅说明本次分析不写长期记忆，并不说明模型供应商或其他组件没有临时处理或留存。

浏览器之间、同一浏览器的不同使用者、同机其他进程不存在账号级隔离。v2 没有服务端保存的关系/会话资源，也没有资源所有权认证；禁止据此声称已支持多用户或服务端强制的档案归属。

## 基线

修改前既有自动检查为 1042 项通过，循环依赖和约定违规均为 0；本次验证见 [TEST_REPORT.md](TEST_REPORT.md)。历史的竞品页面描述没有重新做账户内体验，不构成本次实际功能验证。
