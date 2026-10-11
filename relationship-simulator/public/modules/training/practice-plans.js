/**
 * 从现实卡点选择练习的纯数据模块。
 * 练习是可调整的行动建议；完成练习不代表对方有兴趣或关系会成功。
 * 自动建议只读取行为自检 weaknessPatterns，不使用依恋标签或分布。
 */

export const PRACTICE_PLANS = Object.freeze([
  {
    id: "opportunity",
    label: "缺少认识人的机会",
    dimension: "initiative",
    goal: "让自己真实喜欢的生活活动留下可自然认识人的空间。",
    exercise: "15分钟准备：用3分钟写下真正愿意参加的兴趣活动，5分钟查看已有的公开活动信息，5分钟确认时间、交通、费用与共同任务，2分钟写下自己愿意参与的部分。",
    realAction: "有合适机会时，按自己的时间和预算参加公开活动，先投入共同任务，再在双方愿意时交流。没有机会时，把一个可行活动放进日程，或在已有兴趣小组中了解参与方式；无需强行寻找聊天对象。",
    observe: "记录自己是否享受活动、场合是否安全、能否自然参与，以及交流中双方是否都有表达空间。没有产生新联系也可以据此调整活动选择。",
    stopCondition: "对方拒绝交谈、忙于其他事或表示想独处时结束接触；场合不安全、活动不适合或自己不舒服时可以退出。",
    courseNumbers: [1, 2, 7, 33]
  },
  {
    id: "opening",
    label: "想开口但迟迟不行动",
    dimension: "initiative",
    goal: "用具体情境和真实自我表达，开始一个双方容易接住的交流。",
    exercise: "15分钟准备：3分钟选一个真实共同情境，4分钟写一句观察和一句自己的感受，5分钟朗读并删去套话，3分钟练习对方愿聊、忙碌和拒绝三种回应后的收尾。",
    realAction: "在适合交谈、双方自愿的场合，用共同情境开场并分享一点自己的兴趣，再给对方选择是否继续。没有机会时，先与愿意陪练的朋友练习，或录音检查语速和自然度。",
    observe: "记录自己是否说出了真实内容、是否留出回应时间，以及对方有没有主动展开；礼貌回应先保留为信息不足。",
    stopCondition: "对方拒绝、转向其他事或没有接话意愿时礼貌结束；不靠连续追问、反复添加联系方式或换渠道联系延长互动。",
    courseNumbers: [4, 6, 9, 11]
  },
  {
    id: "connection",
    label: "聊天停在礼貌或追问",
    dimension: "curiosity",
    goal: "在倾听、分享、具体欣赏和轻松幽默中，建立有温度的来回。",
    exercise: "15分钟准备：3分钟选一个近期的小体验，4分钟写成简短故事，5分钟练习先回应对方感受再分享自己，3分钟加一句基于真实细节的欣赏或温和幽默。幽默避开对方的外貌、隐私和弱点。",
    realAction: "已有自然交流且双方有精力时，回应对方说过的细节，分享一个真实体验，并在双方感兴趣时一起讨论或完成一件小事。没有机会时，与愿意陪练的朋友互换故事，练习倾听和反馈。",
    observe: "记录双方是否都有分享、自己是否自在、对方是否接住话题；区分对方实际说的话和自己对其情绪的猜测，也留意相处是否让双方舒服。",
    stopCondition: "对方疲惫、想结束、不愿谈该话题或对玩笑不舒服时停下并调整；不以挖隐私、取笑、制造嫉妒或情绪索取换取回应。",
    courseNumbers: [5, 10, 11, 25, 35, 36, 82]
  },
  {
    id: "invitation",
    label: "有交流但约不出来",
    dimension: "timing",
    goal: "依据已有互惠，提出符合双方兴趣且容易拒绝的具体邀请。",
    exercise: "15分钟准备：3分钟列出双方明确提过的兴趣，5分钟设计方便退出的公开活动，4分钟写清活动、时间和可选择的安排，3分钟练习接受同意、暂不确定和拒绝。",
    realAction: "双方已有自然来回且未表达拒绝时，提出与共同兴趣有关的轻量邀请，方便的话再一起确认细节。没有合适对象或互惠依据时，先为自己安排该活动，并用模拟练习邀请和体面收尾。",
    observe: "记录对方是否明确愿意、是否参与安排、实际是否成行，以及自己是否也想去。对方忙碌或取消时保留未知，以其主动回应和具体安排更新判断。",
    stopCondition: "收到拒绝就接受；对方不回应、取消且未提出继续安排的意愿时停止推进，回到自己的生活。双方都可以在任何阶段改变安排。",
    courseNumbers: [13, 14, 38, 44, 48]
  },
  {
    id: "compatibility",
    label: "不确定是否适合继续",
    dimension: "boundaries",
    goal: "同时观察自己与对方的感受、投入和生活方向，做双向选择。",
    exercise: "15分钟准备：3分钟写出自己的需要与底线，5分钟分开列出已观察到的行为和未知，4分钟准备一个关于生活安排的开放问题，3分钟写下愿意协商和需要退出的条件。",
    realAction: "双方愿意继续了解时，在自然相处中谈一件真实的生活选择，清楚表达自己的偏好，也听取对方的需要；有共同意愿时合作安排小活动。没有现实机会时，复盘一段匿名经历或模拟不同偏好下的协商。",
    observe: "记录自己能否自在表达、双方是否倾听与调整、承诺是否有对应行为，以及生活方向的分歧能否协商；喜欢与不适可以同时存在，不急于给匹配度打分。",
    stopCondition: "核心底线无法协商、自己不愿继续或对方拒绝时结束推进；出现胁迫、威胁、控制或持续侵犯边界时优先退出并寻求适当支持。",
    courseNumbers: [15, 17, 22, 50, 58, 59, 85]
  },
  {
    id: "uncertainty",
    label: "等待或受挫时反复分析",
    dimension: "timing",
    goal: "容纳暂时未知，照顾自己的感受，并保留对方的选择空间。",
    exercise: "15分钟准备：3分钟写下能核实的事实，4分钟分开写自己的感受与猜测，5分钟做散步、呼吸或整理等恢复活动，3分钟决定一个自己可执行的生活安排和停止追问的条件。",
    realAction: "等待回复或受挫时，先回到已安排的工作、休息或社交；确有需要且双方仍愿意交流时，清楚表达自己的需求。没有现实情境时，用模拟的延迟回复或拒绝练习暂停、接受和恢复生活。",
    observe: "记录自己能否减少重复查看和冲动发送、生活是否恢复，以及后来出现了什么新事实；不把回复速度当成自我价值，也不把未知改写成对方的心理结论。",
    stopCondition: "对方明确拒绝、要求停止或拉黑时不再联系；情绪很强时暂停推进，向可信任的人寻求支持。暂停用于照顾自己，不用于惩罚对方或测试其在乎程度。",
    courseNumbers: [19, 20, 37, 51, 53, 56]
  }
].map((plan) => Object.freeze({
  ...plan,
  courseNumbers: Object.freeze([...plan.courseNumbers])
})));

/** 返回已定义的卡点；不把未知值强行归类。 */
export function getPracticePlan(id) {
  if (typeof id !== "string") return null;
  return PRACTICE_PLANS.find((plan) => plan.id === id) || null;
}

const BEHAVIOR_RECOMMENDATIONS = Object.freeze({
  "action-paralysis": Object.freeze({
    id: "opening",
    reason: "你的行为自检提到行动迟疑，可以先练习一个可退、可结束的开场；是否适合你仍以现实卡点为准。"
  }),
  interrogation: Object.freeze({
    id: "connection",
    reason: "你的行为自检提到连续追问，可以先练习回应细节、分享自己和留出对方表达空间。"
  }),
  "rationalize-emotion": Object.freeze({
    id: "connection",
    reason: "你的行为自检提到偏重分析情绪，可以先练习倾听感受、询问需要，再分享自己的体验。"
  }),
  "impulsive-escalation": Object.freeze({
    id: "uncertainty",
    reason: "你的行为自检提到冲动推进，可以先练习暂停、检查已有互惠和接受暂时未知。"
  }),
  overthinking: Object.freeze({
    id: "uncertainty",
    reason: "你的行为自检提到反复分析，可以先分开事实与猜测，再把注意力放回可执行的生活安排。"
  }),
  "avoidant-withdrawal": Object.freeze({
    id: "uncertainty",
    reason: "你的行为自检提到在不确定时撤退，可以先练习照顾情绪，并在双方愿意时清楚表达自己的需要。"
  })
});

/**
 * 使用列表中首个已识别的行为自检作为可改选的建议。
 * 画像不足、字段类型错误或仅含未知行为时返回 null。
 */
export function recommendPracticePlan(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null;
  if (!Array.isArray(profile.weaknessPatterns)) return null;
  for (const pattern of profile.weaknessPatterns) {
    if (typeof pattern !== "string") continue;
    const key = pattern.trim();
    if (Object.hasOwn(BEHAVIOR_RECOMMENDATIONS, key)) {
      return { ...BEHAVIOR_RECOMMENDATIONS[key] };
    }
  }
  return null;
}
