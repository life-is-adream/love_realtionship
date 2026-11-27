/* affect.c — 中文情感识别（词典 + 修饰/否定作用域）
 *
 * 这是整个引擎最容易被攻击的部分，所以先说明它的边界：
 *   它做的是「情绪词探测」，不是语义理解。它会把"我不生气"判成生气。
 *   因此所有下游输出都必须带上命中的词（evidence），让用户自己判断对不对——
 *   产品的可信度来自「可反驳」，不是来自「准确」。
 */
#define _POSIX_C_SOURCE 200809L

#include "hf.h"

#include <stdlib.h>
#include <string.h>

typedef struct { const char *w; int pol; int inten; } HfWord;

static const HfWord WORDS[] = {
    /* 负向 */
    {"委屈",-1,78},{"憋屈",-1,74},{"难受",-1,70},{"难过",-1,72},{"伤心",-1,76},
    {"心痛",-1,82},{"心碎",-1,88},{"崩溃",-1,90},{"绝望",-1,92},{"无力",-1,72},
    {"疲惫",-1,66},{"心累",-1,74},{"好累",-1,62},{"太累",-1,64},{"累死",-1,72},
    {"生气",-1,70},{"愤怒",-1,84},{"火大",-1,78},{"恼火",-1,72},{"烦躁",-1,62},
    {"焦虑",-1,70},{"慌张",-1,66},{"害怕",-1,76},{"恐惧",-1,82},{"担心",-1,52},
    {"不安",-1,66},{"孤独",-1,76},{"寂寞",-1,68},{"失落",-1,66},{"失望",-1,74},
    {"寒心",-1,78},{"心凉",-1,76},{"内疚",-1,70},{"自责",-1,72},{"愧疚",-1,68},
    {"后悔",-1,58},{"羞耻",-1,80},{"丢脸",-1,70},{"嫉妒",-1,62},{"吃醋",-1,56},
    {"不甘",-1,64},{"压抑",-1,72},{"窒息",-1,80},{"麻木",-1,66},{"空虚",-1,70},
    {"想哭",-1,76},{"哭了",-1,66},{"冷战",-1,70},{"敷衍",-1,72},{"冷漠",-1,74},
    {"冷淡",-1,62},{"疏远",-1,66},{"忽视",-1,76},{"冷落",-1,74},{"被丢下",-1,88},
    {"不重要",-1,78},{"不值得",-1,82},{"没底",-1,60},{"忐忑",-1,58},{"纠结",-1,54},
    {"内耗",-1,70},{"撑不住",-1,80},{"受不了",-1,78},{"不公平",-1,70},{"凭什么",-1,68},{"卑微",-1,75},{"在乎",1,60},
    /* 正向 */
    {"开心",1,62},{"高兴",1,60},{"轻松",1,56},{"踏实",1,66},{"安心",1,68},
    {"温暖",1,66},{"被理解",1,80},{"被看见",1,78},{"被接住",1,80},{"喜欢",1,56},
    {"感激",1,60},{"感动",1,66},{"放心",1,56},{"舒展",1,60},{"安全",1,66},
    {"亲密",1,68},{"幸福",1,76},{"满足",1,60},{"平静",1,52},{"有底",1,62},
    {NULL,0,0}
};

static const char *MODIFIERS[] = { "很","太","特别","超级","非常","极其","真","好","巨","超", NULL };
static const char *NEGATORS[]  = { "不","没","别","无", NULL };

/* 向前提取一个 UTF-8 字符（最多 4 字节） */
static int prev_char(const char *base, const char *pos, char *out, size_t outsz)
{
    const char *p;
    int len;

    if (pos <= base) return 0;
    p = pos - 1;
    while (p > base && ((unsigned char)*p & 0xC0) == 0x80) p--;
    len = (int)(pos - p);
    if (len <= 0 || len > 4 || (size_t)len + 1 > outsz) return 0;
    memcpy(out, p, (size_t)len);
    out[len] = '\0';
    return len;
}

static int in_words(const char *s, const char **list)
{
    int k;
    for (k = 0; list[k]; k++)
        if (strcmp(s, list[k]) == 0) return 1;
    return 0;
}

static int has_negator_before(const char *base, const char *pos)
{
    const char *cur = pos;
    char c[8];
    int i;
    for (i = 0; i < 2; i++) {           /* 向前看两个字符："并不"这类组合 */
        if (!prev_char(base, cur, c, sizeof c)) return 0;
        if (in_words(c, NEGATORS)) return 1;
        cur -= strlen(c);
    }
    return 0;
}

static int modifier_bonus(const char *base, const char *pos)
{
    char c1[8], c0[8], c2[16];
    const char *p2;

    if (!prev_char(base, pos, c1, sizeof c1)) return 0;
    if (in_words(c1, MODIFIERS)) return 10;

    /* 双字修饰：「特别」「非常」这类，单看前一个字会漏掉 */
    p2 = pos - strlen(c1);
    if (prev_char(base, p2, c0, sizeof c0)) {
        snprintf(c2, sizeof c2, "%s%s", c0, c1);
        if (in_words(c2, MODIFIERS)) return 10;
    }
    return 0;
}

static int count_occ(const char *text, const char *w)
{
    const char *p = text;
    int n = 0;
    size_t wl = strlen(w);
    while ((p = strstr(p, w)) != NULL) {
        n++;
        p += wl;
    }
    return n;
}

void hf_affect(const char *text, HfAffect *out)
{
    int i;
    int best = -1, best_idx = -1;
    int second = -1, second_idx = -1;
    int neg_max = 0, pos_max = 0, hits = 0;
    int neg_cnt = 0, pos_cnt = 0;
    size_t ev_used = 0;
    int excl = 0;

    memset(out, 0, sizeof *out);
    if (!text || !*text) return;

    for (i = 0; WORDS[i].w; i++) {
        int cnt = count_occ(text, WORDS[i].w);
        int sc, pol;
        const char *p;
        if (cnt == 0) continue;

        hits += cnt;
        p = strstr(text, WORDS[i].w);
        sc = WORDS[i].inten + modifier_bonus(text, p) - (cnt - 1) * 1;
        if (sc > 100) sc = 100;
        if (sc < 5) sc = 5;
        pol = WORDS[i].pol;
        if (has_negator_before(text, p)) {
            pol = -pol;
            sc -= 10;
            if (sc < 5) sc = 5;
        }

        if (pol < 0) { neg_cnt += cnt; if (sc > neg_max) neg_max = sc; }
        else         { pos_cnt += cnt; if (sc > pos_max) pos_max = sc; }

        if (sc > best) {
            second = best; second_idx = best_idx;
            best = sc; best_idx = i;
        } else if (sc > second) {
            second = sc; second_idx = i;
        }

        /* 记录证据词（最多 4 个） */
        if (ev_used + strlen(WORDS[i].w) + 2 < sizeof out->evidence) {
            if (ev_used) out->evidence[ev_used++] = ',';
            memcpy(out->evidence + ev_used, WORDS[i].w, strlen(WORDS[i].w));
            ev_used += strlen(WORDS[i].w);
            out->evidence[ev_used] = '\0';
        }
    }

    out->hits = hits;
    if (best_idx >= 0) snprintf(out->primary, sizeof out->primary, "%s", WORDS[best_idx].w);
    if (second_idx >= 0) snprintf(out->secondary, sizeof out->secondary, "%s", WORDS[second_idx].w);

    /* 强度：主导情绪分 + 词密度（每多一个负向词 +3，上限 +15） */
    out->intensity = (best >= 0) ? best : 0;
    if (neg_cnt > 1) out->intensity += (neg_cnt - 1) * 3 > 15 ? 15 : (neg_cnt - 1) * 3;

    /* 感叹号是廉价但有效的强度信号 */
    {
        const char *p = text;
        while ((p = strstr(p, "！")) != NULL) { excl++; p += 3; }
        p = text;
        while ((p = strchr(p, '!')) != NULL) { excl++; p++; }
    }
    if (excl >= 2) out->intensity += 5;
    if (out->intensity > 100) out->intensity = 100;

    if (neg_cnt > pos_cnt) out->polarity = -1;
    else if (pos_cnt > neg_cnt) out->polarity = 1;
    else out->polarity = 0;
}
