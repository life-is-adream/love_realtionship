# Relationship Intelligence System CN

这是一个中文关系成长与决策项目，包含：

- `恋爱15分钟学习/`：160 天预生成课程和课程总纲；
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

`npm run build:index` 已对齐到 `public/modules/content/long-content-index.js`，长篇原文变更后重新运行即可。

## 课程自动化

Codex Automation 15 每天按 Asia/Shanghai 日期读取唯一匹配的已有课程文件，不生成、改写未来课程或临时补课。详见 `AI_HANDOFF.md` 和 `C:\Users\lenovo\.codex\automations\15\automation.toml`。

## 来源、隐私和 Evals

- 来源登记：`sources/registry.yaml`；未知许可证不得猜测。
- 隐私：`PRIVACY.md` 和 `.agents/skills/relationship-coach-cn/core/privacy-policy.md`。
- Evals：`.agents/skills/relationship-coach-cn/evals/`，运行 `node .agents/skills/relationship-coach-cn/evals/run-static-evals.mjs`。
- Runtime 测试：`node --test .agents/skills/relationship-coach-cn/runtime/**/*.test.mjs`。
- 当前静态数据集为 190 条匿名案例；静态 PASS 和本地单元测试不等于已完成 LLM 效果 benchmark。

## Agent loop 示例

```powershell
node --input-type=module -e "import { runRelationshipLoop } from './.agents/skills/relationship-coach-cn/runtime/agent-loop.mjs'; console.log(JSON.stringify(runRelationshipLoop({messages:[{speaker:'我',text:'最近有空一起喝咖啡吗？'},{speaker:'对方',text:'最近有点忙，之后再说吧。'}]}), null, 2))"
```

输出只包含有界统计、假设、决策、行动和预测，不返回原始聊天，也不会在未同意时写入长期记忆。

## 许可证

根目录没有对第三方材料授予 blanket open-source license。查看 `LICENSE` 和 `THIRD_PARTY_NOTICES.md`。
