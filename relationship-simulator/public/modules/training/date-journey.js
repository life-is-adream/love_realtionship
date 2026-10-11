/**
 * 六阶段连续约会模拟。纯函数，不读 DOM、存储或模型，不保存练习原文。
 *
 * createDateJourney(scenarioId = "gallery") -> 仅含枚举、次数、模拟观察和规则反馈的会话。
 * getDateJourneyScene(session) -> 当前情境、练习目标、四种可观察模拟回应。
 * submitDateJourneyResponse(session, text) / retryDateJourneyResponse(session, text)
 *   -> 更新表达反馈；不改变观察、阶段或关系决策，也不返回 text。
 * recordDateJourneyObservation(session, branch) -> 将所选模拟回应锁定。
 * advanceDateJourney(session) -> 仅在本阶段明确积极回应时进入下一阶段。
 * beginDateJourneyFollowup(session) -> 模糊回应后，模拟对方主动补充新证据；
 *   保留原观察，绝不以改写答案代替新证据。
 * stopDateJourney(session) -> 学习者自主退出；停止不可由重练覆盖。
 * invalidateDateJourneyResponse(session) -> 草稿变化后标记反馈失效，保留结构化改进基线。
 *
 * 分支 positive / uncertain / declined / incompatible 描述假设场景中的行为，
 * 不代表真人的心理、喜欢概率或真实关系结果。表达检查仅是本地启发式。
 */

export const DATE_JOURNEY_BRANCHES = Object.freeze(["positive", "uncertain", "declined", "incompatible"]);
export const DATE_JOURNEY_STAGES = Object.freeze([
  "initial-contact", "first-meeting", "after-date", "second-invitation", "express-interest", "relationship-talk"
]);
export const DATE_JOURNEY_SCENARIOS = Object.freeze([
  Object.freeze({ id: "gallery", label: "一起看展", description: "公开速写活动中初识，逐步了解彼此。" }),
  Object.freeze({ id: "sport", label: "兴趣活动与运动", description: "成人羽毛球兴趣活动中认识，练习合作与倾听。" }),
  Object.freeze({ id: "friends", label: "朋友聚会", description: "成年人的朋友聚会中认识，练习轻松分享与双向选择。" })
]);

const SCENES = [
  {
    title: "初识：把兴趣变成自然连接",
    context: "你们都是成年人，在公开的城市速写活动中认识。对方指着一幅街景说：我很喜欢这种把普通生活画得有意思的感觉，也想找个周末看看附近的展览。",
    task: "回应一个具体细节，再分享自己的兴趣或一小段经历。可以轻松幽默、具体欣赏，也可以提出一个容易拒绝的小邀请；选一种自然表达即可。",
    focus: "具体欣赏 · 自我表达 · 轻松幽默",
    rubric: ["回应具体细节", "分享一点自己的兴趣或故事", "保留对方选择空间"],
    responses: {
      positive: "对方主动接着聊，并同意周六在公开展览见面，与你确认了时间。",
      uncertain: "对方说：听起来不错，最近安排还不确定；没有约定时间。",
      declined: "对方说：谢谢邀请，不过我不想单独见面。",
      incompatible: "你发现对方想立刻排他交往，而你只接受慢慢了解；双方都不愿改变这一点。"
    }
  },
  {
    title: "见面相处：让对话有温度",
    context: "双方按约在展览见面，之后坐在附近的咖啡店。对方分享：我平时会画小漫画，但这周工作累，已经好几天没画了。对方也问起你的兴趣。",
    task: "先回应对方的感受，再用一个小故事或轻松观察分享自己的生活。若提问，留一个容易回答的问题；留意双方是否都能自在表达。",
    focus: "倾听 · 生活故事 · 情绪支持",
    rubric: ["回应感受而非急着解决", "给出自己的具体经历", "避免连续盘问"],
    responses: {
      positive: "对方分享更多细节、主动问你的经历，并表示今天相处舒服、愿意再见。",
      uncertain: "对方礼貌回答，较少接话；你还不知道是疲惫还是不想继续了解。",
      declined: "对方明确说：我觉得我们不适合以约会的方式继续。",
      incompatible: "相处后你发现双方对待服务人员的态度与基本尊重底线持续冲突，不愿继续。"
    }
  },
  {
    title: "约会后：回应开心，也容纳疲惫",
    context: "第一次见面结束后，你想表达一个真实的愉快时刻。对方发来：今天看到那幅漫画很开心，不过我现在有点累，准备休息了。",
    task: "回应共同经历，也给对方休息的空间。不要把晚安、秒回或一时热情当作关系承诺。",
    focus: "共同体验 · 情绪支持 · 节奏",
    rubric: ["回应共同经历或感受", "允许收尾和休息", "不要求立刻回复"],
    responses: {
      positive: "对方休息后主动分享当天照片，并明确提出下次一起看展。",
      uncertain: "对方之后只回了一个表情，没有提出新话题或见面安排。",
      declined: "对方说：谢谢今天的相处，但我不想继续约会。",
      incompatible: "你们坦诚讨论后，发现双方无法接受彼此需要的联系频率，也找不到共同可行的安排。"
    }
  },
  {
    title: "再次邀约：让意愿落实到安排",
    context: "对方已经主动提出想再看展。你也希望再见，并知道附近周末有一个小型插画展。现在还没有具体约定。",
    task: "用自己的话提出时间、公开活动和选择余地。表达自己的偏好，也问对方是否方便；不把忙碌或改期解释成心理测试。",
    focus: "具体邀约 · 双向安排 · 可拒绝",
    rubric: ["有时间和活动信息", "询问对方意愿或便利", "不给拒绝附加情绪代价"],
    responses: {
      positive: "对方确认愿意参加；若原时间不方便，主动提出可行的替代时间，双方确认安排。",
      uncertain: "对方说：最近有点忙，之后再说吧；没有提供替代安排。",
      declined: "对方说：我不想再见面，请不要继续邀请。",
      incompatible: "双方发现其中一人只想随意约会、另一人只接受以长期关系为目标的交往，无法协调。"
    }
  },
  {
    title: "表达好感：清楚表达，容纳不同答案",
    context: "第二次见面按约完成。双方都主动分享了生活，也都兑现了安排。你发现自己希望继续以约会的方式了解对方，但尚未讨论双方的关系意愿。",
    task: "表达你具体喜欢的相处体验和自己的意愿，问对方是否也愿意继续了解。允许不同答案，不要求立即给关系名分。",
    focus: "具体欣赏 · 坦诚好感 · 不确定性",
    rubric: ["表达自己的感受而非猜对方心理", "询问双向意愿", "允许不同答案或考虑时间"],
    responses: {
      positive: "对方明确表示也愿意继续约会了解，并同意找时间讨论双方期待。",
      uncertain: "对方说：我还没想清楚，希望慢一点；没有承诺交往。",
      declined: "对方说：我对你没有恋爱意愿，希望停在这里。",
      incompatible: "双方表达真实期待后，确认对排他关系有无法协商的分歧，决定不继续推进。"
    }
  },
  {
    title: "关系协商：一起判断是否合适",
    context: "双方都明确愿意继续约会。你希望稳定联系，未来可能异地；对方重视自己的生活空间，也还没有确定长期居住计划。你们正在讨论关系期待。",
    task: "表达一项自己的需求、偏好或底线，询问对方的期待，并提出双方可以协商的小安排。把仍未知的事留作后续观察，也允许自己发现不合适。",
    focus: "双向择偶 · 生活方向 · 可协商边界",
    rubric: ["表达自己的需求或边界", "询问对方同样重要的期待", "区分可协商与不可接受"],
    responses: {
      positive: "双方确认都愿意交往，并一起约定联系节奏和再次讨论未定事项的时间。",
      uncertain: "双方仍无法确认是否愿意交往，决定先给彼此时间，不默认已经建立关系。",
      declined: "对方明确表示不想建立恋爱关系，决定结束约会探索。",
      incompatible: "双方确认长期方向或核心底线无法协调，体面结束探索。"
    }
  }
];

// 复用六阶段的目标、边界和停止规则；替换情境与可观察回应，保持一轮故事连贯。
const SCENARIO_DATA = {
  sport: [
    { context: "你们都是成年人，在公开的羽毛球兴趣活动中认识。对方说：我刚开始练发球，虽然常常打偏，但和大家一起玩挺开心。也想找个周末继续参加活动。",
      task: "回应练球的具体细节，分享自己的一个小经历或轻松观察。可以提出一起参加公开活动的小邀请；不嘲笑技术，不默认运动伙伴就有恋爱意愿。",
      responses: { positive: "对方主动分享练球经历，并明确同意周六一起参加公开球场活动，与你确认了时间。" } },
    { context: "双方按约参加球场活动，休息时坐在场边聊天。对方分享：练球让我放松，不过这周工作累，今天可能会早点回去。对方也问起你平时怎样放松。",
      responses: { positive: "对方主动问你的生活、分享自己的兴趣，并表示一起活动舒服、愿意再见。" } },
    { context: "第一次一起活动结束后，对方发来：今天那个打偏的球让我笑了好久，和大家一起玩很开心。不过我有点累，想早点休息。",
      responses: { positive: "对方休息后主动分享活动照片，并明确提出下次继续一起参加球场活动。" } },
    { context: "对方已经主动提出想再次一起参加羽毛球活动。你也想再见，知道周末公开球场有一场轻松的兴趣活动，现在还没有具体约定。",
      responses: { positive: "对方确认愿意参加下次球场活动，并和你一起确认可行的时间与活动安排。" } },
    { context: "第二次球场活动按约完成。双方都主动聊生活，也尊重了休息和运动节奏。你发现自己想以约会的方式进一步了解对方，但运动合作并不等于对方有同样的想法。",
      responses: { positive: "对方明确表示也愿意以约会的方式继续了解，并同意找时间讨论双方期待。" } },
    { context: "双方都明确愿意继续约会了解。你希望稳定联系，也想保留自己的运动和朋友时间；对方重视独处，未来工作地点尚未确定。你们正在讨论双方期待。" }
  ],
  friends: [
    { context: "你们都是成年人，在共同朋友的聚会中第一次见面。对方聊起刚才的桌游说：那一局的反转很好笑，我平时也喜欢这样轻松地和朋友见面。还提到想试试附近的桌游咖啡店。",
      task: "接住聚会中的一个具体趣事，分享自己的经历或兴趣。可以具体欣赏、自然幽默，或提出公开场所的小邀请；不通过朋友施压，不假设介绍就代表合适。",
      responses: { positive: "对方主动接着聊，并明确同意周六在公开的桌游咖啡店见面，与你确认了时间。" } },
    { context: "双方按约在桌游咖啡店见面。聊起日常时，对方说：我喜欢和朋友做饭，不过这周很忙，下班只想休息。对方也问你有什么放松的小习惯。",
      responses: { positive: "对方分享更多生活细节、主动问你的经历，并明确表示今天相处舒服、愿意再见。" } },
    { context: "第一次见面结束后，对方发来：今天那局桌游的反转太好笑了，聊天也很开心。不过我有点累，准备休息了。",
      responses: { positive: "对方休息后主动提起当天的趣事，并明确提出下次一起逛白天的美食市集。" } },
    { context: "对方已经主动提出想一起逛美食市集。你也希望再见，知道附近周末白天有公开的美食活动，现在还没有具体约定。",
      responses: { positive: "对方确认愿意参加市集活动，并与你一起确认可行的时间、地点和安排。" } },
    { context: "第二次在美食市集的见面按约完成。双方主动分享了生活，也都兑现了安排。你希望继续以约会的方式了解对方；共同朋友的介绍和两次愉快见面并不能替代对方的直接意愿。",
      responses: { positive: "对方明确表示也愿意继续约会了解，并同意找时间讨论彼此的关系期待。" } },
    { context: "双方都明确愿意继续约会。你希望稳定联系，保留与朋友相处的时间；对方重视生活空间，未来居住计划仍未确定。你们正在讨论联系节奏和关系期待。" }
  ]
};

function scenarioIdOf(value) {
  return DATE_JOURNEY_SCENARIOS.some((item) => item.id === value) ? value : "gallery";
}

function scenesFor(value) {
  const overrides = SCENARIO_DATA[scenarioIdOf(value)];
  return overrides ? SCENES.map((scene, index) => ({ ...scene, ...overrides[index], responses: { ...scene.responses, ...overrides[index].responses } })) : SCENES;
}

const BRANCH_LABELS = Object.freeze({ positive: "明确互惠", uncertain: "证据仍模糊", declined: "明确拒绝", incompatible: "双方不合适" });

function copyJourney(value = {}) {
  const stageIndex = Math.max(0, Math.min(SCENES.length - 1, Math.trunc(Number(value.stageIndex) || 0)));
  const history = (Array.isArray(value.history) ? value.history : []).slice(-30)
    .filter((item) => DATE_JOURNEY_STAGES.includes(item?.stage) && DATE_JOURNEY_BRANCHES.includes(item?.branch))
    .map((item) => ({ stage: item.stage, branch: item.branch, kind: item.kind === "followup" ? "followup" : "initial" }));
  const stopEvent = history.find((item) => ["declined", "incompatible"].includes(item.branch));
  const stopReason = stopEvent?.branch || (["declined", "incompatible", "self-exit"].includes(value.stopReason) ? value.stopReason : null);
  const observation = DATE_JOURNEY_BRANCHES.includes(value.observation) ? value.observation : null;
  const stopped = stopReason || ["declined", "incompatible"].includes(observation) || value.status === "stopped";
  const status = stopped ? "stopped" : value.status === "complete" ? "complete" : observation === "uncertain" ? "paused" : "active";
  return {
    scenarioId: scenarioIdOf(value.scenarioId), stageIndex, status, observation, history,
    decision: stopped ? "EXIT" : ["ADVANCE", "MAINTAIN", "OBSERVE", "DE_ESCALATE"].includes(value.decision) ? value.decision : "OBSERVE",
    stopReason: stopped ? stopReason || (["declined", "incompatible"].includes(observation) ? observation : "self-exit") : null,
    followup: Boolean(value.followup),
    attempts: Math.max(0, Math.min(100, Math.trunc(Number(value.attempts) || 0))),
    lastFeedback: value.lastFeedback ? { ...value.lastFeedback,
      strengths: [...(value.lastFeedback.strengths || [])], improvements: [...(value.lastFeedback.improvements || [])],
      features: [...(value.lastFeedback.features || [])], issues: [...(value.lastFeedback.issues || [])] } : null
  };
}

export function createDateJourney(scenarioId = "gallery") {
  return copyJourney({ scenarioId });
}

export function getDateJourneyScene(value) {
  const session = copyJourney(value);
  const scenes = scenesFor(session.scenarioId);
  const scene = scenes[session.stageIndex];
  const previous = [...session.history].reverse().find((item) => item.stage !== DATE_JOURNEY_STAGES[session.stageIndex]);
  const current = [...session.history].reverse().find((item) => item.stage === DATE_JOURNEY_STAGES[session.stageIndex]);
  const expressedInterest = session.history.some((item) => item.stage === "express-interest" && item.branch === "positive");
  const agreedRelationship = session.history.some((item) => item.stage === "relationship-talk" && item.branch === "positive");
  const terminal = session.status === "stopped";
  return {
    id: DATE_JOURNEY_STAGES[session.stageIndex], index: session.stageIndex, title: scene.title, scenarioId: session.scenarioId,
    context: terminal ? (session.stopReason === "self-exit" ? "你已经决定不继续这段模拟约会探索。你可以表达自己的选择，不需要争取对方批准。" : scene.responses[session.stopReason])
      : session.followup ? `${scene.context} 你给了对方空间，没有追加催促。现在模拟对方主动补充新回应；这属于一条新证据，前一次模糊回应仍保留。` : scene.context,
    task: terminal ? "如果你愿意，练习一次简短、尊重的收尾。接受双方选择，不追加邀约、不说服、不讨价还价。改写收尾不会改变已停止的结果。" : scene.task,
    focus: terminal ? "接受选择 · 体面收尾 · 恢复自己的生活" : scene.focus,
    rubric: terminal ? ["确认选择", "停止推进", "不要求解释或回报"] : [...scene.rubric],
    previousEvidence: previous ? scenes[DATE_JOURNEY_STAGES.indexOf(previous.stage)].responses[previous.branch] : "目前只有共同活动中的初次交流，没有关系承诺。",
    currentEvidence: current ? scene.responses[current.branch] : null,
    responses: DATE_JOURNEY_BRANCHES.map((branch) => ({ branch, label: BRANCH_LABELS[branch], observation: scene.responses[branch] })),
    unknowns: terminal ? ["对方未表达的内心想法仍未知；停止不以解释是否充分为条件。"]
      : [agreedRelationship ? "未来相处和约定能否持续兑现，仍需要实际观察。" : expressedInterest ? "是否建立关系、是否排他仍需直接协商；继续约会的意愿不能替代这些同意。" : "是否有恋爱意愿仍需双方直接表达，共同兴趣或轻松相处不能替代。", "长期兼容性仍需要现实行为与协商来验证。"],
    counterEvidence: terminal ? session.stopReason === "self-exit" ? "这是你自己的退出决定；没有据此推断对方拒绝或双方存在不可协调的分歧。" : "明确拒绝或无法协调的分歧已经阻止推进；表达更顺畅不能撤销这一点。"
      : "礼貌、共同兴趣、开心或单次主动都不足以证明恋爱意愿；疲惫和忙碌也可能是模糊回应的替代解释。"
  };
}

function critique(session, value) {
  const text = String(value || "").trim().slice(0, 1200);
  if (!text) return { current: true, hasResponse: false, blocked: false, features: [], issues: [], strengths: [], improvements: ["先用自己的话写一条回复，再查看反馈。"], comparison: "" };
  // 忽略明确否定催促的局部表达；剩余强迫措辞仍单独检查。
  const checked = text.replace(/(?:不必|不用|无需|不需要|不要|别)(?:再)?(?:马上|立刻|必须|一定要|现在就|证明|给(?:我)?个?准话)/g, "")
    .replace(/(?:不会|不想|不能|不应该|不要|别|停止|不再|拒绝)(?:去|再)?(?:公开|曝光|泄露|散布|骚扰|跟踪|逼迫|威胁|强迫)(?:你(?:的)?|我(?:的)?|对方(?:的)?)?(?:聊天记录|聊天截图|截图|隐私|私密照片|私密信息)?/g, "")
    .replace(/(?:不接受|不能接受|拒绝)(?:任何|你的|对方的)?(?:威胁|骚扰|胁迫|跟踪|偷拍)/g, "");
  const pressure = /必须.{0,12}(?:答应|出来|见我|回复|回我|给|解释|和我)|现在就(?:答应|决定|给|回)|不答应.{0,8}(?:就是|说明)|欠我|吊着我|装矜持|证明你.{0,6}喜欢|不给.{0,8}就|不回.{0,8}就|不见.{0,8}就/.test(checked);
  const threat = /(?:公开|曝光|泄露|散布|发给|发到).{0,16}(?:聊天|截图|隐私|私密|同事|父母|家人)|(?:把|将).{0,12}(?:聊天记录|聊天截图|隐私|私密).{0,12}(?:发|给|传|公开|曝光)|(?:打你|伤害你|弄死|报复|威胁|逼迫|胁迫|强迫)/.test(checked);
  const harassment = /跟踪|尾随|偷拍|骚扰|死缠|纠缠|(?:去|到).{0,10}(?:你家|家门|学校|公司|单位).{0,6}(?:堵|守)|(?:一直|天天|每天|连续).{0,6}(?:发消息|打电话).{0,14}(?:直到|答应|回复)/.test(checked);
  const questions = (text.match(/[？?]/g) || []).length;
  const assumptions = /(?:肯定|一定|绝对)(?:是)?喜欢我|(?:你|对方).{0,3}(?:肯定|一定|绝对).{0,5}(?:喜欢|爱|想和我|故意)|(?:你|对方)(?:就是|是在|在).{0,6}(?:考验|试探|欲擒故纵|装矜持)/.test(checked);
  const selfExpression = /我(?:也|觉得|喜欢|希望|需要|想|在意|会|平时|之前|上次)|对我来说/.test(text);
  const care = /听起来|辛苦|累|开心|难过|休息|能理解|谢谢.{0,8}分享/.test(text);
  const choice = /方便|愿意|可以|你觉得|你希望|你需要|你的.{0,5}(?:想法|期待)|不勉强|没关系|慢慢|考虑|不急|不同/.test(text);
  const topic = session.scenarioId === "sport" ? /羽毛球|球场|发球|练球|运动|打偏|放松/ : session.scenarioId === "friends" ? /朋友|聚会|桌游|反转|做饭|市集|美食/ : /画|展|街景|漫画|速写|那幅/;
  const detail = topic.test(text) || /咖啡|周末|周六|周日|这周|下周|照片|刚才|上次|异地|联系|空间|底线|生活/.test(text);
  const time = /(?:周[末六日]|这周|下周|明天|后天|星期|[一二三四五六七八九十\d]+点)/.test(text);
  const strengths = [];
  const improvements = [];
  const issues = [];
  const features = [];
  if (threat) { issues.push("threat"); improvements.push("检测到威胁、胁迫或公开隐私的内容。停止这些行为，先改成尊重选择、不侵害隐私的表达。"); }
  if (harassment) { issues.push("harassment"); improvements.push("检测到可能骚扰、跟踪或反复纠缠的表达。停止追逐，让双方都可以退出。"); }
  if (pressure) issues.push("pressure");
  if (pressure) improvements.push("检测到可能催促、强迫或制造内疚的表达。先去掉这些内容，让对方能够拒绝。");
  if (assumptions) issues.push("assumptions");
  if (assumptions) improvements.push("把对方心理写成了定论。改成自己的感受或一个能被实际回应的问题。");
  if (questions > 1) improvements.push("问题较密集。优先接住对方已经分享的内容，只留一个容易回应的问题。");
  if (session.status === "stopped") {
    const continuationText = text.replace(/(?:不再|不会再|不想再|无需再)(?:约|见|考虑|给我|邀请|联系|追求)/g, "");
    if (/再(?:约|见|考虑|给我)|再给.{0,6}机会|说服|为什么.{0,6}(?:拒绝|不喜欢)|我会等你/.test(continuationText)) { issues.push("continuedPursuit"); improvements.push("结果已经停止。收尾中去掉追加邀请、索要理由或等待对方改变的承诺。"); }
    if (/尊重|明白|理解|谢谢|祝|不再|到这里|不继续|停止/.test(text)) { features.push("closure"); strengths.push("表达中确认了选择或收尾。"); }
    else improvements.push("可以明确确认选择，并把行动停在这里。");
  } else {
    if (detail) { features.push("detail"); strengths.push("回应中出现了具体情境。"); }
    if (selfExpression) { features.push("selfExpression"); strengths.push("表达了自己的兴趣、感受或需要。"); }
    if (care) { features.push("care"); strengths.push("回应中出现了对感受或休息的关注。"); }
    if (choice) { features.push("choice"); strengths.push("表达中为对方保留了选择或不同答案。"); }
    if (time && session.stageIndex === 3) features.push("time");
    if ([1, 2].includes(session.stageIndex) && !care) improvements.push("先回应对方的感受或共同经历，再分享或提问；不急着提供解决方案。");
    if ([0, 1, 4, 5].includes(session.stageIndex) && !selfExpression) improvements.push("加入一点真实的自我表达或小故事，让对方也有机会了解你。");
    if ([0, 3, 4, 5].includes(session.stageIndex) && !choice) improvements.push("给对方表达意愿、偏好或不同答案的空间。");
    if (session.stageIndex === 3 && !time) improvements.push("邀约可以补一个可协商的时间，让双方更容易确认安排。");
    if (!detail && improvements.length < 3) improvements.push("回应一个对方已经提到的具体细节，比泛泛评价更容易连接。");
  }
  if (!improvements.length) improvements.push("表达检查未发现明显问题。接下来仍以双方真实意愿和行为为准。");
  return { current: true, hasResponse: true, blocked: issues.length > 0, features, issues, strengths: strengths.slice(0, 3), improvements: improvements.slice(0, 3), comparison: "" };
}

export function invalidateDateJourneyResponse(value) {
  const session = copyJourney(value);
  return session.lastFeedback ? { ...session, lastFeedback: { ...session.lastFeedback, current: false } } : session;
}

export function submitDateJourneyResponse(value, text) {
  const session = copyJourney(value);
  const feedback = critique(session, text);
  return { ...session, attempts: Math.min(100, session.attempts + (feedback.hasResponse ? 1 : 0)), lastFeedback: feedback };
}

export function retryDateJourneyResponse(value, text) {
  const before = copyJourney(value);
  const next = submitDateJourneyResponse(before, text);
  if (before.lastFeedback?.hasResponse && next.lastFeedback.hasResponse) {
    const featureLabels = { detail: "具体情境回应", selfExpression: "自我表达", care: "感受或休息回应", choice: "选择空间", time: "可协商的时间", closure: "确认选择与收尾" };
    const added = next.lastFeedback.features.filter((key) => !before.lastFeedback.features.includes(key));
    const resolved = before.lastFeedback.issues.filter((key) => !next.lastFeedback.issues.includes(key));
    const improvement = added.length ? `这次新增了${added.map((key) => featureLabels[key]).join("、")}。` : "本次没有检测到新增的表达特征。";
    next.lastFeedback.comparison = `${resolved.length ? "本次未再触发此前的风险措辞提醒；这只表示规则检查变化。" : ""}${improvement}原有观察、阶段和决策保持不变。`;
  }
  return next;
}

export function recordDateJourneyObservation(value, branch) {
  const session = copyJourney(value);
  if (session.status !== "active" || session.observation || !DATE_JOURNEY_BRANCHES.includes(branch)) return session;
  const terminal = ["declined", "incompatible"].includes(branch);
  // 拒绝始终可以停止；推进不能绕过先回答、再检查的训练步骤。
  if (!terminal && (!session.lastFeedback?.hasResponse || session.lastFeedback.current === false || session.lastFeedback.blocked)) return session;
  const history = [...session.history, { stage: DATE_JOURNEY_STAGES[session.stageIndex], branch, kind: session.followup ? "followup" : "initial" }].slice(-30);
  const repeatedUncertain = history.filter((item) => item.stage === DATE_JOURNEY_STAGES[session.stageIndex] && item.branch === "uncertain").length > 1;
  return { ...session, observation: branch, history,
    status: terminal ? "stopped" : branch === "uncertain" ? "paused" : "active",
    decision: terminal ? "EXIT" : branch === "uncertain" ? repeatedUncertain ? "DE_ESCALATE" : "OBSERVE" : session.stageIndex === SCENES.length - 1 ? "MAINTAIN" : "ADVANCE",
    stopReason: terminal ? branch : null,
    lastFeedback: terminal ? null : session.lastFeedback
  };
}

export function advanceDateJourney(value) {
  const session = copyJourney(value);
  if (session.status !== "active" || session.observation !== "positive" || !session.lastFeedback?.hasResponse || session.lastFeedback.current === false || session.lastFeedback.blocked) return session;
  if (session.stageIndex === SCENES.length - 1) return { ...session, status: "complete", decision: "MAINTAIN" };
  return { ...session, stageIndex: session.stageIndex + 1, observation: null, decision: "OBSERVE", followup: false, attempts: 0, lastFeedback: null };
}

export function beginDateJourneyFollowup(value) {
  const session = copyJourney(value);
  if (session.status !== "paused" || session.observation !== "uncertain") return session;
  return { ...session, status: "active", observation: null, followup: true, lastFeedback: null };
}

export function stopDateJourney(value) {
  const session = copyJourney(value);
  if (["stopped", "complete"].includes(session.status)) return session;
  return { ...session, status: "stopped", decision: "EXIT", stopReason: "self-exit", lastFeedback: null };
}

export function getDateJourneySummary(value) {
  const session = copyJourney(value);
  const scenes = scenesFor(session.scenarioId);
  const decisionText = {
    ADVANCE: "有明确互惠，可以进入下一段模拟情境。", MAINTAIN: "双方在模拟中已达成一致，继续兑现约定并观察现实行为。",
    OBSERVE: "信息还不充分，保留当前阶段，给双方空间。", DE_ESCALATE: "本阶段多次模糊回应，降低投入；不追加催促或邀请。",
    EXIT: "停止推进。接受拒绝、发现不合适或自主退出，都可以是有效结果。"
  }[session.decision];
  return { decision: session.decision, message: decisionText, complete: session.status === "complete", stopped: session.status === "stopped",
    canAdvance: session.status === "active" && session.observation === "positive" && Boolean(session.lastFeedback?.hasResponse) && session.lastFeedback.current !== false && !session.lastFeedback.blocked,
    canObserveFollowup: session.status === "paused" && session.observation === "uncertain",
    tradeoff: journeyTradeoff(session),
    observations: session.history.map((item) => ({ ...item, stageTitle: scenes[DATE_JOURNEY_STAGES.indexOf(item.stage)].title, label: BRANCH_LABELS[item.branch], observation: scenes[DATE_JOURNEY_STAGES.indexOf(item.stage)].responses[item.branch] })) };
}

// 结局的收获与代价对照：任何结局（完成、被拒、不合适、自主退出）都是有效结果，
// 不打分、不进错题；只让学习者看清每条路「得到了什么、放弃了什么」，由自己判断。
function journeyTradeoff(session) {
  const settled = session.history.filter((item) => DATE_JOURNEY_STAGES.includes(item.stage) && DATE_JOURNEY_BRANCHES.includes(item.branch));
  const reviewNote = settled.length ? [`你可以回看已保留的 ${settled.length} 条模拟观察，再决定下一轮怎么练。`] : [];
  if (session.status === "complete") {
    return { gains: [
      "双方都直接确认了意愿，并就联系节奏和未定事项达成了可协商的安排。",
      "每一段都留下了可以回看的行为证据，而不是靠猜测推进。"
    ], costs: [
      "确定关系意味着放弃同时了解其他人的时间与可能性。",
      "已付出的时间与承诺不会因为以后变化而退回，兑现仍需持续行动。"
    ], note: reviewNote };
  }
  if (session.status === "stopped") {
    if (session.stopReason === "incompatible") return { gains: [
      "及早确认了无法协调的分歧，避免了在错误的基础上继续投入。",
      "双方都能体面结束，没有人需要为「不合适」道歉。"
    ], costs: [
      "双方的时间和期待都落空，惋惜是正常的。",
      "这段已经投入感情的可能性就此结束。"
    ], note: reviewNote };
    if (session.stopReason === "self-exit") return { gains: [
      "你保留了对节奏和方向的决定权，退出本身就是有效答案，不需要对方批准。",
      "不合适也可以不解释；你没有为了答案而委屈自己的底线。"
    ], costs: [
      "没有说出口的答案会一直未知。",
      "也许错过了一种可能的走向；这是选择的一部分。"
    ], note: reviewNote };
    return { gains: [
      "对方给出了清晰的答案，你不必再为不确定投入情绪和猜测。",
      "清晰的拒绝比漫长的模糊更省时间；你把选择权留给了对方，也留给了自己。"
    ], costs: [
      "这段可能性就此结束，失落感是真实且正常的，不需要立刻「想开」。",
      "已经付出的时间与心意不会退回。"
    ], note: reviewNote };
  }
  return null;
}
