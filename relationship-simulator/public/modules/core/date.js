/**
 * 全库唯一日期键口径：Asia/Shanghai（YYYY-MM-DD）。
 *
 * 训练记录、生活记录、成长档案、对话摘要的"今天"必须来自这里，
 * 不要在使用处再拼 getFullYear()（设备本地）或 toISOString()（UTC）。
 * 本文件零 import，避免成为新的依赖环节点。
 */

/**
 * 把 Date / 毫秒时间戳 / 可解析字符串转换为上海时区的日期键。
 * @param {Date|number|string} [value=new Date()] - 待转换时间
 * @returns {string} YYYY-MM-DD
 */
export function shanghaiDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("日期无效");
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
