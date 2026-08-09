/**
 * 7 阶段关系枚举共享常量
 *
 * 值必须与 index.html 的 <select id="stage"> <option> 完全一致。
 * 供 app.js（阶段判断 prompt + 下拉框值校验）、prompts.js（阶段判断 prompt 枚举列表）使用。
 */

/** 7 阶段定义（value/label） */
export const RELATIONSHIP_STAGES = [
  { value: "刚加微信后的第一晚", label: "刚加微信后的第一晚" },
  { value: "隔天轻联系", label: "隔天轻联系" },
  { value: "第一次邀约", label: "第一次邀约" },
  { value: "第一次约会后", label: "第一次约会后" },
  { value: "暧昧推进", label: "暧昧推进" },
  { value: "表达好感", label: "表达好感" },
  { value: "确定关系", label: "确定关系" }
];

/** 纯值数组，供 prompt 拼接和枚举校验使用 */
export const STAGE_VALUES = RELATIONSHIP_STAGES.map((s) => s.value);

/**
 * 校验值是否为合法阶段
 * @param {string} value
 * @returns {boolean}
 */
export function isValidStage(value) {
  return STAGE_VALUES.includes(value);
}
