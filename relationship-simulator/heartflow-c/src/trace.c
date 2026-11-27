/* trace.c — 需求 5：看得见自己变了的证据
 *
 * 这是唯一能对抗「我没变、我永远这样」这种绝望感的东西。
 * 它必须是算出来的，不能是鼓励出来的——
 * 一句「你已经进步了」没有重量，一条从 67% 降到 20% 的曲线有。
 *
 * 同时，如果数据不支持改善，这里也照实说。
 * 一个只在好消息时说话的系统，用户第三次就会不信它。
 */
#define _POSIX_C_SOURCE 200809L

#include "hf.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAXW 64
#define WEEK_SEC (7 * 86400)

typedef struct {
    int  count;
    int  sum_inten;
    int  ren, tao, shuo, wen, qita;
    char top[64];
    int  top_cnt;
} Week;

static void topic_bump(Week *w, const char *t)
{
    if (!t || !*t) return;
    if (w->top_cnt > 0 && strcmp(w->top, t) == 0) { w->top_cnt++; return; }
    if (w->top_cnt == 0) {
        snprintf(w->top, sizeof w->top, "%s", t);
        w->top_cnt = 1;
    }
    /* 只保留首个主题的计数：周表需要的是「这周的主题」，不是完整分布 */
}

static void note_class(Week *w, const char *note)
{
    if (!note || !*note) { w->qita++; return; }
    if (strcmp(note, "忍") == 0)        w->ren++;
    else if (strcmp(note, "逃") == 0)   w->tao++;
    else if (strcmp(note, "说清") == 0) w->shuo++;
    else if (strcmp(note, "问") == 0)   w->wen++;
    else                                 w->qita++;
}

typedef struct {
    int count;
    int sum_inten;
    int avg_inten;
    int avoid;      /* 忍 + 逃 */
    int clear;      /* 说清 */
    int weeks;
} Agg;

static Agg aggregate(const Week *wk, int from, int to)
{
    Agg a;
    int i;
    memset(&a, 0, sizeof a);
    for (i = from; i <= to; i++) {
        a.count += wk[i].count;
        a.sum_inten += wk[i].sum_inten;
        a.avoid += wk[i].ren + wk[i].tao;
        a.clear += wk[i].shuo;
        a.weeks++;
    }
    a.avg_inten = a.count ? a.sum_inten / a.count : 0;
    return a;
}

static void merge_notes(const Week *wk, int from, int to, char *out, size_t n)
{
    int i, ren = 0, tao = 0, shuo = 0, wen = 0, qita = 0;
    size_t used = 0;
    out[0] = '\0';
    for (i = from; i <= to; i++) {
        ren += wk[i].ren; tao += wk[i].tao; shuo += wk[i].shuo;
        wen += wk[i].wen; qita += wk[i].qita;
    }
    if (ren)  used += (size_t)snprintf(out + used, n - used, "忍%d ", ren);
    if (shuo) used += (size_t)snprintf(out + used, n - used, "说清%d ", shuo);
    if (wen)  used += (size_t)snprintf(out + used, n - used, "问%d ", wen);
    if (tao)  used += (size_t)snprintf(out + used, n - used, "逃%d ", tao);
    if (qita && used < n - 1) snprintf(out + used, n - used, "其他%d", qita);
}

void hf_trace(int weeks, const HfEntry *hist, int n, FILE *out)
{
    Week wk[MAXW];
    int i, w;
    int64_t now = hf_now();
    int total = 0;
    char buf[128], pad[160];

    if (weeks < 2) weeks = 2;
    if (weeks > MAXW) weeks = MAXW;

    memset(wk, 0, sizeof wk);

    for (i = 0; i < n; i++) {
        int64_t age = now - hist[i].ts;
        if (age < 0) age = 0;
        w = (int)(age / WEEK_SEC);
        if (w >= weeks) continue;
        wk[w].count++;
        wk[w].sum_inten += hist[i].intensity;
        note_class(&wk[w], hist[i].note);
        {
            char top[64];
            hf_top_topic(hist[i].topics, top, sizeof top);
            topic_bump(&wk[w], top);
        }
        total++;
    }

    fprintf(out, "\n【5 · 你变了没有】\n");

    if (total == 0) {
        fprintf(out, "  最近 %d 周没有记录，算不出变化。\n", weeks);
        fprintf(out, "  从今天开始记，四周后回来看这一页。\n");
        return;
    }
    if (total < 3) {
        fprintf(out, "  最近 %d 周只有 %d 条记录，还不足以看出趋势。\n", weeks, total);
        fprintf(out, "  至少要 3 条、跨 3 周，数字才有意义。\n");
        return;
    }

    fprintf(out, "\n  周起      事件  强度  主主题          处置\n");
    for (w = weeks - 1; w >= 0; w--) {
        char label[32];
        int64_t start = now - (int64_t)(w + 1) * WEEK_SEC;
        char note_s[96];
        hf_strftime(start, "%m-%d", label, sizeof label);
        if (wk[w].count == 0) {
            hf_pad(label, 9, pad, sizeof pad);
            fprintf(out, "  %s -     -     -               -\n", pad);
            continue;
        }
        merge_notes(wk, w, w, note_s, sizeof note_s);
        hf_pad(label, 9, pad, sizeof pad);
        fprintf(out, "  %s ", pad);
        hf_pad("", 0, buf, sizeof buf);
        {
            char c1[16], c2[32], c3[80];
            snprintf(c1, sizeof c1, "%d", wk[w].count);
            snprintf(c2, sizeof c2, "%d", wk[w].sum_inten / wk[w].count);
            snprintf(c3, sizeof c3, "%s", wk[w].top_cnt ? wk[w].top : "-");
            hf_pad(c1, 5, buf, sizeof buf); fprintf(out, "%s ", buf);
            hf_pad(c2, 5, buf, sizeof buf); fprintf(out, "%s ", buf);
            hf_pad(c3, 16, buf, sizeof buf); fprintf(out, "%s ", buf);
        }
        fprintf(out, "%s\n", note_s);
    }

    /* 前后两半对比 */
    {
        int half = weeks / 2;
        int early_from = half, early_to = weeks - 1;
        int late_from = 0, late_to = half - 1;
        Agg e = aggregate(wk, early_from, early_to);
        Agg l = aggregate(wk, late_from, late_to);
        char e_label[32], l_label[32];

        hf_strftime(now - (int64_t)weeks * WEEK_SEC, "%m-%d", e_label, sizeof e_label);
        hf_strftime(now - (int64_t)half * WEEK_SEC, "%m-%d", l_label, sizeof l_label);

        fprintf(out, "\n  对比：%d 周前 → 最近 %d 周\n", weeks, half);

        if (e.count == 0 || l.count == 0) {
            fprintf(out, "  两边的记录数不足，暂时不能对比。\n");
            return;
        }

        fprintf(out, "    平均强度    %d → %d    %+d\n",
                e.avg_inten, l.avg_inten, l.avg_inten - e.avg_inten);

        {
            int ea = e.count ? e.avoid * 100 / e.count : 0;
            int la = l.count ? l.avoid * 100 / l.count : 0;
            int ec = e.count ? e.clear * 100 / e.count : 0;
            int lc = l.count ? l.clear * 100 / l.count : 0;
            fprintf(out, "    回避率      %d%% → %d%%    %+dpp\n", ea, la, la - ea);
            fprintf(out, "    说清率      %d%% → %d%%    %+dpp\n", ec, lc, lc - ec);

            fprintf(out, "\n  结论：");
            if (la < ea - 10 || l.avg_inten < e.avg_inten - 5) {
                fprintf(out, "同一类事，你的处理方式变了。\n");
                fprintf(out, "        这不是感觉，是 %d 条记录算出来的。\n", total);
            } else if (la > ea + 10 || l.avg_inten > e.avg_inten + 8) {
                fprintf(out, "这段时间更紧了，回避和强度都在上升。\n");
                fprintf(out, "        这不说明你没努力，可能只是这段时间本来就难。\n");
            } else {
                fprintf(out, "变化不明显（±%dpp 以内）。\n",
                        (la > ea ? la - ea : ea - la));
                fprintf(out, "        稳定也是一种结果，不必强行读出进步。\n");
            }
        }
    }
}
