/**
 * 场景化训练剧本静态数据
 *
 * 首批 ≥5 个预设剧本，覆盖初聊/邀约/冲突/边界/低谷期等典型场景。
 * 每个剧本的描述不含操控话术，聚焦"如何真实、有分寸地沟通"。
 * 纯前端静态数据，零依赖。
 */

export const scenarios = [
  {
    id: "cold-suddenly",
    title: "她突然冷淡",
    description: "之前聊得还不错，但她最近回复变短、间隔变长。你想了解发生了什么，同时不给她压力。",
    openingMessages: [
      { who: "她", type: "her", text: "嗯。" }
    ],
    recommendedStage: "暧昧推进",
    recommendedPersona: "lin",
    coachFocus: ["boundary", "empathy"],
    contextHint: "她可能只是忙，也可能在重新评估。不要连续追问，先给空间再自然靠近。"
  },
  {
    id: "first-date-rejected",
    title: "第一次邀约被拒",
    description: "你提出周末见面，她拒绝了。你需要处理被拒感受，同时保持关系不冷掉。",
    openingMessages: [
      { who: "她", type: "her", text: "这周末可能不行，最近有点忙。" }
    ],
    recommendedStage: "第一次邀约",
    recommendedPersona: "xu",
    coachFocus: ["boundary", "momentum"],
    contextHint: "被拒不代表结束。重点是不过度解释、不施压，留下后续可能。"
  },
  {
    id: "ghosted-after-date",
    title: "被放鸽子后如何沟通",
    description: "约好的见面她没来，事后才说临时有事。你需要表达感受而不是压抑或爆发。",
    openingMessages: [
      { who: "她", type: "her", text: "对不起，今天真的走不开，下次我请你。" }
    ],
    recommendedStage: "第一次约会后",
    recommendedPersona: "tang",
    coachFocus: ["empathy", "boundary"],
    contextHint: "她的道歉是真的，但这不意味着你不能有感受。关键是具体表达而非指责。"
  },
  {
    id: "ambiguous-boundary-check",
    title: "暧昧期查户口感",
    description: "聊天渐入暧昧，但你发现自己总想确认她的行踪和社交。需要识别并控制这种冲动。",
    openingMessages: [
      { who: "她", type: "her", text: "今晚和朋友吃饭，可能晚点回。" }
    ],
    recommendedStage: "暧昧推进",
    recommendedPersona: "zi",
    coachFocus: ["boundary", "naturalness"],
    contextHint: "她的通知是善意的，不是义务。你的回应决定了她是更愿意分享还是开始防御。"
  },
  {
    id: "low-energy-day",
    title: "她低谷期的沟通",
    description: "她今天状态不好，只回了很短的消息。你想支持她，但不想变成救援者。",
    openingMessages: [
      { who: "她", type: "her", text: "今天有点累，不想说话。" }
    ],
    recommendedStage: "暧昧推进",
    recommendedPersona: "zi",
    coachFocus: ["empathy", "boundary"],
    contextHint: "支持不等于追问。给她选择权：聊、安静、还是只是知道你在。"
  },
  {
    id: "first-night-chat",
    title: "刚加微信的第一晚",
    description: "刚拿到她的微信，这是第一次聊天。需要在礼貌和自然之间找到平衡。",
    openingMessages: [
      { who: "我", type: "me", text: "嗨，我是今天活动里那个。" }
    ],
    recommendedStage: "刚加微信后的第一晚",
    recommendedPersona: "lin",
    coachFocus: ["naturalness", "momentum"],
    contextHint: "第一晚的目标是留下\u201c还好聊\u201d的印象，不是建立深度连接。保持轻松、具体、可结束。"
  }
];
