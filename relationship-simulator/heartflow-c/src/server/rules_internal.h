/* rules_internal.h — 规则引擎共享工具（UTF-8 / 时间 / 数值 / 文本匹配） */
#ifndef HF_RULES_INTERNAL_H
#define HF_RULES_INTERNAL_H

#include "../json.h"
#include <stdint.h>

/* 文本 */
int   r_has(const char *text, const char *phrase);
int   r_has_any(const char *text, const char **list);
int   r_has_seq(const char *text, const char *a, const char *b);
int   r_has_seq3(const char *text, const char *a, const char *b, const char *c);
int   r_count_occ(const char *text, const char *phrase);
int   r_starts_with(const char *text, const char *prefix);
int   r_ends_with(const char *text, const char *suffix);
char *r_trim_dup(const char *s);
char *r_clean_dup(const char *s);          /* JS cleanText: \s+ -> " " + trim */
int   r_quote_reference(const char *text); /* “...” / 「...」 / 『...』 / "..." 1-40 字 */

/* UTF-8 */
int   r_utf8_one(const char *p, uint32_t *cp); /* 返回字节数；非法字节按 1 处理 */
int   r_utf16_len(const char *s);              /* JS String.length */
int   r_cp_len(const char *s);                 /* Array.from(s).length */
int   r_cp_len_no_ws(const char *s);
int   r_is_ws_cp(uint32_t cp);
void  r_utf8_cut_chars(const char *s, int max_chars, char *out, size_t outsz);

/* 数值 */
double r_round(double x); /* JS Math.round（正数四舍五入） */
double r_round1(double x);
double r_round3(double x);
double r_clamp_raw(double x, double min, double max);
int    r_clamp_score(double x);        /* core/number.js clampScore：非有限 -> 0 */
int    r_clamp_score_coach(double x);  /* coach.js clampScore：非有限 -> 70 */

/* 时间 */
long long r_parse_time(const char *s, int *ok);
long long r_timestamp_value(const JNode *node, int *has); /* createdAt/timestamp/time 已由调用方选好 */
void      r_iso_time(long long ms, char out[40]);
int       r_local_hour(long long ms);
void      r_format_elapsed(double minutes, char *out, size_t n);
int       r_is_late_night(long long ms);

/* 阶段 */
int r_stage_valid(const char *stage);

/* JSON */
JNode *r_arr_of_strings(const char **values, int n);

#endif /* HF_RULES_INTERNAL_H */
