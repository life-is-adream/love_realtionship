/* rules.h — 教练评分 / 时机评分 / 聊天回放规则引擎（C 版，浏览器 JS 的对照实现）
 *
 * 这三个规则原本只存在于 public/modules/{coach,timing,replay}.js。
 * 生产 UI 现在优先调用 /api/v2/rules/…；本模块是服务端权威实现，
 * 浏览器 JS 仅作为服务不可用时的兜底，并由 quality/scripts/check-rules-parity.mjs 逐字段核对。
 */
#ifndef HF_RULES_H
#define HF_RULES_H

#include "../json.h"

/* 四维教练评分。text 为待评分草稿；context 字段可为 NULL。 */
JNode *hf_rule_coach_score(const char *text, const char *risk,
                           const char *judgement, const char *her_last_message);

/* 时机评分。body 形如 { messages, latestDraft, stage, now }。 */
JNode *hf_rule_timing(const JNode *body);

/* 聊天回放。body 含 text 时解析+分析；含 messages 时只分析。
 * 返回 { parse?, analysis, summary }。 */
JNode *hf_rule_replay(const JNode *body);

#endif /* HF_RULES_H */
