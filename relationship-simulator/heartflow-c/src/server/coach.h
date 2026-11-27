/* coach.h — 关系智能运行时（从 .agents/skills/relationship-coach-cn/runtime 移植） */
#ifndef HF_COACH_H
#define HF_COACH_H

#include "../json.h"

typedef struct {
    const char *code;
    const char *message;
} HfCoachError;

/* 输入为浏览器消息数组与可选记忆；返回可直接序列化的结果对象。
 * 失败返回 NULL 并填充 err（code 为对外错误码）。 */
JNode *hf_coach_run(const JNode *body, HfCoachError *err);

/* 场景训练：list / get / start / critique / retry */
JNode *hf_scenario_list(void);
JNode *hf_scenario_get(const char *id);
JNode *hf_scenario_start(const char *id, HfCoachError *err);
JNode *hf_scenario_critique(const JNode *session, const char *response, int retry, HfCoachError *err);

#endif
