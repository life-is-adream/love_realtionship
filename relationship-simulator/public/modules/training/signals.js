/**
 * 社交信号解读训练的本地纯函数模块。
 *
 * 这里的标签描述当前消息呈现出的沟通信号，不等价于“她喜欢你多少”。
 * 规则故意偏保守：礼貌、疲惫、边界和收尾优先于“积极”解释，避免把低投入
 * 或结束语误读成暧昧推进。
 */

export const SOCIAL_SIGNAL_LABELS = Object.freeze([
  "positive",
  "polite",
  "lowEnergy",
  "boundary",
  "closing",
  "ambiguous"
]);

const LABEL_META = Object.freeze({
  positive: Object.freeze({
    label: "积极/轻松",
    description: "有具体回应、兴趣或继续交流的意愿，但不等于确定的暧昧。"
  }),
  polite: Object.freeze({
    label: "礼貌回应",
    description: "语气友好或完成基本回应，但暂时看不到足够的投入证据。"
  }),
  lowEnergy: Object.freeze({
    label: "低能量",
    description: "可能疲惫、忙碌或当前没有精力展开对话。"
  }),
  boundary: Object.freeze({
    label: "边界/拒绝",
    description: "表达不方便、不想继续或需要空间，应先尊重边界。"
  }),
  closing: Object.freeze({
    label: "准备收尾",
    description: "正在结束本轮交流，适合自然收尾，不宜继续追问。"
  }),
  ambiguous: Object.freeze({
    label: "信息不足",
    description: "单凭这条消息无法可靠判断关系意愿，需要结合后续行为。"
  })
});

const LABEL_PRIORITY = Object.freeze([
  "boundary",
  "closing",
  "lowEnergy",
  "polite",
  "positive",
  "ambiguous"
]);

const LABEL_ALIASES = Object.freeze({
  "积极": "positive",
  "轻松": "positive",
  "积极轻松": "positive",
  "礼貌": "polite",
  "礼貌回应": "polite",
  "疲惫": "lowEnergy",
  "低能量": "lowEnergy",
  "边界": "boundary",
  "拒绝": "boundary",
  "边界拒绝": "boundary",
  "收尾": "closing",
  "准备收尾": "closing",
  "不确定": "ambiguous",
  "信息不足": "ambiguous",
  "模糊": "ambiguous"
});

const RULES = Object.freeze({
  boundary: Object.freeze([
    { pattern: /我(?:现在|这会儿|今天|目前)?不(?:太)?想聊/u },
    { pattern: /不方便(?:聊|说|回复|接电话)/u },
    { pattern: /(?:想|需要)安静(?:一会儿|一下|一段时间)?/u },
    { pattern: /(?:先)?不聊了|别(?:再)?聊了|不要再问|不想继续/u },
    { pattern: /请别(?:再)?(?:问|联系|聊)/u }
  ]),
  closing: Object.freeze([
    { pattern: /早点休息/u },
    { pattern: /晚安/u },
    { pattern: /(?:我)?(?:先睡了|去睡了|要睡了|准备睡了)/u },
    { pattern: /(?:明天|下次|改天|回头)(?:再)?聊/u },
    { pattern: /(?:先这样|聊到这里|先忙了|我去忙了|不聊了)/u },
    { pattern: /我现在不(?:太)?想聊/u }
  ]),
  lowEnergy: Object.freeze([
    { pattern: /(?:我|今天|最近|现在).{0,8}(?:有点|有些|太|特别)?(?:累|困|忙|加班|疲惫|没精神|没精力|没电|不在状态)/u },
    { pattern: /(?:累死了|忙死了|困死了|脑子转不动|没电了)/u },
    { pattern: /(?:我|今天|最近|现在)(?:只想|想|需要|得去)休息/u }
  ]),
  polite: Object.freeze([
    { pattern: /谢谢(?:你)?/u },
    { pattern: /辛苦了/u },
    { pattern: /你也(?:是|一样|早点休息)/u },
    { pattern: /哈哈还好吧/u },
    { pattern: /(?:^|[，。！？、\s])(?:好的?|嗯嗯?|哦哦?|行吧|还好吧)(?=$|[，。！？、\s])/u }
  ]),
  positive: Object.freeze([
    { pattern: /(?:好呀|可以呀|当然可以|没问题呀|太好了|挺开心|很开心|好玩|有趣|期待|喜欢)/u, strength: 2 },
    { pattern: /(?:下次|有空|周末).{0,8}(?:一起|见面|出来)/u, strength: 2 },
    { pattern: /我也(?:喜欢|觉得|想|是|有同感)/u, strength: 2 },
    { pattern: /(?:跟你|和你)聊(?:得)?(?:挺|很)?开心/u, strength: 2 },
    { pattern: /(?:你呢|想听听|发给我|愿意继续聊)[？?]?/u, strength: 1 },
    { pattern: /哈哈.{0,12}(?:开心|好玩|喜欢|不错|可以|一起|！)/u, strength: 1 }
  ])
});

function normalizeMessage(message) {
  return String(message ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function cleanEvidence(value) {
  return String(value || "")
    .replace(/^[，。！？、\s]+|[，。！？、\s]+$/g, "")
    .trim();
}

function collectMatches(text, rules) {
  const matches = [];
  for (const rule of rules) {
    const match = text.match(rule.pattern);
    if (!match) continue;
    const evidence = cleanEvidence(match[0]);
    if (evidence) matches.push({ evidence, strength: rule.strength || 1 });
  }
  return matches;
}

function orderLabels(labels) {
  return LABEL_PRIORITY.filter((label) => labels.includes(label));
}

function classifyConfidence(labels, strengths, text) {
  if (labels.length === 1 && labels[0] === "ambiguous") return "low";
  if (labels.includes("boundary")) {
    return labels.includes("positive") ? "medium" : "high";
  }
  if (labels.includes("positive") && strengths.positive >= 2) {
    return labels.includes("closing") || labels.includes("lowEnergy") ? "medium" : "high";
  }
  if (labels.includes("ambiguous")) return "low";
  if (labels.includes("closing") || labels.includes("lowEnergy")) return "medium";
  if (labels.includes("polite")) return text.length <= 8 ? "low" : "medium";
  return "low";
}

function buildUncertainty(labels, confidence) {
  if (labels.includes("boundary")) {
    return "边界或拒绝信号比较明确，但这条消息不能用来推断她对关系的长期意愿。";
  }
  if (labels.includes("closing")) {
    return "收尾信号比较明确；是否愿意之后继续交流，需要观察她后续是否主动恢复话题。";
  }
  if (labels.includes("positive") && !labels.includes("ambiguous")) {
    return "这条消息有积极的交流信号，但积极回应不等于暧昧或确定关系。";
  }
  if (labels.includes("lowEnergy")) {
    return "当前更像精力或时间有限，不能把低能量误读成拒绝，也不能据此推断暧昧。";
  }
  if (confidence === "low") {
    return "信息不足，无法仅凭这一句话判断她是否愿意继续发展关系。";
  }
  return "礼貌不等于兴趣，建议结合前后文、持续投入和后续行为再判断。";
}

function buildRecommendation(labels) {
  if (labels.includes("boundary")) {
    return "先承认并尊重她的空间，简短收尾；不要追问原因、连续发送或要求她马上解释。";
  }
  if (labels.includes("closing")) {
    return "顺势收尾即可，例如回复晚安或‘好，你先休息’，把下一次交流留给自然时机。";
  }
  if (labels.includes("lowEnergy")) {
    return "降低消息长度和问题密度，先表达理解，不把对方的疲惫当成需要你解决的关系问题。";
  }
  if (labels.includes("positive") && !labels.includes("ambiguous")) {
    return "承接她提到的具体内容，轻量延续一个话题；保持清楚、可退一步，不急着升级关系。";
  }
  if (labels.includes("polite")) {
    return "礼貌回应即可，不要过度解读；可以观察她是否主动补充细节或提出问题。";
  }
  return "先承认不确定，结合前后文和后续投入观察，不要用一句短消息替她下结论。";
}

/**
 * 对一条消息做保守的多标签信号分类。
 * @param {string} message
 * @param {object} [context] 预留给前后文、阶段或说话人信息；规则结果仍可离线复现。
 * @returns {{labels: string[], confidence: "high"|"medium"|"low", evidence: string[], uncertainty: string, recommendedDirection: string, source: string}}
 */
export function classifySocialSignals(message, context = {}) {
  const text = normalizeMessage(message);
  const matches = {};
  for (const label of ["boundary", "closing", "lowEnergy", "polite", "positive"]) {
    matches[label] = collectMatches(text, RULES[label]);
  }

  const has = (label) => matches[label].length > 0;
  const strengths = {
    positive: Math.max(0, ...matches.positive.map((item) => item.strength))
  };
  const labels = [];

  if (has("boundary")) labels.push("boundary");
  if (has("closing")) labels.push("closing");
  if (has("lowEnergy")) labels.push("lowEnergy");
  if (has("polite")) labels.push("polite");
  if (has("positive")) labels.push("positive");

  // 只有礼貌/疲惫/弱积极信号时，明确标记信息不足，避免把低投入当成暧昧。
  const weakPositive = has("positive") && strengths.positive < 2;
  const weakOnly = !has("boundary") && !has("closing") && (has("polite") || has("lowEnergy") || weakPositive);
  if (!labels.length || weakOnly || (weakPositive && !has("boundary") && !has("closing"))) {
    labels.push("ambiguous");
  }

  const orderedLabels = orderLabels(unique(labels));
  const confidence = classifyConfidence(orderedLabels, strengths, text);
  const evidence = unique(
    ["boundary", "closing", "lowEnergy", "polite", "positive"]
      .flatMap((label) => matches[label].map((item) => item.evidence))
  );

  const analysis = {
    labels: orderedLabels,
    confidence,
    evidence,
    uncertainty: buildUncertainty(orderedLabels, confidence),
    recommendedDirection: buildRecommendation(orderedLabels),
    source: "local-rules"
  };

  // context 目前不改变本地分类，保留字段让调用方可以传入阶段/前文而不破坏接口。
  void context;
  return analysis;
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shuffleDeterministically(values, seed) {
  const result = values.slice();
  let state = stableHash(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

/**
 * 创建一个可重复的信号判断题。expected 保留给提交后的本地评分，页面可以在提交前隐藏它。
 */
export function buildSignalExercise(message, seed = "") {
  const text = normalizeMessage(message);
  const normalizedSeed = String(seed ?? "");
  const expected = classifySocialSignals(text);
  const optionKeys = shuffleDeterministically(SOCIAL_SIGNAL_LABELS, `${normalizedSeed}\u0000${text}`);

  return {
    id: `signal-${stableHash(`${normalizedSeed}\u0000${text}`).toString(16)}`,
    message: text,
    prompt: "这条消息更接近哪些信号？可以多选；不确定时选择‘信息不足’。",
    options: optionKeys.map((key) => ({
      key,
      label: LABEL_META[key].label,
      description: LABEL_META[key].description
    })),
    expected,
    seed: normalizedSeed,
    answerVisible: false
  };
}

function normalizeLabelToken(value) {
  const token = String(value ?? "").trim();
  if (!token) return "";
  if (SOCIAL_SIGNAL_LABELS.includes(token)) return token;
  if (LABEL_ALIASES[token]) return LABEL_ALIASES[token];
  return "";
}

function normalizeLabels(value) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,，、/|]+/u)
      : value && Array.isArray(value.labels)
        ? value.labels
        : value && value.key
          ? [value.key]
          : [];
  return orderLabels(unique(source.map(normalizeLabelToken)));
}

/**
 * 对用户的多选结果进行确定性评分。
 * exact label set => correct；有重叠但不完整 => partial；无重叠 => incorrect。
 */
export function evaluateSignalGuess(expected, guess) {
  const expectedLabels = normalizeLabels(expected);
  const canonicalExpected = expectedLabels.length ? expectedLabels : ["ambiguous"];
  const guessLabels = normalizeLabels(guess);
  const expectedSet = new Set(canonicalExpected);
  const guessSet = new Set(guessLabels);
  const matchedLabels = canonicalExpected.filter((label) => guessSet.has(label));
  const missedLabels = canonicalExpected.filter((label) => !guessSet.has(label));
  const extraLabels = guessLabels.filter((label) => !expectedSet.has(label));
  const correct = missedLabels.length === 0 && extraLabels.length === 0;
  const partial = !correct && matchedLabels.length > 0;
  const unionSize = new Set([...canonicalExpected, ...guessLabels]).size;
  const score = correct
    ? 1
    : unionSize === 0
      ? 0
      : Number((matchedLabels.length / unionSize).toFixed(2));

  let explanation;
  if (correct) {
    explanation = "判断完整。注意：这些标签描述的是当前消息信号，不代表确定的暧昧或关系意愿。";
  } else if (partial) {
    const missed = missedLabels.map((label) => LABEL_META[label].label).join("、");
    const extra = extraLabels.map((label) => LABEL_META[label].label).join("、");
    const details = [
      matchedLabels.length ? `抓到了${matchedLabels.map((label) => LABEL_META[label].label).join("、")}` : "",
      missed ? `还漏了${missed}` : "",
      extra ? `多选了${extra}` : ""
    ].filter(Boolean).join("，");
    explanation = `部分正确：${details}。${getExpectedUncertainty(expected)}`;
  } else {
    explanation = `这次没有命中核心信号。更稳妥的答案是${canonicalExpected.map((label) => LABEL_META[label].label).join("、")}。${getExpectedUncertainty(expected)}`;
  }

  return {
    correct,
    partial,
    score,
    expectedLabels: canonicalExpected,
    guessLabels,
    matchedLabels,
    missedLabels,
    extraLabels,
    explanation
  };
}

function getExpectedUncertainty(expected) {
  if (expected && typeof expected === "object" && expected.uncertainty) {
    return expected.uncertainty;
  }
  return "不要只凭一条消息推断暧昧或拒绝，结合前后文和后续投入观察。";
}

