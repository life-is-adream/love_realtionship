/* Node 参照实现：v2 请求不在服务端持久化。生产服务对应 heartflow-c/src/server/v2.c。 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readRequestJson, RequestBodyTooLargeError, sendJson } from "./http.js";
import { publicDir, LLM_ENDPOINT, LLM_API_KEY, LLM_MODEL, LLM_API_MODE } from "./config.js";
import { runProductRelationshipIntelligence } from "./relationshipIntelligence.js";
import { listScenarios, getScenario, startScenario, critiqueResponse, retryScenario } from "../../.agents/skills/relationship-coach-cn/runtime/index.mjs";

const MAX_MESSAGES = 80;
// L0/L1 规则词表：只做关系边界与显式意愿，不推断心理。顺序与 C 的 V2_*_TERMS 保持一致。
const EXIT = ["不要再联系", "别再联系", "不想继续", "不再联系", "不想再联系", "不愿再联系", "不要再给我发消息", "不要给我发消息", "别再给我发消息", "别给我发消息", "不要再给我打电话", "别再给我打电话", "别找我", "别再找我", "别来找我", "别再来找我", "别再来我家", "别来我家", "别来公司", "别再来公司", "别再给我发", "都别联系", "请不要联系", "不想再见", "不想跟你说话", "不想和你说话", "别再打扰", "不要打扰", "别再打扰我的家人", "不用再联系", "不希望我们再有任何联系", "不希望再", "到此为止", "停止联系", "请停止", "已经结束", "分手吧", "没有任何可能", "不会再见", "不再出现", "不要再出现在", "出现在我生活", "别再发消息", "别再打电话", "不要再打电话", "别再纠缠", "离我远一点", "从我的生活里消失", "不想再和你有任何来往", "不想继续这段关系", "不想继续，请", "我不想见你", "也不想见你"];
const DECLINE = ["先别联系", "暂时不要联系", "不想见面", "不想单独见", "不想约会", "不愿意见面", "先别约", "不想再见面", "不要再见面", "不要见面", "暂停见面", "暂时不想见", "先不约", "这周不约", "还没准备好", "需要空间", "需要一点空间", "先别见面", "最近先别", "这周不行", "这个月先不", "最近不想出来", "今晚不想聊", "今天不想聊", "现在不想谈", "不想现在见面", "不想现在确定", "先暂停联系", "暂时别联系", "先别聊", "之后再谈"];
const POSITIVE = ["我也想见", "一起去吧", "我们约个时间", "我愿意一起", "我也愿意", "我愿意继续", "愿意继续", "愿意，我也", "我也挺想", "好啊", "周末见", "周末可以", "可以呀，我们约", "可以，你来", "你来定时间", "你来安排", "找个时间", "定个时间", "约个时间", "听起来不错", "听起来很好", "我愿意试试", "愿意试试", "可以一起", "行，你来"];
const STABLE = ["保持现在", "这样挺好", "按这个节奏", "我们慢慢来", "现在这样", "维持现在", "维持现状", "照旧", "不用刻意改变", "不急着改变", "顺其自然", "不着急", "慢慢来", "慢慢处", "按现在", "现状挺好", "这样就很好", "我就满意"];
const SAFETY = ["打你", "伤害你", "跟踪你", "威胁你", "堵你", "杀你", "报警"];
const BUSY = ["忙", "累", "没空", "不方便", "改天"];
// 否定判断只看同一分句内的前 8 个字：跨标点回溯会把「我不忙，你别再联系」误判成否定拒绝。
const NEGATIONS = ["不再", "不会再", "不想再", "不愿再", "不要再", "不打算再", "不需要", "不必", "不用", "无需", "不是", "并非", "没有", "没有说", "从没", "从未", "不曾", "不代表", "并不", "不会", "不想", "不要", "别", "没", "未", "不", "停止", "拒绝"];
const NEGATION_STOPS = ["。", "，", "；", "！", "？", "、", "\n", ".", ",", ";", "!", "?", "不过", "但是", "可是", "然而"];
const ANCHORS = ["已读不回","回消息","消息","冷战","吵架","争执","拌嘴","沉默","冷暴力","见家长","父母","婆媳","亲家","催婚","催生","家务","做饭","洗碗","打扫","分担","花钱","工资","存款","彩礼","房贷","前任","异性朋友","异性","边界","手机","隐私","查手机","承诺","答应","食言","结婚","订婚","孩子","生育","异地","陪伴","时间","加班","工作忙","应酬","纪念日","生日","礼物","信任","安全感","情绪","道歉","原谅","分手","复合","搬家","同居","不回消息","已读","卑微","消失","提醒","约定","加班","主动","电影","看电影","备忘录","规则","攒着","抱歉","在开会","冷战期"];
const STOP_CHARS = new Set(Array.from("的了我你他她它是在就都也很不吗呢吧啊呀么和与跟有没有这那个们又还会能要说想觉得到上下一二三好太更最可以被把给对从向但而且或如果因为所之其中里后前时候自己什些样种次"));
const STOP_BIGRAMS = new Set(["我们","你们","他们","她们","这个","那个","什么","怎么","就是","不是","可以","因为","所以","但是","如果","已经","还是","真的","其实","觉得","知道","现在","时候","一个","一下","这样","那样","没有","不会","不能","应该","可能","东西","事情","问题","感觉","而且","然后","之后","以前","以后","开始","一直","有点","一点","一些","这些","那些","这么","那么","多少","怎样"]);

class V2Error extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const chars = (text) => Array.from(String(text || "")).length;
const cut = (text, limit) => Array.from(String(text || "")).slice(0, limit).join("");
const msgId = (index) => "msg_" + String(index + 1).padStart(3, "0");
/** 引用或过去时：第三人称转述、或带过去时间词的“说/让/叫”不算当下指令。 */
function quotedOrPast(text, index) {
  const prefix = text.slice(Math.max(0, index - 16), index);
  if (/(?:他|她|他们|她们|朋友|对方|别人)(?:说|告诉|转告|让|叫)|跟我说|告诉我/u.test(prefix)) return true;
  return /(?:昨天|上周|上个星期|之前|以前|当时|那时|上次)/u.test(prefix) && /说|让|叫/u.test(prefix);
}
function unnegated(text, terms) {
  for (const term of terms) {
    let from = 0, index;
    while ((index = text.indexOf(term, from)) >= 0) {
      const windowStart = Math.max(0, index - 8);
      let start = windowStart;
      for (const stop of NEGATION_STOPS) {
        let at = text.indexOf(stop, windowStart);
        while (at >= 0 && at < index) {
          if (at + stop.length <= index) start = Math.max(start, at + stop.length);
          at = text.indexOf(stop, at + stop.length);
        }
      }
      if (!NEGATIONS.some((word) => text.slice(start, index).includes(word)) && !quotedOrPast(text, index)) return term;
      from = index + term.length;
    }
  }
  return null;
}

/** 命中词所在完整分句的 code point 偏移；用于可审计证据。 */
function clauseSpan(text, cue) {
  const source = String(text || "");
  const hit = cue ? source.indexOf(cue) : -1;
  if (hit < 0) return null;
  let start = 0, end = source.length;
  for (const stop of NEGATION_STOPS) {
    let from = 0, at;
    while ((at = source.indexOf(stop, from)) >= 0 && at < hit) {
      if (at + stop.length <= hit) start = Math.max(start, at + stop.length);
      from = at + stop.length;
    }
    const after = source.indexOf(stop, hit + cue.length);
    if (after >= 0 && after < end) end = after;
  }
  while (start < end && /\s/u.test(source[start])) start++;
  while (end > start && /\s/u.test(source[end - 1])) end--;
  const quote = Array.from(source.slice(start, end)).slice(0, 60).join("");
  const startPoint = Array.from(source.slice(0, start)).length;
  return { start: startPoint, end: startPoint + Array.from(quote).length, text: quote, unit: "unicode_code_point" };
}

/** 引用证据取命中词所在的完整分句，避免只引用「我」「听」这类无解释力的片段。 */
function clauseOf(text, cue) {
  const source = String(text || "");
  const hit = cue ? source.indexOf(cue) : -1;
  if (hit < 0) return cut(source, 60);
  let start = 0, end = source.length;
  for (const stop of NEGATION_STOPS) {
    let from = 0, at;
    while ((at = source.indexOf(stop, from)) >= 0 && at < hit) {
      if (at + stop.length <= hit) start = Math.max(start, at + stop.length);
      from = at + stop.length;
    }
    const after = source.indexOf(stop, hit + cue.length);
    if (after >= 0 && after < end) end = after;
  }
  return cut(source.slice(start, end).trim(), 60);
}

function validMessages(messages) {
  return Array.isArray(messages) && messages.length >= 1 && messages.length <= MAX_MESSAGES &&
    messages.every((m) => m && ["user", "other", "unknown"].includes(m.speaker) && typeof m.text === "string" && m.text.length && chars(m.text) <= 2000);
}

function validZonedTimestamp(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/iu.exec(value);
  if (!m) return false;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const zone = m[7];
  const zoneDigits = zone.toUpperCase() === "Z" ? "0000" : zone.slice(1).replace(":", "");
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && Number(m[4]) <= 23 && Number(m[5]) <= 59 && Number(m[6] || 0) <= 59 && Number(zoneDigits.slice(0, 2)) <= 23 && Number(zoneDigits.slice(2)) <= 59;
}

export function importChat(text, mode = "chat") {
  if (!["chat", "event"].includes(mode)) throw new V2Error("invalid_text", "请输入不超过 120KB 的聊天文本。");
  if (typeof text !== "string" || !text || Buffer.byteLength(text) > 119488) throw new V2Error("invalid_text", "请输入不超过 120KB 的聊天文本。");
  const prefixes = [["我方：","user"],["男方：","user"],["自己：","user"],["我：","user"],["我:","user"],["我方:","user"],["对方：","other"],["对方:","other"],["她：","other"],["她:","other"],["他：","other"],["他:","other"],["女方：","other"],["女生：","other"]];
  const messages = [];
  for (const raw of (mode === "event" ? [text] : text.split("\n"))) {
    let line = raw.trim(); if (!line) continue;
    let timestamp_text = "";
    const bracket = line.match(/^\[([^\]]{16,47})\]\s*/u);
    const plain = line.match(/^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}\S*)\s*/u);
    const match = mode === "event" ? null : bracket || plain;
    if (match && /^\d{4}-\d{2}-\d{2}/u.test(match[1])) { timestamp_text = match[1].replace(" ", "T"); line = line.slice(match[0].length).trim(); }
    let speaker = mode === "event" ? "user" : "unknown";
    if (mode !== "event") for (const [prefix, role] of prefixes) if (line.startsWith(prefix)) { speaker = role; line = line.slice(prefix.length).trim(); break; }
    if (!line) continue;
    if (messages.length >= MAX_MESSAGES) throw new V2Error("too_many_messages", "最多导入 80 条消息，请先缩小范围。");
    if (chars(line) > 2000) throw new V2Error("message_too_long", "单条消息超过 2000 字，请先拆分。");
    const zoned = validZonedTimestamp(timestamp_text);
    messages.push({ id: msgId(messages.length), speaker, text: line, timestamp_text, timestamp: zoned ? timestamp_text : null });
  }
  if (!messages.length) throw new V2Error("messages_required", "没有找到非空消息。");
  const unknown = messages.filter((m) => m.speaker === "unknown").length;
  const both = messages.some((m) => m.speaker === "user") && messages.some((m) => m.speaker === "other");
  const timestamps = messages.filter((m) => m.timestamp_text).length;
  const unzoned = messages.filter((m) => m.timestamp_text && !m.timestamp).length;
  const warnings = [];
  if (unknown) warnings.push("存在未识别的说话人，请在分析前人工确认。");
  if (mode === "event") warnings.push("这是用户的事件叙述，对方的观点与背景仍未知。");
  else if (!both) warnings.push("尚未识别到双方消息，样本不足以判断互动关系。");
  warnings.push("消息按输入顺序排列；时间和前后背景需要人工核对。");
  if (unzoned) warnings.push("部分时间没有时区或格式无效，不用于计算时间间隔。");
  return { schema_version: "2.0", source_type: mode === "event" ? "event" : "chat_text", messages, quality: { messageCount: messages.length, unknownSpeakers: unknown, bothSpeakersPresent: both, timestampCoverage: !timestamps ? "none" : timestamps === messages.length && !unzoned ? "complete" : "partial_or_unverified" }, warnings };
}

export function analyzeV2(messages, sourceType = "chat_text") {
  if (!validMessages(messages)) throw new V2Error("invalid_messages", "请检查消息数量、说话人和内容。");
  const engine = runProductRelationshipIntelligence({ messages, consent: false, signals: {} });
  const supports = [], observations = [], textById = new Map();
  let exitId = "", pauseId = "", positiveId = "", stableId = "";
  let exitCue = "", pauseCue = "", positiveCue = "", stableCue = "", safetyCue = "";
  let user = 0, other = 0;
  messages.forEach((message, index) => {
    const id = msgId(index);
    textById.set(id, message.text);
    if (message.speaker === "user") user++;
    if (message.speaker === "other") {
      other++;
      const exit = unnegated(message.text, EXIT), pause = unnegated(message.text, DECLINE);
      const positive = unnegated(message.text, POSITIVE), stable = unnegated(message.text, STABLE);
      if (exit) { exitId = id; exitCue = exit; }
      if (pause) { pauseId = id; pauseCue = pause; }
      if (positive) { positiveId = id; positiveCue = positive; }
      if (stable) { stableId = id; stableCue = stable; }
      if (unnegated(message.text, BUSY)) supports.push(id);
    }
    const safety = unnegated(message.text, SAFETY);
    if (safety) { exitId = id; exitCue = safety; safetyCue = safety; }
    if (index >= messages.length - 12) observations.push({ id, type: "user_supplied_text", speaker: message.speaker, claim: cut(message.text, 220), source_message_ids: [id] });
  });
  const missing_context = ["聊天片段可能缺少前后背景和现实互动。"];
  if (!user || !other) missing_context.push("未确认双方的消息。");
  missing_context.push("消息原文由用户提供，系统不能独立核实其完整性。");
  const category = exitId ? "EXIT" : pauseId ? "DE_ESCALATE" : user && other && positiveId ? "ADVANCE" : user && other && stableId ? "MAINTAIN" : "OBSERVE";
  const decisionInfo = {
    EXIT: ["输入中出现明确停止或可能的安全风险表达。", "尊重对方选择，停止本次联系或推进；涉及安全时优先保护自己。", exitId],
    DE_ESCALATE: ["对方对某项联系或邀约表达了拒绝或暂停。", "接受本次拒绝或暂停，不追加说服或邀约。", pauseId],
    ADVANCE: ["对方明确表达愿意继续某项互动。", "仅就已表达的事项确认一个具体、可拒绝的安排。", positiveId],
    MAINTAIN: ["对方表达了对当前节奏的意见。", "保持双方明确同意的节奏，并继续观察。", stableId],
    OBSERVE: ["仅凭当前片段不足以确定对方意愿。", "先尊重当前安排，留出空间并观察后续事实。", ""]
  }[category];
  const cue = category === "EXIT" ? exitCue : category === "DE_ESCALATE" ? pauseCue : category === "ADVANCE" ? positiveCue : category === "MAINTAIN" ? stableCue : "";
  const span = decisionInfo[2] && cue ? clauseSpan(textById.get(decisionInfo[2]) || "", cue) : null;
  const abstain = category === "OBSERVE";
  const threatDetected = Boolean(safetyCue);
  return {
    schema_version: "2.0",
    source: { type: ["event", "screenshot"].includes(sourceType) ? sourceType : "chat_text", quality: messages.length >= 20 && user && other ? "medium" : "limited", missing_context },
    observations,
    hypotheses: [{ id: "hyp_01", claim: supports.length ? "对方可能暂时受到时间或精力限制。" : "目前无法确定对方的意愿或原因。", support_ids: supports, counterevidence: ["也可能存在其他原因；现有片段不足以排除。"], unknowns: ["后续是否有主动沟通或具体安排。"], status: "unresolved" }],
    unknowns: ["片段之外是否存在其他背景。", "对方后续是否会主动沟通或给出具体安排。"],
    decision: {
      category,
      rationale: decisionInfo[0],
      next_action: decisionInfo[1],
      stop_condition: "对方明确拒绝、要求停止或出现不安全情况时停止推进。",
      source_message_ids: decisionInfo[2] ? [decisionInfo[2]] : [],
      decision_source: "rule",
      evidence: span ? [{ message_id: decisionInfo[2], ...span }] : [],
      evidence_status: abstain ? "insufficient" : "sufficient",
      abstain,
      safety: { hard_boundary_detected: category === "EXIT", pressure_reply_blocked: category === "EXIT" || category === "DE_ESCALATE", threat_detected: threatDetected },
      audit: { rule_version: "sem-v2.1.0", model_used: false }
    },
    memory: { authorized: false, persisted: false }, engine
  };
}

export function repliesV2(messages) {
  if (!validMessages(messages)) throw new V2Error("invalid_messages", "请先确认聊天消息。");
  let last = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].speaker === "user") throw new V2Error("awaiting_response", "最后一条是你的消息，先等待对方回应。");
    if (messages[i].speaker === "other") { last = messages[i].text; break; }
  }
  if (!last) throw new V2Error("other_message_required", "请先标记一条对方消息。");
  let texts, reasons;
  const otherMessages = messages.filter((message) => message.speaker === "other");
  if (otherMessages.some((message) => unnegated(message.text, EXIT))) {
    texts = ["好，我明白了。", "谢谢你说清楚，我尊重你的决定。", "收到，我会停止联系。祝你一切顺利。"];
    reasons = Array(3).fill("接受明确拒绝，不追加邀约或说服。");
  } else if (otherMessages.some((message) => unnegated(message.text, DECLINE))) {
    texts = ["好，明白了。", "谢谢你直接告诉我，我尊重你的选择。", "收到，我不会继续提出这次邀约。"];
    reasons = Array(3).fill("接受这次拒绝，不继续说服或追加邀约。");
  } else if (unnegated(last, BUSY)) {
    texts = ["好，你先忙，等方便的时候再说。", "听起来最近安排挺满的，先照顾好自己，不急着回复。", "明白，我先不继续约。以后如果你愿意，可以再告诉我。"];
    reasons = ["简短回应并留出时间。", "回应忙碌或疲惫，不要求立即回复。", "明确停止追加邀约，并保留对方选择。"];
  } else if (/[?？]/u.test(last)) {
    texts = ["我想先想一想，再认真回答你。", "谢谢你问我，我想整理一下自己的想法，再答复你。", "这个问题对我很重要，我需要一点时间想清楚再回答。"];
    reasons = ["先争取思考时间，避免编造事实。", "回应提问并说明需要整理想法。", "清楚表达需要时间，请按实际情况修改。"];
  } else {
    texts = ["嗯，明白了。你愿意的话可以继续说。", "谢谢你愿意告诉我，我会认真听。", "我想听听你的想法；如果现在不想聊，也没关系。"];
    reasons = ["自然承接，同时允许对方选择。", "以温和方式回应分享。", "说清意愿，同时允许对方暂停。"];
  }
  return { schema_version: "2.0", source: "local_templates", note: "本地规则建议，请按真实情况修改；不能据此推断对方心理。", suggestions: ["自然", "温和", "清晰边界"].map((tone, index) => ({ tone, text: texts[index], reason: reasons[index] })) };
}

function keywords(text) {
  const flat = text.replace(/[ \t\r\n,.!?:;]/g, ""), found = new Map();
  const add = (word, boost = 0) => {
    if (found.has(word)) found.get(word).score += 1;
    else if (found.size < 160) found.set(word, { word, score: 1 + boost, order: found.size });
  };
  let anchorCount = 0;
  for (const anchor of ANCHORS) if (flat.includes(anchor)) { add(anchor, 40); anchorCount++; }
  if (!anchorCount) {
    const codepoints = Array.from(text).slice(0, 2048);
    for (let i = 0; i + 1 < codepoints.length; i++) {
      const a = codepoints[i], b = codepoints[i + 1], word = a + b;
      if (!/^[\u3400-\u9fff]$/u.test(a) || !/^[\u3400-\u9fff]$/u.test(b) || STOP_CHARS.has(a) || STOP_CHARS.has(b) || STOP_BIGRAMS.has(word)) continue;
      add(word);
    }
  }
  return [...found.values()].sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 10).map((item) => item.word);
}

function countTerm(text, term) {
  let count = 0, from = 0, at;
  if (!term) return 0;
  while ((at = text.indexOf(term, from)) >= 0) { count += 1; from = at + 1; }
  return count;
}

// 课程正文 BM25：查询词由本地关键词规则给出，正文参与词频与长度归一化。
// 课程检索的通用领域同义扩展：只做稳定的词对，不做逐条查询的特判。
// 顺序与 heartflow-c/src/text.c 的 RETRIEVAL_SYNONYMS 一致。
const RETRIEVAL_SYNONYMS = [
  ["回消息", ["回复", "消息"]],
  ["消息", ["回复"]],
  ["回复速度", ["回复"]],
  ["修复", ["和好", "重建"]],
  ["吵架", ["争执", "分歧"]],
  ["冲突", ["争执", "分歧"]],
  ["花钱", ["财务", "开销"]],
  ["工资", ["收入"]],
  ["存款", ["财务"]],
  ["债务", ["财务", "收入"]],
  ["见面", ["邀约", "约会"]],
  ["拒绝", ["不接受"]],
  ["出轨", ["不忠", "背叛"]],
  ["暴力", ["安全", "控制"]],
  ["操控", ["控制"]],
  ["家务", ["分担", "打扫"]],
  ["照护", ["照顾"]],
  ["分手", ["结束"]],
  ["结婚", ["婚姻"]],
  ["婚前", ["婚姻"]],
  ["异地", ["距离"]],
  ["冷暴力", ["沉默"]],
  ["承诺", ["投入"]],
  ["择偶", ["标准"]],
  ["新鲜感", ["成长"]],
  ["同意", ["边界"]]
];

// 课程检索专用：锚点与二元组同时保留，让正文里的普通词也能参与 BM25。
// 顺序和上限与 heartflow-c/src/text.c 的 hf_retrieval_terms 一致。
function retrievalKeywords(text) {
  const found = [];
  const add = (word) => { if (word && found.length < 24 && !found.includes(word)) found.push(word); };
  const flat = text.replace(/[ \t\r\n,.!?:;]/g, "");
  for (const anchor of ANCHORS) if (flat.includes(anchor)) add(anchor);
  // 「会」是通用停用字，但「约会」是领域词，二元组会被停用字规则误删。
  if (flat.includes("约会")) add("约会");
  for (const [key, values] of RETRIEVAL_SYNONYMS) if (found.includes(key)) for (const value of values) add(value);
  const codepoints = Array.from(text).slice(0, 2048);
  for (let i = 0; i + 1 < codepoints.length; i++) {
    const a = codepoints[i], b = codepoints[i + 1], word = a + b;
    if (!/^[\u3400-\u9fff]$/u.test(a) || !/^[\u3400-\u9fff]$/u.test(b) || STOP_CHARS.has(a) || STOP_CHARS.has(b) || STOP_BIGRAMS.has(word)) continue;
    add(word);
  }
  if (/忙|没空/u.test(text)) { add("时间"); add("边界"); }
  if (/约|见面/u.test(text)) { add("时间"); add("主动"); }
  if (/吵|冲突/u.test(text)) { add("情绪"); add("边界"); }
  return found;
}

// S3 语义概念扩展：只覆盖稳定的领域概念，供 semantic/hybrid 模式使用；bm25 模式保持原词表。
const SEMANTIC_CONCEPTS = [
  ["压力", ["情绪", "支持", "倾听"]], ["安慰", ["倾听", "支持", "情绪"]], ["婆媳", ["父母", "家庭", "边界"]],
  ["父母", ["家庭", "边界", "代际"]], ["彩礼", ["婚姻", "财务", "协商"]], ["婚前", ["婚姻", "准备", "财务"]],
  ["财务", ["金钱", "预算", "协商"]], ["钱", ["财务", "预算", "协商"]], ["酗酒", ["成瘾", "依赖", "支持"]],
  ["成瘾", ["依赖", "支持", "边界"]], ["冷战", ["沉默", "沟通", "冲突"]], ["冷暴力", ["沉默", "沟通", "边界"]],
  ["暧昧", ["信任", "边界", "沟通"]], ["忽冷忽热", ["不确定", "信号", "观察"]], ["社交媒体", ["比较", "自我", "焦虑"]],
  ["比较", ["自我", "价值", "焦虑"]], ["控制型", ["控制", "边界", "安全"]], ["操控", ["控制", "边界", "安全"]],
  ["照护", ["照顾", "家庭", "分工"]], ["照顾", ["照护", "家庭", "分工"]], ["离婚", ["结束", "决定", "财务"]],
  ["中年", ["变化", "成长", "关系"]], ["离世", ["哀伤", "丧失", "支持"]], ["去世", ["哀伤", "丧失", "支持"]],
  ["破冰", ["主动", "认识", "聊天"]], ["开场", ["主动", "认识", "聊天"]], ["介绍自己", ["自我", "表达", "认识"]],
  ["朋友", ["友谊", "边界", "表白"]], ["异地", ["距离", "信任", "沟通"]], ["新婚", ["婚姻", "磨合", "分工"]],
  ["怀孕", ["生育", "育儿", "支持"]], ["产后", ["生育", "育儿", "支持"]], ["育儿", ["孩子", "教育", "分工"]],
  ["家务", ["分工", "公平", "协商"]], ["背叛", ["信任", "修复", "边界"]], ["出轨", ["信任", "修复", "边界"]],
  ["承诺", ["行动", "信任", "一致"]], ["择偶", ["标准", "价值", "需求"]], ["新鲜", ["亲密", "成长", "激情"]],
  ["激情", ["亲密", "成长", "新鲜"]], ["表白", ["拒绝", "表达", "尊重"]], ["被拒", ["拒绝", "尊重", "收场"]],
  ["已读不回", ["回复", "焦虑", "边界"]], ["隐私", ["信任", "边界", "透明"]], ["手机", ["隐私", "信任", "边界"]],
  ["同居", ["规则", "财务", "边界"]], ["生病", ["照护", "疾病", "支持"]], ["病人", ["照护", "疾病", "支持"]],
  ["生育", ["孩子", "价值观", "协商"]], ["干预", ["父母", "边界", "家庭"]], ["亲密接触", ["同意", "边界", "沟通"]],
  ["性", ["同意", "边界", "沟通"]], ["情绪失控", ["情绪", "调节", "冲突"]], ["稳定", ["安全型", "依恋", "成长"]],
  ["伤人", ["沟通", "表达", "冲突"]], ["第一次", ["约会", "见面", "安全"]], ["约会", ["见面", "邀约", "安全"]]
];

function conceptTerms(query) {
  const extra = [];
  for (const [key, values] of SEMANTIC_CONCEPTS) {
    if (!String(query).includes(key)) continue;
    for (const value of values) if (!extra.includes(value)) extra.push(value);
  }
  return extra.slice(0, 24);
}

function bm25Scores(docs, terms, k1 = 1.2, b = 0.75) {
  const avgdl = docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length;
  const df = terms.map((term) => docs.filter((doc) => doc.text.includes(term)).length);
  const idf = df.map((freq) => freq ? Math.log(1 + (docs.length - freq + 0.5) / (freq + 0.5)) : 0);
  const scored = new Map();
  for (const doc of docs) {
    let score = 0; const matched = [];
    terms.forEach((term, index) => {
      if (!df[index]) return;
      const tf = countTerm(doc.text, term);
      if (!tf) return;
      score += idf[index] * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc.length / avgdl));
      if (matched.length < 6) matched.push(term);
    });
    scored.set(doc.id ?? doc.course_no, { score, matched });
  }
  return scored;
}

function rankScores(scores) {
  return [...scores.entries()].filter(([, value]) => value.score > 0).sort((a, b) => b[1].score - a[1].score || a[0] - b[0]).map(([no]) => no);
}

function bestPassage(body, terms) {
  const lines = String(body || "").split(/\r?\n/);
  const sections = [];
  let start = 0, heading = "正文";
  for (let i = 0; i <= lines.length; i++) {
    if (i === lines.length || /^#{1,6}\s+/.test(lines[i])) {
      if (i > start) sections.push({ heading, start: start + 1, end: i, text: lines.slice(start, i).join("\n") });
      if (i < lines.length) { heading = lines[i].replace(/^#{1,6}\s+/, "").trim() || "正文"; start = i; }
    }
  }
  let best = sections[0] || { heading: "正文", start: 1, end: lines.length, text: String(body || "") };
  let bestScore = -1;
  for (const section of sections) {
    let score = 0;
    for (const term of terms) score += countTerm(section.text, term) * Math.min(3, term.length);
    if (score > bestScore) { best = section; bestScore = score; }
  }
  const quote = cut(best.text.replace(/^#{1,6}\s+.*$/gm, "").replace(/\s+/g, " ").trim(), 120);
  return { section: best.heading, line_start: best.start, line_end: best.end, quote };
}

function courseChunks(doc) {
  const lines = String(doc.body || "").split(/\r?\n/);
  const chunks = [];
  let heading = "正文", buffer = [];
  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) {
      for (let i = 0; i < text.length; i += 320) {
        const piece = Array.from(text.slice(i, i + 420)).join("");
        if (Array.from(piece).length >= 20) chunks.push({ id: doc.course_no + "#" + chunks.length, course_no: doc.course_no, heading, text: doc.title + " " + doc.goal + " " + piece, length: chars(doc.title) + chars(doc.goal) + chars(piece) });
      }
    }
    buffer = [];
  };
  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) { flush(); heading = line.replace(/^#{1,6}\s+/, "").trim() || "正文"; }
    else buffer.push(line);
  }
  flush();
  return chunks;
}

function chunkScores(docs, terms) {
  const chunks = docs.flatMap(courseChunks);
  const scored = bm25Scores(chunks, terms);
  const byCourse = new Map();
  for (const chunk of chunks) {
    const score = scored.get(chunk.id)?.score || 0;
    if (!byCourse.has(chunk.course_no)) byCourse.set(chunk.course_no, []);
    byCourse.get(chunk.course_no).push(score);
  }
  const result = new Map();
  for (const [no, values] of byCourse) {
    const sorted = values.sort((a, b) => b - a);
    result.set(no, { score: (sorted[0] || 0) + 0.25 * sorted.slice(0, 3).reduce((s, v) => s + v, 0), matched: [] });
  }
  return result;
}

export async function recommendCourses(query, requestLimit = 3, options = {}) {
  if (typeof query !== "string" || !query || chars(query) > 4000) throw new V2Error("invalid_query", "请输入不超过 4000 字的检索内容。");
  const limit = Number(requestLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new V2Error("invalid_limit", "limit 需在 1 到 10 之间。");
  const requested = ["bm25", "semantic", "hybrid", "hybrid_rerank"].includes(options.mode) ? options.mode : "bm25";
  const effective = requested === "hybrid_rerank" ? "hybrid" : requested;
  const fallback_reason = requested === "hybrid_rerank" ? "reranker_not_configured" : null;
  let manifest;
  try { manifest = JSON.parse(await readFile(path.join(publicDir, "love-learning", "manifest.json"), "utf8")); }
  catch { throw new V2Error("course_index_missing", "课程索引不存在，请先构建课程索引。", 503); }
  if (!Array.isArray(manifest.courses)) throw new V2Error("course_index_invalid", "课程索引格式无效。", 503);
  const terms = retrievalKeywords(query);
  const extraTerms = conceptTerms(query);
  const docs = [];
  for (const item of manifest.courses.slice(0, 179)) {
    const no = Number(item.no), expected = "love-learning/courses/" + String(no).padStart(3, "0") + ".md";
    if (!Number.isInteger(no) || no < 1 || no > 179 || typeof item.title !== "string" || !item.title || item.file !== expected) continue;
    let body;
    try { body = await readFile(path.join(publicDir, expected), "utf8"); } catch { continue; }
    const text = item.title + " " + String(item.goal || "") + " " + body;
    docs.push({ course_no: no, title: item.title, goal: String(item.goal || ""), text, length: chars(text), body, file: expected });
  }
  if (!docs.length) throw new V2Error("course_index_invalid", "课程正文无法读取。", 503);
  const baseScores = bm25Scores(docs, terms);
  const conceptScores = bm25Scores(docs, extraTerms);
  const weightedDocs = docs.map((doc) => ({ ...doc, text: doc.title + " " + doc.title + " " + doc.title + " " + doc.goal + " " + doc.goal + " " + doc.body, length: chars(doc.title) * 3 + chars(doc.goal) * 2 + chars(doc.body) }));
  const fieldScores = bm25Scores(weightedDocs, terms);
  const passageScores = chunkScores(docs, [...terms, ...extraTerms]);
  const baseRank = rankScores(baseScores);
  const semanticScores = new Map();
  for (const doc of docs) {
    const field = fieldScores.get(doc.course_no).score;
    const concept = extraTerms.length ? conceptScores.get(doc.course_no).score : 0;
    const passage = passageScores.get(doc.course_no)?.score || 0;
    semanticScores.set(doc.course_no, { score: field + concept * 2 + passage * 0.8, matched: [...fieldScores.get(doc.course_no).matched, ...(conceptScores.get(doc.course_no).matched || [])].slice(0, 6) });
  }
  const semanticRank = rankScores(semanticScores);
  const conceptRank = rankScores(conceptScores);
  const fieldRank = rankScores(fieldScores);
  const passageRank = rankScores(passageScores);
  let order;
  if (effective === "bm25") order = baseRank;
  else if (effective === "semantic") order = semanticRank;
  else {
    const rrf = new Map();
    const add = (list, weight) => list.forEach((no, index) => rrf.set(no, (rrf.get(no) || 0) + weight / (30 + index + 1)));
    add(baseRank, 0.6);
    add(semanticRank, 1.2);
    order = [...rrf.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([no]) => no);
  }
  const selected = order.slice(0, limit).map((no) => {
    const doc = docs.find((item) => item.course_no === no);
    const citationTerms = [...terms, ...extraTerms];
    const passage = bestPassage(doc.body, citationTerms);
    return { course_no: doc.course_no, title: doc.title, goal: doc.goal, matched_terms: (semanticScores.get(no)?.matched || []).join(","), citation: { path: doc.file, ...passage } };
  });
  const notes = {
    bm25: "按课程标题、目标与正文的本地 BM25 相关度排序。",
    semantic: "本地概念扩展 BM25：加入稳定领域概念词，属于语义近似而非神经网络 embedding。",
    hybrid: "本地 BM25 与概念扩展排序的 RRF 融合。",
    hybrid_rerank: "未配置重排器，已回退到 hybrid。"
  };
  return { schema_version: "2.0", source: "local_course_" + effective, mode_requested: requested, mode_effective: effective, fallback_reason, index_version: "course-index-2.1.0", note: notes[requested] + "引用仍需人工判断。", courses: selected };
}

function evaluation(scenario, responses) {
  const text = responses.map((item) => item.text).join(" ");
  const after = responses.filter((item) => item.after_refusal || scenario === "breakup-recovery").map((item) => item.text).join(" ");
  const empathy = ["听起来","我理解","辛苦","谢谢你说","你提到","你很累","你很忙"].find((x) => text.includes(x));
  const generic = unnegated(text, ["收到","明白","好的","嗯"]);
  const dismissive = unnegated(text, ["闭嘴","矫情","别烦我"]);
  const self = ["我想","我希望","我需要","我觉得","我愿意","我会","我不想","我不愿意","我不能"].find((x) => text.includes(x));
  const request = ["商量","可以吗","方便吗","希望","需要"].find((x) => text.includes(x));
  const choice = unnegated(text, ["如果你愿意","你愿意","方便","不急","没关系","尊重","可以拒绝","不勉强","不再联系"]);
  const strong = unnegated(text, ["尊重","不勉强","不再联系","接受你的决定"]);
  const mild = unnegated(text, ["为什么不回","你怎么还不"]);
  const bad = unnegated(text, ["必须","立刻","不回就是","证明给我","凭什么不","威胁","跟踪"]);
  const continued = unnegated(after, ["联系你","约你","见你","复合","挽回","再见面","给我机会"]);
  const conflict = ["商量","协商","一起想","我的感受","具体","下次"].find((x) => text.includes(x));
  const blame = unnegated(text, ["你总是","你从来","都是你的错"]);
  const detail = ["纪录片","活动","忙","累","休息","展","周末","时间","联系","追问","消息","结束"].find((x) => text.includes(x));
  const scores = [
    dismissive ? 0 : empathy && detail ? 4 : empathy ? 3 : generic ? 2 : null,
    self && request ? 4 : self ? 3 : generic ? 2 : null,
    bad || continued ? 0 : mild ? 1 : strong ? 4 : choice ? 3 : null,
    null,
    scenario !== "conflict-repair" ? null : bad ? 0 : blame ? 1 : conflict && self ? 4 : conflict || self ? 3 : generic ? 2 : null
  ];
  const reasons = [
    scores[0] === null ? "当前规则没有找到足够的回应证据。" : "依据可见的承接、具体内容或否定性措辞提示。",
    scores[1] === null ? "当前规则没有找到足够的自我表达证据。" : "依据自我表达和具体请求的可见措辞提示。",
    continued ? "模拟对方明确拒绝后，检测到继续追求的表达。" : bad || mild ? "检测到可能施压的措辞。" : choice || strong ? "检测到选择空间或尊重边界的表达。" : "没有足够证据评价边界尊重。",
    "仅凭长度或问句数量无法可靠判断自然度，需要人工评价。",
    scenario !== "conflict-repair" ? "本情境未提供可观察的冲突，不评分。" : scores[4] === null ? "当前规则没有找到足够的分歧处理证据。" : "依据自我表达、协商或指责措辞提示。"
  ];
  const ids = ["listening","clarity","boundary","naturalness","conflict"], labels = ["倾听和回应","表达清晰度","边界尊重","交流自然度","冲突与分歧处理"];
  const cues = [dismissive || empathy || generic, self || generic, continued || bad || mild || strong || choice, null, bad || blame || conflict || self || generic];
  const dimensions = ids.map((id, index) => {
    const applicable = index !== 4 || scenario === "conflict-repair";
    if (scores[index] === null) return { id, label: labels[index], applicable, status: applicable ? "insufficient_evidence" : "not_applicable", score: null, reason: reasons[index], evidence: [] };
    const cue = cues[index];
    let selected = 0, source = text;
    for (const [i, item] of responses.entries()) {
      if (index === 2 && continued && !item.after_refusal) continue;
      if (item.text && (!cue || item.text.includes(cue))) { selected = i; source = item.text; if (cue) break; }
    }
    const quote = clauseOf(source, cue);
    if (chars(quote) < 4) return { id, label: labels[index], applicable: true, status: "insufficient_evidence", score: null, reason: "可见证据不足一个完整分句，暂不评分。", evidence: [] };
    let anchor = selected;
    for (const [i, item] of responses.entries()) {
      if (index === 2 && continued && !item.after_refusal) continue;
      if (item.text && item.text.includes(quote)) { anchor = i; break; }
    }
    return { id, label: labels[index], applicable: true, status: "scored", score: scores[index], reason: reasons[index], evidence: [{ message_id: "practice_user_" + (anchor + 1), quote }] };
  });
  const scored = dimensions.filter((item) => Number.isInteger(item.score)).map((item) => item.score);
  return { rubric_version: "2.1.0", score: scored.length ? scored.reduce((sum, score) => sum + score, 0) : null, maximum: scored.length * 4, dimensions, note: "分数来自可见文字的启发式规则，尚未与人工评分校准，也不代表现实关系结果。" };
}

const PLANS = {
  listening: ["倾听和回应", "选择一节沟通课程，记下一个回应具体内容的方法。", "用一个虚构场景练习先回应对方说过的内容。", "回顾一次实际交流：自己是否有机会倾听，结果可以保持未知。"],
  clarity: ["表达清晰度", "学习区分事实、感受和请求。", "用一到两句表达自己的感受与可执行请求。", "记录一次表达是否清楚，以及自己想调整的一点。"],
  boundary: ["边界尊重", "学习同意、拒绝和暂停的区别。", "分别练习接受模糊回应与明确拒绝。", "观察双方的选择空间；不把礼貌回应当成同意。"],
  naturalness: ["交流自然度", "选择一个自己感兴趣的沟通知识点。", "把一段想说的话缩成一个真实重点并朗读。", "回顾表达是否像自己，允许没有合适机会。"],
  conflict: ["冲突与分歧处理", "学习用具体事件描述分歧。", "练习说出感受、需要和可协商的小请求。", "记录实际发生的分歧与双方回应，避免猜测动机。"]
};

function weeklyPlan(body) {
  let focus = Object.hasOwn(PLANS, body.focus) ? body.focus : "", source = "user_selected";
  if (!focus && body.scores && typeof body.scores === "object") {
    let lowest = 5;
    for (const id of Object.keys(PLANS)) if (typeof body.scores[id] === "number" && body.scores[id] >= 0 && body.scores[id] <= 4 && body.scores[id] < lowest) { lowest = body.scores[id]; focus = id; source = "last_practice"; }
  }
  if (!focus) return { schema_version: "2.0", needs_assessment: true, reason: "先选择一个想练的方面，或完成一次模拟练习。", tasks: [] };
  const p = PLANS[focus];
  return { schema_version: "2.0", needs_assessment: false, focus, focus_label: p[0], source, reason: source === "last_practice" ? "依据最近一次规则反馈中较低的适用维度，可自行改选。" : "依据你自己选择的练习重点。", tasks: ["learn","practice","reflect"].map((id, index) => ({ id, day: 1 + index * 2, minutes: 5, title: ["学一个知识点","做一次模拟","回看一次实际机会"][index], description: p[index + 1] })) };
}

async function screenshot(body) {
  const side = body.self_side || "unknown";
  if (body.remote_consent !== true) throw new V2Error("consent_required", "识别截图前请确认图片会发送给配置的模型服务。");
  if (!["left","right","unknown"].includes(side)) throw new V2Error("invalid_side", "请选择自己消息所在的一侧。");
  if (typeof body.image_data_url !== "string" || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]{16,1600000}$/u.test(body.image_data_url)) throw new V2Error("invalid_image", "请选择不超过限制的 JPEG、PNG 或 WebP 图片。");
  if (body.image_data_url.slice(body.image_data_url.indexOf(",") + 1).length % 4 !== 0) throw new V2Error("invalid_image", "请选择不超过限制的 JPEG、PNG 或 WebP 图片。");
  if (!LLM_API_KEY) throw new V2Error("missing_api_key", "请先在本机配置可处理图片的模型服务。");
  const instruction = "把聊天截图按从上到下顺序转成 JSON：{\"messages\":[{\"speaker\":\"user|other|unknown\",\"text\":\"原文\",\"timestamp_text\":\"可见原文或空\"}],\"uncertain\":[\"不确定之处\"]}。只转写实际可见文字，不猜测缺失文字、人物心理或时间。用户所在气泡一侧由输入说明；无法确认则用 unknown。只输出 JSON。 用户消息位于：" + side + "。";
  const responses = LLM_API_MODE === "responses";
  const content = responses ? [{ type: "input_text", text: instruction }, { type: "input_image", image_url: body.image_data_url }] : [{ type: "text", text: instruction }, { type: "image_url", image_url: { url: body.image_data_url } }];
  const payload = { model: process.env.VISION_MODEL || LLM_MODEL, stream: false, [responses ? "max_output_tokens" : "max_completion_tokens"]: 2048, [responses ? "input" : "messages"]: [{ role: "user", content }] };
  if (responses) payload.store = false;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 120000);
  let upstream;
  try {
    const response = await fetch(LLM_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + LLM_API_KEY }, body: JSON.stringify(payload), signal: controller.signal });
    if (!response.ok) throw new V2Error("vision_upstream_error", "图片识别服务拒绝请求，请检查模型是否支持图片。", 502);
    upstream = await response.json();
  } catch (error) {
    if (error instanceof V2Error) throw error;
    throw new V2Error("vision_unavailable", "无法连接图片识别服务；可改用文字粘贴。", 502);
  } finally { clearTimeout(timer); }
  const output = upstream.output_text || upstream.choices?.[0]?.message?.content || upstream.output?.flatMap((item) => item.content || []).find((item) => item.text)?.text || "";
  const text = Array.isArray(output) ? output.find((item) => item.text)?.text || "" : String(output);
  const first = text.indexOf("{"), last = text.lastIndexOf("}");
  let parsed;
  try { parsed = JSON.parse(text.slice(first, last + 1)); } catch { throw new V2Error("vision_invalid_result", "图片识别结果格式无效，请重试或手动输入。", 502); }
  if (!Array.isArray(parsed.messages) || parsed.messages.length < 1 || parsed.messages.length > MAX_MESSAGES) throw new V2Error("vision_invalid_result", "图片识别结果格式无效，请重试或手动输入。", 502);
  const messages = parsed.messages.filter((item) => typeof item?.text === "string" && item.text && chars(item.text) <= 2000).map((item, index) => ({ id: msgId(index), speaker: ["user","other"].includes(item.speaker) ? item.speaker : "unknown", text: cut(item.text, 2000), timestamp_text: cut(item.timestamp_text, 40), timestamp: null }));
  if (!messages.length) throw new V2Error("vision_empty_result", "未识别到可用消息，请手动输入。", 502);
  return { schema_version: "2.0", source: "remote_vision", messages, warnings: ["图片识别可能遗漏、错字或混淆说话人，请逐条核对。", ...(Array.isArray(parsed.uncertain) ? parsed.uncertain.filter((item) => typeof item === "string" && item).slice(0, 10).map((item) => cut(item, 100)) : [])] };
}

function voiceFeedback(body) {
  const duration = body.duration_ms, pauses = body.pause_ms;
  if (typeof duration !== "number" || duration < 0 || duration > 300000 || !Array.isArray(pauses) || pauses.length > 200 || pauses.some((value) => typeof value !== "number" || value < 0 || value > duration)) throw new V2Error("invalid_voice_timing", "语音时长或停顿数据无效。");
  const sum = pauses.reduce((a, b) => a + b, 0);
  if (sum > duration + 1000) throw new V2Error("invalid_voice_timing", "停顿总时长超过录音时长。");
  return { schema_version: "2.0", duration_ms: duration, pause_count: pauses.length, pause_total_ms: sum, longest_pause_ms: Math.max(0, ...pauses), mean_pause_ms: pauses.length ? sum / pauses.length : null, note: "停顿由浏览器音量阈值粗略估计，受环境噪声影响；不能据此判断情绪、能力或关系结果。" };
}

const TURN_PRESSURE = ["必须", "立刻", "马上", "凭什么", "证明", "威胁", "跟踪", "闭嘴", "不回就是", "不会放弃", "去找你", "堵你", "都是你的错", "报警"];
const TURN_APOLOGY = ["对不起", "抱歉", "我错了", "是我不对", "我不该", "我道歉"];
const TURN_EMPATHY = ["听起来", "我理解", "我听到", "谢谢你愿意", "辛苦", "你提到"];
const TURN_ROOM = ["如果你愿意", "不方便", "不勉强", "没关系", "尊重你的决定", "可以拒绝", "不急"];

/** 由用户已说过的内容累积角色状态：连续施压会升高紧张，道歉/共情/留空间会缓和。
 * 状态由客户端携带，服务器不持久化。顺序与 C 的 role_state_from 一致。 */
function roleStateFrom(history, response) {
  let tension = 0, repair = 0, apologized = false;
  const messages = [...history, response];
  messages.forEach((text, index) => {
    const current = index === messages.length - 1;
    const apology = TURN_APOLOGY.some((word) => text.includes(word));
    const pressure = unnegated(text, TURN_PRESSURE);
    const empathy = TURN_EMPATHY.some((word) => text.includes(word)) || TURN_ROOM.some((word) => text.includes(word));
    // 同一句里既有道歉又有施压时，安全优先：先按施压处理，不能靠道歉抵消边界。
    if (pressure) tension = Math.min(3, tension + 1);
    else if (apology) { tension = Math.max(0, tension - 1); repair = Math.min(3, repair + 1); if (current) apologized = true; }
    else if (empathy) tension = Math.max(0, tension - 1);
  });
  return { tension, repair, apologized };
}

export function practiceTurn(body) {
  const scenario = getScenario(body.scenario_id), requested = body.branch || "uncertain", difficulty = body.difficulty || "normal";
  const branch = scenario?.id === "breakup-recovery" ? "declined" : requested;
  if (!scenario || typeof body.response !== "string" || !body.response || chars(body.response) > 1200 || !["positive","uncertain","declined"].includes(requested) || !["easy","normal","challenging"].includes(difficulty)) throw new V2Error("invalid_turn", "请选择有效情境、回应和模拟分支。");
  const history = body.history ?? [];
  if (!Array.isArray(history) || history.length > 5 || history.some((item) => typeof item !== "string" || !item || chars(item) > 1200)) throw new V2Error("invalid_turn", "历史回复须为不超过 5 条、每条 1 至 1200 字的文本。");
  const response = body.response.trim();
  const excerpt = cut(response, 24);
  const { tension, repair, apologized } = roleStateFrom(history, response);
  const pressured = Boolean(unnegated(response, TURN_PRESSURE));
  let text, ended = branch === "declined";
  if (branch === "declined") text = "谢谢你说清楚，但我不想继续这次互动。";
  else if (tension >= 3) { text = `你刚才说「${excerpt}」。我现在有点承受不住，想先暂停这次对话。`; ended = true; }
  else if (apologized) text = `你刚才说「${excerpt}」。谢谢你愿意道歉，我感觉好受一些了。我们可以慢慢来。`;
  else if (tension === 2) text = `你刚才说「${excerpt}」。我还在听，但我们需要慢一点，可以吗？`;
  else if (tension === 1 && pressured) text = `你刚才说「${excerpt}」。我听到了一些压力，我想先停一下；如果你愿意，我们可以换个方式说。`;
  else if (tension === 1) text = `你刚才说「${excerpt}」。我需要一点时间消化，我们慢一点说。`;
  else if (pressured) text = `你刚才说「${excerpt}」。我听到了一些压力，我想先停一下；如果你愿意，我们可以换个方式说。`;
  else if (TURN_EMPATHY.some((word) => response.includes(word))) text = `你刚才说「${excerpt}」。谢谢你愿意这样回应，我感觉被听见了。` + (branch === "positive" ? "我愿意继续聊聊。" : "我还需要一点时间想想。");
  else if (TURN_ROOM.some((word) => response.includes(word))) text = `你刚才说「${excerpt}」。谢谢你给我选择的空间，我再想一想。`;
  else if (/[?？]/u.test(response)) text = `你刚才说「${excerpt}」。这个问题我想整理一下再回答你。`;
  else if (branch === "positive") text = `你刚才说「${excerpt}」。谢谢你表达，我愿意再聊聊。`;
  else if (difficulty === "easy") text = `你刚才说「${excerpt}」。我还不太确定，不过谢谢你说清楚。`;
  else if (difficulty === "challenging") text = `你刚才说「${excerpt}」。我现在不想马上决定，能不能先让我想想？`;
  else text = `你刚才说「${excerpt}」。我现在还不确定，想先留一点时间。`;
  return { schema_version: "2.0", source: "scripted", branch, ended, text, state: { tension, repair } };
}

function practiceFeedback(body) {
  if (!body.session || typeof body.session !== "object") throw new V2Error("invalid_practice", "练习会话或回复数量无效。");
  const responses = Array.isArray(body.responses) && body.responses.length ? body.responses : [{ text: body.response }];
  if (responses.length > 6 || responses.some((item) => typeof item?.text !== "string" || !item.text || chars(item.text) > 1200)) throw new V2Error("invalid_practice", "每条练习回复须为 1 至 1200 字。");
  const last = responses[responses.length - 1].text;
  let result;
  try { result = body.retry ? retryScenario(body.session, last) : critiqueResponse(body.session, last); }
  catch (error) { throw new V2Error("practice_error", error.message); }
  return { ...result, skillEvaluation: evaluation(body.session.scenarioId, responses), schema_version: "2.0" };
}

export async function handleV2(req, res, pathname) {
  const address = req.socket?.remoteAddress || "";
  if (!(address === "::1" || /^127\./u.test(address) || /^::ffff:127\./u.test(address))) return sendJson(res, 403, { error: "local_only", message: "此功能只允许本机访问。" });
  const origin = req.headers.origin;
  const port = req.socket.localPort;
  if (origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(origin)) return sendJson(res, 403, { error: "origin_forbidden", message: "此功能只接受当前本机页面的请求。" });
  if (req.method === "GET" && pathname === "/api/v2/practice/scenarios") return sendJson(res, 200, listScenarios());
  if (req.method !== "POST") return sendJson(res, 405, { error: "method_not_allowed", message: "不支持此请求方式。" });
  if (!/^application\/json(?:\s*;|\s*$)/u.test(String(req.headers["content-type"] || ""))) return sendJson(res, 400, { error: "json_required", message: "请使用 application/json 请求。" });
  try {
    const body = await readRequestJson(req);
    const limit = pathname === "/api/v2/imports/screenshot" ? 1800000 : 120000;
    if (Buffer.byteLength(JSON.stringify(body)) > limit) throw new V2Error("payload_too_large", "输入过长，请缩短后重试。", 413);
    let result;
    if (pathname === "/api/v2/imports/chat") result = importChat(body.text, body.mode || "chat");
    else if (pathname === "/api/v2/imports/screenshot") result = await screenshot(body);
    else if (pathname === "/api/v2/analyses") result = analyzeV2(body.messages, body.source_type);
    else if (pathname === "/api/v2/replies") result = repliesV2(body.messages);
    else if (pathname === "/api/v2/learning/recommendations") result = await recommendCourses(body.query, body.limit, { mode: body.mode });
    else if (pathname === "/api/v2/learning/weekly-plan") result = weeklyPlan(body);
    else if (pathname === "/api/v2/voice/feedback") result = voiceFeedback(body);
    else if (pathname === "/api/v2/practice/sessions") {
      const scenario = getScenario(body.scenario_id || "low-energy-reply");
      if (!scenario) throw new V2Error("unknown_scenario", "未知练习场景。");
      result = { schema_version: "2.0", scenario, session: startScenario(scenario.id) };
    } else if (pathname === "/api/v2/practice/turns") result = practiceTurn(body);
    else if (pathname === "/api/v2/practice/feedback") result = practiceFeedback(body);
    else throw new V2Error("not_found", "没有这个本地接口。", 404);
    return sendJson(res, 200, result);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return sendJson(res, 413, { error: "payload_too_large", message: "输入过长，请缩短后重试。" });
    if (error instanceof V2Error) return sendJson(res, error.status, { error: error.code, message: error.message });
    if (error?.message === "Invalid JSON object") return sendJson(res, 400, { error: "invalid_json", message: "请求体不是有效的 JSON 对象。" });
    return sendJson(res, 500, { error: "server_error", message: "本地服务处理失败。" });
  }
}
