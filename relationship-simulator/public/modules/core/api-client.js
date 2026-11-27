import { buildHerSystemPrompt, buildHerTaskPrompt, buildCoachSystemPrompt } from "../coach/prompts.js";
import { DEFAULT_MODEL, API_ENDPOINTS, DEFAULT_TEMPERATURE } from "./config.js";
import { sanitizeOutboundMessages } from "./privacy.js";
import { selectInjectedMemoryEntries } from "./memory.js";

/** 把会话消息映射为消息角色：她=assistant、我=user；无文本的条目跳过。 */
function toHistoryMessages(messages, personaName) {
  const history = [];
  for (const message of (Array.isArray(messages) ? messages : [])) {
    if (!message || !message.text) continue;
    if (message.type === "her") {
      history.push({ role: "assistant", content: `${message.who || personaName}：${message.text}` });
    } else {
      history.push({ role: "user", content: `我：${message.text}` });
    }
  }
  return history;
}

// ── 确定性回复护栏 ────────────────────────────────────────────────────────────
//
// 这一层只做两件可验证的事：
// 1. 识别「你是不是 AI」这类整句身份询问，给出固定答复；
// 2. 用户追问自己的过往事实时，只**引用**当前对话与授权且可见的长期记忆里出现过的原话。
//
// 设计约束（对应 2026-11-06 审计）：
// - 不做事实改写：否定句原样引用，不会被翻成肯定；不确定表达原样保留。
// - 来源封闭：只用用户自己发的消息（她的话、模型的输出都不算证据），
//   以及 `buildMemoryInjection` 真正会注入的那几条记忆；不用 `JSON.stringify(memory)`。
// - 无法覆盖自由生成：普通聊天里模型是否编造用户事实，仍由提示词约束，
//   不能把这一层当成事实校验器。

/** 身份直问的固定答复：角色扮演不得覆盖。 */
export const AI_IDENTITY_REPLY = "我是 AI 模拟角色，不是真人。";

/** 身份询问里的名词槽位（含「还是人」这种对举用法）。 */
const AI_IDENTITY_NOUN = "(?:真人|人类|人工智能|ai|机器人|机器|语言模型|大模型|虚拟角色|模拟角色|程序|人)";

/**
 * 直接身份询问：只匹配「（你/您）+ 系词 + 身份名词（+ 吗/呢/吧）」这类整句。
 * 不做关键词命中，避免「我在看 AI 电影，你觉得怎么样？」被误判。
 * @param {string} text
 * @returns {boolean}
 */
export function isAiIdentityQuestion(text) {
  const query = String(text || "")
    .trim()
    .replace(/^(?:请问|想问一下|我想问一下|问一下|想问)[，,：:、]?\s*/, "")
    .replace(/[\s\u3000]+/g, "");
  if (!query || query.length > 40) return false;
  const self = "(?:你|您)";
  const lead = "(?:到底|究竟|真的|实际上|其实)?";
  const tail = "(?:吗|么|呢|吧|啊)?[？?。！!~～]*";
  const straight = new RegExp(`^${self}${lead}(?:是不是|是否|是|算是|属于)(?:一个|一名|一款)?${AI_IDENTITY_NOUN}(?:模拟)?(?:角色|人物|程序)?${tail}$`, "i");
  const either = new RegExp(`^${self}${lead}(?:是|算是)(?:一个|一名)?${AI_IDENTITY_NOUN}(?:吗|么)?[？?]*(?:还是|或者|或)(?:一个|一名)?${AI_IDENTITY_NOUN}${tail}$`, "i");
  return straight.test(query) || either.test(query);
}

/** 时间锚：顺序有意义，「上周末」必须先于「上周」，否则会被后者截胡。 */
const RECALL_ANCHORS = [
  { key: "weekend:last", pattern: /上个周末|上周末|上星期末/ },
  { key: "week:last", pattern: /上个星期|上礼拜|上周/ },
  { key: "month:last", pattern: /上个月|上月/ },
  { key: "year:last", pattern: /去年/ },
  { key: "day:-2", pattern: /前天/ },
  { key: "day:-1", pattern: /昨天|昨日/ },
  { key: "day:recent", pattern: /前几天|这两天|最近几天/ },
  { key: "time:last", pattern: /上一回|上回|上次/ },
  { key: "time:before", pattern: /之前|以前|早先/ },
  { key: "time:that", pattern: /那天|当时|那次/ }
];

/** 语义模糊、可以跨具体时间锚匹配的词。 */
const VAGUE_ANCHOR_KEYS = new Set(["time:last", "time:before", "time:that"]);

/** 谓词归并：只做同义动作归一，不承担「猜答案」的职责。 */
const PREDICATE_GROUPS = [
  ["去", "到", "在", "待", "呆", "留", "回", "飞", "赶"],
  ["买", "购", "入手", "下单", "订"],
  ["吃", "喝", "尝"],
  ["看", "瞧", "追"],
  ["说", "讲", "提", "聊", "谈", "告诉"],
  ["做", "干", "弄", "搞"],
  ["见", "碰", "遇"],
  ["玩", "逛"]
];

const WEAK_PREDICATES = new Set(["那", "这", "个", "家", "的", "和", "跟", "对", "把", "被", "们", "什", "哪", "吗", "呢", "吧", "啊", "了", "着", "过"]);

const KEYWORD_NOISE = new Set([
  "什么", "哪个", "哪里", "哪儿", "哪座", "哪家", "哪位", "谁", "哪天", "多少", "怎么", "怎样",
  "记得", "记不", "不记", "你还", "还记", "上上", "上周", "周末", "个月", "去年", "昨天", "前天",
  "几天", "上次", "之前", "以前", "时候", "那次", "那天", "当时", "说过", "提过", "告诉", "我们"
]);

/** 去掉「你还记得」「我之前说过」这类提问框架，剩下的才是被问的事实。 */
function stripRecallFrame(text) {
  return String(text || "")
    .replace(/^(?:请问|想问一下|我想问一下)[，,：:]?\s*/, "")
    .replace(/^(?:你|您)?(?:还)?(?:记不记得|记得|记起|想起|回忆一下|想一想|能想起)/, "")
    .replace(/^(?:我)?(?:之前|以前)?(?:有没有)?(?:说过|提过|告诉过你|讲过|跟你提过|跟你说过)/, "")
    .replace(/^[，,：:\s]+/, "");
}

function detectAnchor(text) {
  for (const anchor of RECALL_ANCHORS) {
    if (anchor.pattern.test(text)) return anchor;
  }
  return null;
}

function predicateKey(head) {
  if (!head || WEAK_PREDICATES.has(head)) return "";
  for (const group of PREDICATE_GROUPS) {
    if (group.includes(head)) return group[0];
  }
  return head;
}

/** 取时间锚（没有锚则取「我」）之后的第一个实义动词字，作为谓词头。 */
function predicateHead(text, anchor) {
  let rest = String(text || "");
  const match = anchor ? rest.match(anchor.pattern) : null;
  if (match) {
    rest = rest.slice(match.index + match[0].length);
  } else {
    const self = rest.match(/我(?!们)/);
    if (self) rest = rest.slice(self.index + 1);
  }
  rest = rest.replace(/^[\s，,。、；;：:！？?]+/, "");
  let previous;
  do {
    previous = rest;
    rest = rest.replace(/^(?:并没有|没有|并未|从没有|从没|没|不|别|未|也|还|就|又|才|都|已经|刚|刚刚|真的|确实|其实|后来|然后|结果|可能|好像|大概|应该|估计|说不定|有点|有些|只|只是|是|有|了|过|着|我|你|他|她|它|们|这|那|个|把|给|跟|和|对)+/, "");
  } while (rest !== previous);
  const head = rest.match(/^[a-zA-Z]+|^[\u4e00-\u9fa5]/);
  return head ? head[0].toLowerCase() : "";
}

/** 抽取 2-gram 内容词，用于谓词缺失时的兜底匹配。 */
function contentBigrams(text) {
  const cleaned = String(text || "")
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "")
    .replace(/上个周末|上周末|上个星期|上礼拜|上周|上个月|上月|去年|前天|昨天|昨日|前几天|这两天|最近几天|上一回|上回|上次|之前|以前|早先|那天|当时|那次/g, "")
    .replace(/我们|你们|他们|她们/g, "")
    .replace(/[我你他她它的了吗呢吧啊呀哦嗯着过这那个家]/g, "")
    .replace(/什么|哪个|哪里|哪儿|哪座|哪家|哪位|谁|哪天|什么时候|几点|多少|几号|来着|记得|记不记得|说过|提过|告诉过/g, "");
  const grams = new Set();
  for (const run of cleaned.match(/[\u4e00-\u9fa5]{2,}/g) || []) {
    for (let index = 0; index + 1 < run.length; index += 1) {
      const gram = run.slice(index, index + 2);
      if (!KEYWORD_NOISE.has(gram)) grams.add(gram);
    }
  }
  return grams;
}

function sharedKeywordCount(leftText, rightText) {
  const left = contentBigrams(leftText);
  const right = contentBigrams(rightText);
  let count = 0;
  for (const gram of left) {
    if (right.has(gram)) count += 1;
  }
  return count;
}

/** 极性沿用原句：否定句只是被引用，不会被改写成肯定。 */
function detectPolarity(text, anchor) {
  let rest = String(text || "");
  const match = anchor ? rest.match(anchor.pattern) : null;
  if (match) rest = rest.slice(match.index + match[0].length);
  const window = rest.replace(/^[\s，,。、；;：:！？?]+/, "").slice(0, 8);
  if (/(?:可能|也许|大概|好像|似乎|应该|估计|说不定|不确定|记不清|忘了|说不准|打算|准备|想着|考虑|想要)/.test(window)) return "uncertain";
  if (/^(?:也|还|就|又|才|都|已经|刚|刚刚|真的|确实|其实|后来|然后|结果)?(?:并没有|没有|没|不|未|从没|从没有)/.test(window)) return "negated";
  return "affirmed";
}

/** 判断是否为「追问自己过往事实」；普通聊天必须返回 false，否则会劫持对话。 */
export function isPersonalFactRecall(text) {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 60) return false;
  const query = raw.replace(/\s+/g, "");
  if (!/我(?!们)/.test(query)) return false;
  // 「你猜我上周干了什么」是互动玩法，不是要事实核对
  if (/你猜|猜猜|猜一下|猜猜看/.test(query)) return false;

  const hasRecallVerb = /(?:记不记得|记得|记起|想起|回忆一下|想一想)/.test(query)
    || /(?:我之前|我以前|我)(?:说过|提过|告诉过你|讲过|跟你提过|跟你说过)/.test(query);
  if (hasRecallVerb) return true;

  const body = stripRecallFrame(query);
  const anchor = detectAnchor(body);
  if (!anchor) return false;
  const anchorIndex = body.search(anchor.pattern);
  if (anchorIndex < 0) return false;
  const before = body.slice(Math.max(0, anchorIndex - 4), anchorIndex);
  // 「我朋友上周…」不算用户自己的经历，必须紧邻时间锚
  if (!/我(?:也|还|就|又|大概|可能|好像|确实)?$/.test(before)) return false;
  const after = body.slice(anchorIndex);
  // 「我上周买了个礼物，你觉得好看么」是在问对方，不是回忆自己
  if (/你/.test(after)) return false;
  return /(?:什么|啥|哪个|哪一个|哪里|哪儿|哪座|哪家|哪位|谁|哪天|什么时候|几点|多少|几号)/.test(after)
    || /(?:吗|么|来着)\s*[？?]?$/.test(after);
}

/** 主语是他人时，不能当成用户自己的经历引用。 */
const OTHER_SUBJECT = /我(?:的)?(?:朋友|同事|同学|室友|老板|领导|家人|妈妈|爸爸|母亲|父亲|哥哥|姐姐|弟弟|妹妹|对象|男友|女友)/;

/** 证据打分：时间锚 + 谓词 + 内容词；分数不足即视为无证据。 */
function scoreRecallEvidence(question, evidence) {
  const qAnchor = detectAnchor(question);
  const eAnchor = detectAnchor(evidence);
  if (qAnchor && eAnchor
    && !VAGUE_ANCHOR_KEYS.has(qAnchor.key)
    && !VAGUE_ANCHOR_KEYS.has(eAnchor.key)
    && qAnchor.key !== eAnchor.key) return 0;

  let score = 0;
  if (qAnchor && eAnchor) score += qAnchor.key === eAnchor.key ? 2 : 1;

  const qPredicate = predicateKey(predicateHead(question, qAnchor));
  const ePredicate = predicateKey(predicateHead(evidence, eAnchor));
  if (qPredicate && ePredicate) score += qPredicate === ePredicate ? 3 : -2;

  score += Math.min(2, sharedKeywordCount(question, evidence));
  return Math.max(0, score);
}

/**
 * 收集记忆核对的事实来源。
 * 只收用户自己发的消息：她的回复与模型输出永远不能变成「用户说过」的证据。
 */
function collectConversationFacts(question, messages) {
  const facts = [];
  const seen = new Set();
  const list = Array.isArray(messages) ? messages.slice(-80) : [];
  for (const message of list) {
    if (message?.type !== "me") continue;
    const text = String(message.text || "").trim();
    if (!text || text === question || seen.has(text)) continue;
    if (isPersonalFactRecall(text)) continue; // 提问本身不是事实
    if (OTHER_SUBJECT.test(text)) continue; // 「我朋友上周去了…」不是用户自己的经历
    seen.add(text);
    facts.push({ text, origin: "conversation" });
  }
  return facts;
}

/**
 * 授权且可见的长期记忆：与 `buildMemoryInjection` 完全同源，
 * 只取真正会进入角色上下文的那几条，未展示字段一律不作为证据。
 */
function collectMemoryFacts(memory) {
  const { timeline, summary } = selectInjectedMemoryEntries(memory?._enhanced);
  const facts = [];
  for (const item of timeline) {
    const text = String(item?.content || "").trim();
    if (text) facts.push({ text, origin: "memory" });
  }
  const summaryText = String(summary?.summary || "").trim();
  if (summaryText) facts.push({ text: summaryText, origin: "memory" });
  return facts;
}

function formatQuote(text) {
  const value = String(text || "")
    .replace(/[「」]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[。！？；，、]+$/, "");
  return `「${value.length > 60 ? `${value.slice(0, 60)}…` : value}」`;
}

function buildRecallReply(matches) {
  const affirmed = matches.filter((item) => item.polarity === "affirmed");
  const negated = matches.filter((item) => item.polarity === "negated");
  const uncertain = matches.filter((item) => item.polarity === "uncertain");
  const allFromConversation = matches.every((item) => item.origin === "conversation");

  if (affirmed.length && (negated.length || uncertain.length)) {
    return `我这边看到的记录有出入：${formatQuote(affirmed[0].text)}${formatQuote((negated[0] || uncertain[0]).text)}。`;
  }
  if (affirmed.length === 1) {
    return `${allFromConversation ? "你之前说过" : "我这边找到的相关记录"}：${formatQuote(affirmed[0].text)}。`;
  }
  if (affirmed.length > 1) {
    return `我这边记到几条相关的话：${affirmed.slice(0, 2).map((item) => formatQuote(item.text)).join("")}。`;
  }
  if (negated.length) {
    return `我这边只看到你说过：${formatQuote(negated[0].text)}。没有更具体的记录。`;
  }
  if (uncertain.length) {
    return `你之前只是说：${formatQuote(uncertain[0].text)}，没有确定下来。`;
  }
  return "我这边没有可靠记录，你愿意再告诉我一次吗？";
}

/**
 * 个人事实回忆核对。
 *
 * 命中「追问自己过往」时，只在下列来源里找同一条带时间锚的陈述：
 * 1. 当前对话里用户自己发的消息；
 * 2. 授权且会被注入的长期记忆条目（最近 3 条时间线 + 最近 1 条摘要）。
 *
 * 找到就**引用原话**，找不到就承认没有记录——不推断、不补全。
 * 非回忆类问题返回 null，交回模型与提示词约束。
 *
 * @param {string} text - 用户最新输入
 * @param {Array<Object>} messages - 当前对话
 * @param {Object} memory - 需含 `_enhanced`；缺失即视为未授权/无记忆
 * @returns {string|null}
 */
export function resolveMemoryRecall(text, messages = [], memory = {}) {
  const question = String(text || "").trim();
  if (!isPersonalFactRecall(question)) return null;

  const body = stripRecallFrame(question.replace(/\s+/g, ""));
  // 「我之前说过什么」是开放式回忆，没有具体可核对的事实；交回模型，
  // 不要用「没有记录」去否认确实存在的记忆条目。
  if (!predicateKey(predicateHead(body, detectAnchor(body))) && contentBigrams(body).size === 0) return null;
  const facts = [...collectConversationFacts(question, messages), ...collectMemoryFacts(memory)];
  const matches = facts
    .map((fact) => ({
      ...fact,
      score: scoreRecallEvidence(body, fact.text),
      polarity: detectPolarity(fact.text, detectAnchor(fact.text))
    }))
    .filter((fact) => fact.score >= 2);

  return buildRecallReply(matches);
}

/**
 * 确定性回复的统一入口：身份直问 → 记忆核对 → 交回模型。
 * app.js 的两条生成路径（模型通道与本地兜底）都必须走这里，避免实现分叉。
 * @returns {{text: string, source: "identity"|"memory-guard"}|null}
 */
export function resolveDeterministicReply(text, messages = [], memory = {}) {
  const latest = String(text || "").trim();
  if (!latest) return null;
  if (isAiIdentityQuestion(latest)) return { text: AI_IDENTITY_REPLY, source: "identity" };
  const recall = resolveMemoryRecall(latest, messages, memory);
  if (recall) return { text: recall, source: "memory-guard" };
  return null;
}

/**
 * 构建「她」的消息列表：只产出微信文本回复，不含教练技能契约与 JSON 要求。
 * @param {Object} persona - 角色对象
 * @param {Object} memory - 角色记忆（含 _enhancedInjection / _tierInjection）
 * @param {Array<Object>} messages - 对话消息列表
 * @param {Object} [uiValues] - UI 参数（用到 mode）
 * @returns {Array<{role: string, content: string}>}
 */
export function buildHerMessages(persona, memory, messages, uiValues = {}) {
  return [
    { role: "system", content: buildHerSystemPrompt(persona, memory, { mode: uiValues.mode, chatStyle: uiValues.chatStyle }) },
    ...toHistoryMessages(messages, persona.name),
    { role: "user", content: buildHerTaskPrompt() }
  ];
}

/**
 * 构建「教练」的消息列表：她的回复作为已知输入，教练只产出分析 JSON。
 * @param {Object} params
 * @param {Object} params.persona - 角色对象
 * @param {Object} params.memory - 角色记忆
 * @param {Array<Object>} params.messages - 对话消息列表
 * @param {string} params.herReply - 已确定的女方回复
 * @param {Object} [params.uiValues] - UI 参数（stage/styleBias/goal/tone/mode/textbookContext）
 * @returns {Array<{role: string, content: string}>}
 */
export function buildCoachMessages({ persona, memory, messages, herReply, uiValues = {} }) {
  const result = [{ role: "system", content: buildCoachSystemPrompt(persona, memory, { tone: uiValues.tone, mode: uiValues.mode }) }];
  result.push(...toHistoryMessages(messages, persona.name));
  const userPrompt = [
    `她本轮的回复（已确定，不要改写、不要替她说话）：${String(herReply || "").trim()}`,
    `当前阶段：${uiValues.stage || ""}`,
    `风格偏好：${uiValues.styleBias || ""}`,
    `当前目标：${uiValues.goal || ""}`,
    "请只输出 JSON。"
  ];
  if (uiValues.textbookContext?.excerpts?.length) {
    userPrompt.push(`教材参考（只用于解释，不得编造）：${JSON.stringify(uiValues.textbookContext.excerpts)}`);
  }
  result.push({ role: "user", content: userPrompt.join("\n") });
  return result;
}

/**
 * 调用 LLM API
 * @param {Object} options - 调用参数
 * @param {string} [options.endpoint] - API 端点
 * @param {string} [options.apiKey] - API 密钥
 * @param {string} [options.model] - 模型名称
 * @param {Array<{role: string, content: string}>} options.messages - 消息列表
 * @param {number} [options.temperature] - 温度参数
 * @param {{type: "disabled"|"enabled"}} [options.thinking] - 思维链开关；角色回复通道关闭以换取延迟
 * @param {number} [options.maxCompletionTokens] - 输出上限；不传则用服务端默认
 * @returns {Promise<{raw: Object, content: string}>}
 */
export async function callLLM({ endpoint = API_ENDPOINTS.chat, apiKey = "", model = DEFAULT_MODEL, messages, temperature = DEFAULT_TEMPERATURE, thinking, maxCompletionTokens, responseFormat, signal }) {
  // 唯一出站边界：所有消息在离开浏览器前统一脱敏（邮箱/网址/电话/长数字）。
  const { messages: safeMessages, hits: redactionHits } = sanitizeOutboundMessages(messages);
  const payload = { model, messages: safeMessages, temperature };
  if (apiKey) payload.apiKey = apiKey;
  if (thinking?.type === "disabled" || thinking?.type === "enabled") payload.thinking = { type: thinking.type };
  if (Number.isFinite(maxCompletionTokens)) payload.max_completion_tokens = maxCompletionTokens;
  // 只放行 json_object：教练通道要求模型输出合法 JSON，实测会偶发解析失败而落到本地模板。
  if (responseFormat?.type === "json_object") payload.response_format = { type: "json_object" };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = null; }
  if (!res.ok) {
    const message = json?.message || json?.error || text;
    throw new Error(`HTTP ${res.status}: ${String(message).slice(0, 500)}`);
  }
  const rawContent = json?.choices?.[0]?.message?.content || json?.choices?.[0]?.text || json?.output_text || "";
  const content = Array.isArray(rawContent)
    ? rawContent.map((part) => typeof part === "string" ? part : (part?.text || part?.content || "")).join("")
    : String(rawContent || "");
  if (!content.trim()) throw new Error("模型返回为空，未生成女方对话。");
  return { raw: json, content, redactionHits };
}

/**
 * 检查服务健康状态
 * @returns {Promise<Object>}
 */
export async function checkHealth() {
  const res = await fetch("/api/health");
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.message || `HTTP ${res.status}`);
  return json;
}

/**
 * 联网搜索（双引擎：默认 MiMo 模型联网搜索，配置 SEARCH_ENDPOINT 后走外部搜索 API）。
 * 只发送查询词，绝不发送对话内容；服务端验证引用 URL 并按域名白名单过滤。
 * @param {string} query 查询词（最长 120 字符）
 * @returns {Promise<{results: Array<{title: string, url: string, snippet: string}>, filtered: number, sourcePolicy?: "allowlist", engine?: string, model?: string, note?: string}>}
 */
export async function searchWeb(query, { signal } = {}) {
  const res = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
  return json;
}
