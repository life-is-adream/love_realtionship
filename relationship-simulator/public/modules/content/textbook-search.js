/**
 * HeartFlow 本地教材检索。
 *
 * 这里不依赖 DOM、网络或向量服务。检索结果只能来自传入的长篇索引，
 * 通过中文短语、关键词和保守的同义词组做可解释匹配，供聊天教练和
 * 后续阅读器复用。
 */

export const TEXTBOOK_SEARCH_LIMIT = 3;
export const TEXTBOOK_EXCERPT_LIMIT = 360;
export const TEXTBOOK_SEARCH_TEXT_LIMIT = 1600;
/**
 * 语义排序加分上限：查询与结果文本的字符 bigram Jaccard 相似度乘以上限后取整。
 * 中文同义改写必然换字（“很忙”→“忙”），bigram 相似度通常 <0.4，因此它只作
 * 排序增强、不改变召回集；真正的语义召回由 SYNONYM_GROUPS 同义词组承担。
 * 保留它是为了让关键词命中相近的条目按语义相关度拉开差距（确定性、纯本地）。
 */
const SEMANTIC_BOOST_MAX = 8;

const STOP_WORDS = new Set([
  "如何",
  "怎么",
  "怎样",
  "什么",
  "为什么",
  "以后",
  "之后",
  "然后",
  "对方",
  "他说",
  "她说",
  "我是不是",
  "是不是",
  "我",
  "你",
  "她",
  "他",
  "是",
  "的",
  "了",
  "吗",
  "呢",
  "吧",
  "啊",
  "有",
  "没有",
  "可以",
  "怎么回",
  "怎么回复",
  "如何回复"
]);

const STOP_FRAGMENTS = [
  "我",
  "你",
  "他",
  "她",
  "是不是",
  "没有",
  "不是",
  "怎么",
  "如何",
  "以后",
  "之后",
  "然后",
  "对方"
];

/**
 * Canonical labels are also the labels shown in `matchedTerms` and `reason`.
 * Aliases are intentionally short and concrete; this keeps the local matcher
 * predictable and avoids turning every polite message into a recommendation.
 */
const SYNONYM_GROUPS = Object.freeze([
  Object.freeze({ canonical: "邀约", aliases: ["邀约", "约见", "约会", "见面", "见一面", "出来", "邀请"] }),
  Object.freeze({ canonical: "被拒", aliases: ["被拒", "拒绝", "拒绝了", "没空", "不方便", "暂时不行", "不能见", "约不上"] }),
  Object.freeze({ canonical: "留出空间", aliases: ["留出空间", "留空间", "给空间", "给她空间", "不打扰", "不追问", "先忙", "给她时间"] }),
  Object.freeze({ canonical: "冷却", aliases: ["冷却", "降温", "冷淡", "变冷", "没回应", "没有回应", "不回", "不回复", "未回应", "未回复", "不理"] }),
  Object.freeze({ canonical: "追问", aliases: ["追问", "连续发", "连续追问", "多条", "补一句", "接着问", "一直问", "查户口", "问太多"] }),
  Object.freeze({ canonical: "误读", aliases: ["误读", "误解", "误会", "过度解读", "过度推断", "脑补", "礼貌不等于兴趣", "把礼貌"] }),
  Object.freeze({ canonical: "回复", aliases: ["回复", "回应", "接话", "怎么回", "如何回复", "回她", "承接"] }),
  Object.freeze({ canonical: "聊天", aliases: ["聊天", "对话", "交流", "沟通", "联系", "消息"] }),
  Object.freeze({ canonical: "推进", aliases: ["推进", "自然推进", "进一步", "升级", "主动", "接近"] }),
  Object.freeze({ canonical: "边界", aliases: ["边界", "分寸", "压力", "低压力", "施压", "越界", "尊重"] }),
  Object.freeze({ canonical: "收尾", aliases: ["收尾", "晚安", "早点休息", "明天再聊", "改天再聊", "先这样", "聊到这里"] }),
  Object.freeze({ canonical: "忙碌", aliases: ["最近很忙", "有点忙", "没时间", "忙", "加班", "疲惫", "累"] }),
  Object.freeze({ canonical: "修复", aliases: ["修复", "道歉", "承认", "改正", "纠正", "自我修正", "重新建立"] }),
  Object.freeze({ canonical: "重新联系", aliases: ["重新联系", "加回", "初次联系", "旧识", "重新认识"] })
]);

const GROUP_BY_CANONICAL = new Map(SYNONYM_GROUPS.map((group) => [group.canonical, group]));

/**
 * Build a flat search index from either a chapter array or the generated
 * `{ chapters: [...] }` module object.
 *
 * @param {Array<object>|{chapters?: Array<object>}} chapters
 * @returns {{entries: Array<object>}}
 */
export function buildTextbookSearchIndex(chapters) {
  const sourceChapters = Array.isArray(chapters)
    ? chapters
    : (isRecord(chapters) && Array.isArray(chapters.chapters) ? chapters.chapters : []);
  const entries = [];

  sourceChapters.forEach((chapter, chapterOrder) => {
    if (!isRecord(chapter)) return;
    const points = Array.isArray(chapter.reviewPoints)
      ? chapter.reviewPoints
      : (Array.isArray(chapter.reviews) ? chapter.reviews : []);
    const chapterId = chapter.id ?? chapter.chapterId ?? `chapter-${chapterOrder + 1}`;
    const chapterTitle = cleanText(chapter.title || chapter.name || `第${chapterId}章`);
    const chapterTags = normalizeList(chapter.tags);

    points.forEach((point) => {
      if (!isRecord(point)) return;
      const reviewPointId = point.id ?? point.reviewPointId;
      if (reviewPointId === undefined || reviewPointId === null || String(reviewPointId).trim() === "") return;

      const title = cleanText(point.title || point.name || String(reviewPointId));
      const tags = unique([
        ...chapterTags,
        ...normalizeList(point.tags),
        ...(point.stage ? [point.stage] : [])
      ]);
      const sourceParts = [
        chapterTitle,
        chapter.summary,
        title,
        ...tags,
        point.searchText,
        point.intent,
        point.benefit,
        point.risk,
        point.correction,
        point.note,
        point.originalMaleReply,
        point.originalFemaleFollowup,
        point.text,
        point.excerpt,
        point.searchExcerpt
      ].filter((value) => value !== undefined && value !== null).map(cleanText).filter(Boolean);
      const searchText = truncate(unique(sourceParts).join(" "), TEXTBOOK_SEARCH_TEXT_LIMIT);
      const providedTerms = Array.isArray(point.searchTerms) ? point.searchTerms : [];
      const searchTerms = unique([
        ...providedTerms.map(cleanText),
        ...tags,
        ...getSemanticTerms(searchText),
        ...extractLiteralTerms(searchText)
      ]).filter(Boolean).slice(0, 300);
      const fallbackExcerpt = [
        point.correction,
        point.benefit,
        point.risk,
        point.intent,
        point.originalFemaleFollowup,
        point.originalMaleReply,
        point.excerpt,
        searchText
      ].map(cleanText).find(Boolean) || title;
      const searchExcerpt = truncate(
        cleanText(point.searchExcerpt || fallbackExcerpt),
        TEXTBOOK_EXCERPT_LIMIT
      );

      entries.push({
        chapterId,
        chapterTitle,
        reviewPointId,
        title,
        tags,
        searchText,
        searchTerms,
        searchExcerpt
      });
    });
  });

  return { entries };
}

/**
 * Search the local index. Every returned item is copied from an indexed entry;
 * no chapter or quote is invented when there is no matching evidence.
 *
 * @param {string} query
 * @param {{entries?: Array<object>}|Array<object>} index
 * @param {number} [limit=3]
 * @returns {Array<object>}
 */
export function searchTextbook(query, index, limit = TEXTBOOK_SEARCH_LIMIT) {
  const terms = buildQueryTerms(query);
  if (!terms.normalizedQuery || !terms.semanticTerms.length && !terms.literalTerms.length) return [];

  const entries = getEntries(index);
  const safeLimit = Math.max(0, Math.min(TEXTBOOK_SEARCH_LIMIT, Math.floor(Number(limit) || 0)));
  if (!entries.length || safeLimit === 0) return [];

  const candidates = [];
  entries.forEach((entry, sourceOrder) => {
    const match = matchEntry(entry, terms);
    if (!match.matchedTerms.length) return;
    const result = {
      chapterId: entry.chapterId,
      chapterTitle: entry.chapterTitle,
      reviewPointId: entry.reviewPointId,
      title: entry.title,
      tags: Array.isArray(entry.tags) ? entry.tags.slice() : [],
      searchExcerpt: truncate(cleanText(entry.searchExcerpt), TEXTBOOK_EXCERPT_LIMIT),
      score: 0,
      matchedTerms: match.matchedTerms,
      reason: `命中：${match.matchedTerms.join("、")}`
    };
    result.score = rankTextbookResult({
      ...result,
      searchText: entry.searchText,
      searchTerms: entry.searchTerms
    }, terms);
    if (result.score >= 6) candidates.push({ result, sourceOrder });
  });

  candidates.sort((left, right) => right.result.score - left.result.score || left.sourceOrder - right.sourceOrder);
  return candidates.slice(0, safeLimit).map(({ result }) => result);
}

/**
 * Rank one result against either the internal query-term object or a simple
 * array of strings. The score has no probabilistic meaning; it only makes the
 * transparent, deterministic ordering explicit.
 *
 * @param {object} result
 * @param {object|string[]} terms
 * @returns {number}
 */
export function rankTextbookResult(result, terms = []) {
  if (!isRecord(result)) return 0;
  const spec = normalizeTermsArgument(terms);
  const resultText = normalizeForSearch([
    result.title,
    result.tags,
    result.searchText,
    result.searchTerms,
    result.searchExcerpt
  ].flat().join(" "));
  const titleText = normalizeForSearch(result.title);
  const tagText = normalizeForSearch(Array.isArray(result.tags) ? result.tags.join(" ") : result.tags);
  const matched = new Set((Array.isArray(result.matchedTerms) ? result.matchedTerms : []).map(normalizeForSearch));
  let score = 0;

  if (spec.normalizedQuery && resultText.includes(spec.normalizedQuery)) score += 36;

  for (const group of spec.semanticTerms) {
    const groupMatched = matched.has(normalizeForSearch(group.canonical)) || group.aliases.some((alias) => resultText.includes(normalizeForSearch(alias)));
    if (!groupMatched) continue;
    score += 22;
    if (group.aliases.some((alias) => titleText.includes(normalizeForSearch(alias)))) score += 10;
    if (group.aliases.some((alias) => tagText.includes(normalizeForSearch(alias)))) score += 8;
  }

  for (const term of spec.literalTerms) {
    const normalizedTerm = normalizeForSearch(term);
    if (!normalizedTerm || !resultText.includes(normalizedTerm)) continue;
    const isCanonical = spec.semanticTerms.some((group) => group.canonical === term);
    score += isCanonical ? 0 : (titleText.includes(normalizedTerm) || tagText.includes(normalizedTerm) ? 12 : 7);
  }

  // 语义加分：查询与结果文本的字符 bigram 相似度（确定性、纯本地）。
  if (spec.normalizedQuery) {
    const similarity = bigramJaccard(spec.normalizedQuery, resultText);
    score += Math.round(similarity * SEMANTIC_BOOST_MAX);
  }

  if (matched.size > 1) score += Math.min(12, (matched.size - 1) * 4);
  return Math.round(score);
}

/**
 * Convert a normalized coach analysis into a local textbook recommendation.
 * Only explicit analysis fields are used; `rawReplay` and full conversation
 * fields are intentionally ignored.
 *
 * @param {object|null|undefined} analysis
 * @param {{entries?: Array<object>}|Array<object>} index
 * @returns {{query: string, results: Array<object>, primary: object|null, message: string}}
 */
export function buildCoachTextbookEvidence(analysis, index) {
  const query = buildAnalysisQuery(analysis);
  const results = query ? searchTextbook(query, index, TEXTBOOK_SEARCH_LIMIT) : [];
  if (!results.length) {
    return {
      query,
      results: [],
      primary: null,
      message: "暂未找到直接对应内容。可以尝试更具体的关键词，例如“邀约”“留出空间”或“连续追问”。"
    };
  }
  return {
    query,
    results,
    primary: results[0],
    message: `已找到 ${results.length} 条教材依据。`
  };
}

/**
 * Bound the optional textbook context passed to a model prompt. The returned
 * object deliberately has no `rawReplay` property, even if the caller passes
 * one in its input object.
 *
 * @param {{summary?: string, results?: Array<object>}} input
 * @returns {{summary: string, excerpts: Array<{chapterTitle: string, reviewPointId: string|number, text: string}>}}
 */
export function buildTextbookCoachContext(input = {}) {
  const value = isRecord(input) ? input : {};
  const summary = truncate(cleanText(value.summary), TEXTBOOK_EXCERPT_LIMIT);
  const excerpts = [];
  const seen = new Set();

  for (const result of Array.isArray(value.results) ? value.results : []) {
    if (!isRecord(result)) continue;
    const reviewPointId = result.reviewPointId;
    if (reviewPointId === undefined || reviewPointId === null || String(reviewPointId).trim() === "") continue;
    const key = `${String(result.chapterId ?? "")}:${String(reviewPointId)}`;
    if (seen.has(key)) continue;
    const text = truncate(cleanText(
      result.searchExcerpt || result.excerpt || result.text || result.title
    ), TEXTBOOK_EXCERPT_LIMIT);
    if (!text) continue;
    seen.add(key);
    excerpts.push({
      chapterTitle: cleanText(result.chapterTitle || "教材章节"),
      reviewPointId,
      text
    });
    if (excerpts.length >= 2) break;
  }

  return { summary, excerpts };
}

function buildAnalysisQuery(analysis) {
  if (!isRecord(analysis)) return "";
  const parts = [];
  const add = (value) => {
    const text = cleanText(value);
    if (text) parts.push(text);
  };

  for (const key of [
    "stage",
    "dimension",
    "summary",
    "judgement",
    "risk",
    "herIntent",
    "yourGoal",
    "nextPractice",
    "opinion",
    "rewriteReason"
  ]) add(analysis[key]);
  for (const key of ["evidence", "risks", "suggestions", "observations"]) {
    for (const item of Array.isArray(analysis[key]) ? analysis[key] : []) {
      if (typeof item === "string") add(item);
      else if (isRecord(item)) {
        for (const field of ["dimension", "title", "text", "reason", "description", "action", "observation"]) {
          add(item[field]);
        }
      }
    }
  }

  return truncate(unique(parts).join(" "), 720);
}

/**
 * 字符 bigram Jaccard 相似度（0~1）。对已归一化的中文/英文文本计算，
 * 是纯本地、确定性的轻量语义近似，不依赖外部向量服务。
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function bigramJaccard(left, right) {
  const a = normalizeForSearch(left);
  const b = normalizeForSearch(right);
  if (!a || !b) return 0;
  const gramsA = new Set();
  const gramsB = new Set();
  for (let i = 0; i + 1 < a.length; i += 1) gramsA.add(a.slice(i, i + 2));
  for (let i = 0; i + 1 < b.length; i += 1) gramsB.add(b.slice(i, i + 2));
  if (!gramsA.size || !gramsB.size) return 0;
  let intersection = 0;
  for (const gram of gramsA) if (gramsB.has(gram)) intersection += 1;
  return intersection / (gramsA.size + gramsB.size - intersection);
}

function matchEntry(entry, terms) {
  const resultText = normalizeForSearch([
    entry.title,
    entry.tags,
    entry.searchText,
    entry.searchTerms,
    entry.searchExcerpt
  ].flat().join(" "));
  const matchedTerms = [];

  for (const group of terms.semanticTerms) {
    if (group.aliases.some((alias) => resultText.includes(normalizeForSearch(alias)))) {
      matchedTerms.push(group.canonical);
    }
  }

  for (const term of terms.literalTerms) {
    const normalizedTerm = normalizeForSearch(term);
    if (!normalizedTerm || !resultText.includes(normalizedTerm)) continue;
    if (terms.semanticTerms.some((group) => group.canonical === term)) continue;
    if (normalizedTerm.length < 3) continue;
    if (terms.semanticTerms.some((group) =>
      group.aliases.some((alias) => {
        const normalizedAlias = normalizeForSearch(alias);
        return normalizedAlias.includes(normalizedTerm) || normalizedTerm.includes(normalizedAlias);
      }))) continue;
    matchedTerms.push(term);
  }

  return { matchedTerms: unique(matchedTerms).slice(0, 8) };
}

function buildQueryTerms(query) {
  const normalizedQuery = normalizeForSearch(query);
  const semanticTerms = SYNONYM_GROUPS.filter((group) =>
    group.aliases.some((alias) => normalizedQuery.includes(normalizeForSearch(alias)))
  );
  const literalTerms = unique([
    ...extractLiteralTerms(query),
    ...semanticTerms.map((group) => group.canonical)
  ]).filter((term) => !semanticTerms.some((group) => group.canonical === term));
  return { normalizedQuery, semanticTerms, literalTerms };
}

function normalizeTermsArgument(terms) {
  if (isRecord(terms)) {
    return {
      normalizedQuery: normalizeForSearch(terms.normalizedQuery || terms.query || ""),
      semanticTerms: Array.isArray(terms.semanticTerms)
        ? terms.semanticTerms.map(normalizeGroup).filter(Boolean)
        : [],
      literalTerms: unique(Array.isArray(terms.literalTerms) ? terms.literalTerms : [])
        .map(cleanText)
        .filter(Boolean)
    };
  }
  const values = Array.isArray(terms) ? terms : [terms];
  const literalTerms = unique(values.map(cleanText).filter(Boolean));
  return {
    normalizedQuery: "",
    semanticTerms: literalTerms.map((term) => ({ canonical: term, aliases: [term] })),
    literalTerms
  };
}

function normalizeGroup(group) {
  if (typeof group === "string") {
    const known = GROUP_BY_CANONICAL.get(group);
    return known || { canonical: group, aliases: [group] };
  }
  if (!isRecord(group)) return null;
  const canonical = cleanText(group.canonical);
  const aliases = unique([canonical, ...(Array.isArray(group.aliases) ? group.aliases : [])].map(cleanText).filter(Boolean));
  return canonical && aliases.length ? { canonical, aliases } : null;
}

function getSemanticTerms(text) {
  const normalized = normalizeForSearch(text);
  return SYNONYM_GROUPS
    .filter((group) => group.aliases.some((alias) => normalized.includes(normalizeForSearch(alias))))
    .map((group) => group.canonical);
}

function extractLiteralTerms(value) {
  const text = cleanText(value);
  const terms = [];
  const chunks = text.match(/[A-Za-z0-9]+|[\u3400-\u9fff]+/gu) || [];

  for (const chunk of chunks) {
    const normalizedChunk = cleanText(chunk);
    if (/^[A-Za-z0-9]+$/u.test(normalizedChunk)) {
      if (normalizedChunk.length >= 2 && !STOP_WORDS.has(normalizedChunk.toLowerCase())) terms.push(normalizedChunk);
      continue;
    }
    if (isUsefulTerm(normalizedChunk)) terms.push(normalizedChunk);
    const maxN = Math.min(4, normalizedChunk.length);
    for (let size = maxN; size >= 2; size -= 1) {
      for (let start = 0; start + size <= normalizedChunk.length; start += 1) {
        const term = normalizedChunk.slice(start, start + size);
        if (isUsefulTerm(term)) terms.push(term);
      }
    }
  }

  return unique(terms);
}

function isUsefulTerm(value) {
  const term = normalizeForSearch(value);
  if (term.length < 2 || STOP_WORDS.has(term)) return false;
  if (STOP_FRAGMENTS.some((fragment) => term.includes(normalizeForSearch(fragment)))) return false;
  return /[\u3400-\u9fffA-Za-z0-9]/u.test(term);
}

function getEntries(index) {
  if (Array.isArray(index)) {
    if (index.some((item) => isRecord(item) && Array.isArray(item.reviewPoints))) {
      return buildTextbookSearchIndex(index).entries;
    }
    return index.filter(isRecord);
  }
  if (!isRecord(index)) return [];
  if (Array.isArray(index.entries)) return index.entries.filter(isRecord);
  if (Array.isArray(index.chapters)) return buildTextbookSearchIndex(index).entries;
  return [];
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return unique(value.flatMap((item) => {
    if (typeof item === "string") return [cleanText(item)];
    if (isRecord(item)) return [cleanText(item.name || item.label || item.text || item.title)];
    return [];
  }));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/gu, "")
    .replace(/[`*_#>]/gu, " ")
    .replace(/[“”]/gu, '"')
    .replace(/[‘’]/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeForSearch(value) {
  return cleanText(value)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\u3400-\u9fff]+/gu, "");
}

function truncate(value, limit) {
  return String(value || "").slice(0, limit);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
