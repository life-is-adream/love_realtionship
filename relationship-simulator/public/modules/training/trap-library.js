/**
 * ④ 常见陷阱图鉴：把错题按「人会掉进去的原因」归档成静态陷阱卡。
 *
 * 设计对齐《拣爱》的失败观：第一周目必然踩坑（「钢铁直男」是成就不是耻辱）。
 * 图鉴的语义是「收集」，不是「待修复的债」——每个陷阱回答两件事：
 * - why：为什么人会掉进来（机制，不是性格缺陷）；
 * - signal：下次在什么场景容易触发。
 *
 * 匹配键对齐错题本的既有标签（core/mistakes.js classifyPreflightIssues +
 * app.js collectCoachMistake）：越界词 / 施压词 / 「维度」短板。
 * 纯函数聚合，零 DOM / 零存储 / 零 LLM；判定来自本地规则，不是给用户贴标签。
 */

export const TRAP_LIBRARY = Object.freeze([
  {
    id: "pressure",
    name: "催促施压",
    why: "不确定感会让人想尽快拿到答案，仿佛催一催结果就会提前出现。但确定感只能由对方给出来，催出来的回答不算数。",
    signal: "一句话里出现「必须」「马上」「怎么不回我」这类要求即时回应的措辞。",
    matchedIssues: ["施压词"]
  },
  {
    id: "boundary-crossing",
    name: "越过舒适区",
    why: "把网上看到的亲密套话当成了通用答案，节奏跑在了关系前面。对方还没到那一步，就先感到了不安全。",
    signal: "早期对话出现超出当前关系浓度的称呼或暗示，对方开始回避或敷衍。",
    matchedIssues: ["越界词"]
  },
  {
    id: "lecture",
    name: "讲道理不接情绪",
    why: "紧张或想帮忙时，大脑会默认切到「解决问题」模式；但对刚倾诉的人来说，「被听到」比「被修理」重要得多。",
    signal: "对方说累、说难过时，你的第一句是分析或建议，而不是先接住感受。",
    matchedIssues: ["共情短板"]
  },
  {
    id: "try-hard",
    name: "用力过猛",
    why: "怕冷场就不断加料：回得快、写得多、给的空间少。热情本身没有错，但它挤掉了对方参与的位置。",
    signal: "回复明显长于对方、秒回连发、对方只需回「嗯」就能结束一轮对话。",
    matchedIssues: ["边界感短板"]
  },
  {
    id: "script",
    name: "照教程说话",
    why: "怕说错所以背话术。但套路感是藏不住的——对方会感觉自己在被「操作」，而不是在被认识。",
    signal: "句子工整得不像你平时说话；同样的话换个人也能原样发出。",
    matchedIssues: ["自然度短板"]
  },
  {
    id: "stall",
    name: "原地打转",
    why: "怕被拒绝所以不敢表达意愿。可关系里长期没有信号，对方同样不知道该不该靠近；模糊的代价由两个人一起付。",
    signal: "聊了很久、聊得也不错，但没约过、没表达过想再见面。",
    matchedIssues: ["推进力短板"]
  }
]);

/** 图鉴进度上限说明文案 */
export const TRAP_LIBRARY_NOTE = "图鉴来自本地规则与评分的判定，不是给你贴标签；点亮它只说明这是你当前最值得练的方向。走出一次，就算一段真实的进步。";

/**
 * 聚合图鉴进度：一条错题可同时命中多个陷阱（issues 是数组）。
 * @param {Array<Object>|null|undefined} mistakes - state.mistakes 条目
 * @returns {{ traps: Array<{id: string, name: string, why: string, signal: string,
 *   count: number, resolvedCount: number, firstSeen: string|null}>, litCount: number }}
 */
export function buildTrapProgress(mistakes) {
  const list = Array.isArray(mistakes) ? mistakes.filter((item) => item && typeof item === "object") : [];
  const counts = new Map(TRAP_LIBRARY.map((trap) => [trap.id, { count: 0, resolvedCount: 0, firstSeen: null }]));
  for (const mistake of list) {
    const issues = Array.isArray(mistake.issues) ? mistake.issues.map((item) => String(item ?? "").trim()) : [];
    for (const trap of TRAP_LIBRARY) {
      if (!trap.matchedIssues.some((label) => issues.includes(label))) continue;
      const entry = counts.get(trap.id);
      entry.count += 1;
      if (mistake.resolved === true) entry.resolvedCount += 1;
      const time = Date.parse(String(mistake.ts || ""));
      if (Number.isFinite(time) && (entry.firstSeen === null || time < Date.parse(entry.firstSeen))) {
        entry.firstSeen = new Date(time).toISOString();
      }
    }
  }
  const traps = TRAP_LIBRARY
    .map((trap) => ({ ...trap, ...counts.get(trap.id) }))
    .sort((a, b) => b.count - a.count || TRAP_LIBRARY.findIndex((item) => item.id === a.id) - TRAP_LIBRARY.findIndex((item) => item.id === b.id));
  return { traps, litCount: traps.filter((trap) => trap.count > 0).length };
}
