/* coach_internal.h — 关系智能内部数据结构
 *
 * 移植自 .agents/skills/relationship-coach-cn/runtime（JS，约 1300 行）。
 * 原则：只做可观察特征，不推断兴趣、人格或诊断；所有结论都带证据 id。
 */
#ifndef HF_COACH_INTERNAL_H
#define HF_COACH_INTERNAL_H

#include "../json.h"

#define HF_MAX_MSGS      80
#define HF_COACH_TEXT      2000
#define HF_MAX_EVIDENCE  12
#define HF_MAX_OBS       100
#define HF_MAX_STATES    10

typedef struct {
    char      id[96];
    char      speaker[16];      /* user | other | unknown */
    char     *text;
    long long ts_ms;            /* -1 表示缺失 */
} HfMsg;

typedef struct {
    HfMsg *v;
    int    n;
} HfMsgs;

typedef struct {
    int   warm, low_energy, boundary, conflict;
} HfEmotionCount;

typedef struct {
    int    message_count;
    int    user_count, other_count, unknown_count;
    int    has_user_ratio;
    double user_ratio;
    int    has_other_q_ratio;
    double other_q_ratio;
    long long avg_gap_ms;
    int    has_avg_gap;
    int    gap_samples;
    char   emotional_exchange[32];
    char   emotion_labels[4][24];
    int    emotion_label_count;
    char   topic_label[24];
    int    has_topic_sim;
    double topic_sim;
    int    conflict_count;
    int    has_conflict_freq;
    double conflict_freq;
    int    consecutive_followups;
    int    boundary_count;
    int    rejection_count;
    int    exit_count;
    int    pause_count;
    int    safety_count;
    char   timestamp_coverage[16];
    char   data_quality[16];
} HfMetrics;

typedef struct {
    const char *id;
    const char *kind;
    const char *observation;
    const char *source;
} HfEvidence;

typedef struct {
    HfMetrics  m;
    HfEvidence ev[HF_MAX_EVIDENCE];
    int        ev_n;
} HfAnalysis;

/* 文本工具 */
char *hf_trim_dup(const char *s);
int   hf_text_has(const char *text, const char *phrase);
int   hf_text_near(const char *text, const char *a, const char *b, int max_bytes);
int   hf_utf8_chars(const char *s);
void  hf_redact(const char *in, char *out, size_t n, int limit);
int   hf_is_anon_id(const char *s, int maxlen);
int   hf_is_case_id(const char *s);
long long hf_parse_iso(const char *s);
void  hf_fmt_ratio(double v, char *out, size_t n);

/* 分析 */
void hf_analyze(const HfMsgs *msgs, HfAnalysis *out);
JNode *hf_analysis_json(const HfAnalysis *a);
void  hf_msgs_free(HfMsgs *m);

#endif
