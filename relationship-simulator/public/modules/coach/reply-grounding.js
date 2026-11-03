/**
 * 教练回复审计（P1）：判断 A/B/C 有没有把「新提议」说成「已经发生的事实」。
 *
 * 判定规则（可测、可解释，不宣称理解语义）：
 *   未见于台账的实体（时间 / 地点 / 已订事项） + 既成事实框架  =>  捏造。
 *   同一实体以提议框架出现（可以吗 / 怎么样 / 要不要 / 不如）  =>  合法新提议，放行。
 * 所以「那周六下午两点可以吗」不会被误杀，而「就去上次说的那家咖啡馆」会被拦下。
 *
 * 明确不承诺的：换说法的越界推断、隐喻式捏造、需要世界知识的专名（人名、店名）。
 * 这些走保守的高风险提示 + 「待确认」骨架，而不是假装词面检测覆盖全部自然语言。
 */

const TIME_PATTERN = /(?:这|下|本|上)?(?:周|星期|礼拜)[一二三四五六日天]|(?:周末|明天|后天|大后天|今天|今晚|昨晚|昨夜)|(?:上午|中午|下午|傍晚|晚上|夜里|半夜)?[0-9一二两三四五六七八九十]{1,3}点(?:半|钟|一刻|左右)?/g;

const PLACE_PATTERN = /(?:咖啡馆|咖啡厅|咖啡店|餐厅|饭店|火锅店|火锅|日料|西餐|烧烤|奶茶店|奶茶|甜品店|书店|图书馆|美术馆|博物馆|展览馆|展览|公园|植物园|动物园|猫咖|商场|购物中心|电影院|影院|清吧|酒吧|健身房|体育馆|游泳馆|火车站|高铁站|机场|地铁站|面馆|湘菜馆|甜品)/g;

// 「在 X 见 / 等你 / 碰面」里的 X 通常是具体地点，包括台账里没有的专名。
const MEET_AT_PATTERN = /在([\u4e00-\u9fa5A-Za-z0-9]{2,10}?)(?:见|碰面|见面|等你|约|集合|碰头)/g;

const ARRANGEMENT_PATTERN = /(?:位子|座位|包厢|门票|票|预约|订位|行程|计划|食材)/g;

// 既成事实框架：把某事说成已经商定 / 已经发生 / 上次就有。
// 「上次/之前 + 说|聊|定|约|提」两类动词、「定|订」同音异体都得列进来，
// 否则「上次定的那家健身房」「我早就订了」这类写法会整条漏掉。
const ASSERTION_SPAN = /(?:我们|咱们|那就|还是)?(?:早就?[定订]好?[的]?|[定订]好?了|已经?[定订约]|约好|说好|商定|就这么定|已经[定约]|上次(?:说|聊到|定|约|提)[的]?|之前(?:说|聊到|定|约|提)[的]?|上回(?:说|定|约)[的]?|你(?:答应|说过|不是说|常去)|老(?:地方|时间|规矩)|照旧|按原计划|(?:门票|位子|位置)[我]?买好了?|(?:安排|预约)好了?)/g;
const ASSERTION = /早就?[定订]|已经?[定订约]|约好|说好|商定|就这么定|上次(?:说|聊到|定|约|提)|之前(?:说|聊到|定|约|提)|上回(?:说|定|约)|你(?:答应|说过|不是说|常去)|老(?:地方|时间|规矩)|照旧|按原计划|买好了|[定订]好|安排好了|预约好了/;

// 提议框架：新方案、征询、假设。出现即视为未主张既成事实。
const PROPOSAL = /可以吗|可不可以|好不好|行不行|行吗|方便吗|怎么样|要不要|要不|不如|或者|暂定|先定|定个|约个|找个|挑个|看你|你那边|方便的话|随时|改天|如果|要是|假设|理想的话|我建议|不妨|吗？|\?|？/;

/**
 * 外部世界的日程断言。真实抽样里抓到一次漏检：
 * 台账只有「周末有个画展」，模型写「画展是周六下午两点开始，你那边方便吗？」——
 * 句尾的问句让整句被当成提议放过了，但「周六下午两点开始」是对**展览日程**的事实断言，
 * 不是用户的提议。提议框架不能给这类断言免检。
 * 主语必须是外部事物；「我们周六下午两点开始」仍然是合法提议。
 */
const EXTERNAL_SUBJECT = /画展|展览|展会|展|电影|影片|纪录片|片|演出|演唱会|话剧|音乐剧|音乐节|脱口秀|会议|例会|培训|课|活动|店|餐厅|馆|商场|博物馆|美术馆|图书馆|影院|剧场|书店|猫咖|健身房|景区|场馆/;
const SCHEDULE_PREDICATE = /开始|开场|开幕|开展|闭幕|结束|散场|开放|营业|关门|打烊|截止|排片|场次|上映|闭馆|截止报名/;
const SELF_SUBJECT = /(?:^|[，,、\s])(?:我们|咱们|我|你|您|大家|这边|那边)/;
// 「我们周六两点开始」是用户的计划，合法；但「我记得你们馆周一闭馆」是第一人称包装的
// 世界事实断言，不能因为句首有个「我」就免检。
const RECOLLECTION = /我记得|我印象|印象中|好像|应该是|我记着|之前看过|查过/;

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const squash = (value) => String(value || "").replace(/\s+/g, "").toLowerCase();

function uniqueMatches(text, pattern) {
  const found = String(text || "").match(pattern);
  return found ? [...new Set(found.map((item) => item.trim()).filter(Boolean))] : [];
}

function meetAtEntities(text) {
  const out = [];
  MEET_AT_PATTERN.lastIndex = 0;
  let match;
  while ((match = MEET_AT_PATTERN.exec(String(text || ""))) !== null) {
    const place = clean(match[1]);
    // 只收实体感的补语；「在这儿」「那里」这类指代不构成新事实。
    if (place && !/^(?:这|那|这儿|那里|这里|外|家|公司|学校|门口|楼下|附近)/.test(place)) out.push(place);
  }
  return [...new Set(out)];
}

function hasLedgerSupport(ledger, entity) {
  const needle = squash(entity);
  if (!needle) return true;
  return String(ledger?.normalizedCorpus || "").includes(needle);
}

/** 断言事实的出处：返回正文确实包含该实体的消息 mid，供 UI 展示「这句话来自哪条消息」。 */
function sourceIdsFor(ledger, entities) {
  const ids = [];
  for (const entry of ledger?.entries || []) {
    if (!entry.mid) continue;
    const haystack = squash(entry.text);
    if (entities.some((entity) => squash(entity) && haystack.includes(squash(entity)))) ids.push(entry.mid);
  }
  return [...new Set(ids)];
}

/**
 * 单条审计：返回 assertedFacts（已发生/已知）与 proposals（新提法），
 * 以及 findings —— 未获台账支持的既成事实断言。
 */
export function auditReplyOption(option, ledger) {
  const text = clean(option?.text || option?.reply || option?.content);
  if (!text) return { key: option?.key || "", text: "", assertedFacts: [], proposals: [], sourceMessageIds: [], findings: [], needsUserFill: false };

  const times = uniqueMatches(text, TIME_PATTERN);
  const places = [...uniqueMatches(text, PLACE_PATTERN), ...meetAtEntities(text)];
  const objects = uniqueMatches(text, ARRANGEMENT_PATTERN);

  const assertion = ASSERTION.test(text);
  const proposal = PROPOSAL.test(text);

  const findings = [];
  const assertedFacts = [];
  const proposals = [];

  // 先查「对外部世界的事实断言」：这类句子即使带问句尾巴也不属于提议框架，
  // 不能走下面的提议豁免。按小句切分，避免「我们…开始」被同一句里别处的展览名误伤。
  for (const clause of text.split(/[，,。；;!！~、]/)) {
    const hasSchedule = SCHEDULE_PREDICATE.test(clause);
    if (!hasSchedule || !EXTERNAL_SUBJECT.test(clause)) continue;
    if (SELF_SUBJECT.test(clause) && !RECOLLECTION.test(clause)) continue;
    const clauseTimes = uniqueMatches(clause, TIME_PATTERN);
    for (const entity of clauseTimes) {
      if (!hasLedgerSupport(ledger, entity)) {
        findings.push({ type: "fabricated_time", entity, severity: "block", reason: "断言了对话里没出现过的场馆日程" });
      }
    }
  }

  // 只有在「既成事实框架」里缺证据才算捏造；提议框架下缺证据是正常的新方案。
  if (assertion && !proposal) {
    for (const entity of [...times, ...places]) {
      if (!hasLedgerSupport(ledger, entity)) {
        findings.push({ type: places.includes(entity) ? "fabricated_place" : "fabricated_time", entity, severity: "block" });
      } else {
        assertedFacts.push(entity);
      }
    }
    for (const object of objects) {
      // 「位子订好了」需要台账里确实约过地点/时间，否则是无中生有的既定安排。
      const surrounding = [...times, ...places].length > 0;
      if (!surrounding && !hasLedgerSupport(ledger, object)) {
        findings.push({ type: "fabricated_arrangement", entity: object, severity: "block" });
      } else if (!surrounding) {
        assertedFacts.push(object);
      }
    }
    // 句子里没有可提取的具体实体（「那我们早就定的那顿饭不改了吧」），但断言了一个约定；
    // 台账里根本不存在任何约定 => 整个断言无来源，按既成事实捏造处理。
    if (!findings.length && ![...times, ...places, ...objects].length && ledger?.hasCommitment === false) {
      const span = uniqueMatches(text, ASSERTION_SPAN)[0] || "";
      if (span) findings.push({ type: "fabricated_arrangement", entity: span, severity: "block" });
    }
  } else {
    const flagged = new Set(findings.map((finding) => finding.entity));
    for (const entity of [...times, ...places, ...objects]) {
      if (flagged.has(entity)) continue;
      if (hasLedgerSupport(ledger, entity)) assertedFacts.push(entity);
      else proposals.push(entity);
    }
  }

  const uniqueAsserted = [...new Set(assertedFacts)];
  return {
    key: option?.key || "",
    text,
    assertedFacts: uniqueAsserted,
    proposals: [...new Set(proposals)],
    // 空 assertedFacts => 没主张任何既成事实，sourceMessageIds 也应为空；
    // 有 assertedFacts 但查不出 mid 说明台账缺 mid，此时必须让调用方看见，不能假装可追溯。
    sourceMessageIds: uniqueAsserted.length ? sourceIdsFor(ledger, uniqueAsserted) : [],
    findings,
    needsUserFill: findings.length > 0
  };
}

/**
 * 骨架式替代：不裁剪原句。
 * 逐词删改自然语言会把句子弄坏（「…那家【地点】我了」），用户拿到的是一条读不通的话；
 * 改成整条换成明确待填的骨架，既保住「不把未定说成已定」，也保住可发送性。
 * 原文保留在 originalText，审计字段描述的是模型原文而不是骨架。
 */
const SKELETONS = {
  "time+place": {
    ask: "时间和地点我都还没定死，【时间待你确认】在【地点待你确认】见可以吗？",
    tell: ["时间和地点我都还没定死，先按你有空的来，我这边把【时间待你确认】和【地点待你确认】留出来。",
      "时间和地点都还没跟你确认过，先都留空：【时间待你确认】、【地点待你确认】，你挑一个。"]
  },
  time: {
    ask: "我这边时间还没定死，【时间待你确认】你方便吗？",
    tell: ["我这边时间还没定死，先把【时间待你确认】留出来，你不用迁就我。",
      "时间我不敢替你定，先记成【时间待你确认】，你哪天舒服我们就哪天。"]
  },
  place: {
    ask: "地点我还没定，【地点待你确认】你觉得合适吗？",
    tell: ["地点我还没定，先留成【地点待你确认】，你更熟那边走你来挑。",
      "地方我不敢瞎定，先写成【地点待你确认】，你说一个我照着安排。"]
  },
  arrangement: {
    ask: "之前到底约上了没有我不确定，我们重新定一次可以吗？",
    tell: ["之前到底约上了没有我不确定，这次我重新跟你确认，不再当成已知条件。",
      "这条里的安排其实还没跟你敲定，我们先从「要不要见」谈起，细节下一步再补。"]
  }
};

function skeletonKind(findings) {
  const types = new Set(findings.map((finding) => finding.type));
  if (types.has("fabricated_time") && types.has("fabricated_place")) return "time+place";
  if (types.has("fabricated_time")) return "time";
  if (types.has("fabricated_place")) return "place";
  return "arrangement";
}

function degradeToSkeleton(findings, useQuestion, variant = 0) {
  const template = SKELETONS[skeletonKind(findings)] || SKELETONS.arrangement;
  if (useQuestion) return template.ask;
  // 同批里两条都被降级时必须给不同措辞，否则用户拿到的 A/B/C 有两条一字不差。
  const list = template.tell;
  return list[variant % list.length];
}

/**
 * 批量审计教练给出的 A/B/C。
 * @returns {{ok:boolean, options:Array, findings:Array, needsUserFill:boolean, rejectReason:string}}
 */
export function groundReplyOptions(options, ledger) {
  const list = Array.isArray(options) ? options : [];
  const audits = list.map((option) => auditReplyOption(option, ledger));
  const blockingOf = (audit) => audit.findings.filter((finding) => finding.severity === "block");
  const blockedIdx = audits.map((audit, index) => (blockingOf(audit).length ? index : -1)).filter((index) => index >= 0);

  // 降级后的骨架也可能以问句结尾。若保留下来的某条本身就是问句，骨架必须改用陈述式，
  // 否则「最多一条以问句结尾」会在我们自己的降级路径上被打破。
  const survivingQuestion = audits.some((audit, index) =>
    !blockedIdx.includes(index) && /[？?]\s*$/.test(audit.text));

  const audited = audits.map((audit, index) => {
    const blocking = blockingOf(audit);
    if (!blocking.length) return { ...list[index], ...audit };
    const useQuestion = index === blockedIdx[0] && !survivingQuestion;
    return {
      ...list[index],
      ...audit,
      originalText: audit.text,
      text: degradeToSkeleton(blocking, useQuestion, blockedIdx.indexOf(index)),
      needsUserFill: true
    };
  });

  const findings = audited.flatMap((item) => item.findings || []);
  const blockedKeys = audited.filter((item) => item.needsUserFill).map((item) => item.key);

  // 三条全都被降级 = 模型这一轮基本没在按台账说话；整套退回本地兜底比留下三份骨架有用。
  const allBlocked = audited.length > 0 && blockedKeys.length === audited.length;

  return {
    ok: !allBlocked,
    options: audited,
    findings,
    blockedKeys,
    needsUserFill: blockedKeys.length > 0,
    rejectReason: allBlocked ? "A/B/C 均含未见于会话证据的既成事实断言" : ""
  };
}

/** 供 UI 标注「哪几条需要你补信息」。 */
export function groundingNote(result) {
  if (!result?.needsUserFill) return "";
  const keys = (result.blockedKeys || []).join("、");
  const hasPlaceholder = (result.options || [])
    .filter((item) => item.needsUserFill)
    .some((item) => /【[^】]*】/.test(String(item.text || "")));
  // 措辞必须和实际发生的一致：带实体的捏造换成【待确认】占位；
  // 只捏造了「约定」本身时换成先确认的写法，句子里并没有占位符可填。
  return hasPlaceholder
    ? `其中 ${keys} 提到会话里没出现过的时间或地点，已换成【待你确认】占位；发送前请把真实信息填进去。`
    : `其中 ${keys} 把会话里没出现过的安排说成了既定事实，已改成先向你确认的说法；发送前请按实际情况改写。`;
}
