function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function shortQuote(value, fallback = "她刚才的回复") {
  const text = cleanText(value).replace(/[“”]/g, "");
  if (!text) return fallback;
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

/**
 * 取「我」上一条消息的内容主干，作为回答她提问的唯一素材。
 * 本地兜底不能凭空编事实，所以只能用用户自己已经说过的话。
 */
function answerSeed(value) {
  const text = cleanText(value).replace(/[“”]/g, "");
  if (!text) return "我刚才说的那件事";
  const clause = text.split(/[，,。！？~、]/).map(cleanText).find((part) => part.length >= 3) || text;
  return clause.length > 18 ? `${clause.slice(0, 18)}…` : clause;
}

function classifyReply(text) {
  if (/天晚了|早点休息|晚安|先睡|睡了|明天再聊|下次聊|先这样|不早了/.test(text)) return "closing";
  if (/不想|不用|别问|改天|再说|需要.{0,4}(?:空间|安静|休息)|先不|不方便|算了|拒绝/.test(text)) return "boundary";
  if (/累|忙|加班|工作|开会|赶|没电|低落|难受|睡不着|状态不好/.test(text)) return "energy";
  // 提问必须排在 plan 之前：她问「周六有空吗」时，正确动作是回答问题本身，
  // 而不是套用「按你舒服的时间来」这种回避答案的日程模板。
  if (/[？?]/.test(text)) return "question";
  if (/周[一二三四五六日天]|明天|后天|几点|时间|见面|约|咖啡|散步|可以.{0,5}吗/.test(text)) return "plan";
  if (/吃|喝|饭|菜|面|粉|咖啡|奶茶|书|电影|纪录片|音乐|展览|猫|狗|跑步|散步/.test(text)) return "interest";
  if (/哈哈|开心|高兴|不错|喜欢|期待|有意思|好玩/.test(text)) return "positive";
  return "default";
}

function ordered(options, style) {
  if (style === "B") return [options.B, options.A, options.C];
  if (style === "C") return [options.C, options.A, options.B];
  return [options.A, options.B, options.C];
}

export function buildReplyOptionsForHer(style, latestHer = "", latestMine = "") {
  const her = cleanText(latestHer);
  const mine = cleanText(latestMine);
  const quote = shortQuote(her);
  const context = classifyReply(her);
  let texts;

  if (context === "closing") {
    texts = {
      A: `好，你也早点休息，今天聊得挺舒服的，晚安～`,
      B: `收到，今晚先让手机下班，晚安～`,
      C: `好，那我们先到这里。下次再接着聊刚才的话题，晚安。`
    };
  } else if (context === "boundary") {
    texts = {
      A: `好，我听到了。你先按自己的节奏来，不想展开也没关系。`,
      B: `收到，我先把追问模式关掉。等你想聊的时候，我们再接着说。`,
      C: `明白。你希望我先不打扰，还是偶尔分享一点轻松的日常？`
    };
  } else if (context === "energy") {
    texts = {
      A: `听起来今天确实挺消耗的。你先忙或休息，想说的时候我在。`,
      B: `收到，今天先不开复盘大会，给你的电量留点余额。`,
      C: `你现在更想安静一会儿，还是聊点和工作无关的轻松话题？`
    };
  } else if (context === "question") {
    // 她问的那一点，本地只能拿「我」上一条已说过的话来答。所以三条都只复述已确定的部分，
    // 不声称她知道或不知道任何细节——本地兜底没有权利替用户编造事实。
    const answer = answerSeed(mine);
    texts = {
      A: `${answer}。这个是我已经定下来的部分，剩下的按你的偏好来。`,
      B: `${answer}，我先交个底，省得你被我一句笼统的话糊过去。`,
      C: `${answer}。你更在意内容、地点还是时间？我照你在意的那部分再补。`
    };
  } else if (context === "plan") {
    texts = {
      A: `好，我们按你舒服的时间来，临近时再确认一次就行。`,
      B: `收到，我先把日程写成铅笔字，方便我们随时调整。`,
      C: `那我们先定一个大概范围，具体时间等临近了再一起确认，可以吗？`
    };
  } else if (context === "interest") {
    // A 不追问、也不替她解读心理（「你是真的挺喜欢」是对她的断言），只说自己被带动到的反应。
    // 追问交给 C，这样三条里只剩一个问句，符合「最多一条以问句结尾」。
    texts = {
      A: `听你说“${quote}”，我都想跟着你去试试了。`,
      B: `你这么一说，我的待看待吃清单又多了一项。下次得听你做个简短推荐。`,
      C: `你会喜欢“${quote}”，更多是因为内容本身，还是当时的心情？`
    };
  } else if (context === "positive") {
    texts = {
      A: `听你这么说，我也跟着开心起来。`,
      B: `哈哈，那我先把这点好心情收下，不继续抢你的话题。`,
      C: `你说“${quote}”时听起来很确定，是最近才有的感觉吗？`
    };
  } else {
    // 这三句以前是「我听到你说／我先记下／不急着抢答」——教练元话语，
    // 而 isUsableModelReplyOptions 正好把这类措辞判为不可发送，等于自产自发都被自己否掉。
    texts = {
      A: `你说的“${quote}”我挺想听下去的，先不岔开话题。`,
      B: `“${quote}”这句有点意思，我脑子里已经冒出一个不太靠谱的想法了。`,
      C: `关于“${quote}”，你是怎么开始对这个感兴趣的？`
    };
  }

  const options = {
    A: { key: "A", label: "A 温柔高情商", text: texts.A, effect: "先承接最新女方回复，再给对方选择和空间。" },
    B: { key: "B", label: "B 幽默风趣", text: texts.B, effect: "用轻松表达降低压力，但不回避她刚说的内容。" },
    C: { key: "C", label: "C 深入了解", text: texts.C, effect: "围绕最新回复追问一个具体问题，避免查户口式连问。" }
  };

  // If the latest reply is empty, the previous male message is only a last-resort cue.
  if (!her && mine) {
    const mineQuote = shortQuote(mine, "刚才的话题");
    options.A.text = `刚才说到“${mineQuote}”，我想听听你的真实想法，不急着下结论。`;
    options.B.text = `“${mineQuote}”这个话题先留在桌上，我们可以慢慢聊。`;
    options.C.text = `关于“${mineQuote}”，你更想从哪一部分开始说？`;
  }

  return ordered(options, style);
}

/**
 * Validate model-generated A/B/C options before showing them to the user.
 * The model remains the primary author; local templates are only a fallback
 * when the response is structurally incomplete or obviously meta.
 */
export function isUsableModelReplyOptions(options, latestHer = "", latestMine = "") {
  if (!Array.isArray(options) || options.length !== 3) return false;

  const keys = options.map((item) => String(item?.key || "").trim());
  if (new Set(keys).size !== 3 || !["A", "B", "C"].every((key) => keys.includes(key))) return false;

  const texts = options.map((item) => cleanText(item?.text || item?.reply || item?.content));
  if (texts.some((text) => text.length < 2 || text.length > 180)) return false;
  if (new Set(texts).size !== 3) return false;

  const her = cleanText(latestHer);
  const mine = cleanText(latestMine);
  if (texts.some((text) => text === her || text === mine)) return false;

  // 三条里最多一条以问句结尾（A-03）：两条都在提问，用户拿到的其实是同一个动作的两种说法，
  // 而且一次问两件事会把她逼成回答机器。只数句尾，句中提问不算。
  const questionCount = texts.filter((text) => /[？?]\s*$/.test(text)).length;
  if (questionCount > 1) return false;

  // These are coaching explanations, not something the user should send.
  const metaCount = texts.filter((text) => /我听到你说|我先记下|不急着抢答|你愿意的话，可以再跟我说一点/.test(text)).length;
  if (metaCount >= 2) return false;

  return true;
}
