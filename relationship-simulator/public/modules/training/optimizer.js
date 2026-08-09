/**
 * 消息优化器 2.0 的纯函数模块。
 *
 * 这个模块不依赖 DOM、localStorage 或模型请求，因此可以在浏览器和
 * Node 测试环境中复用。模型输出必须经过 normalizeOptimizationResult，
 * 不能直接进入 UI 或发送流程。
 */

const DEFAULT_STAGE = "未标注阶段";
const DEFAULT_LOW_PRESSURE_TEXT = "如果你方便的话，有空再回我就好。";
const DEFAULT_PROACTIVE_TEXT = "如果你愿意，方便时可以跟我分享一点近况。";

const RISK_RULES = [
  { label: "施压", pattern: /必须|一定要|赶紧|立刻|马上|不许|你得|你应该/ },
  { label: "情绪绑架", pattern: /不回(?:我)?(?:就是|就说明|就代表)|看不起我|不在乎我|给我个交代|证明你/ },
  { label: "追问施压", pattern: /你怎么还不回|为什么不回|怎么不理我|你怎么不理我/ },
  { label: "贬低", pattern: /你是不是(?:有病|傻|蠢|不正常|故意)|闭嘴|滚开|废物|垃圾/ },
  { label: "操控或威胁", pattern: /不给.{0,8}(?:就|否则)|否则.{0,8}(?:后果|拉黑)|不.{0,5}(?:准|允许)/ },
  { label: "越界隐私", pattern: /跟踪|定位|查手机|密码|发裸照|发私密照|开房/ },
  { label: "过早亲密", pattern: /宝贝|宝宝|亲爱的|性感|身材/ },
  { label: "伤害性表达", pattern: /去死|自杀/ }
];

const INTENT_STOP_CHARS = new Set(
  "你我他她它是吗呢啊呀哦有没不还怎么最近是不是的了么很也再就想要会能可以如果因为跟和在从一下这那把给让对与及都来去一个什么是否然后现在刚才真的挺比较".split("")
);

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizePunctuation(text) {
  return cleanText(text)
    .replace(/[?？]{2,}/g, "？")
    .replace(/[!！]{2,}/g, "！")
    .replace(/[，,]{2,}/g, "，")
    .replace(/^[，,。！？!?\s]+|[，,。！？!?\s]+$/g, "")
    .trim();
}

function stripTrailingPunctuation(text) {
  return cleanText(text).replace(/[。！？!?，,\s]+$/g, "");
}

function riskHits(text) {
  const source = cleanText(text);
  if (!source) return [];

  return RISK_RULES
    .filter(({ pattern }) => pattern.test(source))
    .map(({ label }) => label);
}

function containsRisk(text) {
  return riskHits(text).length > 0;
}

function countQuestions(text) {
  return (cleanText(text).match(/[？?]/g) || []).length;
}

function hasClosingSignal(text) {
  return /早点休息|晚安|先睡|睡了|明天再聊|下次聊|先这样|不早了|先不聊/.test(cleanText(text));
}

function hasBoundarySignal(text) {
  return /不想|不用|别问|改天|再说|不方便|算了|拒绝|先不|需要.{0,4}(?:空间|安静|休息)/.test(cleanText(text));
}

function hasQuestion(text) {
  return /[？?]/.test(cleanText(text));
}

function firstQuestion(text) {
  const source = normalizePunctuation(text);
  const match = source.match(/^(.{1,80}?[？?])/u);
  return match ? match[1] : source;
}

function quotedTopic(text) {
  const match = cleanText(text).match(/[《「“‘](.{1,24}?)[》」”’]/u);
  return match ? match[1].trim() : "";
}

function extractIntentAnchors(text) {
  const source = cleanText(text);
  const anchors = [];
  const quoted = quotedTopic(source);
  if (quoted) anchors.push(quoted);

  for (const word of source.match(/[A-Za-z0-9][A-Za-z0-9_-]{1,}/g) || []) {
    anchors.push(word.toLowerCase());
  }

  for (const run of source.match(/[\u3400-\u9fff]{2,}/gu) || []) {
    const meaningful = Array.from(run).filter((char) => !INTENT_STOP_CHARS.has(char));
    if (meaningful.length >= 2) {
      anchors.push(meaningful.join(""));
      for (let index = 0; index < meaningful.length - 1; index += 1) {
        anchors.push(meaningful.slice(index, index + 2).join(""));
      }
    }
  }

  return [...new Set(anchors)].filter((anchor) => anchor.length >= 2 || /[A-Za-z0-9]/.test(anchor));
}

function inferIntent(text) {
  const source = cleanText(text);
  let type = "share";
  if (/一起|见面|约|咖啡|散步|看电影|吃饭|下次见/.test(source)) type = "invite";
  else if (hasClosingSignal(source)) type = "close";
  else if (hasBoundarySignal(source)) type = "boundary";
  else if (hasQuestion(source)) type = "ask";
  else if (/想你|喜欢你|在意|担心|想听/.test(source)) type = "express";
  else if (/最近|今天|这几天|还好吗|怎么样|忙不忙|回我|联系/.test(source)) type = "checkIn";

  return {
    type,
    anchors: extractIntentAnchors(source),
    summary: type === "invite"
      ? "提出轻量互动或见面意愿"
      : type === "close"
        ? "自然结束本轮交流"
        : type === "boundary"
          ? "表达边界或降低互动压力"
          : type === "ask"
            ? "围绕当前话题获取回应"
            : type === "checkIn"
              ? "关心近况并保持联系"
              : "分享想法或感受"
  };
}

function hasAnchor(original, candidate) {
  const source = cleanText(candidate).toLowerCase();
  const anchors = extractIntentAnchors(original).map((anchor) => anchor.toLowerCase());
  if (!anchors.length) return true;
  return anchors.some((anchor) => source.includes(anchor));
}

function preservesIntent(original, candidate) {
  const originalIntent = inferIntent(original);
  const text = cleanText(candidate);
  if (!text) return false;

  if (originalIntent.type === "close") return /休息|晚安|明天|下次|先到这里|不打扰/.test(text);
  if (originalIntent.type === "boundary") return /按你|你的节奏|不打扰|空间|方便|愿意|没关系/.test(text);
  if (originalIntent.type === "invite") {
    return hasAnchor(original, text) || /一起|见面|找个时间|有空|下次|聊聊/.test(text);
  }
  if (originalIntent.type === "ask") return hasAnchor(original, text) || hasQuestion(text) || /告诉我|聊聊|听你说/.test(text);
  return hasAnchor(original, text) || /有空|方便|愿意|聊聊|回我|近况|分享/.test(text);
}

function pickTopic(original, context = {}) {
  const explicit = cleanText(context.topic || context.recentTopic || context.topicHint);
  if (explicit) return explicit;
  const quoted = quotedTopic(original);
  if (quoted) return quoted;

  const topicMatch = cleanText(original).match(/咖啡|奶茶|电影|纪录片|音乐|书|展览?|散步|旅行|工作|学习|天气|周末|项目|活动/u);
  return topicMatch ? topicMatch[0] : "";
}

function removePressureAndRisk(text) {
  let result = cleanText(text)
    .replace(/你怎么还不回(?:我)?[呀啊呢吗?？]*/g, "你最近是不是有点忙")
    .replace(/为什么不回(?:我)?[呀啊呢吗?？]*/g, "你最近是不是有点忙")
    .replace(/怎么(?:不理|不回)(?:我)?[呀啊呢吗?？]*/g, "你最近是不是有点忙")
    .replace(/你是不是不高兴/g, "你是不是最近有点不舒服")
    .replace(/不回(?:我)?(?:就是|就说明|就代表)[^。！？!?，,]*/g, "")
    .replace(/(?:必须|一定要|赶紧|立刻|马上|不许|你得|你应该)/g, "")
    .replace(/(?:宝贝|宝宝|亲爱的|性感|身材|酒店|开房|发裸照|发私密照)/g, "")
    .replace(/(?:看不起我|不在乎我|给我个交代|证明你)/g, "")
    .replace(/(?:你是不是(?:有病|傻|蠢|不正常|故意)|闭嘴|滚开|废物|垃圾|去死|自杀)/g, "")
    .replace(/\s+/g, " ");

  result = normalizePunctuation(result);
  if (containsRisk(result)) return "";
  return result;
}

function appendSentence(base, suffix) {
  const left = stripTrailingPunctuation(base);
  if (!left) return suffix;
  return `${left}。${suffix}`;
}

function makeLowPressureText(original, context) {
  if (!cleanText(original)) return "";

  const closing = hasClosingSignal(original);
  const boundary = hasBoundarySignal(original);
  const topic = pickTopic(original, context);
  let base = removePressureAndRisk(original);

  if (closing) {
    return topic
      ? `好，你先休息，等你方便时我们再聊聊${topic}。`
      : "好，你先休息，等你方便时我们再聊。";
  }

  if (boundary) {
    return "好，我听到了。你先按自己的节奏来，不急着回复。";
  }

  if (countQuestions(base) > 1) base = firstQuestion(base);
  if (!base) {
    return topic ? `如果你方便的话，有空再聊聊${topic}就好。` : DEFAULT_LOW_PRESSURE_TEXT;
  }

  if (canonicalText(base) === canonicalText(original)) {
    base = base.replace(/有空再/g, "方便时再").replace(/你有空/g, "你方便时");
  }
  if (!/有空|方便|不急|不用马上|按自己的节奏/.test(base)) {
    base = appendSentence(base, "有空再回我就好");
  }

  return containsRisk(base) ? DEFAULT_LOW_PRESSURE_TEXT : normalizePunctuation(base) + (/[。！？!?]$/.test(base) ? "" : "。");
}

function makeProactiveText(original, context, lowPressureText) {
  if (!cleanText(original)) return "";

  const topic = pickTopic(original, context);
  if (hasClosingSignal(original)) {
    return topic
      ? `好，那先不打扰你。等你愿意时，我们再从${topic}聊起。`
      : "好，那先不打扰你。等你愿意时，我们再接着聊。";
  }
  if (hasBoundarySignal(original)) {
    return topic
      ? `明白，我先给你空间。等你方便时，如果愿意可以再聊聊${topic}。`
      : "明白，我先给你空间。等你方便时，如果愿意我们再聊。";
  }

  const base = stripTrailingPunctuation(lowPressureText || removePressureAndRisk(original));
  const action = topic
    ? `有空的话，我们可以继续聊聊${topic}。`
    : "有空的话，可以跟我分享一点今天最想说的事。";
  const result = appendSentence(base, action);
  return containsRisk(result) ? DEFAULT_PROACTIVE_TEXT : result;
}

function variant(text, changes, reason, stage, original) {
  const safeText = cleanText(text);
  const risks = riskHits(safeText);
  return {
    text: safeText,
    changes: [...new Set(changes.filter(Boolean))],
    reason: cleanText(reason),
    stage: cleanText(stage) || DEFAULT_STAGE,
    applicableStage: cleanText(stage) || DEFAULT_STAGE,
    risks,
    safe: risks.length === 0,
    intentPreserved: preservesIntent(original, safeText),
    diff: diffText(original, safeText)
  };
}

function localChanges(original, lowPressure = false) {
  const changes = [];
  const hits = riskHits(original);
  if (hits.length) changes.push("移除施压、指责或越界表达");
  if (countQuestions(original) > 1) changes.push("保留一个核心问题，避免连续追问");
  if (cleanText(original).length > 90) changes.push("压缩多余解释，降低消息负担");
  if (lowPressure || !changes.length) changes.push("补充可拒绝的空间，降低回复压力");
  return changes;
}

function buildResult(original, context = {}, source = "local") {
  const text = cleanText(original);
  const stage = cleanText(context.stage) || DEFAULT_STAGE;
  const intent = inferIntent(text);
  const originalRisks = riskHits(text);
  const lowText = makeLowPressureText(text, context);
  const proactiveText = makeProactiveText(text, context, lowText);
  const low = variant(
    lowText,
    localChanges(text, true),
    "先承接原本想表达的内容，再给对方更多选择和空间。",
    stage,
    text
  );
  const proactive = variant(
    proactiveText,
    [...localChanges(text), "补充一个具体且低压力的话题入口"],
    "保留边界的同时给出轻量、可拒绝的下一步，避免对话停在空泛表达。",
    stage,
    text
  );

  return {
    original: text,
    intent,
    lowPressure: low,
    proactive,
    recommendation: originalRisks.length || hasClosingSignal(text) || hasBoundarySignal(text)
      ? "lowPressure"
      : "proactive",
    confidence: source === "local" ? "low" : "medium",
    risk: {
      level: originalRisks.length ? "high" : "low",
      hits: originalRisks,
      filtered: originalRisks.length > 0
    },
    source,
    version: "2.0"
  };
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseModelValue(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getVariant(value, key) {
  if (!isObject(value)) return null;
  return value[key] || value[key === "lowPressure" ? "low_pressure" : "proactive_version"] || null;
}

function normalizeChanges(value, fallback) {
  if (Array.isArray(value)) {
    const changes = value.map(cleanText).filter(Boolean);
    if (changes.length) return [...new Set(changes)].slice(0, 8);
  }
  if (typeof value === "string" && cleanText(value)) return [cleanText(value)];
  return fallback;
}

function canonicalText(value) {
  return cleanText(value).replace(/[\s。！？!?，,、；;：“”‘’"'（）()]/g, "").toLowerCase();
}

function validCandidate(text, original, otherText = "") {
  const candidate = cleanText(text);
  if (!candidate || canonicalText(candidate) === canonicalText(original)) return false;
  if (otherText && canonicalText(candidate) === canonicalText(otherText)) return false;
  if (containsRisk(candidate)) return false;
  return preservesIntent(original, candidate);
}

function fallbackVariant(fallbackResult, key, localResult, original) {
  const supplied = getVariant(fallbackResult, key);
  const local = localResult[key];
  const suppliedText = isObject(supplied) ? supplied.text : supplied;
  return validCandidate(suppliedText, original)
    ? variant(
      suppliedText,
      normalizeChanges(supplied.changes, local.changes),
      cleanText(supplied.reason) || local.reason,
      cleanText(supplied.stage || supplied.applicableStage) || local.stage,
      original
    )
    : local;
}

function normalizeModelVariant(raw, key, original, fallback, otherText) {
  const rawText = isObject(raw) ? raw.text : raw;
  if (!validCandidate(rawText, original, otherText)) return { value: fallback, accepted: false };

  return {
    value: variant(
      rawText,
      normalizeChanges(raw.changes, fallback.changes),
      cleanText(raw.reason) || fallback.reason,
      cleanText(raw.stage || raw.applicableStage) || fallback.stage,
      original
    ),
    accepted: true
  };
}

/**
 * 生成离线可用的三版本优化结果。
 * @param {string} original 用户原始草稿
 * @param {{stage?: string, topic?: string, recentTopic?: string}} context 上下文
 * @returns {OptimizationResult}
 */
export function buildLocalOptimizations(original, context = {}) {
  return buildResult(original, context, "local");
}

/**
 * 校验和规整模型输出。任何解析失败、空文本、重复文本、未保留意图或
 * 含有高风险表达的版本都会回退到安全版本；original 始终以用户原文为准。
 * @param {object|string|null} value 模型返回的对象或 JSON 字符串
 * @param {string} original 用户原始草稿
 * @param {OptimizationResult} [fallback] 可选的本地或调用方兜底结果
 * @returns {OptimizationResult}
 */
export function normalizeOptimizationResult(value, original, fallback = null) {
  const sourceText = cleanText(original);
  const local = buildLocalOptimizations(sourceText);
  const parsed = parseModelValue(value);
  const fallbackObject = isObject(fallback) ? fallback : null;
  const lowFallback = fallbackVariant(fallbackObject, "lowPressure", local, sourceText);
  const proactiveFallback = fallbackVariant(fallbackObject, "proactive", local, sourceText);
  const candidateObject = isObject(parsed?.result) ? parsed.result : parsed;

  if (!isObject(candidateObject)) {
    return {
      ...local,
      lowPressure: lowFallback,
      proactive: proactiveFallback,
      source: "local-fallback"
    };
  }

  const lowCandidate = normalizeModelVariant(
    getVariant(candidateObject, "lowPressure"),
    "lowPressure",
    sourceText,
    lowFallback,
    ""
  );
  const lowText = lowCandidate.value.text;
  const proactiveCandidate = normalizeModelVariant(
    getVariant(candidateObject, "proactive"),
    "proactive",
    sourceText,
    proactiveFallback,
    lowText
  );

  const acceptedCount = Number(lowCandidate.accepted) + Number(proactiveCandidate.accepted);
  const recommendation = candidateObject.recommendation === "proactive" ? "proactive" : "lowPressure";
  const confidence = ["high", "medium", "low"].includes(candidateObject.confidence)
    ? candidateObject.confidence
    : acceptedCount === 2 ? "medium" : "low";

  return {
    original: sourceText,
    intent: local.intent,
    lowPressure: lowCandidate.value,
    proactive: proactiveCandidate.value,
    recommendation,
    confidence,
    risk: local.risk,
    source: acceptedCount === 2 ? "model" : "mixed-fallback",
    version: "2.0"
  };
}

/**
 * 对中文和其他 Unicode 文本进行字符级 Diff，不依赖第三方包。
 * 返回片段按原文到新文的顺序排列，相邻同类型片段会合并。
 * @param {string} before
 * @param {string} after
 * @returns {Array<{type: "same"|"added"|"removed", text: string}>}
 */
export function diffText(before, after) {
  const left = Array.from(before === null || before === undefined ? "" : String(before));
  const right = Array.from(after === null || after === undefined ? "" : String(after));
  const rows = left.length + 1;
  const cols = right.length + 1;
  const table = Array.from({ length: rows }, () => new Uint32Array(cols));

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const parts = [];
  const push = (type, char) => {
    if (!char) return;
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += char;
    else parts.push({ type, text: char });
  };

  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      push("same", left[i]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      push("removed", left[i]);
      i += 1;
    } else {
      push("added", right[j]);
      j += 1;
    }
  }
  while (i < left.length) push("removed", left[i++]);
  while (j < right.length) push("added", right[j++]);

  return parts;
}

/**
 * @typedef {Object} OptimizationVariant
 * @property {string} text
 * @property {string[]} changes
 * @property {string} reason
 * @property {string} stage
 * @property {string} applicableStage
 * @property {string[]} risks
 * @property {boolean} safe
 * @property {boolean} intentPreserved
 * @property {Array<{type: "same"|"added"|"removed", text: string}>} diff
 *
 * @typedef {Object} OptimizationResult
 * @property {string} original
 * @property {{type: string, anchors: string[], summary: string}} intent
 * @property {OptimizationVariant} lowPressure
 * @property {OptimizationVariant} proactive
 * @property {"lowPressure"|"proactive"} recommendation
 * @property {"high"|"medium"|"low"} confidence
 * @property {{level: string, hits: string[], filtered: boolean}} risk
 * @property {string} source
 * @property {string} version
 */
