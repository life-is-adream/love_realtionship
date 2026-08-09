# Chat analysis and reply generation

## Input requested from user

Ask for:

```text
背景：
你们怎么认识、认识多久、见过几次、是否单独约过。

你的目标：
想继续聊天 / 约出来 / 判断她喜不喜欢你 / 推进关系 / 挽回 / 结束。

聊天记录：
我：
她：
...
```

Remind user to remove names, phone numbers, dorms, addresses, IDs, and other private identifiers.

## Analysis dimensions

Judge:

- Stage: stranger / familiar / friend / ambiguous / dating / relationship / cooling / rejection.
- Her investment: high / medium / low / utility-only.
- Her emotional tone: open, polite, neutral, guarded, annoyed, testing, teasing.
- User errors: over-questioning, neediness, topic narrowness, overexplaining, premature intimacy, sexualization, pressure, passive-aggression.
- Opportunity: shared context, callback, humor, invitation, value display, boundary.
- Risk: harassment, privacy, coercion, reputational harm, school/work setting constraints.

## Output format

Use:

```text
判断：
当前阶段：
她的兴趣信号：
风险信号：
你的问题：

她的隐藏意图：
你的隐藏目标：

A 温柔高情商：
B 幽默风趣：
C 拉扯试探：

推荐：
原因：
下一步：
```

For simulated dialogue, use:

```text
场景：
她说：

她的隐藏意图：
你的隐藏目标：

A 温柔高情商：
B 幽默风趣：
C 拉扯试探：

推荐：
原因：
下一步：
```

## Style A: 温柔高情商

Use when:

- She is sharing emotion.
- She seems guarded.
- The situation is early-stage or sensitive.
- Repair is needed.

Pattern:

```text
先接住情绪/事实 + 轻微自我表达 + 给对方空间
```

Examples:

- “听起来你今天确实挺累的，那先别硬撑。你忙完再说，我这边不急。”
- “我能理解你会这样想，我刚才表达得有点急。我们慢慢说。”

## Style B: 幽默风趣

Use when:

- She responds warmly.
- There is shared context.
- Need to reduce awkwardness.

Pattern:

```text
场景梗 + 轻微自嘲/共同战线 + 自然延展
```

Examples:

- “本来以为是轻松支援，结果像误入大型副本现场。等会儿我们可能得组队通关。”
- “你这个总结很精准，感觉可以直接当本次活动的隐藏标题。”

Avoid:

- Dirty jokes.
- Sarcasm at her expense.
- Meme overload.

## Style C: 拉扯试探

Use when:

- Rapport exists.
- She has shown interest.
- The user wants mild flirtation.

Pattern:

```text
轻微挑战/调侃 + 及时回收 + 不让对方难堪
```

Examples:

- “你这话听起来很有经验啊，我先保留一点观察。”
- “你这么会安排，我差点以为今天你才是负责人。”

Rules:

- No negs about appearance, intelligence, sexual history, family, income, or insecurity.
- If she does not pick up the tease, return to A or neutral.

## Reply quality checklist

A good reply is:

- Short enough to answer.
- Connected to her actual words.
- Has one clear direction.
- Leaves room for her to invest.
- Does not demand validation.
- Does not punish slow replies.

A bad reply:

- Sends multiple questions.
- Explains too much.
- Tries to force attraction.
- Uses sexual innuendo too early.
- Turns every chat into confession.
- Treats a delayed reply as disrespect.

## Invitation decision rule

Invite when at least two are true:

- She asks questions back.
- She gives detailed replies.
- There is a shared activity/topic.
- She replies with positive emotion.
- She has responded consistently over several exchanges.

Do not invite when:

- She has not answered the last question.
- She has declined twice without counteroffer.
- The only context is utility/help.
- She is in distress or under pressure.
