/**
 * 每日五分钟微训练的纯函数模块。
 *
 * 这个模块不读 DOM、不读 localStorage，也不依赖模型。任务选择、评分、
 * 连续天数和掌握度都可以在浏览器或 Node 测试环境中得到相同结果。
 */

export const MICRO_TRAINING_SOURCE = "micro-training-v1";
import { shanghaiDate } from "../core/date.js";

export const TRAINING_DIMENSIONS = Object.freeze([
  "initiative",
  "curiosity",
  "boundaries",
  "timing"
]);

export const MICRO_TRAINING_TYPES = Object.freeze([
  "rewrite",
  "signal",
  "pause",
  "boundary",
  "replay"
]);

const DIMENSION_LABELS = Object.freeze({
  initiative: "主动性",
  curiosity: "好奇与共情",
  boundaries: "边界感",
  timing: "时机感"
});

const DIMENSION_ALIASES = Object.freeze({
  initiative: "initiative",
  momentum: "initiative",
  curiosity: "curiosity",
  empathy: "curiosity",
  naturalness: "curiosity",
  boundaries: "boundaries",
  boundary: "boundaries",
  timing: "timing"
});

const TYPE_LABELS = Object.freeze({
  rewrite: "改写练习",
  signal: "信号判断",
  pause: "暂停决策",
  boundary: "边界回应",
  replay: "回放复盘"
});

const PRESSURE_RE = /必须|一定要|马上|赶紧|现在就|不回我|为什么不回|你到底|给个准话|证明一下|男朋友|女朋友|宝贝|亲爱的|吃醋|威胁|算了我走/;
const QUESTION_RE = /[？?]/g;
const SPECIFIC_RE = /今天|明天|刚才|刚刚|下班|课程|电影|纪录片|天气|周末|咖啡|散步|工作|考试|旅行|音乐|书|猫|狗|活动|项目/;
const CHOICE_RE = /如果你方便|方便的话|你愿意|想说再说|不用急|有空再|不方便也没关系|你可以选择|看你/;
const EMPATHY_RE = /听起来|感觉你|辛苦|有点累|忙了一天|我理解|能理解|先休息|难怪|谢谢你说|接住/;
const BOUNDARY_RESPECT_RE = /不用解释|不方便也没关系|你可以拒绝|不勉强|不急着|给你空间|先不聊|改天再说|好，那就不|尊重你的安排/;
const CLOSING_OR_LOW_ENERGY_RE = /早点休息|先休息|晚安|下次再聊|改天|有点累|好困|忙完再说|先忙|不太方便|今天不想聊/;

function clamp(value, min = 0, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function canonicalDimension(value) {
  const key = String(value || "").trim().toLowerCase();
  return DIMENSION_ALIASES[key] || null;
}

function dateKey(value) {
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // 日期键统一 Asia/Shanghai（core/date.js 是唯一口径），不再用设备本地 getFullYear 自拼。
  return shanghaiDate(date);
}

function dateToDayNumber(key) {
  if (!key) return 0;
  const [year, month, day] = key.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function stableHash(text) {
  let hash = 2166136261;
  for (const character of String(text)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRubric(items) {
  return items.map(([key, label, pass]) => ({ key, label, pass }));
}

const TASK_CATALOG = Object.freeze({
  initiative: [
    {
      id: "initiative-rewrite-specific",
      type: "rewrite",
      title: "把空泛开场改成具体回应",
      prompt: "把“最近还好吗？”改成一句结合对方近况、但不要求对方立刻长篇回答的话。",
      rubric: makeRubric([
        ["specific", "有具体情境", "提到对方刚说过的一个细节"],
        ["lowPressure", "压力较低", "没有催促、审问或情绪索取"],
        ["oneQuestion", "问题适量", "最多保留一个容易回答的问题"]
      ])
    },
    {
      id: "initiative-signal-open-door",
      type: "signal",
      title: "给积极信号留出回应空间",
      prompt: "判断对方说“这个周末终于可以去看展了哈哈”后，下一步更适合主动聊细节、立即邀约，还是先停下？写出你的选择和一句理由。",
      rubric: makeRubric([
        ["evidence", "引用证据", "指出消息中的开放或积极线索"],
        ["calibration", "不过度推断", "不把轻松表达直接等同于确定的关系意愿"]
      ])
    },
    {
      id: "initiative-pause-before-push",
      type: "pause",
      title: "主动之前先做一次暂停检查",
      prompt: "写下你准备发送的推进消息，并在发送前回答：对方是否给了接话点？如果没有，怎样把动作缩小一点？",
      rubric: makeRubric([
        ["check", "检查上下文", "提到对方上一条消息是否留下接话点"],
        ["smallStep", "动作可退", "给出更小、更可拒绝的推进方式"]
      ])
    },
    {
      id: "initiative-boundary-invite",
      type: "boundary",
      title: "把邀约写成可拒绝的选择",
      prompt: "把“这周末出来见面，别总说忙”改成一个具体、低压力、允许对方拒绝的邀约。",
      rubric: makeRubric([
        ["specific", "具体安排", "有时间或活动信息"],
        ["choice", "保留选择权", "明确不方便可以拒绝或改天"],
        ["noGuilt", "不制造内疚", "不使用责备、比较或催促"]
      ])
    },
    {
      id: "initiative-replay-next-step",
      type: "replay",
      title: "从回放中找一个自然的下一步",
      prompt: "回看最近一段聊天，写出一个对方主动提供的具体信息，再写一个基于该信息的下一步，而不是直接推进关系。",
      rubric: makeRubric([
        ["evidence", "找到具体信息", "引用对方提供的事实或兴趣"],
        ["nextStep", "下一步贴合", "动作与原话有关且规模适中"]
      ])
    }
  ],
  curiosity: [
    {
      id: "curiosity-rewrite-respond-first",
      type: "rewrite",
      title: "先回应，再追问一个细节",
      prompt: "对方说“今天忙到有点累”，请写一句先接住感受、再给她选择是否继续聊的回复。",
      rubric: makeRubric([
        ["empathy", "回应感受", "明确接住忙或累，而不是立刻换话题"],
        ["choice", "允许不聊", "给出休息或稍后再聊的空间"],
        ["question", "问题轻量", "如果提问，只问一个容易回答的问题"]
      ])
    },
    {
      id: "curiosity-signal-energy",
      type: "signal",
      title: "区分礼貌和真实投入",
      prompt: "判断“哈哈还好，你呢？”更接近积极、礼貌回应、低能量还是收尾？可以选择多个标签，并写出一条不确定性。",
      rubric: makeRubric([
        ["label", "选择有依据", "至少识别出礼貌或信息不足"],
        ["uncertainty", "保留不确定性", "说明不能只凭一句话确定关系意愿"]
      ])
    },
    {
      id: "curiosity-pause-listen",
      type: "pause",
      title: "给对方完整说完的时间",
      prompt: "在对方只回复“刚到家，好累”时，选择继续追问、先表达理解后暂停，或直接结束，并说明你为什么这么选。",
      rubric: makeRubric([
        ["energy", "识别能量", "注意到对方可能疲惫"],
        ["space", "留出空间", "不把沉默解释成拒绝或冷淡"]
      ])
    },
    {
      id: "curiosity-boundary-sensitive-topic",
      type: "boundary",
      title: "对敏感话题保持好奇但不逼问",
      prompt: "把“你为什么还不找对象？是不是眼光太高？”改成一个尊重隐私、允许不回答的表达。",
      rubric: makeRubric([
        ["privacy", "尊重隐私", "不替对方定义原因"],
        ["choice", "可以不答", "明确不想聊也可以跳过"],
        ["curiosity", "仍有好奇", "问题不变成盘问"]
      ])
    },
    {
      id: "curiosity-replay-misread",
      type: "replay",
      title: "找出一次回应错位",
      prompt: "从一段聊天里找出一个你没有回应对方情绪或细节的地方，并写出一条更贴合原话的替代回复。",
      rubric: makeRubric([
        ["evidence", "指出原话", "明确是哪条消息和哪个细节"],
        ["repair", "能够修复", "替代回复先回应对方，再自然延伸"]
      ])
    }
  ],
  boundaries: [
    {
      id: "boundaries-rewrite-pressure",
      type: "rewrite",
      title: "删除隐性施压",
      prompt: "把“你怎么又不回我，是不是不在乎我？”改成一条不索取解释、也不否定自己感受的消息。",
      rubric: makeRubric([
        ["removePressure", "去除施压", "不要求对方立即证明或解释"],
        ["ownFeeling", "表达自己", "用我感到或我会怎么做来表达"],
        ["space", "保留空间", "允许对方稍后回复或不回复"]
      ])
    },
    {
      id: "boundaries-signal-no",
      type: "signal",
      title: "识别明确的边界",
      prompt: "看到“今晚不太方便，改天吧”，请写出你识别到的标签，并写一句不会继续施压的回应。",
      rubric: makeRubric([
        ["boundary", "识别边界", "把不方便或改天视为需要留空间的信号"],
        ["response", "尊重回应", "不追问原因、不要求马上定时间"]
      ])
    },
    {
      id: "boundaries-pause-after-no",
      type: "pause",
      title: "收到拒绝后停在合适的位置",
      prompt: "对方拒绝一次邀约后，写出你会发送的最后一句，以及接下来暂不继续追问的理由。",
      rubric: makeRubric([
        ["accept", "接受信息", "承认对方当前不方便"],
        ["pause", "真正暂停", "不在同一轮继续改约或索要承诺"]
      ])
    },
    {
      id: "boundaries-boundary-response",
      type: "boundary",
      title: "练习不替对方做决定",
      prompt: "把“你不想说就算了”改成一句让对方可以自己决定说多少的回应。",
      rubric: makeRubric([
        ["choice", "给出选择", "明确对方可以决定是否继续"],
        ["warmth", "语气不惩罚", "不以冷淡、讽刺或赌气表达失望"],
        ["space", "承认空间", "不立即追加问题"]
      ])
    },
    {
      id: "boundaries-replay-repair",
      type: "replay",
      title: "复盘一次越界并写修复",
      prompt: "回看聊天，找到一句可能让对方有压力的话，写出不辩解、只承担并给空间的修复句。",
      rubric: makeRubric([
        ["evidence", "识别具体话", "不笼统归因，指出原句"],
        ["accountability", "承担表达", "不把责任推回对方"],
        ["space", "给出空间", "修复后不要求对方立刻安慰你"]
      ])
    }
  ],
  timing: [
    {
      id: "timing-rewrite-short",
      type: "rewrite",
      title: "把长消息压缩成一两句",
      prompt: "把你最近想发送的一段长消息压缩成一到两句：保留一个重点，最多一个问题。",
      rubric: makeRubric([
        ["focus", "保留重点", "只表达一个主要意思"],
        ["length", "长度适中", "不堆叠解释或多个分支问题"],
        ["space", "方便接话", "结尾给对方可选择的回应空间"]
      ])
    },
    {
      id: "timing-signal-closing",
      type: "signal",
      title: "识别本轮收尾",
      prompt: "判断“早点休息，明天还要上班”更接近积极、疲惫、收尾还是边界，并写出你会如何收住对话。",
      rubric: makeRubric([
        ["closing", "识别收尾", "注意到对方在结束当前对话"],
        ["response", "顺势收住", "不借机追加新问题或邀约"]
      ])
    },
    {
      id: "timing-pause-unanswered",
      type: "pause",
      title: "未回复时做等待决策",
      prompt: "对方还没有回复，而你已经发了两条消息。选择继续发、等待，或发送收尾，并写出判断依据。",
      rubric: makeRubric([
        ["history", "看见消息历史", "明确考虑已经连续发送"],
        ["decision", "决策克制", "不给未回复附会成确定意图"],
        ["reason", "理由可解释", "说明为什么此刻的动作压力更低"]
      ])
    },
    {
      id: "timing-boundary-energy",
      type: "boundary",
      title: "对低能量状态不做推进",
      prompt: "把“你累也没关系，出来坐一会儿嘛”改成尊重对方疲惫状态的表达。",
      rubric: makeRubric([
        ["recognize", "承认疲惫", "不把累视为需要被说服的障碍"],
        ["choice", "给出选择", "允许休息或改天"],
        ["noPush", "不继续推进", "删掉软性劝说和坚持"]
      ])
    },
    {
      id: "timing-replay-cooldown",
      type: "replay",
      title: "在回放中找出冷却点",
      prompt: "检查一段聊天：标出第一次出现低能量、收尾或连续发送的地方，并写出一个更合适的停顿动作。",
      rubric: makeRubric([
        ["evidence", "找到冷却点", "引用消息或顺序作为依据"],
        ["action", "动作合适", "选择等待、收尾或减少追问中的一种"],
        ["uncertainty", "保留不确定性", "不把冷却点直接解释成关系结论"]
      ])
    }
  ]
});

function allEvents(learningState) {
  if (!learningState || typeof learningState !== "object") return [];
  const candidates = [learningState.events, learningState.trainingEvents, learningState.logs, learningState.trainingLog];
  return candidates.find((candidate) => Array.isArray(candidate) && candidate.length > 0)
    || candidates.find(Array.isArray)
    || [];
}

function eventScore(event) {
  const value = event?.score ?? event?.value ?? event?.total;
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number) : null;
}

function eventDate(event) {
  return dateKey(event?.date ?? event?.createdAt ?? event?.completedAt);
}

function deriveWeakestDimension(learningState, day) {
  const events = allEvents(learningState)
    .map((event, index) => ({ event, index, dimension: canonicalDimension(event?.dimension ?? event?.targetDimension), score: eventScore(event) }))
    .filter((item) => item.dimension && item.score !== null);

  if (!events.length) {
    return TRAINING_DIMENSIONS[stableHash(`balanced:${day}`) % TRAINING_DIMENSIONS.length];
  }

  const stats = new Map(TRAINING_DIMENSIONS.map((dimension) => [dimension, { total: 0, count: 0, lastDay: -Infinity }]));
  for (const item of events) {
    const stat = stats.get(item.dimension);
    stat.total += item.score;
    stat.count += 1;
    stat.lastDay = Math.max(stat.lastDay, dateToDayNumber(eventDate(item.event)) || item.index);
  }

  return TRAINING_DIMENSIONS.slice().sort((left, right) => {
    const a = stats.get(left);
    const b = stats.get(right);
    const aAverage = a.count ? a.total / a.count : -1;
    const bAverage = b.count ? b.total / b.count : -1;
    if (aAverage !== bAverage) return aAverage - bAverage;
    if (a.count !== b.count) return a.count - b.count;
    if (a.lastDay !== b.lastDay) return a.lastDay - b.lastDay;
    return TRAINING_DIMENSIONS.indexOf(left) - TRAINING_DIMENSIONS.indexOf(right);
  })[0];
}

function taskFor(dimension, day, date) {
  const catalog = TASK_CATALOG[dimension] || TASK_CATALOG.initiative;
  // 用维度固定相位 + 日期序号做轮换。这样刷新同一天仍然稳定，
  // 相邻日期也一定会进入下一个任务类型，而不是被日期哈希打乱。
  const offset = stableHash(dimension) % catalog.length;
  const template = catalog[(day + offset) % catalog.length];
  return {
    id: template.id,
    taskId: template.id,
    date,
    dimension,
    targetDimension: dimension,
    type: template.type,
    title: template.title,
    prompt: template.prompt,
    timeLimit: 5,
    rubric: template.rubric.map((item) => ({ ...item })),
    source: MICRO_TRAINING_SOURCE,
    completionKey: `${date}:${template.id}`,
    idempotencyKey: `${date}:${template.id}`
  };
}

/**
 * 按最弱维度、日期和稳定种子选择当天任务。
 * options.weakestDimension 只用于显式测试或预览覆盖，不写入任务状态。
 */
export function selectDailyTask(learningState = {}, date = new Date(), options = {}) {
  const normalizedDate = dateKey(date) || dateKey(new Date());
  const day = dateToDayNumber(normalizedDate);
  const override = canonicalDimension(options?.weakestDimension);
  const dimension = override || deriveWeakestDimension(learningState, normalizedDate);
  return taskFor(dimension, day, normalizedDate);
}

function inputText(input) {
  if (typeof input === "string") return input.trim();
  if (!input || typeof input !== "object") return "";
  return String(input.text ?? input.answer ?? input.value ?? input.choice ?? "").trim();
}

function contextText(context) {
  if (!context || typeof context !== "object") return "";
  return String(context.context ?? context.message ?? context.prompt ?? context.history ?? "").trim();
}

function countQuestions(text) {
  return (text.match(QUESTION_RE) || []).length;
}

function distinctLabels(text) {
  const labels = [];
  const add = (label) => {
    if (!labels.includes(label)) labels.push(label);
  };
  if (/积极|开放|愿意|继续|轻松/.test(text)) add("positive");
  if (/礼貌|还好|哈哈|你呢/.test(text)) add("polite");
  if (/疲惫|累|忙|低能量|困/.test(text)) add("lowEnergy");
  if (/边界|拒绝|不方便|不想|不聊|改天/.test(text)) add("boundary");
  if (/收尾|晚安|休息|下次再聊|结束/.test(text)) add("closing");
  return labels;
}

function signalExpected(context) {
  const text = contextText(context);
  const labels = Array.isArray(context?.expectedLabels)
    ? context.expectedLabels.map(String)
    : distinctLabels(text);
  return labels.length ? labels : ["ambiguous"];
}

function scoreRewrite(text, context) {
  const criteria = [];
  const questionCount = countQuestions(text);
  const specific = SPECIFIC_RE.test(text) || text.length >= 12;
  const pressure = PRESSURE_RE.test(text);
  const choice = CHOICE_RE.test(text) || BOUNDARY_RESPECT_RE.test(text);
  const empathy = EMPATHY_RE.test(text) || /我听到|我能理解|谢谢/.test(text);
  const notTooLong = text.length >= 8 && text.length <= 110;

  criteria.push({ key: "specific", passed: specific, evidence: specific ? "出现了具体内容或可回应的细节。" : "内容仍偏空泛，可以落到一个具体细节。" });
  criteria.push({ key: "lowPressure", passed: !pressure, evidence: pressure ? "检测到可能让对方有压力的措辞。" : "没有检测到明显催促或索取。" });
  criteria.push({ key: "oneQuestion", passed: questionCount <= 1, evidence: questionCount <= 1 ? "问题数量控制在一个以内。" : "问题超过一个，接话成本可能上升。" });
  // context 可能是 { context: "..." } 对象或字符串；统一用 contextText 提取后判断
  if (/curiosity|共情|回应|感受/.test(contextText(context))) criteria.push({ key: "empathy", passed: empathy, evidence: empathy ? "先回应了对方的状态或感受。" : "可以先回应对方的状态，再表达自己。" });
  if (choice || BOUNDARY_RESPECT_RE.test(text)) criteria.push({ key: "choice", passed: true, evidence: "给对方保留了选择和退出空间。" });

  const passed = criteria.filter((item) => item.passed).length;
  const score = clamp(30 + passed * 18 + (notTooLong ? 8 : 0) - (pressure ? 20 : 0));
  return { score, criteria };
}

function scoreBoundary(text) {
  const criteria = [
    { key: "choice", passed: CHOICE_RE.test(text) || BOUNDARY_RESPECT_RE.test(text), evidence: "是否明确保留对方的选择权。" },
    { key: "noPressure", passed: !PRESSURE_RE.test(text), evidence: PRESSURE_RE.test(text) ? "仍有催促、责备或情绪索取。" : "没有检测到明显的催促或责备。" },
    { key: "warmth", passed: EMPATHY_RE.test(text) || /理解|没关系|辛苦|谢谢/.test(text), evidence: "是否用平和方式承接对方，而不是惩罚性收尾。" }
  ];
  const score = clamp(35 + criteria.filter((item) => item.passed).length * 20 - (PRESSURE_RE.test(text) ? 22 : 0));
  return { score, criteria };
}

function scorePause(text, context) {
  const source = `${text} ${contextText(context)}`;
  const lowEnergy = CLOSING_OR_LOW_ENERGY_RE.test(source);
  const pause = /等待|暂停|先不发|不再发|稍后|明天|改天|休息|收尾|结束|停一下/.test(text);
  const uncertainty = /不确定|不能说明|不代表|不一定|信息不足|不猜/.test(text);
  const pressure = PRESSURE_RE.test(text);
  const criteria = [
    { key: "recognize", passed: lowEnergy || /未回复|连续|两条|拒绝|收尾|累|忙/.test(text), evidence: lowEnergy ? "注意到了对方可能处在低能量或收尾状态。" : "需要明确说明你依据了什么状态或消息历史。" },
    { key: "pause", passed: pause && !pressure, evidence: pause && !pressure ? "选择了留出空间的动作。" : "当前答案没有清楚体现暂停，或仍带有推进压力。" },
    { key: "uncertainty", passed: uncertainty || !contextText(context), evidence: uncertainty ? "保留了对意图的不确定性。" : "可以补一句：未回复不等于确定的关系结论。" }
  ];
  const score = clamp(28 + criteria.filter((item) => item.passed).length * 23 - (pressure ? 20 : 0));
  return { score, criteria };
}

function scoreSignal(text, context) {
  const answerLabels = distinctLabels(text);
  const expected = signalExpected(context);
  const overlap = answerLabels.filter((label) => expected.includes(label)).length;
  const asksForUncertainty = /不确定|不能仅凭|信息不足|不代表|无法判断/.test(text);
  const identifiesBoundary = expected.includes("boundary") && /边界|拒绝|不方便|空间|改天/.test(text);
  const correct = overlap > 0 || (expected.includes("ambiguous") && asksForUncertainty);
  const criteria = [
    { key: "label", passed: correct || identifiesBoundary, evidence: correct ? `识别到与本地信号线索相符的标签：${expected.join("、")}。` : "标签与消息中的主要线索还没有对齐。" },
    { key: "uncertainty", passed: asksForUncertainty || expected.length > 1 || expected.includes("ambiguous"), evidence: asksForUncertainty ? "明确保留了不确定性。" : "可以同时说明其他解释仍然可能成立。" }
  ];
  const score = clamp(35 + criteria.filter((item) => item.passed).length * 25 + (overlap > 1 ? 10 : 0));
  return { score, criteria };
}

function scoreReplay(text) {
  const criteria = [
    { key: "evidence", passed: text.length >= 12 && (/[“”‘’"']/.test(text) || /对方|她|我说|原话|那句|消息/.test(text)), evidence: "是否指出了可以回看的具体消息或证据。" },
    { key: "action", passed: /等待|暂停|收尾|改成|回应|先说|空间|问题|不追问|修复|下一步/.test(text), evidence: "是否提出了下一步可执行动作。" },
    { key: "uncertainty", passed: /不确定|不代表|可能|不能|不一定|信息不足/.test(text), evidence: "是否避免把一次互动直接推断成关系结论。" }
  ];
  const score = clamp(30 + criteria.filter((item) => item.passed).length * 23 + (text.length >= 25 ? 5 : 0));
  return { score, criteria };
}

function criteriaForType(type, text, context) {
  if (type === "rewrite") return scoreRewrite(text, context);
  if (type === "boundary") return scoreBoundary(text, context);
  if (type === "pause") return scorePause(text, context);
  if (type === "signal") return scoreSignal(text, context);
  if (type === "replay") return scoreReplay(text, context);
  return { score: 0, criteria: [] };
}

/**
 * 使用透明规则对任务答案评分。结果包含稳定的幂等键，调用方可据此避免
 * 同一日期、同一任务重复写入训练事件。
 */
export function gradeMicroTask(task, input, context = {}) {
  const safeTask = task && typeof task === "object" ? task : {};
  const dimension = canonicalDimension(safeTask.dimension ?? safeTask.targetDimension) || "initiative";
  const text = inputText(input);
  const type = MICRO_TRAINING_TYPES.includes(safeTask.type) ? safeTask.type : "rewrite";
  const evaluated = text ? criteriaForType(type, text, context) : { score: 0, criteria: [] };
  const score = text ? evaluated.score : 0;
  const passed = score >= 75;
  const criteria = evaluated.criteria;
  const evidence = criteria.filter((item) => item.passed).map((item) => item.evidence);
  const gaps = criteria.filter((item) => !item.passed).map((item) => item.evidence);
  const feedback = !text
    ? "还没有答案。先写一条你愿意真实发送的表达，再看评分。"
    : passed
      ? `本次${TYPE_LABELS[type]}完成得不错，已经体现出${DIMENSION_LABELS[dimension]}的关键动作。`
      : `本次${TYPE_LABELS[type]}还需要继续练习，先修正一个最明显的行为信号即可。`;
  const nextAction = gaps[0]
    ? gaps[0].replace(/^是否|^需要|^当前答案/, "下一次请")
    : `下一次换一个不同场景，继续练习${DIMENSION_LABELS[dimension]}。`;
  const date = dateKey(safeTask.date) || null;
  const taskId = String(safeTask.taskId ?? safeTask.id ?? "micro-training");
  const idempotencyKey = String(safeTask.idempotencyKey ?? safeTask.completionKey ?? `${date || "undated"}:${taskId}`);

  return {
    passed,
    score,
    dimension,
    feedback,
    evidence: evidence.length ? evidence : gaps.slice(0, 2),
    nextAction,
    taskId,
    date,
    type,
    source: String(safeTask.source ?? MICRO_TRAINING_SOURCE),
    idempotencyKey,
    completionKey: idempotencyKey,
    rubricResults: criteria.map((item) => ({ key: item.key, passed: item.passed, evidence: item.evidence }))
  };
}

function isCompleted(task) {
  return task?.completed === true || task?.status === "completed" || task?.status === "complete" || task?.passed === true;
}

/**
 * 计算当前连续完成天数。若今天尚未完成，则从昨天开始计算，避免当天
 * 尚未练习时把正在延续的连续记录立即显示为零。
 */
export function getTrainingStreak(tasks, today = new Date()) {
  if (!Array.isArray(tasks)) return 0;
  const todayKey = dateKey(today);
  if (!todayKey) return 0;
  const completedDays = new Set(
    tasks
      .filter(isCompleted)
      .map((task) => dateKey(task?.date ?? task?.completedAt ?? task?.createdAt))
      .filter((key) => key && dateToDayNumber(key) <= dateToDayNumber(todayKey))
  );
  if (!completedDays.size) return 0;

  let anchor = dateToDayNumber(todayKey);
  if (!completedDays.has(todayKey)) anchor -= 1;
  const anchorKey = dayNumberToDateKey(anchor);
  if (!completedDays.has(anchorKey)) return 0;

  let streak = 0;
  while (completedDays.has(dayNumberToDateKey(anchor - streak))) streak += 1;
  return streak;
}

function dayNumberToDateKey(day) {
  const date = new Date(day * 86400000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function eventSortValue(event, index) {
  const raw = event?.createdAt ?? event?.completedAt ?? event?.date;
  const date = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(date) ? date : index;
}

function riskCount(event) {
  const risks = event?.riskSignals ?? event?.triggeredRisks ?? event?.risks;
  if (Array.isArray(risks)) return risks.length;
  if (typeof risks === "string") return risks.trim() ? 1 : 0;
  if (event?.risk === true || event?.hasRisk === true) return 1;
  return 0;
}

function isMicroEvent(event) {
  return event?.source === MICRO_TRAINING_SOURCE
    || event?.source === "micro-training"
    || event?.type === "micro-training"
    || Boolean(event?.taskId);
}

/**
 * 根据相关事件返回可解释的掌握状态。progress 表示近期行为得分，
 * 而不是对人格、关系结果或他人意图的预测。
 */
export function getMasteryStatus(events, dimension) {
  const target = canonicalDimension(dimension);
  const relevant = (Array.isArray(events) ? events : [])
    .map((event, index) => ({ event, index, score: eventScore(event), dimension: canonicalDimension(event?.dimension ?? event?.targetDimension) }))
    .filter((item) => item.dimension === target && item.score !== null)
    .sort((a, b) => eventSortValue(a.event, a.index) - eventSortValue(b.event, b.index));

  const sampleSize = relevant.length;
  if (!target || sampleSize === 0) {
    return { level: "not-started", progress: 0, sampleSize: 0, confidence: "low", label: "尚未开始" };
  }

  const recent = relevant.slice(-5);
  const average = recent.reduce((sum, item) => sum + item.score, 0) / recent.length;
  const microCount = relevant.filter((item) => isMicroEvent(item.event)).length;
  const riskFreeCount = recent.filter((item) => riskCount(item.event) === 0).length;
  const sceneIds = new Set(relevant.map((item) => item.event?.sceneId ?? item.event?.scenarioId).filter(Boolean));
  const enoughEvidenceForMastery = sampleSize >= 5
    && average >= 75
    && riskFreeCount >= 3
    && microCount >= 1
    && sceneIds.size >= 2;

  let level = "practicing";
  let label = "需要继续";
  if (average < 60) {
    level = "needs-practice";
    label = "需要重点练习";
  } else if (average >= 75 && enoughEvidenceForMastery) {
    level = "mastered";
    label = "已掌握";
  } else if (average >= 75) {
    level = "unstable";
    label = "尚未稳定";
  }

  const confidence = sampleSize >= 5 ? "high" : sampleSize >= 3 ? "medium" : "low";
  return {
    level,
    progress: clamp(average),
    sampleSize,
    confidence,
    label,
    recentAverage: clamp(average),
    evidence: {
      microTrainingCount: microCount,
      riskFreeCount,
      sceneCount: sceneIds.size
    }
  };
}

export const MICRO_TRAINING_TASKS = TASK_CATALOG;
