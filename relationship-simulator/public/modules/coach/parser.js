import { buildCoachScore, clampScore } from "./coach.js";
import { buildReplyOptionsForHer, isUsableModelReplyOptions } from "./replies.js";
import { buildLocalHerReply, getCurrentPersona, getPersonaMemory, getLatestMineText, getState } from "../core/state.js";
import { selectLocalPuaReply } from "../training/pua-awareness.js";

/** 取对话中最近一条女方消息文本（供个人校准检测"理性回应情绪"） */
function getPreviousHerText() {
  const messages = getState().messages || [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === "her") return messages[i].text || "";
  }
  return "";
}

export function extractJsonObject(raw) {
  const text = String(raw || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  if (text.startsWith("{") && text.endsWith("}")) return text;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start !== -1 && end > start ? text.slice(start, end + 1) : "";
}

export function normalizeReplyOptions(replyOptions) {
  const list = Array.isArray(replyOptions)
    ? replyOptions
    : (replyOptions && typeof replyOptions === "object"
      ? Object.entries(replyOptions).map(([key, value]) => typeof value === "string" ? { key, text: value } : { key, ...(value || {}) })
      : []);
  const fallbackLabels = { A: "A 温柔高情商", B: "B 幽默风趣", C: "C 拉扯试探" };
  return list.map((item, index) => {
    const key = item.key || ["A", "B", "C"][index] || String(index + 1);
    return {
      key,
      label: item.label || fallbackLabels[key] || `${key} 回复`,
      text: item.text || item.reply || item.content || "",
      effect: item.effect || item.reason || ""
    };
  }).filter((item) => item.text);
}

export function normalizeCoachScore(input, latestMine, context = {}) {
  const fromModel = input && typeof input === "object" ? input : {};
  const fallback = buildCoachScore(latestMine, context);
  return {
    total: clampScore(fromModel.total ?? fromModel.score ?? fallback.total),
    naturalness: clampScore(fromModel.naturalness ?? fromModel["自然度"] ?? fallback.naturalness),
    empathy: clampScore(fromModel.empathy ?? fromModel["共情"] ?? fallback.empathy),
    boundary: clampScore(fromModel.boundary ?? fromModel["边界感"] ?? fallback.boundary),
    momentum: clampScore(fromModel.momentum ?? fromModel["推进力"] ?? fallback.momentum),
    weakestDim: fromModel.weakestDim || fromModel["最弱维度"] || fallback.weakestDim,
    strongestDim: fromModel.strongestDim || fromModel["最强维度"] || fallback.strongestDim,
    strength: fromModel.strength || fromModel["优势"] || fallback.strength,
    shortcoming: fromModel.shortcoming || fromModel["短板"] || fallback.shortcoming,
    nextPractice: fromModel.nextPractice || fromModel["下一步训练"] || fallback.nextPractice,
    summary: fromModel.summary || fromModel["总结"] || fallback.summary
  };
}

export function parseModelContent(content, context = {}) {
  const raw = String(content || "").trim();
  const jsonText = extractJsonObject(raw);
  if (jsonText) {
    try { return normalizeAnalysis(JSON.parse(jsonText), raw, context); } catch { /* use text compatibility parser */ }
  }
  return parsePlainTextFallback(raw, context);
}

export function normalizeAnalysis(obj, raw, context = {}) {
  const latestMine = context.latestMine ?? getLatestMineText(context.typedInput || "");
  const styleBias = context.styleBias || "mix";
  const goal = context.goal || "继续推进自然对话。";
  const herReply = obj.herReply || obj.herText || obj.reply || obj["女方下一句"] || obj["女方回复"] || "";
  const normalizedHerReply = firstReplyLine(herReply) || firstReplyLine(raw);
  const replyOptions = normalizeReplyOptions(obj.replyOptions || obj.choices || obj["A/B/C回复"]);
  const useModelOptions = isUsableModelReplyOptions(replyOptions, normalizedHerReply, latestMine);
  return {
    herReply: normalizedHerReply,
    herIntent: obj.herIntent || obj["她的隐藏意图"] || "模型未提供。",
    yourGoal: obj.yourGoal || obj["你的隐藏目标"] || goal,
    judgement: obj.judgement || obj["当前判断"] || raw.slice(0, 500),
    risk: obj.risk || obj["风险提醒"] || "无明确风险。",
    replyOptions: useModelOptions ? replyOptions.slice(0, 3) : buildLocalReplyOptions(styleBias, latestMine, normalizedHerReply),
    replyOptionsSource: useModelOptions ? "model" : "local",
    recommendation: obj.recommendation || obj["推荐"] || "",
    coachScore: normalizeCoachScore(obj.coachScore || obj["教练评分"], latestMine, { ...obj, herLastMessage: getPreviousHerText() })
  };
}

export function parsePlainTextFallback(raw, context = {}) {
  const latestMine = context.latestMine ?? getLatestMineText(context.typedInput || "");
  const styleBias = context.styleBias || "mix";
  const extractedHerReply = extractJsonLikeString(raw, "herReply") || extractJsonLikeString(raw, "reply") || pickByRegex(raw, [/女方(?:回复|说|下一句)?[：:\s-]*([\s\S]*?)(?=\n\s*(A|分析|隐藏|判断|风险|推荐|$))/i]);
  const extractedIntent = extractJsonLikeString(raw, "herIntent");
  const extractedGoal = extractJsonLikeString(raw, "yourGoal");
  const extractedJudgement = extractJsonLikeString(raw, "judgement");
  const extractedRisk = extractJsonLikeString(raw, "risk");
  const extractedReplyOptions = extractJsonLikeReplyOptions(raw);
  const herReply = extractedHerReply || firstReplyLine(raw) || "哈哈，谢谢~ 你也挺会说话的。你平时也经常参加这种活动吗？";
  const normalizedHerReply = firstReplyLine(herReply);
  const useModelOptions = isUsableModelReplyOptions(extractedReplyOptions, normalizedHerReply, latestMine);
  return {
    herReply,
    herIntent: extractedIntent || "模型返回普通文本，已兼容解析。",
    yourGoal: extractedGoal || context.goal || "继续推进自然对话。",
    judgement: extractedJudgement || raw.slice(0, 900),
    risk: extractedRisk || "模型未严格按 JSON 输出；已转为兼容模式。",
    replyOptions: useModelOptions ? extractedReplyOptions.slice(0, 3) : buildLocalReplyOptions(styleBias, latestMine, normalizedHerReply),
    replyOptionsSource: useModelOptions ? "model" : "local",
    recommendation: extractJsonLikeString(raw, "recommendation") || "先看右侧 A/B/C，再选一条更像你本人说话方式的。",
    coachScore: normalizeCoachScore(null, latestMine, { risk: extractedRisk, judgement: extractedJudgement })
  };
}

export function localAnalyze(modelError = "", uiValues = {}) {
  const state = getState();
  const persona = getCurrentPersona();
  const memory = getPersonaMemory(persona);
  const latestMine = getLatestMineText(uiValues.typedInput || "");
  const previousHer = [...state.messages].reverse().find((message) => message.type === "her")?.text || "";
  const style = uiValues.styleBias || "mix";
  const stage = uiValues.stage || "";
  const mode = state.trainingMode === "pua" ? "pua" : "anti";
  const herReply = mode === "pua"
    ? selectLocalPuaReply({ latestMine, previousHer, messageCount: state.messages.length })
    : buildLocalHerReply(persona, memory, latestMine, previousHer, uiValues);
  const background = String(memory.background || "").replace(/[。！？\s]+$/, "");
  if (mode === "pua") {
    return {
      source: "local",
      generationSource: "local",
      modelError,
      herIntent: "PUA 识别训练（本地演示）：女方本轮使用了可识别的操控手法。",
      yourGoal: String(uiValues.goal || "").trim() || "练习识别操控手法，保持自己的边界，不接对方的操控框架。",
      judgement: "当前处于 PUA 识别训练模式。这不是真实关系判断，而是手法识别练习：看清话术背后的操控结构，而不是被话术带节奏。",
      risk: "识别信号见 herIntent 与下方手法提示。核心防御：不接‘证明自己’的框架，不追赶忽冷忽热，不把愧疚当作服从的理由。",
      herReply,
      replyOptions: buildLocalReplyOptions(style, latestMine, herReply),
      recommendation: "防御回应优先：先点出手法（如‘这话听着像在贬我抬你’），再给出健康替代（如直接表达自己的感受）。健康做法见每日课程（第22课边界、第23课非暴力沟通、第29课识别危险关系）。",
      coachScore: buildCoachScore(latestMine, { risk: memory.boundaries, judgement: background || stage, herLastMessage: previousHer })
    };
  }
  return {
    source: "local",
    generationSource: "local",
    modelError,
    herIntent: `${persona.name} 正在观察你这一轮的真实意图。`,
    yourGoal: String(uiValues.goal || "").trim() || "继续推进自然对话。",
    judgement: `当前处于${stage}，${background || "关系背景待补充"}。重点是把对话维持得自然、有边界。`,
    risk: memory.boundaries || "保持尊重边界，避免操控或施压。",
    herReply,
    replyOptions: buildLocalReplyOptions(style, latestMine, herReply),
    recommendation: buildRecommendation(style),
    coachScore: buildCoachScore(latestMine, { risk: memory.boundaries, judgement: background || stage, herLastMessage: previousHer })
  };
}

export function buildLocalReplyOptions(style, latestMine = "", previousHer = "") {
  return buildReplyOptionsForHer(style, previousHer, latestMine);
}

export function buildRecommendation(style) {
  if (style === "B") return "先用 B。当前气氛轻松，幽默更容易把她的问题接得自然，不会太用力。";
  if (style === "C") return "先用 C。她已经主动追问，你可以轻微试探，但句子仍要留退路。";
  return "先用 A。这个阶段先稳住自然感最重要，再慢慢加一点个人色彩。";
}

export function buildLocalRewriteReason(original, rewrite) {
  if (/蓝色星球|纪录片|电影|视频|看了|观看/.test(original) && /纪录片|内容|作品/.test(rewrite)) return "把泛化的‘活动’改成与前文一致的纪录片话题，让问题真正承接上下文，减少模板感。";
  if (/你平时也会参加这种活动吗/.test(original)) return "去掉固定套话，改成围绕对方刚刚提到的内容提问，让对方更容易自然接话。";
  if (original !== rewrite) return "保留原本想表达的意思，压缩多余表达，并把问题改成更具体、低压力的交流。";
  return "当前表达没有明显风险，暂时保留原意；后续应继续结合对方的具体话题调整。";
}

export function parsePreflightEvaluation(content, fallbackScore, fallbackFlags, original, fallbackRewrite) {
  const raw = String(content || "").trim();
  try {
    const parsed = parseLooseJson(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("invalid evaluation");
    const score = {
      ...fallbackScore,
      total: clampScore(parsed.total ?? parsed.score ?? fallbackScore.total),
      naturalness: clampScore(parsed.naturalness ?? fallbackScore.naturalness),
      empathy: clampScore(parsed.empathy ?? fallbackScore.empathy),
      boundary: clampScore(parsed.boundary ?? fallbackScore.boundary),
      momentum: clampScore(parsed.momentum ?? fallbackScore.momentum),
      nextPractice: String(parsed.opinion || parsed.nextPractice || fallbackScore.nextPractice),
      summary: String(parsed.summary || fallbackScore.summary)
    };
    const rewrite = extractRewriteText(parsed.rewrite || "", original) || fallbackRewrite;
    return { score, risk: String(parsed.risk || parsed.warning || fallbackFlags.warning), rewrite, rewriteReason: String(parsed.rewriteReason || buildLocalRewriteReason(original, rewrite)), partial: false };
  } catch {
    const partial = parsePlainPreflightEvaluation(raw, fallbackScore, fallbackFlags, original, fallbackRewrite);
    return partial ? { ...partial, partial: true } : null;
  }
}

export function parseLooseJson(raw) {
  const candidate = extractJsonObject(raw);
  if (!candidate) return null;
  const attempts = [candidate, candidate.replace(/,\s*([}\]])/g, "$1"), candidate.replace(/[“”]/g, '"').replace(/[‘’]/g, "'")];
  for (const attempt of attempts) {
    try { return JSON.parse(attempt); } catch { /* try the next format */ }
  }
  return null;
}

export function parsePlainPreflightEvaluation(raw, fallbackScore, fallbackFlags, original, fallbackRewrite) {
  if (!raw) return null;
  const numberFor = (name, fallback) => {
    const match = raw.match(new RegExp(`${name}[^0-9]{0,12}(\\d{1,3})`, "i"));
    return match ? clampScore(match[1]) : fallback;
  };
  const rewriteMatch = raw.match(/(?:rewrite|改写(?:版本)?)[：:]?\s*([^\n]+)/i);
  const rewrite = extractRewriteText(rewriteMatch?.[1] || raw, original) || fallbackRewrite;
  if (rewrite === fallbackRewrite && !/total|naturalness|boundary|推进力|边界感|风险|意见|建议/i.test(raw)) return null;
  return {
    score: { ...fallbackScore, total: numberFor("(?:total|综合分|总分)", fallbackScore.total), naturalness: numberFor("(?:naturalness|自然度)", fallbackScore.naturalness), empathy: numberFor("(?:empathy|共情度)", fallbackScore.empathy), boundary: numberFor("(?:boundary|边界感)", fallbackScore.boundary), momentum: numberFor("(?:momentum|推进力)", fallbackScore.momentum) },
    risk: raw.match(/(?:risk|风险)[：:]?\s*([^\n]+)/i)?.[1] || fallbackFlags.warning,
    rewrite,
    rewriteReason: raw.match(/(?:rewriteReason|改写原因)[：:]?\s*([^\n]+)/i)?.[1] || buildLocalRewriteReason(original, rewrite)
  };
}

export function extractRewriteText(content, original) {
  const raw = String(content || "").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(extractJsonObject(raw));
    const value = parsed.rewrite || parsed.rewrittenText || parsed.text || parsed.reply || "";
    if (value && String(value).trim() !== original.trim() && !/你平时也会参加这种活动吗/.test(String(value))) return String(value).trim();
  } catch {
    const value = raw.replace(/^```(?:text|txt)?\s*/i, "").replace(/```$/i, "").trim();
    if (value && value !== original.trim() && value.length < 240 && !/你平时也会参加这种活动吗/.test(value) && !/[：:]\s*$/.test(value)) return value;
  }
  return "";
}

export function parseStageResult(content) {
  try {
    const parsed = JSON.parse(extractJsonObject(String(content || "").trim()));
    return { stage: String(parsed.stage || ""), reason: String(parsed.reason || ""), confidence: String(parsed.confidence || "medium") };
  } catch {
    return null;
  }
}

export function parseChapterContent(rawText, chapterIndex) {
  const lines = String(rawText || "").split(/\r?\n/);
  const units = [];
  const RE_DIALOGUE = /^(?:\*\*)?(我|周叙|男方|夏紫桐)(?:\[?\d+\]?)?[：:](?:\*\*)?\s*(.*)$/;
  const RE_HEADER = /^#{1,4}\s+/;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith(">")) continue;
    if (/^#\s+第.+章/.test(trimmed)) continue;
    if (/^##\s+/.test(trimmed) && !trimmed.includes("恋爱大师")) {
      units.push({ type: "section", title: trimmed.replace(/^##\s+/, ""), line: i + 1 });
      continue;
    }
    if (RE_HEADER.test(trimmed) && trimmed.includes("恋爱大师")) {
      const title = trimmed.replace(/^#{2,4}\s+/, "");
      const reviewPoint = chapterIndex.reviewPoints?.find((rp) => rp.title === title);
      units.push({ type: "review", title, reviewPoint: reviewPoint || null, line: i + 1 });
      continue;
    }
    if (/^###\s+/.test(trimmed)) {
      units.push({ type: "time", title: trimmed.replace(/^###\s+/, ""), line: i + 1 });
      continue;
    }
    const dialogueMatch = trimmed.match(RE_DIALOGUE);
    if (dialogueMatch) {
      const speaker = dialogueMatch[1];
      const text = (dialogueMatch[2] || "").trim();
      if (text) units.push({ type: "dialogue", speaker: ["我", "周叙", "男方"].includes(speaker) ? "me" : "her", speakerName: speaker === "我" ? "我" : speaker, text, line: i + 1 });
      continue;
    }
    units.push({ type: "narrative", text: trimmed, line: i + 1 });
  }
  return units;
}

export function pickByRegex(text, patterns) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    const value = (match?.[1] || "").trim().replace(/^["“]|["”]$/g, "");
    if (value) return firstReplyLine(value);
  }
  return "";
}

export function extractJsonLikeString(raw, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(raw || "").match(new RegExp(`"${escapedKey}"\\s*:\\s*"((?:\\\\.|[^"])*)"`, "i"));
  if (!match?.[1]) return "";
  return match[1].replace(/\\"/g, '"').replace(/\\n/g, " ").replace(/\\r/g, " ").replace(/\\t/g, " ").trim();
}

export function extractJsonLikeReplyOptions(raw) {
  const options = [];
  for (const key of ["A", "B", "C"]) {
    const match = String(raw || "").match(new RegExp(`"key"\\s*:\\s*"${key}"[\\s\\S]*?"label"\\s*:\\s*"((?:\\\\.|[^"])*)"[\\s\\S]*?"text"\\s*:\\s*"((?:\\\\.|[^"])*)"(?:[\\s\\S]*?"effect"\\s*:\\s*"((?:\\\\.|[^"])*)")?`, "i"));
    if (!match) continue;
    options.push({ key, label: (match[1] || "").replace(/\\"/g, '"').replace(/\\n/g, " ").trim() || `${key} 回复`, text: (match[2] || "").replace(/\\"/g, '"').replace(/\\n/g, " ").trim(), effect: (match[3] || "").replace(/\\"/g, '"').replace(/\\n/g, " ").trim() });
  }
  return options.filter((item) => item.text);
}

export function firstReplyLine(text) {
  return String(text || "").split(/\n+/).map((line) => line.trim()).filter(Boolean).find((line) => !/^(原因|效果|推荐|隐藏|判断|风险|A|B|C)\b/.test(line)) || "";
}
