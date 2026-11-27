/* hf.h — 关系档案引擎（heartflow engine）公共接口
 *
 * 设计约束（对应产品原则）：
 *   1. 单二进制、无外部依赖、数据全在本地纯文本
 *   2. 任何分析结果都必须可回溯到具体文本证据
 *   3. 程序不提供「绕过冷静期」的入口——这是产品意志，不是技术限制
 */
#ifndef HF_H
#define HF_H

#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <time.h>

#define HF_VERSION    "0.1.0"
#define HF_MAX_TEXT   4096
#define HF_MAX_TOPIC  32
#define HF_MAX_TOPICS 16
#define HF_TOPICS_BUF (HF_MAX_TOPIC * HF_MAX_TOPICS)

/* 一条记录 = 一次「发生了什么」 */
typedef struct {
    int64_t id;
    int64_t ts;
    char    kind;              /* e 事件 / c 冲突 / r 修复 / t 谈话 / b 刹车 */
    char    mood[32];          /* 主情绪 */
    int     intensity;         /* 0-100 */
    char    topics[HF_TOPICS_BUF]; /* 逗号分隔关键词 */
    char    note[32];          /* 处置：忍 / 问 / 说清 / 逃 / 道歉 / 未定 */
    char    text[HF_MAX_TEXT];
} HfEntry;

/* 情感识别结果 */
typedef struct {
    char primary[32];
    char secondary[32];
    char evidence[128];        /* 命中的情感词，逗号分隔——每条结论都可回溯 */
    int  intensity;            /* 0-100 */
    int  polarity;             /* -1 负 / 0 中性 / 1 正 */
    int  hits;                 /* 命中的情感词个数，用于判断证据是否充分 */
} HfAffect;

/* 归因偏差计数 */
typedef struct {
    int absolutism;
    int mindreading;
    int blame_other;
    int blame_self;
} HfBias;

/* ---------------- util ---------------- */
void   *hf_xmalloc(size_t n);
void   *hf_xrealloc(void *p, size_t n);
char   *hf_xstrdup(const char *s);
void    hf_die(const char *fmt, ...);
void    hf_localtime(int64_t ts, struct tm *tm_out);
void    hf_strftime(int64_t ts, const char *fmt, char *out, size_t n);
int64_t hf_now(void);
void    hf_mkdir_p(const char *path);
int     hf_file_exists(const char *path);
char   *hf_read_file(const char *path, size_t *len_out);
int     hf_append_line(const char *path, const char *line);
int     hf_disp_width(const char *s);
void    hf_pad(const char *s, int width, char *out, size_t n);

/* ---------------- utf8 / 关键词 ---------------- */
int  hf_utf8_decode(const char *s, uint32_t *cp, int cap);
int  hf_utf8_encode(uint32_t cp, char *out);
int  hf_is_cjk(uint32_t cp);
int  hf_utf8_count(const char *s);
void hf_utf8_cut(const char *s, int max_chars, char *out, size_t outsz);
void hf_keywords(const char *text, char *out, size_t outsz);
void hf_retrieval_terms(const char *text, char *out, size_t outsz);
int  hf_topic_overlap(const char *a, const char *b, char *shared, size_t shared_sz);
const char *hf_top_topic(const char *topics, char *buf, size_t bufsz);
int  hf_topic_count(const char *topics, const char *topic);

/* ---------------- 情感 ---------------- */
void hf_affect(const char *text, HfAffect *out);

/* ---------------- 五个能力 ---------------- */
void hf_mirror(const char *text, const HfAffect *a, FILE *out);
void hf_bias(const char *text, HfBias *b);
void hf_neutral(const char *text, const HfBias *b, FILE *out);
void hf_memory(const char *text, const char *topics,
               const HfEntry *hist, int n, FILE *out);

/* ---------------- 存储 ---------------- */
const char *hf_home(void);
void hf_data_path(const char *name, char *out, size_t n);
int  hf_store_append(HfEntry *e);
int  hf_store_load(HfEntry **out);
void hf_escape(const char *in, char *out, size_t n);
void hf_unescape(const char *in, char *out, size_t n);
int  hf_store_rewrite(const HfEntry *arr, int n);

/* ---------------- 冷静期 ---------------- */
int hf_brake_add(const char *text, int intensity);
int hf_brake_list(FILE *out);
int hf_brake_send(int64_t id, int confirmed, FILE *out);
int hf_brake_drop(int64_t id, FILE *out);
int hf_brake_wait_minutes(int intensity);

/* ---------------- 变化证据 ---------------- */
void hf_trace(int weeks, const HfEntry *hist, int n, FILE *out);

/* ---------------- 演示 ---------------- */
int  hf_cmd_demo(void);

void hf_print_usage(FILE *out);

#endif /* HF_H */
