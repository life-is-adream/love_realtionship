/* memory.c — 需求 3：记得住历史
 *
 * 单次对话谁都能做，纵向模式识别只有长期产品能做。
 * 这里输出的不是「建议」，而是三件用户自己很难算出来的事实：
 *   这是第几次 / 上次怎么处理的 / 结果如何。
 *
 * 一条额外的克制：如果主题只出现过一次，就什么都不说。
 * 把「第一次」说成「模式」，是这个品类最常见的欺骗。
 */
#define _POSIX_C_SOURCE 200809L

#include "hf.h"

#include <string.h>

#define NOTE_MAX 8
typedef struct { char name[32]; int cnt; } NoteStat;

static void note_add(NoteStat *ns, int *n, const char *name)
{
    int i;
    if (!name || !*name) return;
    for (i = 0; i < *n; i++) {
        if (strcmp(ns[i].name, name) == 0) { ns[i].cnt++; return; }
    }
    if (*n >= NOTE_MAX) return;
    snprintf(ns[*n].name, sizeof ns[*n].name, "%s", name);
    ns[*n].cnt = 1;
    (*n)++;
}

void hf_memory(const char *text, const char *topics,
               const HfEntry *hist, int n, FILE *out)
{
    char shared[64];
    int i;
    int hits = 0;
    int64_t first_ts = 0, last_ts = 0;
    int sum_inten = 0;
    NoteStat ns[NOTE_MAX];
    int nns = 0;
    const HfEntry *last = NULL;
    int topic_hits[64];
    int ntopics = 0;

    (void)text;
    fprintf(out, "\n【3 · 这条你走过】\n");

    if (!topics || !*topics) {
        fprintf(out, "  这段文本没提取出稳定的主题，暂时无法和历史比对。\n");
        return;
    }

    /* 逐条比对主题交集 */
    for (i = 0; i < n; i++) {
        if (!hf_topic_overlap(topics, hist[i].topics, shared, sizeof shared))
            continue;
        hits++;
        sum_inten += hist[i].intensity;
        if (!first_ts || hist[i].ts < first_ts) first_ts = hist[i].ts;
        if (hist[i].ts > last_ts) { last_ts = hist[i].ts; last = &hist[i]; }
        note_add(ns, &nns, hist[i].note);
        if (ntopics < 64) topic_hits[ntopics++] = i;
    }

    if (hits == 0) {
        char top[64];
        hf_top_topic(topics, top, sizeof top);
        fprintf(out, "  主题「%s」是第一次出现，没有历史可比。\n", top);
        fprintf(out, "  第一次就先记下来，不用急着解释它。\n");
        return;
    }

    if (hits == 1) {
        fprintf(out, "  这个主题之前出现过 1 次，还构不成模式。\n");
        fprintf(out, "  两次相同的难受，可能是巧合；三次才值得当成结构来看。\n");
    } else {
        char top[64];
        int days = (int)((last_ts - first_ts) / 86400);
        hf_top_topic(topics, top, sizeof top);

        fprintf(out, "  「%s」这个主题，在 %d 天的跨度里出现过 %d 次。\n", top, days, hits);
        fprintf(out, "  平均强度 %d。\n", sum_inten / hits);

        if (nns > 0) {
            int k;
            fprintf(out, "  你的处置分布：");
            for (k = 0; k < nns; k++)
                fprintf(out, "%s%s %d", k ? " · " : "", ns[k].name, ns[k].cnt);
            fprintf(out, "\n");

            /* 只指出一次，不说教 */
            for (k = 0; k < nns; k++) {
                if ((strcmp(ns[k].name, "忍") == 0 || strcmp(ns[k].name, "逃") == 0) &&
                    ns[k].cnt >= 2) {
                    fprintf(out, "  「%s」出现了 %d 次。同一种处置重复两次以上，\n",
                            ns[k].name, ns[k].cnt);
                    fprintf(out, "  通常不是性格问题，是这条路当时是唯一走得通的。\n");
                    break;
                }
            }
        }
    }

    if (last) {
        int64_t gap_days = (hf_now() - last->ts) / 86400;
        fprintf(out, "  最近一次：%lld 天前，强度 %d，处置「%s」。\n",
                (long long)gap_days, last->intensity,
                last->note[0] ? last->note : "未记录");
        if (last->note[0] && strcmp(last->note, "未定") == 0)
            fprintf(out, "  那一次你没有决定怎么处理——它可能还在。\n");
    }

    fprintf(out, "\n  以上是事实，不是评价。怎么用由你决定。\n");
}
