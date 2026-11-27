/* text.c — UTF-8 处理与中文关键词提取
 *
 * 不引第三方分词库的原因：单二进制、零依赖是本项目的硬约束。
 * 策略是「锚点词表 + 二元组补足」：
 *   锚点词表覆盖关系冲突的高频主题（已读不回、见家长、家务……），命中即整词入档并加权；
 *   未命中的部分用 CJK 二元组（bigram）补充，再过滤停用组合。
 * 代价是有噪声词，收益是任何输入都能产出稳定的主题标签。
 */
#define _POSIX_C_SOURCE 200809L

#include "hf.h"

#include <stdlib.h>
#include <string.h>

/* ---------------- UTF-8 ---------------- */

int hf_utf8_decode(const char *s, uint32_t *cp, int cap)
{
    const unsigned char *p = (const unsigned char *)s;
    int n = 0;

    while (*p && n < cap) {
        uint32_t c;
        if (p[0] < 0x80) {
            c = p[0]; p += 1;
        } else if ((p[0] & 0xE0) == 0xC0 && p[1] && (p[1] & 0xC0) == 0x80) {
            c = ((uint32_t)(p[0] & 0x1F) << 6) | (uint32_t)(p[1] & 0x3F); p += 2;
        } else if ((p[0] & 0xF0) == 0xE0 && p[1] && p[2] &&
                   (p[1] & 0xC0) == 0x80 && (p[2] & 0xC0) == 0x80) {
            c = ((uint32_t)(p[0] & 0x0F) << 12) | ((uint32_t)(p[1] & 0x3F) << 6) |
                (uint32_t)(p[2] & 0x3F); p += 3;
        } else if ((p[0] & 0xF8) == 0xF0 && p[1] && p[2] && p[3] &&
                   (p[1] & 0xC0) == 0x80 && (p[2] & 0xC0) == 0x80 && (p[3] & 0xC0) == 0x80) {
            c = ((uint32_t)(p[0] & 0x07) << 18) | ((uint32_t)(p[1] & 0x3F) << 12) |
                ((uint32_t)(p[2] & 0x3F) << 6) | (uint32_t)(p[3] & 0x3F); p += 4;
        } else {
            p += 1;            /* 非法序列：跳过单字节，不崩溃 */
            continue;
        }
        cp[n++] = c;
    }
    return n;
}

int hf_utf8_encode(uint32_t c, char *out)
{
    if (c < 0x80) {
        out[0] = (char)c; return 1;
    }
    if (c < 0x800) {
        out[0] = (char)(0xC0 | (c >> 6));
        out[1] = (char)(0x80 | (c & 0x3F)); return 2;
    }
    if (c < 0x10000) {
        out[0] = (char)(0xE0 | (c >> 12));
        out[1] = (char)(0x80 | ((c >> 6) & 0x3F));
        out[2] = (char)(0x80 | (c & 0x3F)); return 3;
    }
    out[0] = (char)(0xF0 | (c >> 18));
    out[1] = (char)(0x80 | ((c >> 12) & 0x3F));
    out[2] = (char)(0x80 | ((c >> 6) & 0x3F));
    out[3] = (char)(0x80 | (c & 0x3F)); return 4;
}

int hf_is_cjk(uint32_t c)
{
    if (c >= 0x4E00 && c <= 0x9FFF) return 1;
    if (c >= 0x3400 && c <= 0x4DBF) return 1;
    if (c >= 0xF900 && c <= 0xFAFF) return 1;
    return 0;
}

int hf_utf8_count(const char *s)
{
    const unsigned char *p = (const unsigned char *)s;
    int n = 0;
    while (*p) {
        if (*p < 0x80) p += 1;
        else if ((*p & 0xE0) == 0xC0) p += 2;
        else if ((*p & 0xF0) == 0xE0) p += 3;
        else if ((*p & 0xF8) == 0xF0) p += 4;
        else p += 1;
        n++;
    }
    return n;
}

void hf_utf8_cut(const char *s, int max_chars, char *out, size_t outsz)
{
    const unsigned char *p = (const unsigned char *)s;
    size_t used = 0;
    int n = 0;

    while (*p && n < max_chars) {
        size_t step = 1;
        if (*p < 0x80) step = 1;
        else if ((*p & 0xE0) == 0xC0) step = 2;
        else if ((*p & 0xF0) == 0xE0) step = 3;
        else if ((*p & 0xF8) == 0xF0) step = 4;
        if (used + step + 1 > outsz) break;
        memcpy(out + used, p, step);
        used += step;
        p += step;
        n++;
    }
    out[used] = '\0';
}

/* ---------------- 停用字与停用二元组 ---------------- */

static const char *STOP_CHARS[] = {
    "的","了","我","你","他","她","它","是","在","就","都","也","很","不","吗","呢",
    "吧","啊","呀","么","和","与","跟","有","没","这","那","个","们","又","还","会",
    "能","要","说","想","觉","得","到","上","下","一","二","三","好","太","更","最",
    "可","以","被","把","给","对","从","向","但","而","且","或","如","果","因","为",
    "所","之","其","中","里","后","前","时","候","自","己","什","些","样","种","次",
    NULL
};

static const char *STOP_BIGRAMS[] = {
    "我们","你们","他们","她们","这个","那个","什么","怎么","就是","不是",
    "可以","因为","所以","但是","如果","已经","还是","真的","其实","觉得","知道",
    "现在","时候","一个","一下","这样","那样","没有","不会","不能","应该","可能",
    "东西","事情","问题","感觉","而且","然后","之后","以前","以后","开始","一直",
    "有点","一点","一些","这些","那些","这么","那么","多少","怎样","什么",
    NULL
};

/* 关系冲突的高频主题锚点：命中即作为整词主题，并优先于二元组 */
static const char *ANCHORS[] = {
    "已读不回","回消息","消息","冷战","吵架","争执","拌嘴","沉默","冷暴力",
    "见家长","父母","婆媳","亲家","催婚","催生",
    "家务","做饭","洗碗","打扫","分担",
    "花钱","工资","存款","彩礼","房贷",
    "前任","异性朋友","异性","边界","手机","隐私","查手机",
    "承诺","答应","食言","结婚","订婚","孩子","生育","异地",
    "陪伴","时间","加班","工作忙","应酬","纪念日","生日","礼物",
    "信任","安全感","情绪","道歉","原谅","分手","复合","搬家","同居",
    "不回消息","已读","卑微","消失","提醒","约定","加班","主动","电影",
    "看电影","备忘录","规则","攒着","抱歉","在开会","冷战期",
    NULL
};

static int in_list(const char *s, const char **list)
{
    int i;
    for (i = 0; list[i]; i++)
        if (strcmp(s, list[i]) == 0) return 1;
    return 0;
}

static int is_stop_char(uint32_t c)
{
    char b[8];
    int n = hf_utf8_encode(c, b);
    b[n] = '\0';
    return in_list(b, STOP_CHARS);
}

/* ---------------- 关键词 ---------------- */

typedef struct { char w[HF_MAX_TOPIC]; int score; int order; } Kw;
#define KW_MAX 160

static void kw_add(Kw *kw, int *n, const char *w, int boost)
{
    int i;
    for (i = 0; i < *n; i++) {
        if (strcmp(kw[i].w, w) == 0) {
            kw[i].score += 1;
            return;
        }
    }
    if (*n >= KW_MAX) return;
    snprintf(kw[*n].w, sizeof kw[*n].w, "%s", w);
    kw[*n].score = 1 + boost;
    kw[*n].order = *n;
    (*n)++;
}

/* 去掉空白与半角标点，供锚点整词匹配使用 */
static char *compact_dup(const char *s)
{
    const unsigned char *p = (const unsigned char *)s;
    size_t cap = strlen(s) + 1;
    char *out = (char *)hf_xmalloc(cap);
    size_t u = 0;

    while (*p) {
        unsigned char c = *p;
        if (c == ' ' || c == '\t' || c == '\n' || c == '\r' ||
            c == ',' || c == '.' || c == '!' || c == '?' || c == ';' || c == ':') {
            p++; continue;
        }
        if (c < 0x80) { out[u++] = (char)c; p++; }
        else if ((c & 0xE0) == 0xC0 && p[1]) {
            out[u++] = (char)p[0]; out[u++] = (char)p[1]; p += 2;
        } else if ((c & 0xF0) == 0xE0 && p[1] && p[2]) {
            out[u++] = (char)p[0]; out[u++] = (char)p[1]; out[u++] = (char)p[2]; p += 3;
        } else if ((c & 0xF8) == 0xF0 && p[1] && p[2] && p[3]) {
            out[u++] = (char)p[0]; out[u++] = (char)p[1];
            out[u++] = (char)p[2]; out[u++] = (char)p[3]; p += 4;
        } else p++;
    }
    out[u] = '\0';
    return out;
}

static int contains_token(const char *list, const char *w)
{
    char hay[HF_TOPICS_BUF + 4];
    char pat[80];
    if (!list || !*list) return 0;
    snprintf(hay, sizeof hay, ",%s,", list);
    snprintf(pat, sizeof pat, ",%s,", w);
    return strstr(hay, pat) != NULL;
}

void hf_keywords(const char *text, char *out, size_t outsz)
{
    uint32_t cp[2048];
    int ncp, i;
    Kw kw[KW_MAX];
    int nkw = 0;
    char *flat;
    size_t used = 0;
    int picked = 0;

    out[0] = '\0';
    if (!text || !*text) return;

    /* 1. 锚点整词优先。命中即止，不再用二元组补——
     *    领域词表比统计切分可靠；两者混用只会带来「住发」这类跨词噪声。 */
    flat = compact_dup(text);
    {
        int anchor_n = 0;
        for (i = 0; ANCHORS[i]; i++) {
            if (strstr(flat, ANCHORS[i])) {
                kw_add(kw, &nkw, ANCHORS[i], 40);
                anchor_n++;
            }
        }
        /* 2. 二元组只在没有锚点时才用，作为兜底 */
        if (anchor_n == 0) {
            ncp = hf_utf8_decode(text, cp, (int)(sizeof cp / sizeof cp[0]));
            for (i = 0; i + 1 < ncp; i++) {
                char bg[16];
                int bl;
                if (!hf_is_cjk(cp[i]) || !hf_is_cjk(cp[i + 1])) continue;
                if (is_stop_char(cp[i]) || is_stop_char(cp[i + 1])) continue;
                bl = hf_utf8_encode(cp[i], bg);
                bl += hf_utf8_encode(cp[i + 1], bg + bl);
                bg[bl] = '\0';
                if (in_list(bg, STOP_BIGRAMS)) continue;
                kw_add(kw, &nkw, bg, 0);
            }
        }
    }
    free(flat);

    /* 3. 按 score 降序、入档顺序升序，取前 10 个 */
    while (picked < 10) {
        int best = -1, bi;
        for (bi = 0; bi < nkw; bi++) {
            if (kw[bi].score <= 0) continue;
            if (contains_token(out, kw[bi].w)) continue;
            if (best < 0 || kw[bi].score > kw[best].score ||
                (kw[bi].score == kw[best].score && kw[bi].order < kw[best].order))
                best = bi;
        }
        if (best < 0) break;
        {
            size_t wl = strlen(kw[best].w);
            int need = (int)wl + (picked ? 1 : 0);
            if (used + (size_t)need + 1 > outsz) break;
            if (picked) out[used++] = ',';
            memcpy(out + used, kw[best].w, wl);
            used += wl;
            out[used] = '\0';
        }
        kw[best].score = 0;
        picked++;
    }
}

/* 课程检索的通用领域同义扩展：只做稳定的词对，不做逐条查询的特判。 */
static const struct { const char *key, *a, *b; } RETRIEVAL_SYNONYMS[] = {
    {"回消息", "回复", "消息"}, {"消息", "回复", NULL}, {"回复速度", "回复", NULL},
    {"修复", "和好", "重建"}, {"吵架", "争执", "分歧"}, {"冲突", "争执", "分歧"},
    {"花钱", "财务", "开销"}, {"工资", "收入", NULL}, {"存款", "财务", NULL}, {"债务", "财务", "收入"},
    {"见面", "邀约", "约会"}, {"拒绝", "不接受", NULL}, {"出轨", "不忠", "背叛"},
    {"暴力", "安全", "控制"}, {"操控", "控制", NULL}, {"家务", "分担", "打扫"},
    {"照护", "照顾", NULL}, {"分手", "结束", NULL}, {"结婚", "婚姻", NULL}, {"婚前", "婚姻", NULL},
    {"异地", "距离", NULL}, {"冷暴力", "沉默", NULL}, {"承诺", "投入", NULL}, {"择偶", "标准", NULL},
    {"新鲜感", "成长", NULL}, {"同意", "边界", NULL},
    {NULL, NULL, NULL}
};

/* 课程检索专用：锚点与二元组同时保留，让正文里的普通词也能参与 BM25。
 * 与 Node server/v2.js 的 retrievalKeywords 保持同一顺序和上限，避免双端排序漂移。 */
void hf_retrieval_terms(const char *text, char *out, size_t outsz)
{
    uint32_t cp[2048];
    int ncp, i, count = 0;
    char *flat;
    size_t used = 0;

    out[0] = '\0';
    if (!text || !*text) return;
    flat = compact_dup(text);
    for (i = 0; ANCHORS[i] && count < 24; i++) {
        size_t n = strlen(ANCHORS[i]);
        if (!strstr(flat, ANCHORS[i]) || contains_token(out, ANCHORS[i])) continue;
        if (used + n + 2 > outsz) break;
        if (used) out[used++] = ',';
        memcpy(out + used, ANCHORS[i], n + 1); used += n; count++;
    }
    /* 「会」是通用停用字，但「约会」是领域词，二元组会被停用字规则误删。 */
    if (strstr(flat, "约会") && !contains_token(out, "约会") && count < 24) {
        if (used + 8 <= outsz) { if (used) out[used++] = ','; memcpy(out + used, "约会", 7); used += 6; count++; }
    }
    for (i = 0; RETRIEVAL_SYNONYMS[i].key && count < 24; i++) {
        const char *vals[2]; int k;
        if (!contains_token(out, RETRIEVAL_SYNONYMS[i].key)) continue;
        vals[0] = RETRIEVAL_SYNONYMS[i].a; vals[1] = RETRIEVAL_SYNONYMS[i].b;
        for (k = 0; k < 2 && vals[k] && count < 24; k++) {
            size_t n = strlen(vals[k]);
            if (contains_token(out, vals[k])) continue;
            if (used + n + 2 > outsz) break;
            if (used) out[used++] = ',';
            memcpy(out + used, vals[k], n + 1); used += n; count++;
        }
    }
    free(flat);
    ncp = hf_utf8_decode(text, cp, (int)(sizeof cp / sizeof cp[0]));
    for (i = 0; i + 1 < ncp && count < 24; i++) {
        char bg[16];
        int bl;
        if (!hf_is_cjk(cp[i]) || !hf_is_cjk(cp[i + 1])) continue;
        if (is_stop_char(cp[i]) || is_stop_char(cp[i + 1])) continue;
        bl = hf_utf8_encode(cp[i], bg); bl += hf_utf8_encode(cp[i + 1], bg + bl); bg[bl] = '\0';
        if (in_list(bg, STOP_BIGRAMS) || contains_token(out, bg)) continue;
        if (used + (size_t)bl + 2 > outsz) break;
        if (used) out[used++] = ',';
        memcpy(out + used, bg, (size_t)bl + 1); used += (size_t)bl; count++;
    }
    {
        const char *bridges[6]; int n = 0, j;
        if (strstr(text, "忙") || strstr(text, "没空")) { bridges[n++] = "时间"; bridges[n++] = "边界"; }
        if (strstr(text, "约") || strstr(text, "见面")) { bridges[n++] = "时间"; bridges[n++] = "主动"; }
        if (strstr(text, "吵") || strstr(text, "冲突")) { bridges[n++] = "情绪"; bridges[n++] = "边界"; }
        for (j = 0; j < n && count < 24; j++) {
            size_t m = strlen(bridges[j]);
            if (contains_token(out, bridges[j])) continue;
            if (used + m + 2 > outsz) break;
            if (used) out[used++] = ',';
            memcpy(out + used, bridges[j], m + 1); used += m; count++;
        }
    }
}

int hf_topic_overlap(const char *a, const char *b, char *shared, size_t shared_sz)
{
    char bufa[HF_TOPICS_BUF];
    char hay[HF_TOPICS_BUF + 4];
    char *p;

    shared[0] = '\0';
    if (!a || !b || !*a || !*b) return 0;
    if (strlen(a) >= sizeof bufa) return 0;

    snprintf(hay, sizeof hay, ",%s,", b);
    snprintf(bufa, sizeof bufa, "%s", a);

    p = strtok(bufa, ",");
    while (p) {
        char pat[80];
        snprintf(pat, sizeof pat, ",%s,", p);
        if (strstr(hay, pat)) {
            snprintf(shared, shared_sz, "%s", p);
            return 1;
        }
        p = strtok(NULL, ",");
    }
    return 0;
}

const char *hf_top_topic(const char *topics, char *buf, size_t bufsz)
{
    size_t i = 0;
    buf[0] = '\0';
    if (!topics || !*topics) return buf;
    while (topics[i] && topics[i] != ',' && i + 1 < bufsz) {
        buf[i] = topics[i];
        i++;
    }
    buf[i] = '\0';
    return buf;
}

int hf_topic_count(const char *topics, const char *topic)
{
    char hay[HF_TOPICS_BUF + 4];
    char pat[80];
    if (!topics || !topic || !*topic) return 0;
    snprintf(hay, sizeof hay, ",%s,", topics);
    snprintf(pat, sizeof pat, ",%s,", topic);
    return strstr(hay, pat) != NULL;
}
