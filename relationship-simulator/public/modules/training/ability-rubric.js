/** 产品训练规则：行为自评与情境测验，不是心理量表或吸引力预测。 */
export const ABILITY_RUBRIC_VERSION = "2026-10-13-v1";

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const ABILITY_LEVELS = freeze([
  { value: 0, label: "明确待改善", description: "已观察到需要改变的具体行为，目前还做不到这一项。" },
  { value: 1, label: "知道但需提示", description: "知道应该怎样做，实际行动仍需要提醒或准备。" },
  { value: 2, label: "简单情境能做到", description: "在熟悉、压力较小的情境中可以做到。" },
  { value: 3, label: "多种情境较稳定", description: "在不同情境中有多次做到的记录，偶尔仍需调整。" },
  { value: 4, label: "复杂情境能修正", description: "在有压力或意见不同时也能做到，并能发现问题、调整行动。" }
]);

const anchorDescriptions = {
  appearance: ["已有清洁、护理或运动方面的具体问题，尚未形成适合自己的习惯。", "能列出基础准备，但执行需要提醒，尚未检查是否适合自己。", "日常场景能完成基础管理，外出前能检查整洁与合身。", "不同活动中能稳定准备，并根据天气、舒适度和预算调整。", "行程或压力变化时仍能维持合适习惯，发现不适及时调整并复盘。"],
  voice: ["已有抢话、听不清或强迫音色的具体表现，尚不能调整。", "知道音量、语速和停顿的重要性，实际交流仍需提醒。", "熟悉环境中表达清楚，能够讲完一句后留出回应时间。", "不同环境中能根据听者反馈调整音量、语速和表达长度。", "紧张或嘈杂时仍能确认理解、自然调整，并复盘自己的表达。"],
  communication: ["已有忽视具体回应、只顾展示或套用话术的表现，尚未改变。", "知道要倾听与真实表达，但仍需要准备或提示。", "熟悉话题中能回应具体内容、提问和适量分享。", "多种话题中能平衡倾听与表达，清楚说明兴趣和需求。", "意见不同时仍能确认理解、表达自己并根据反馈修正。"],
  emotion: ["已出现冲动追问或指责等具体行动，尚未建立暂停办法。", "能识别情绪，但暂停和恢复日常仍需外部提醒。", "较轻的不确定中能暂停冲动，完成一项原有生活安排。", "多次面对等待或拒绝时能区分事实与猜测，并恢复日常。", "强烈失落或冲突中仍能调节行动、寻求支持并复盘有效办法。"],
  dating: ["已有模糊邀约、坚持计划或忽视疲惫反馈的表现，尚未改进。", "知道要清楚邀约和接受调整，执行仍需逐项准备。", "简单活动中能明确安排、允许拒绝并回应现场反馈。", "不同活动中能安排备选方案，确认双方需要和舒适度。", "临时变化时能共同调整或结束，并用行为过程复盘而非接受率。"],
  boundaries: ["已有需要停止或改变的施压行为，尚未能落实停止。", "知道拒绝与自己的边界应被尊重，实际执行仍需提示。", "简单情境中能接受拒绝、停止追问并表达自己的不舒服。", "多种互动中能确认意愿、表达边界并处理具体分歧。", "有冲突或失落时仍能尊重停止、承担责任，并接受双方结束的选择。"],
  reliability: ["已有失约、拖延说明或默认他人照顾自己的问题，尚未调整。", "知道基本生活和承诺由自己负责，执行仍需提醒。", "熟悉安排中能照顾自己、履行承诺，做不到时及时说明。", "多种安排中能评估承诺、管理时间并主动修复影响。", "工作或生活冲突时仍能尽早沟通、承担影响并改进长期安排。"],
  knowledge: ["已有用性别或一般健康信息替个人下结论的理解，尚未纠正。", "知道信息有局限，但分辨来源和保护隐私仍需提示。", "简单情境中能区分事实与猜测，询问需要并尊重隐私。", "多种情境中能识别来源局限、个体差异和本人选择。", "信息冲突或健康担忧时仍不猜诊断、不替人决定，能支持寻求合适帮助。"]
};

export const ABILITY_DIMENSIONS = freeze([
  {
    id: "appearance", label: "外形与健康管理",
    description: "评估可持续的日常管理和场景适配，不根据身材、肤色、体重变化或他人评价打分。",
    indicators: [
      { id: "appearance_routine", label: "我能保持适合自己的清洁、基础护理和运动安排，并根据不适调整。" },
      { id: "appearance_fit", label: "我能为活动选择整洁、合身、便于行动的穿搭，并提前检查仪容。" }
    ],
    scenario: {
      id: "appearance_preparation", prompt: "两天后有一次约会，你担心状态不够好。你会怎样准备？",
      options: [
        { id: "extreme", label: "临时极端节食并叠加刺激性护理，即使不适也继续。", level: 0, critical: true, feedback: "明显不适时不应硬撑。先停止激进尝试，必要时咨询合适的专业人员；外形准备不能以伤害健康为代价。" },
        { id: "purchase", label: "照着热门清单买很多新东西，约会当天第一次一起用。", level: 1, feedback: "准备应考虑自己的耐受、预算和活动场景；临时堆叠新尝试难以判断是否合适。" },
        { id: "basic", label: "维持熟悉的护理和休息，准备干净合身的衣服。", level: 2, feedback: "完成基础准备是可执行的起点，可以再检查天气、场地和行动便利性。" },
        { id: "adapt", label: "维持熟悉习惯，按天气和活动检查穿搭；发现不适就调整，不追求临时突变。", level: 4, feedback: "这体现了可持续管理、场景适配和及时修正；不需要用外貌变化证明能力。" }
      ]
    },
    nextAction: "为下一次外出列出清洁、穿搭、休息三项准备；一周后复盘可持续性和不适，而非外貌评价。", targetView: "lifestyle"
  },
  {
    id: "voice", label: "声音与现场表达",
    description: "评估清晰度、音量、停顿和倾听配合；不按音色、口音或是否低沉评价。",
    indicators: [
      { id: "voice_clarity", label: "我能用自然舒适的音量和语速表达，让对方听清并留出回应时间。" },
      { id: "voice_adjustment", label: "我能根据环境与对方反馈调整表达，不强压音色或连续抢话。" }
    ],
    scenario: {
      id: "voice_noise", prompt: "聊天的地方有些吵，对方两次表示没有听清。你会怎么做？",
      options: [
        { id: "blame", label: "说对方不认真听，继续用原来的速度讲。", level: 0, feedback: "先确认环境与表达问题，不把听不清解释为态度问题。" },
        { id: "force", label: "刻意压低音色并提高音量，一口气讲完。", level: 1, feedback: "可以调整音量，但不必强迫音色；一次讲太多仍可能影响理解。" },
        { id: "repeat", label: "放慢一点，简短重复刚才的重点。", level: 2, feedback: "简短重述有助于理解，还可以询问是否需要换个安静位置。" },
        { id: "check", label: "简短重述并确认是否听清，征求意见后换位置或暂停话题。", level: 4, feedback: "你结合环境、清晰表达和对方反馈进行调整，也保留了对方的选择。" }
      ]
    },
    nextAction: "录一段一分钟的日常介绍，只检查听得清、语速和停顿；练习一句表达后留出回应时间。", targetView: "practice"
  },
  {
    id: "communication", label: "沟通与兴趣表达",
    description: "评估倾听、回应、自我表达与明确表达兴趣，不按消息数量或回复热度评分。",
    indicators: [
      { id: "communication_listening", label: "我能先听懂对方具体说了什么，再回应或确认，不急着套用话术。" },
      { id: "communication_expression", label: "我能简洁表达自己的想法、欣赏或需求，同时允许对方有不同回应。" }
    ],
    scenario: {
      id: "communication_interest", prompt: "对方说最近在学摄影。你也感兴趣，怎样继续这个话题？",
      options: [
        { id: "takeover", label: "马上长篇展示我的知识，证明自己更懂。", level: 0, feedback: "展示自己之前先回应对方的经历；互动不是知识竞争。" },
        { id: "script", label: "只发一句固定夸奖，接着换成我准备好的话题。", level: 1, feedback: "泛化夸奖很难接住具体分享，可以先问一个与她所说内容有关的问题。" },
        { id: "ask", label: "问她最近喜欢拍什么，并听她说完。", level: 2, feedback: "这是倾听的起点，可以在回应后适量分享自己的真实兴趣。" },
        { id: "exchange", label: "回应她的具体经历，问一个相关问题，适量分享我的兴趣，并留意她是否想继续。", level: 4, feedback: "回应、提问、自我表达和观察反馈结合起来，给双方留出了交流空间。" }
      ]
    },
    nextAction: "练习一次“回应具体内容＋一个问题＋一句真实分享”，复盘是否倾听和留出空间。", targetView: "chat"
  },
  {
    id: "emotion", label: "情绪与自我稳定",
    description: "评估面对不确定、拒绝和冲突时的行动调节，不要求没有负面情绪。",
    indicators: [
      { id: "emotion_pause", label: "我能识别焦虑或愤怒，在冲动发送、指责或追问前暂停。" },
      { id: "emotion_recovery", label: "遇到拒绝或不确定时，我能照顾情绪并回到自己的工作、休息与社交安排。" }
    ],
    scenario: {
      id: "emotion_waiting", prompt: "对方暂时没有回复，你开始反复查看消息。此时怎样处理？",
      options: [
        { id: "accuse", label: "连续追问并指责她让我焦虑。", level: 0, feedback: "焦虑可以被照顾，但不应转成对他人的指责和持续施压。" },
        { id: "suppress", label: "告诉自己不能难受，却继续反复查看。", level: 1, feedback: "承认情绪比要求自己毫无感觉更有帮助，还需要一个具体的暂停动作。" },
        { id: "pause", label: "先暂停查看，做一件自己原本安排的事。", level: 2, feedback: "暂停和恢复日常安排是有效起点，之后可以区分事实与自己的推断。" },
        { id: "regulate", label: "承认焦虑，区分未回复的事实和猜测，暂停追问并恢复日常；需要时向可信任的人求支持。", level: 4, feedback: "你在照顾情绪的同时控制行动，没有把未知情况解释为确定的拒绝或义务。" }
      ]
    },
    nextAction: "记录一次冲动出现时的事实、猜测和暂停动作，安排一个能够回到日常的具体活动。", targetView: "real"
  },
  {
    id: "dating", label: "社交与约会执行",
    description: "评估邀约、安排、现场反馈和复盘；对方接受或拒绝均不是能力分的直接依据。",
    indicators: [
      { id: "dating_invitation", label: "我能提出清楚、负担适当且方便拒绝的邀约，不依赖反复试探。" },
      { id: "dating_feedback", label: "我能安排可调整的活动，照顾自己的需求并确认对方是否自在。" }
    ],
    scenario: {
      id: "dating_change", prompt: "约会中对方说有些累，原计划还有一个活动。你会怎么做？",
      options: [
        { id: "insist", label: "强调我花了很多心思，要求按计划完成。", level: 0, feedback: "准备不能成为要求对方配合的理由；应允许停止或调整活动。" },
        { id: "guess", label: "不询问，擅自决定她其实想继续。", level: 1, feedback: "不要用自己的推测代替对方的反馈，可以提供清楚的选择。" },
        { id: "shorten", label: "询问是否想提前结束，接受她的选择。", level: 2, feedback: "接受调整是有效行动，也可以说明自己的状态并提供可行选项。" },
        { id: "options", label: "确认她想休息还是结束，说明我的状态，给出轻松调整方案并尊重双方选择。", level: 4, feedback: "约会执行包含现场调整与双方感受，不要求完成所有活动或获得肯定结果。" }
      ]
    },
    nextAction: "准备一个简短邀约和两个可调整的活动方案，复盘表达、安排和反馈，不用接受率打分。", targetView: "journey"
  },
  {
    id: "boundaries", label: "边界与关系经营",
    description: "评估尊重意愿、表达自己的边界及修复分歧；亲密与关系推进需要明确意愿。",
    indicators: [
      { id: "boundaries_respect", label: "我能把拒绝、暂停和不明确的意愿认真对待，不追加说服或更换渠道施压。" },
      { id: "boundaries_own", label: "我能表达自己的边界和不舒服，在分歧中提出具体需求并接受结束的选择。" }
    ],
    scenario: {
      id: "boundaries_rejection", prompt: "对方明确说“不想发展恋爱关系”。怎样回应更合适？",
      options: [
        { id: "persuade", label: "继续说服，或者换一个账号联系，证明我的诚意。", level: 0, critical: true, feedback: "明确拒绝需要被尊重。继续说服或更换渠道联系不能作为正常推进；本题表示关键知识待补，不用于指控实际行为。" },
        { id: "bargain", label: "先答应，但要求她给我一个期限，之后再考虑。", level: 1, critical: true, feedback: "接受拒绝不附带再考虑的义务或期限。应停止本次追求，而不是把停止变成交换条件。" },
        { id: "accept", label: "简短表示理解，停止追求并给彼此空间。", level: 2, feedback: "尊重拒绝是有效的关系能力，即使你仍感到失落也不影响这一行动。" },
        { id: "respect", label: "简短接受并停止追求，照顾自己的情绪；是否保持普通联系也尊重双方意愿。", level: 4, feedback: "你同时尊重对方意愿与自己的需要，不以继续联系或关系成功证明能力。" }
      ]
    },
    nextAction: "练习一句清楚接受拒绝的回应和一句表达自己边界的回应，再列出停止追问后的生活安排。", targetView: "practice"
  },
  {
    id: "reliability", label: "生活独立与可靠性",
    description: "评估自我照顾、时间管理、承诺与承担责任，不按收入、消费或礼物价格评分。",
    indicators: [
      { id: "reliability_independence", label: "我能管理基本生活和时间，不把照顾自己的责任默认交给伴侣。" },
      { id: "reliability_commitment", label: "我能作出可履行的承诺；做不到时及时说明、承担影响并调整。" }
    ],
    scenario: {
      id: "reliability_conflict", prompt: "你发现工作安排与已约好的见面冲突，可能无法按时赴约。怎么处理？",
      options: [
        { id: "disappear", label: "不说，等对方到了再解释。", level: 0, feedback: "尽早告知可以减少对方的时间损失；不能把等待和猜测留给对方。" },
        { id: "promise", label: "先保证一定能到，等最后一刻再看。", level: 1, feedback: "不要用无法确认的承诺暂时安抚对方；说明真实的不确定更可靠。" },
        { id: "inform", label: "及时说明可能迟到或取消，向对方致歉。", level: 2, feedback: "及时说明是起点，还可以提供可行的改约选项并接受对方不愿改约。" },
        { id: "repair", label: "尽早说明、承担影响，提供可行的调整选项，尊重对方安排，并改进自己的时间管理。", level: 4, feedback: "可靠性包含及时沟通、修复影响和改进安排，而不是永远没有冲突。" }
      ]
    },
    nextAction: "复盘最近一项承诺：是否可履行、是否及时沟通，给下周安排留出合理余量。", targetView: "real"
  },
  {
    id: "knowledge", label: "生理心理与关系知识",
    description: "评估基础信息辨别、个体差异、同意和隐私；不推断某个人的生理状态、心理或诊断。",
    indicators: [
      { id: "knowledge_individual", label: "我能区分一般知识与个体情况，不根据性别、生理周期或单次消息猜定对方心理。" },
      { id: "knowledge_sources", label: "我能辨别健康信息来源，尊重隐私和本人选择，遇到专业问题寻求合适支持。" }
    ],
    scenario: {
      id: "knowledge_health", prompt: "对方说最近身体不舒服，网上有人建议你根据她的生理周期判断情绪并推荐用药。你会怎么做？",
      options: [
        { id: "diagnose", label: "按网上的周期规律认定原因，替她决定用药和安排。", level: 0, critical: true, feedback: "一般信息不能确定个人的原因或心理，也不能代替本人选择和专业评估。健康信息与自主选择属于关键知识。" },
        { id: "collect", label: "追问私密细节，把网上建议全部转给她。", level: 1, critical: true, feedback: "关心不意味着有权收集私密信息；未经核实的健康建议也不应当作可靠指导。" },
        { id: "ask", label: "询问是否需要实际帮助，不急着判断原因。", level: 2, feedback: "先询问需要并尊重隐私是合适起点；若涉及诊治，应由本人选择合适的专业支持。" },
        { id: "support", label: "询问她需要什么，尊重不想分享；不猜诊断、不替她决定，必要时支持她寻找专业帮助。", level: 4, feedback: "你区分了关心、一般知识与专业判断，也尊重了个体差异、隐私和自主选择。" }
      ]
    },
    nextAction: "完成一次健康信息辨别练习：来源是什么、能说明什么、不能确定什么，以及怎样尊重本人选择。", targetView: "practice"
  }
].map((dimension) => ({ ...dimension, anchors: ABILITY_LEVELS.map((level) => ({ ...level, description: anchorDescriptions[dimension.id][level.value] })) })));
