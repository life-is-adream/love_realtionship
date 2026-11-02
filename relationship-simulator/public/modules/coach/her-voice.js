/**
 * ① 角色回信：把教练评分翻译成「模拟对方口吻的可能读法」。
 *
 * 设计对齐《拣爱》的核心洞察：系统分数防御性强、教不会共情；真正让学习者
 * 换位的是「对方怎么说这句话落到了ta那里」。本模块是纯本地启发式：
 * - 只依赖 coachScore 的四维与总分，零 DOM / 零存储 / 零模型调用；
 * - 输出以最弱维度为主线的第一人称读法；分档：>=80 正面回信、65-79 观察与
 *   一个具体请求、<65 或最弱维度 <55 直说不适；
 * - 文案基调不是「抓包」：不评价人格，只描述这句表达在对方那里引起的感受，
 *   并始终附带「这是模拟读法，不是读心」的边界声明。
 *
 * score 维度沿用教练引擎命名：naturalness / empathy / boundary / momentum。
 */

import { clampScoreOrNull } from "../core/number.js";

export const HER_VOICE_DIM_THRESHOLD = 55;
export const HER_VOICE_GOOD_TOTAL = 80;
export const HER_VOICE_MID_TOTAL = 65;

const DIM_READINGS = {
  naturalness: {
    low: "有些话读起来像照着教程说的，我能看出结构，却摸不到你这个人。下次说点你自己的话，哪怕笨一点，我也会更想接。",
    label: "自然度"
  },
  empathy: {
    low: "你回复得很认真，但我感觉你更急着解决问题，或者急着表达你自己——我更想先被听到：我今天说的那些小事，对你来说是重要的吗？",
    label: "共情"
  },
  boundary: {
    low: "你的热情我能感觉到，但回得又快又密，我还没准备好这种节奏。我需要能说「今天先到这里」而不怕你失望的空间。",
    label: "边界感"
  },
  momentum: {
    low: "聊得挺舒服，可我一直猜不到你到底想不想继续——如果你愿意，给我一个更具体一点的信号，或者一个容易回答的问题也好。",
    label: "推进力"
  }
};

/** 取最弱维度（确定性：并列时按 naturalness→empathy→boundary→momentum 取靠前） */
function weakestDimOf(score) {
  const keys = ["naturalness", "empathy", "boundary", "momentum"];
  const scored = keys
    .map((key) => ({ key, value: normalizeDim(score[key]) }))
    .filter((item) => item.value !== null);
  if (!scored.length) return null;
  return scored.reduce((min, item) => (item.value < min.value ? item : min));
}

function normalizeDim(value) {
  return clampScoreOrNull(value);
}

/**
 * @param {Object|null|undefined} score - coachScore（total + 四维）
 * @param {string} [personaName] - 模拟角色名（空则不署名）
 * @returns {Object|null} { headline, signature, lines, note }；无有效总分时返回 null
 */
export function buildHerVoice(score, personaName = "") {
  if (!score || typeof score !== "object") return null;
  const total = normalizeDim(score.total);
  if (total === null) return null;
  const weakest = weakestDimOf(score);
  const weak = weakest && weakest.value < HER_VOICE_DIM_THRESHOLD ? weakest : null;
  const dim = weak ? DIM_READINGS[weak.key] : null;
  const name = String(personaName || "").trim();

  if (total >= HER_VOICE_GOOD_TOTAL && !weak) {
    return {
      headline: "这轮她大概会这样回你",
      signature: name,
      lines: [
        "和你聊天挺自在的：你在听我说话，也在说你自己，我没有被追问或被安排的感觉。",
        "这种感觉我会想继续，下次你可以继续保持这样的节奏。"
      ],
      note: "这是基于评分的模拟读法，不是读心；她的真实感受只能由本人确认。"
    };
  }
  if (total >= HER_VOICE_MID_TOTAL && !weak) {
    return {
      headline: "这轮她大概会这样想",
      signature: name,
      lines: [
        "这轮聊得还行，没有让我不舒服的地方，但我还没感觉到特别的靠近。",
        "如果你想让我更想回应，下轮试着具体一点：回应我提到的一件小事，而不是泛泛地接话。"
      ],
      note: "这是基于评分的模拟读法，不是读心；她的真实感受只能由本人确认。"
    };
  }
  return {
    headline: dim ? `这轮她可能会说（主要是${dim.label}）` : "这轮她可能会说",
    signature: name,
    lines: [
      dim ? dim.low : "这轮的回复让我有点接不上：话都在，但我感觉不到你在和我说话。",
      "我可以理解第一次尝试会紧张；比「说对」更重要的是让我看到你在意我的感受，而不是在意这句话的得分。"
    ],
    note: "这是基于评分的模拟读法，不是读心，也不代表所有女生的感受；她的真实感受只能由本人确认。"
  };
}
