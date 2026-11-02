/**
 * 数值收口：全库唯一的 0–100 取整工具。
 *
 * 背景：项目里曾同时存在 12 份 `Math.max(0, Math.min(100, ...))`，但它们
 * **并不等价**——非有限值的回退各有不同（0 / 70 / null），取整时机也不同。
 * 本模块只收口语义一致的两类，语义不同的保留原实现并在其处注明原因：
 *
 * | 形态 | 回退 | 收口到 |
 * |---|---|---|
 * | 非有限 → 0 | `clampScore` | ✅ 本模块 |
 * | 哨兵/非有限 → null | `clampScoreOrNull` | ✅ 本模块 |
 * | 非有限 → 70 | `coach/coach.js` 的 `clampScore` | ❌ 刻意的默认分，勿合并 |
 * | `Number(value) \|\| 0` 头像位置 | `core/state.js` | ❌ 不是评分 |
 * | 不取整（条形宽度） | `render/render-session-report.js` | ❌ 不是评分 |
 * | `Math.trunc`（次数计数） | `training/date-journey.js` | ❌ 不是评分 |
 *
 * 收口的唯一目的：让"0–100 取整"这件事只有一处定义，改边界策略时不用改 12 处。
 */

/**
 * 把任意值收口为 0–100 的整数分；非有限值回退 0。
 *
 * 与被合并的三处旧实现行为一致（`coach/analysis-result.js`、`core/investment.js`、
 * `training/growth.js`）：`Number(value)` 后取整再夹取。
 *
 * @param {unknown} value
 * @returns {number}
 */
export function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

/**
 * 把任意值收口为 0–100 的整数分；"未评分"与非数值都返回 null。
 *
 * 语义要点：`null` / `undefined` / `""` / 全空白串是**未评分**哨兵，不能被
 * `Number()` 悄悄转成 0——那会把"没评"变成"评了 0 分"。布尔值与对象同样按非数值处理。
 *
 * 注意：本函数比旧的 `core/training-scores.js finiteScore` 更严格——旧实现
 * 会把 `Number(true)` 转成 1。这里收紧为 null，属于**有意的修正**：布尔评分
 * 是脏数据，静默转成 1/0 才是数据损坏。
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export function clampScoreOrNull(value) {
  if (value === null || value === undefined) return null;
  // 空白串同样是「未评分」哨兵：`Number("   ") === 0`，不拦就是把"没评"变成"0 分"。
  if (typeof value === "string" && !value.trim()) return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number)));
}
