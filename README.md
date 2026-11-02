# Relationship Intelligence System CN

这是一个中文关系成长与决策项目，包含：

- `恋爱15分钟学习/`：179 天预生成课程和课程总纲；
- `.agents/skills/relationship-coach-cn/`：证据驱动的 Relationship Intelligence System Skill；
- `.agents/skills/relationship-coach-cn/runtime/`：本地 Conversation Analyzer、匿名 Memory、关系状态机、Reflection、Role-play 和 Agent Loop；
- `relationship-simulator/`：本地 HeartFlow 对话训练、回放分析、长篇教材和 Role-play 应用；
- `sources/`、`PRIVACY.md`、`THIRD_PARTY_NOTICES.md`：来源、隐私和版权治理。

## 它是什么

它帮助用户整理关系事实、区分假设与未知、选择 `ADVANCE / MAINTAIN / OBSERVE / DE_ESCALATE / EXIT` 决策，并给出低压力、可拒绝、可退出的下一步。它保留聊天、邀约、约会、长期关系、冲突、分手、婚姻和性健康教育能力。

## 它不是什么

它不是操控异性、跟踪、羞辱、PUA、心理诊断、医疗诊断或法律意见工具。医疗、法律和当前政策问题必须重新查阅权威来源；项目内静态文本不替代专业服务。

## Skill 使用

入口：`.agents/skills/relationship-coach-cn/SKILL.md`。

默认只读取 `core/`、`modules/`、`references/curated/` 和必要的本地参考。`references/upstream/` 仅作为 archive/provenance，不能直接当 Prompt。个人 profile 和 locale 必须显式加载；真实 `profiles/private-profile.md` 不提交。

## HeartFlow 启动

```powershell
Set-Location 'E:\一门给年轻人的恋爱成长课\relationship-simulator'
Copy-Item .env.example .env       # 首次配置时执行，并填入本地 Key
npm install
npm test
npm start
```

浏览器访问 `http://localhost:3000`。模型 Key 只放在本地 `.env`，不要提交或回显。

`npm run build:index` 生成 `public/modules/content/long-content-manifest.js` 和 `public/modules/content/long-content/chapter-XX.js`，长篇原文变更后重新运行即可。

### HeartFlow 与 Runtime 的连接

HeartFlow 现在通过本地 `POST /api/relationship-intelligence` 调用同一套 `runRelationshipLoop`，不再只是拥有两套互不相连的实现。浏览器会展示有界的证据、工作状态、五分类决策和下一步；该接口是确定性本地分析，不调用远程模型，也不会返回原始聊天。

结构化复盘记忆默认关闭。用户在界面明确开启后，产品才保存 `case_` 受控标识和经校验、规则脱敏的观察摘要；规则无法识别所有姓名或组合信息，因此不能保证自由文本完全匿名，需自行复核并避免第三方个人信息。关闭时清除该结构化记忆。`POST /api/chat` 和用户主动触发的 `POST /api/search` 可根据 `.env` 调用上游；本地 Relationship Intelligence 不调用远程模型。

联网搜索始终执行 HTTP(S) URL 和域名白名单校验，只展示“参考来源”，不把域名匹配视为观点核验。模型搜索目前只支持 MiMo Chat Completions 与已开通的搜索插件；Responses 或冲突配置在发请求前返回 `503 search_api_mode_unsupported`。需要使用其它搜索接口时可独立配置 `SEARCH_ENDPOINT` / `SEARCH_API_KEY`；主聊天对 Responses 的支持保持原有范围。

## 课程自动化

Codex Automation 15 每天按 Asia/Shanghai 日期读取唯一匹配的已有课程文件，不生成、改写未来课程或临时补课。详见 `AI_HANDOFF.md` 和 `C:\Users\lenovo\.codex\automations\15\automation.toml`。

本地可重复审计课程完整性、当天唯一匹配和 Automation 15 配置：

```powershell
Set-Location 'E:\一门给年轻人的恋爱成长课'
node scripts/audit-automation-15.mjs
node scripts/audit-automation-15.mjs --date 2026-08-29 --json
```

审计发现发送记忆缺失时只报告“缺少可验证记录”，不会把它直接解释为未发送；需要结合运行日志和会话证据判断。

## 来源、隐私和 Evals

### 实战训练入口

HeartFlow 主页采用教程站排版和原有深梅紫、玫瑰粉、暖金配色：左侧目录、中央正文，一次显示一个功能。左侧“现实互动复盘”提供六种现实卡点：机会、开口、建立连接、邀约、兼容性、不确定性。选择后会提供准备练习、现实行动、观察点与停止条件，并将“每日小练习”切到相应能力维度。对话、连续约会、成长记录、形象与身心知识和角色设置各有独立入口；切换不会清除本页草稿。

“形象与身心知识”（`#lifestyle`）包含健身、护肤、穿搭、声音与仪态、女性生理、心理与相处六类，共 14 张补充知识卡与 15 项公开来源。事实逐条附原文链接，来源注明专业机构、资料类型、支持范围和核验日期（2026-10-04，Asia/Shanghai）；每卡附原创场景练习、适用范围、误区和理解自测。健康资料使用 CDC、NHS、AAD、NIH/NIDCD、OWH、ADA，服装设计使用 USU Extension 教材，心理内容区分历史研究综述与日常沟通建议。这些依据不构成个体诊疗、外形评分或恋爱效果证明。

日常运动、护理和穿搭记录保留原数据结构并独立折叠；体重提示只描述有限记录，原界面阈值不是医学标准，不再自动开增减热量建议，也不默认使用者服用异维 A 酸。补充区不采集录音、照片、对方周期或心理档案；理解自测不持久化。179 节原课程与每日发送自动化保持原有范围。

“现实练习与复盘”分开记录是否行动、可观察回应、自己的感受、表达、生活恢复和边界；没有尝试或证据不足时保持未知。同日同一卡点可以新增独立事件，也能补充旧记录，并保留最多5个此前版本；全部30条记录都可展开查看。补充未知值不会抹掉已知观察，同一事件的拒绝或越界不会被后来的普通友好回应取消。默认只保留在本页，明确开启保存后仅在此浏览器保留最多30条枚举摘要，关闭即可清除。

“连续约会训练”提供看展、兴趣运动、朋友聚会三种成人虚构场景，各包含初识、见面相处、约会后、再次邀约、好感表达和关系协商。先自己回答，再看规则反馈、重练和选择虚构回应；编辑回复会使旧反馈失效，模糊不会自动推进，拒绝或不合适会停止，练习文本刷新或重置即清空。规则只能识别部分表达风险；练习分数和软件测试均不表示现实关系效果。

主对话重置保留独立现实复盘、生活记录及其保存设置，同时清理模拟与编辑草稿。教练展示事实、解释的支持与反证、未知；模型状态区分本地服务和未核验的远程连接。课程链接可直达指定课，打开阅读不自动标记已学。

咨询技能的配套方法见 `.agents/skills/relationship-coach-cn/references/practice-loop.md`。在 `relationship-simulator/` 中执行 `node scripts/build-love-learning.mjs --courses-only` 只重建课程；默认构建同时从 `外道/` 同步19本书。书源缺失时保留已有可读副本，源与副本均缺失时提前报错，不将已有书籍标记为不可读。两种构建均不改每日课源文件。

- 来源登记：`sources/registry.yaml`；未知许可证不得猜测。
- 隐私：`PRIVACY.md` 和 `.agents/skills/relationship-coach-cn/core/privacy-policy.md`。
- Evals：`.agents/skills/relationship-coach-cn/evals/`，运行 `node .agents/skills/relationship-coach-cn/evals/run-static-evals.mjs`。
- Runtime 测试：`node --test .agents/skills/relationship-coach-cn/runtime/**/*.test.mjs`。
- HeartFlow 测试：进入 `relationship-simulator/` 后运行 `npm test`；循环依赖检查运行 `npm run check:circular`。
- 当前静态数据集为 190 条匿名案例；静态 PASS 和本地单元测试不等于已完成 LLM 效果 benchmark。

## Agent loop 示例

```powershell
node --input-type=module -e "import { runRelationshipLoop } from './.agents/skills/relationship-coach-cn/runtime/agent-loop.mjs'; console.log(JSON.stringify(runRelationshipLoop({messages:[{speaker:'我',text:'最近有空一起喝咖啡吗？'},{speaker:'对方',text:'最近有点忙，之后再说吧。'}]}), null, 2))"
```

输出只包含有界统计、假设、决策、行动和预测，不返回原始聊天，也不会在未同意时写入长期记忆。

## 许可证

根目录没有对第三方材料授予 blanket open-source license。查看 `LICENSE` 和 `THIRD_PARTY_NOTICES.md`。
