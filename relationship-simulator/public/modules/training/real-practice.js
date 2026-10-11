import { getPracticePlan } from "./practice-plans.js";

export const PRACTICE_OPTIONS = Object.freeze({
  attempt: { done: "已经尝试", notYet: "还没尝试", noOpportunity: "暂时没有合适机会" },
  response: { reciprocal: "双方有具体回应或共同安排", unclear: "回应模糊，暂时无法判断", refused: "对方明确拒绝", incompatible: "发现彼此不合适", notObserved: "还没有可观察的回应" },
  comfort: { comfortable: "相处自在", mixed: "有些自在，也有些勉强", uncomfortable: "感到不舒服", unknown: "暂时无法判断" },
  expression: { clear: "清楚表达了真实想法", unclear: "表达还不够清楚", notApplicable: "这次没有表达的机会" },
  regulation: { maintained: "回到自己的工作、休息或社交安排", struggled: "仍在反复查看或冲动发送", unknown: "尚未观察自己的恢复情况" },
  boundary: { respected: "双方边界得到尊重", uncertain: "还需要确认边界", violated: "出现越界或施压" },
  expected: { reciprocal: "了解是否有双向投入", clearer: "把自己的想法表达清楚", space: "保持空间与自己的生活", unknown: "尚未设定观察目标" }
});

const validObject = (value) => value && typeof value === "object" && !Array.isArray(value);
const allowed = (field, value) => Object.hasOwn(PRACTICE_OPTIONS[field], value);
const OBSERVATION_FIELDS = Object.freeze(["response", "comfort", "expression", "regulation", "boundary", "expected"]);
const UNKNOWN_VALUES = Object.freeze({ response: "notObserved", comfort: "unknown", expression: "notApplicable", regulation: "unknown", boundary: "uncertain", expected: "unknown" });
let anonymousSequence = 0;

function anonymousEventId(existing = new Set()) {
  if (globalThis.crypto?.getRandomValues) {
    try {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
      const id = `practice_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
      if (!existing.has(id)) return id;
    } catch { /* 不可用时使用有界的本页后备方案。 */ }
  }
  // 检查当前最多30条记录，避免随机源退化或测试替身导致覆盖。
  for (let attempt = 0; attempt < 32; attempt += 1) {
    anonymousSequence = (anonymousSequence + 1) % Number.MAX_SAFE_INTEGER;
    const id = `practice_${Date.now().toString(36)}_${anonymousSequence.toString(36)}_${Math.random().toString(36).slice(2, 12) || "0"}`;
    if (!existing.has(id)) return id;
  }
  throw new Error("暂时无法创建独立记录，请稍后重试");
}

function validEventId(id, date, planId) {
  if (typeof id !== "string") return false;
  const legacy = id.match(/^(\d{4}-\d{2}-\d{2}):(.+)$/);
  return /^practice_[a-z0-9_-]{8,96}$/.test(id) || Boolean(legacy && validDate(legacy[1]) && legacy[2] === planId);
}

function validTimestamp(value) {
  return typeof value === "string" && value.length <= 35 && !Number.isNaN(Date.parse(value)) ? value : null;
}

function observationSnapshot(input) {
  const snapshot = { date: input.date, attempt: input.attempt };
  for (const field of OBSERVATION_FIELDS) {
    snapshot[field] = input.attempt !== "done" && field !== "expected"
      ? UNKNOWN_VALUES[field]
      : allowed(field, input[field]) ? input[field] : UNKNOWN_VALUES[field];
  }
  return { ...snapshot, updatedAt: validTimestamp(input.updatedAt) || validTimestamp(input.createdAt) };
}

function boundedHistory(snapshots) {
  if (snapshots.length <= 5) return snapshots;
  // 原观察及已出现的停止信号不能因普通补充次数多而消失。
  const retained = new Set([0]);
  for (const predicate of [(item) => item.response === "refused", (item) => item.boundary === "violated"]) {
    const index = snapshots.findIndex(predicate);
    if (index >= 0) retained.add(index);
  }
  for (let index = snapshots.length - 1; index >= 0 && retained.size < 5; index -= 1) retained.add(index);
  return [...retained].sort((a, b) => a - b).map((index) => snapshots[index]);
}

export function shanghaiDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("日期无效");
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function createPracticeRecord(input, now = new Date()) {
  if (!validObject(input) || !getPracticePlan(input.planId)) throw new TypeError("请先选择当前练习的卡点");
  const date = input.date ?? shanghaiDate(now);
  if (!validDate(date) || date > shanghaiDate(now)) throw new TypeError("请记录有效的当天或过去日期");
  if (!allowed("attempt", input.attempt)) throw new TypeError("请选择是否实际尝试");
  const timestamp = (now instanceof Date ? now : new Date(now)).toISOString();
  return {
    ...observationSnapshot({ ...input, date, updatedAt: timestamp }),
    id: validEventId(input.id, date, input.planId) ? input.id : anonymousEventId(),
    planId: input.planId,
    createdAt: validTimestamp(input.createdAt) || timestamp,
    history: []
  };
}

export function normalizePracticeState(value, now = new Date()) {
  const source = validObject(value) ? value : {};
  const today = shanghaiDate(now);
  const records = new Map();
  for (const input of (Array.isArray(source.records) ? source.records : []).slice(-60)) {
    try {
      if (!validObject(input) || !validDate(input.date)) continue;
      if (!getPracticePlan(input.planId) || !allowed("attempt", input.attempt) || input.date > today) continue;
      // 旧版每天一条的 ID 原样迁移，不虚构日期或载入时间。
      const id = validEventId(input.id, input.date, input.planId) ? input.id : `${input.date}:${input.planId}`;
      const record = {
        ...observationSnapshot(input), id, planId: input.planId,
        createdAt: validTimestamp(input.createdAt),
        history: boundedHistory((Array.isArray(input.history) ? input.history : []).slice(-60).filter((snapshot) => validObject(snapshot) && validDate(snapshot.date) && snapshot.date <= today && allowed("attempt", snapshot.attempt)).map(observationSnapshot))
      };
      records.set(record.id, record);
    } catch { /* 坏数据不成为关系事实。 */ }
  }
  return {
    schemaVersion: 2,
    consent: source.consent === true,
    planId: getPracticePlan(source.planId)?.id ?? null,
    records: [...records.values()].slice(-30)
  };
}

export function toPersistedPracticeState(value) {
  const state = normalizePracticeState(value);
  return { ...state, records: state.consent ? state.records : [] };
}

export function setPracticeConsent(value, granted) {
  const state = normalizePracticeState(value);
  return { ...state, consent: granted === true, records: granted === true ? state.records : [] };
}

export function recordPracticeOutcome(value, input, now = new Date()) {
  const state = normalizePracticeState(value, now);
  const id = anonymousEventId(new Set(state.records.map((record) => record.id)));
  const record = createPracticeRecord({ ...input, id }, now);
  return { ...state, records: [...state.records, record].slice(-30) };
}

/** 补充指定事件；空白或未知选择不会抹去已确认观察。 */
export function updatePracticeOutcome(value, recordId, patch, now = new Date()) {
  const state = normalizePracticeState(value, now);
  const previous = state.records.find((record) => record.id === recordId);
  if (!previous) throw new TypeError("这条记录已不存在，请重新选择要补充的记录");
  if (!validObject(patch)) throw new TypeError("补充内容无效");
  const merged = { ...previous };
  if (patch.date !== undefined && patch.date !== "") {
    if (!validDate(patch.date) || patch.date > shanghaiDate(now)) throw new TypeError("请记录有效的当天或过去日期");
    merged.date = patch.date;
  }
  if (allowed("attempt", patch.attempt)) {
    if (previous.attempt === "done" && patch.attempt !== "done") throw new TypeError("已尝试的事件请保留行动状态；另一次未行动请新增记录");
    merged.attempt = patch.attempt;
  }
  for (const field of OBSERVATION_FIELDS) {
    if (allowed(field, patch[field]) && patch[field] !== UNKNOWN_VALUES[field]) merged[field] = patch[field];
  }
  const snapshot = observationSnapshot(merged);
  const changed = ["date", "attempt", ...OBSERVATION_FIELDS].some((field) => snapshot[field] !== previous[field]);
  if (!changed) return state;
  const updated = {
    ...previous, ...snapshot,
    updatedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    history: boundedHistory([...previous.history, observationSnapshot(previous)])
  };
  return { ...state, records: state.records.map((record) => record.id === recordId ? updated : record) };
}

export function reflectPracticeRecord(record) {
  if (!record || !getPracticePlan(record.planId)) return null;
  const plan = getPracticePlan(record.planId);
  const result = (decision, observation, nextAction, calibration = "unknown") => ({ decision, observation, nextAction, calibration });
  if (record.attempt === "noOpportunity") return result("OBSERVE", "目前是机会条件不足，不能据此判断你的相处能力。", "先确认一个适合自己、可重复参加的公开活动；没有合适机会时完成准备练习即可。");
  if (record.attempt !== "done") return result("OBSERVE", "这次还未实际尝试，现实结果保持未知。", plan.exercise);
  if (record.boundary === "violated") return result("EXIT", "出现越界或施压，优先停止关系推进。", "停止这次推进，保护边界与安全；必要时向可信任的人或专业支持求助。");
  if (record.response === "refused") return result("EXIT", "对方已明确拒绝；停止本次追求是有效的关系判断。", "接受拒绝，不追加说服、不换方式反复联系；把注意力放回自己的生活。");
  if (record.response === "incompatible") return result("EXIT", "发现不合适提供了有用信息，不需要把继续关系当作任务。", "说明自己的选择并结束这次推进；保留适合自己的择偶标准。");
  if (Array.isArray(record.history) && record.history.some((snapshot) => snapshot.response === "refused" || snapshot.boundary === "violated")) return result("EXIT", "这条事件的此前观察中有明确拒绝或越界；一般友好回应不能撤销停止信号。", "尊重原来的停止要求；只有对方主动、明确改变意愿时，才另行记录新的互动。另一段互动请使用新增记录。");
  if (record.comfort === "uncomfortable") return result("DE_ESCALATE", "你自己的不舒服也需要被认真对待。", "降低投入，辨认具体的不舒服来自哪里；可以清楚表达边界，也可以结束这次互动。");
  if (record.boundary === "uncertain") return result("OBSERVE", "双方边界仍需确认，暂不推进亲密或关系承诺。", "先询问并听清对方的选择；任何模糊回应都不能作为同意。");
  let calibration = "unknown";
  if (record.expected === "reciprocal" && ["reciprocal", "unclear"].includes(record.response)) calibration = record.response === "reciprocal" ? "supported" : "notConfirmed";
  if (record.expected === "clearer" && record.expression !== "notApplicable") calibration = record.expression === "clear" ? "supported" : "notConfirmed";
  if (record.expected === "space" && record.boundary === "respected" && ["maintained", "struggled"].includes(record.regulation)) calibration = record.regulation === "maintained" ? "supported" : "notConfirmed";
  if (record.expression === "unclear") return result("OBSERVE", "现在可以改进的是表达清楚程度，而非猜测对方心理。", "对照准备练习，只重写一个真实感受和一个容易拒绝的请求；不连续补发解释。", calibration);
  if (record.response !== "reciprocal") return result("OBSERVE", "现有回应不足以确定双方意愿，保留其他解释。", "维持自己的生活，不连续追问；下一次只观察是否有具体回应或替代安排。", calibration);
  return result("MAINTAIN", "这次出现双向参与，但不代表已同意更亲密的关系。", "继续双方都舒服的当前节奏；再观察兑现、相处感受和彼此是否合适。", calibration);
}
