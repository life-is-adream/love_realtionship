# 对话风格与记忆护栏：真实上游抽样（2026-11-07）

- 上游：本机 `/api/chat` 代理 → `mimo-v2.6-flash`（chat_completions）；脚本不回显凭证
- 提示词版本：`1.8.0`
- 场景：`test/fixtures/chat-style-cases.json` 共 7 个合成场景 × 3 种风格
- 实际发往上游：15 次；本地护栏拦截：6 次
- 上游成功：15/15；编造未提及城市：0 条
- 单回合 ≥2 个问句：0 条；以系统视角确认记忆状态：0 条
  - 问句数为分句启发式计数（问号结尾 + 疑问词/语气词收尾），只用于观察「连问」倾向，不是质量评分。

| 场景 | 风格 | 来源 | 耗时 | 问句 | 编造城市 | 回复摘要 |
| --- | --- | --- | --- | --- | --- | --- |
| greeting | daily | model | 1.2s | 1 | — | 早，哪家店？在哪条路上 |
| greeting | humorous | model | 1.2s | 1 | — | 早，哪家店？拍个照看看 |
| greeting | gentle | model | 1.2s | 0 | — | 早，新开的咖啡店啊，看着挺新鲜的。 |
| negative-emotion | daily | model | 1.0s | 0 | — | 烦的时候就先放一放，别硬扛。 |
| negative-emotion | humorous | model | 1.0s | 0 | — | 烦的话就先歇会儿，别硬扛 |
| negative-emotion | gentle | model | 19.0s | 0 | — | 辛苦了，先歇会儿吧。 |
| direct-question | daily | model | 1.3s | 1 | — | 挺好的呀，你想去看哪个展？ |
| direct-question | humorous | model | 1.1s | 1 | — | 可以啊，你想看哪个展？ |
| direct-question | gentle | model | 1.3s | 1 | — | 挺好的呀，周末去看展放松一下，你想看哪个展？ |
| stop-chat | daily | model | 3.1s | 0 | — | 好，那先这样，晚点再聊。 |
| stop-chat | humorous | model | 1.1s | 0 | — | 好，那先这样，回头聊。 |
| stop-chat | gentle | model | 1.7s | 0 | — | 好，那先这样，晚点再聊。 |
| ai-identity | daily | 护栏/identity | — | 0 | — | 我是 AI 模拟角色，不是真人。 |
| ai-identity | humorous | 护栏/identity | — | 0 | — | 我是 AI 模拟角色，不是真人。 |
| ai-identity | gentle | 护栏/identity | — | 0 | — | 我是 AI 模拟角色，不是真人。 |
| unknown-fact | daily | 护栏/memory-guard | — | 1 | — | 我这边没有可靠记录，你愿意再告诉我一次吗？ |
| unknown-fact | humorous | 护栏/memory-guard | — | 1 | — | 我这边没有可靠记录，你愿意再告诉我一次吗？ |
| unknown-fact | gentle | 护栏/memory-guard | — | 1 | — | 我这边没有可靠记录，你愿意再告诉我一次吗？ |
| memory-edit-delete | daily | model | 7.5s | 0 | — | 嗯，那我按现在知道的来。 |
| memory-edit-delete | humorous | model | 4.1s | 0 | — | 好，那我按现在知道的说 |
| memory-edit-delete | gentle | model | 2.1s | 0 | — | 好，我知道了，按现在的来。 |
