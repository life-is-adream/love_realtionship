/* brake.c — 需求 4：关键时刻的刹车
 *
 * 这个模块的全部价值在于「没有后门」。
 * 一旦提供 --force，它立刻退化成一句建议；而有后门的建议，
 * 在凌晨两点是不会被采纳的。
 *
 * 冷静期按时长由情绪强度决定，不是用户自选——
 * 因为此刻的用户，正是最不适合决定「要不要等」的那个人。
 */
#define _POSIX_C_SOURCE 200809L

#include "hf.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define BRAKE_MAX 256

typedef struct {
    int64_t id;
    int64_t created;
    int64_t unlock;
    int     intensity;
    char    text[HF_MAX_TEXT];
} HfBrake;

static int load(HfBrake *arr, int max)
{
    char path[1024];
    char *buf;
    size_t len = 0;
    char *p;
    int n = 0;

    hf_data_path("brake.log", path, sizeof path);
    buf = hf_read_file(path, &len);
    if (!buf) return 0;

    p = buf;
    while (*p && n < max) {
        char *nl = strchr(p, '\n');
        char *f[5];
        int nf = 0;
        char *q;
        if (nl) *nl = '\0';
        {
            size_t l = strlen(p);
            if (l > 0 && p[l - 1] == '\r') p[l - 1] = '\0';
        }
        if (*p) {
            f[0] = p; nf = 1;
            for (q = p; *q && nf < 5; q++) {
                if (*q == '|') { *q = '\0'; f[nf++] = q + 1; }
            }
            if (nf >= 5) {
                memset(&arr[n], 0, sizeof arr[n]);
                arr[n].id = (int64_t)strtoll(f[0], NULL, 10);
                arr[n].created = (int64_t)strtoll(f[1], NULL, 10);
                arr[n].unlock = (int64_t)strtoll(f[2], NULL, 10);
                arr[n].intensity = atoi(f[3]);
                hf_unescape(f[4], arr[n].text, sizeof arr[n].text);
                n++;
            }
        }
        if (!nl) break;
        p = nl + 1;
    }
    free(buf);
    return n;
}

static int save(const HfBrake *arr, int n)
{
    char path[1024], tmp[1100];
    FILE *f;
    int i;

    hf_data_path("brake.log", path, sizeof path);
    snprintf(tmp, sizeof tmp, "%s.tmp", path);

    f = fopen(tmp, "wb");
    if (!f) return -1;
    for (i = 0; i < n; i++) {
        char etxt[HF_MAX_TEXT * 2];
        hf_escape(arr[i].text, etxt, sizeof etxt);
        fprintf(f, "%lld|%lld|%lld|%d|%s\n",
                (long long)arr[i].id, (long long)arr[i].created,
                (long long)arr[i].unlock, arr[i].intensity, etxt);
    }
    fclose(f);
    remove(path);
    return rename(tmp, path) == 0 ? 0 : -1;
}

/* 没有情绪词时，用语气特征估一个下限。
 * 这条路径存在的理由很简单：「你现在到底什么意思？」里一个情绪词都没有，
 * 但没有人会在平静的时候打出这句话。纯词典法在这里必然失明。 */
static int urgency(const char *text)
{
    static const char *HARD[] = {
        "什么意思", "到底", "直说", "算了", "随便", "呵呵",
        "无所谓", "你自己", "不想谈", "爱怎样", NULL
    };
    int score = 32, i;
    const char *p;

    for (p = text; *p; p++) if (*p == '?') score += 6;
    p = text;
    while ((p = strstr(p, "？")) != NULL) { score += 6; p += 3; }
    for (p = text; *p; p++) if (*p == '!') score += 8;
    p = text;
    while ((p = strstr(p, "！")) != NULL) { score += 8; p += 3; }

    for (i = 0; HARD[i]; i++)
        if (strstr(text, HARD[i])) score += 12;

    if (hf_utf8_count(text) <= 15) score += 5;
    if (score > 95) score = 95;
    return score;
}

int hf_brake_wait_minutes(int intensity)
{
    if (intensity >= 80) return 90;
    if (intensity >= 60) return 45;
    if (intensity >= 40) return 20;
    return 10;
}

int hf_brake_add(const char *text, int intensity)
{
    HfBrake arr[BRAKE_MAX];
    int n, i;
    int64_t maxid = 0;
    int wait;
    char tbuf[32];

    if (!text || !*text) {
        fprintf(stderr, "hf: 没有内容可扣。\n");
        return -1;
    }

    n = load(arr, BRAKE_MAX);
    for (i = 0; i < n; i++)
        if (arr[i].id > maxid) maxid = arr[i].id;

    if (intensity <= 0) {
        HfAffect a;
        hf_affect(text, &a);
        intensity = a.intensity;
        if (intensity < 40) intensity = urgency(text);
    }
    wait = hf_brake_wait_minutes(intensity);

    if (n >= BRAKE_MAX) {
        fprintf(stderr, "hf: 待发队列已满，先处理旧的。\n");
        return -1;
    }

    memset(&arr[n], 0, sizeof arr[n]);
    arr[n].id = maxid + 1;
    arr[n].created = hf_now();
    arr[n].unlock = arr[n].created + (int64_t)wait * 60;
    arr[n].intensity = intensity;
    snprintf(arr[n].text, sizeof arr[n].text, "%s", text);

    if (save(arr, n + 1) != 0) {
        fprintf(stderr, "hf: 写入失败。\n");
        return -1;
    }

    hf_strftime(arr[n].unlock, "%H:%M", tbuf, sizeof tbuf);
    printf("\n已扣下 #%lld。强度 %d → 冷静期 %d 分钟（%s 解锁）。\n",
           (long long)arr[n].id, intensity, wait, tbuf);
    printf("它不会自动发送——这个程序不接管任何聊天工具。\n");
    printf("到点后你自己决定要不要发。\n");
    return 0;
}

int hf_brake_list(FILE *out)
{
    HfBrake arr[BRAKE_MAX];
    int n = load(arr, BRAKE_MAX);
    int i;
    int64_t now = hf_now();
    char cbuf[32], ubuf[32];

    fprintf(out, "\n【待发 · %d 条】\n", n);
    if (n == 0) {
        fprintf(out, "  队列是空的。\n");
        return 0;
    }

    for (i = 0; i < n; i++) {
        int64_t left = arr[i].unlock - now;
        hf_strftime(arr[i].created, "%m-%d %H:%M", cbuf, sizeof cbuf);
        hf_strftime(arr[i].unlock, "%H:%M", ubuf, sizeof ubuf);

        fprintf(out, "\n  #%lld  写下 %s  强度 %d\n",
                (long long)arr[i].id, cbuf, arr[i].intensity);
        fprintf(out, "      \"%s\"\n",
                hf_utf8_count(arr[i].text) > 48 ? "(内容较长，略)" : arr[i].text);
        if (left > 0)
            fprintf(out, "      还差 %lld 分钟（%s 解锁）\n",
                    (long long)((left + 59) / 60), ubuf);
        else
            fprintf(out, "      已到时间，可以 hf brake send %lld\n", (long long)arr[i].id);
    }
    return 0;
}

int hf_brake_send(int64_t id, int confirmed, FILE *out)
{
    HfBrake arr[BRAKE_MAX];
    int n = load(arr, BRAKE_MAX);
    int i, idx = -1;
    int64_t now = hf_now();
    char ubuf[32];

    for (i = 0; i < n; i++)
        if (arr[i].id == id) { idx = i; break; }

    if (idx < 0) {
        fprintf(out, "没有 #%lld 这条。用 hf brake list 看队列。\n", (long long)id);
        return -1;
    }

    if (now < arr[idx].unlock) {
        int64_t left = arr[idx].unlock - now;
        hf_strftime(arr[idx].unlock, "%H:%M", ubuf, sizeof ubuf);
        fprintf(out, "\n还差 %lld 分钟。%s 才能发。\n",
                (long long)((left + 59) / 60), ubuf);
        fprintf(out, "\n这期间能做的事：\n");
        fprintf(out, "    hf brake drop %lld        撤回，当作没写过\n", (long long)id);
        fprintf(out, "    hf reflect \"...\"         把想说的话重看一遍\n");
        fprintf(out, "\n这个程序没有强制发送的参数。这是故意的。\n");
        return 1;
    }

    if (!confirmed) {
        fprintf(out, "\n#%lld 已经到时间了。\n", (long long)id);
        fprintf(out, "  仍要发，加 --yes：hf brake send %lld --yes\n", (long long)id);
        fprintf(out, "  不想发：hf brake drop %lld\n", (long long)id);
        return 2;
    }

    /* 放行：从队列移除，记一条 journal 事件 */
    {
        HfEntry e;
        memset(&e, 0, sizeof e);
        e.kind = 'b';
        e.intensity = arr[idx].intensity;
        snprintf(e.text, sizeof e.text, "[放行] %s", arr[idx].text);
        snprintf(e.mood, sizeof e.mood, "未定");
        hf_keywords(arr[idx].text, e.topics, sizeof e.topics);
        snprintf(e.note, sizeof e.note, "发出");
        hf_store_append(&e);
    }

    for (i = idx; i < n - 1; i++) arr[i] = arr[i + 1];
    save(arr, n - 1);

    fprintf(out, "\n已放行 #%lld。\n", (long long)id);
    fprintf(out, "发出去之后的结果，比这条消息本身更值得记下来：\n");
    fprintf(out, "    hf add e \"发出去之后发生了什么\" --note 说清\n");
    return 0;
}

int hf_brake_drop(int64_t id, FILE *out)
{
    HfBrake arr[BRAKE_MAX];
    int n = load(arr, BRAKE_MAX);
    int i, idx = -1;

    for (i = 0; i < n; i++)
        if (arr[i].id == id) { idx = i; break; }

    if (idx < 0) {
        fprintf(out, "没有 #%lld 这条。\n", (long long)id);
        return -1;
    }

    for (i = idx; i < n - 1; i++) arr[i] = arr[i + 1];
    save(arr, n - 1);

    fprintf(out, "\n已撤回 #%lld。\n", (long long)id);
    fprintf(out, "多数时候，没发出去的那条才是你想说的。\n");
    fprintf(out, "如果它还在，明天用 hf reflect 把它说清楚。\n");
    return 0;
}
