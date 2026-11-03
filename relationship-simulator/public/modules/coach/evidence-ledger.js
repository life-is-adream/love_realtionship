/**
 * 证据台账（P1）：只从**已经落盘的消息**构建可核对事实，供教练回复审计引用。
 *
 * 为什么存在：教练会把「新提出的时间地点」写成「你们早就约好的事」，也会凭空造出
 * 用户从没提过的咖啡馆。单靠提示词约束挡不住，因为输出侧没有东西去对照「会话里到底出现过什么」。
 * 本模块提供那个对照面。
 *
 * 三条硬规则：
 * 1. 条目只能来自真实消息，mid 必须可追溯；本模块**永不生成新事实**。
 * 2. 教练自己的自由文本不回填成证据 —— 否则一次幻觉会被下一轮当成既成事实。
 * 3. 她说的话算「会话内已知」，但作用域是 simulation：陪伴/现实复盘不得把它当现实关系证据。
 *
 * 已知局限：判定「某个时间/地点是否出现过」用的是正文词面命中，不做语义推理。
 * 因此它能可靠抓住「无中生有」，抓不住「换了个说法的越界推断」；后者由提示词与
 * 用户侧的「待确认」标注兜底，不假装词面检测能证明全部自然语言语义。
 */

export const EVIDENCE_KIND = Object.freeze({
  OBSERVED: "observed",
  USER_ASSERTED: "user_asserted",
  CHARACTER_ASSERTED: "character_asserted",
  SIMULATION_EVENT: "simulation_event"
});

export const EVIDENCE_SCOPE = Object.freeze({ REAL: "real", SIMULATION: "simulation", UNKNOWN: "unknown" });

const normalize = (value) => String(value || "").replace(/\s+/g, "").toLowerCase();

function kindOf(message) {
  if (message?.type === "me") return EVIDENCE_KIND.USER_ASSERTED;
  if (message?.type === "her") return EVIDENCE_KIND.CHARACTER_ASSERTED;
  return EVIDENCE_KIND.OBSERVED;
}

function scopeOf(message) {
  if (message?.type === "her") return EVIDENCE_SCOPE.SIMULATION;
  if (message?.type === "me") return message.source === "user" ? EVIDENCE_SCOPE.REAL : EVIDENCE_SCOPE.UNKNOWN;
  return EVIDENCE_SCOPE.UNKNOWN;
}

/**
 * @param {Array<Object>} messages 已落盘会话消息（需带 mid；缺失时按内容现补，保持幂等）
 * @param {Object} [options]
 * @param {Array<Object>} [options.scenarioEvents] 剧情事件，作用域强制为 simulation
 * @returns {{entries: Array<Object>, byMid: Map<string,Object>, corpus: string, normalizedCorpus: string}}
 */
export function buildEvidenceLedger(messages, options = {}) {
  const list = (Array.isArray(messages) ? messages : []).filter(
    (message) => message && typeof message.text === "string" && message.text.trim()
  );
  const events = (Array.isArray(options.scenarioEvents) ? options.scenarioEvents : []).filter(
    (event) => event && typeof event.text === "string" && event.text.trim()
  );

  const entries = list.map((message) => ({
    mid: message.mid || null,
    kind: kindOf(message),
    scope: scopeOf(message),
    text: message.text.trim(),
    createdAt: message.createdAt || null
  }));

  for (const event of events) {
    entries.push({
      mid: event.mid || null,
      kind: EVIDENCE_KIND.SIMULATION_EVENT,
      scope: EVIDENCE_SCOPE.SIMULATION,
      text: event.text.trim(),
      createdAt: event.createdAt || null
    });
  }

  const byMid = new Map();
  for (const entry of entries) if (entry.mid) byMid.set(entry.mid, entry);

  const corpus = entries.map((entry) => entry.text).join("\n");
  const normalizedCorpus = normalize(corpus);
  // 会话里到底存在过「约定」这回事吗？没有的话，任何「早就定的那顿饭」都是无中生有 ——
  // 即使句子里没给出可提取的具体时间/地点，也需要这一位来触发保守拦截。
  const hasCommitment = /约好|说好|商定|定好|定了|订了|已约|安排|老地方|照旧|原计划|下次(?:再)?(?:约|见)/.test(normalizedCorpus);
  return { entries, byMid, corpus, normalizedCorpus, hasCommitment };
}

/** 该文本是否已在台账里出现过（词面命中，忽略空白与大小写）。 */
export function isGroundedInLedger(ledger, text) {
  const needle = normalize(text);
  if (!needle) return true;
  return String(ledger?.normalizedCorpus || "").includes(needle);
}

/** 取出台账里出现过的原文，供 UI 展示证据出处。 */
export function sourcesFor(ledger, texts) {
  const wanted = (Array.isArray(texts) ? texts : [texts]).map(normalize).filter(Boolean);
  return (ledger?.entries || [])
    .filter((entry) => wanted.some((needle) => normalize(entry.text).includes(needle)))
    .map((entry) => ({ mid: entry.mid, kind: entry.kind, scope: entry.scope, text: entry.text }));
}
