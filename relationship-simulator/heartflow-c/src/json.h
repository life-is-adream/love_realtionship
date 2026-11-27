/* json.h — 最小 JSON 解析/序列化（无外部依赖）
 *
 * 为什么自己写：服务端要在 C 里处理 LLM 请求体与响应体，
 * 引入第三方 JSON 库会破坏「单二进制、零依赖」这条本项目最硬的约束。
 *
 * 设计取舍：
 *   - DOM 式（解析成树），不做流式。请求体上限 2MB，内存代价可接受。
 *   - 字符串按原字节保存（UTF-8 直通），只在 \uXXXX 处解码。
 *   - 序列化默认紧凑输出；需要缩进时用 jw_pretty。
 */
#ifndef HF_JSON_H
#define HF_JSON_H

#include <stddef.h>

/* ---------- 动态缓冲区 ---------- */
typedef struct {
    char  *p;
    size_t n;
    size_t cap;
} HfBuf;

void  hf_buf_init(HfBuf *b);
void  hf_buf_free(HfBuf *b);
void  hf_buf_reset(HfBuf *b);
void  hf_buf_add(HfBuf *b, const char *s, size_t n);
void  hf_buf_puts(HfBuf *b, const char *s);
void  hf_buf_putc(HfBuf *b, char c);
void  hf_buf_printf(HfBuf *b, const char *fmt, ...);
char *hf_buf_take(HfBuf *b);          /* 交出所有权，调用方 free */

/* ---------- 节点 ---------- */
typedef enum { JNULL = 0, JBOOL, JNUM, JSTR, JARR, JOBJ } JType;

typedef struct JNode JNode;

struct JNode {
    JType type;
    union {
        int    b;
        double num;
        struct { char *s; size_t n; } str;
        struct { JNode **v; int n, cap; } arr;
        struct { char **k; JNode **v; int n, cap; } obj;
    } u;
};

JNode *json_parse(const char *src, size_t len, char *err, size_t errsz);
JNode *json_clone(const JNode *n);
void   json_free(JNode *n);

/* 读取：类型不符返回默认值，不抛错 */
JNode       *json_get(const JNode *obj, const char *key);
JNode       *json_at(const JNode *arr, int index);
int          json_len(const JNode *n);
const char  *json_str(const JNode *obj, const char *key, const char *def);
double       json_num(const JNode *obj, const char *key, double def);
int          json_bool(const JNode *obj, const char *key, int def);
const char  *json_node_str(const JNode *n, const char *def);
int          json_is_null(const JNode *n);

/* 构造 */
JNode *json_new_obj(void);
JNode *json_new_arr(void);
JNode *json_new_str(const char *s);
JNode *json_new_num(double d);
JNode *json_new_bool(int b);
JNode *json_new_null(void);
void   json_obj_set(JNode *obj, const char *key, JNode *val);   /* 接管 val */
void   json_obj_set_str(JNode *obj, const char *key, const char *s);
void   json_obj_set_num(JNode *obj, const char *key, double d);
void   json_obj_set_bool(JNode *obj, const char *key, int b);
void   json_arr_push(JNode *arr, JNode *val);                   /* 接管 val */

/* 序列化 */
void json_write(const JNode *n, HfBuf *out, int pretty, int depth);
void json_escape_to(HfBuf *out, const char *s, size_t n);

#endif /* HF_JSON_H */
