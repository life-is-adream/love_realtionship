const FOCUSES = new Set(["listening", "clarity", "boundary", "naturalness", "conflict"]);
const TASKS = new Set(["learn", "practice", "reflect"]);

export function normalizeWeeklyPlan(value) {
  if (!value || typeof value !== "object" || value.schemaVersion !== 1 || !FOCUSES.has(value.focus)) return null;
  const createdAt = typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt)) ? value.createdAt : null;
  if (!createdAt) return null;
  const seen = new Set();
  const tasks = (Array.isArray(value.tasks) ? value.tasks : []).filter((task) => {
    if (!task || !TASKS.has(task.id) || seen.has(task.id)) return false;
    seen.add(task.id); return true;
  }).slice(0, 3).map((task) => ({
    id: task.id,
    day: [1, 3, 5].includes(task.day) ? task.day : 1,
    minutes: 5,
    title: String(task.title || "").slice(0, 50),
    description: String(task.description || "").slice(0, 240),
    done: task.done === true
  }));
  if (tasks.length !== 3) return null;
  return {
    schemaVersion: 1, createdAt, focus: value.focus,
    focusLabel: String(value.focusLabel || "").slice(0, 50),
    reason: String(value.reason || "").slice(0, 200),
    source: value.source === "last_practice" ? "last_practice" : "user_selected",
    tasks
  };
}
