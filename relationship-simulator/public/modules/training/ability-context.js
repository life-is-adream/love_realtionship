import { normalizeLifestyle } from "./lifestyle.js";
import { normalizePracticeState, shanghaiDate } from "./real-practice.js";

/** Anonymous material counts for review; never converts body or outcomes to ability points. */
export function buildAbilityContext(state = {}, { now = Date.now() } = {}) {
  const time = new Date(now).getTime();
  if (!Number.isFinite(time)) return [];
  const today = shanghaiDate(time), earliest = shanghaiDate(time - 29 * 86400000);
  const recent = record => typeof record?.date === "string" && record.date >= earliest && record.date <= today;
  const lifestyle = normalizeLifestyle(state.lifestyle);
  const practice = normalizePracticeState(state.relationshipPractice).records.filter(recent);
  const training = lifestyle.fitness.trainings.filter(recent).length;
  const skincare = lifestyle.skincare.days.filter(recent).filter(day => [...Object.values(day.am), ...Object.values(day.pm)].some(Boolean)).length;
  const grooming = lifestyle.grooming.days.filter(recent).length;
  const items = [
    { id: "appearance", count: training + skincare + grooming, label: "生活管理记录", source: "生活自报", detail: `近30天：运动${training}天、护肤${skincare}天、仪容${grooming}天。这里只说明有记录，不证明健康或外形效果。` },
    { id: "communication", count: practice.filter(r => r.attempt === "done" && r.expression !== "notApplicable").length, label: "表达复盘", source: "现实自报" },
    { id: "emotion", count: practice.filter(r => r.regulation !== "unknown").length, label: "恢复与生活复盘", source: "现实自报" },
    { id: "dating", count: practice.filter(r => r.attempt === "done").length, label: "实际尝试记录", source: "现实自报" },
    { id: "boundaries", count: practice.filter(r => r.boundary !== "uncertain").length, label: "边界观察", source: "现实自报" }
  ];
  return items.map(item => ({ ...item, detail: item.detail || `近30天有${item.count}条结构化记录，可用于复核；回应和拒绝不换算为能力分。` }));
}
