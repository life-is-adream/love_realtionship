/* store.c — 追加式纯文本存储
 *
 * 格式（每行一条，字段用 | 分隔，text 内的特殊字符做转义）：
 *   id|ts|kind|mood|intensity|topics|note|text
 *
 * 为什么不用 SQLite：这个产品的第一卖点是「数据是你的」。
 * 一个能被记事本打开、能被 grep、能整份拷走的文件，
 * 比任何加密数据库都更能兑现这句话。
 */
#define _POSIX_C_SOURCE 200809L

#include "hf.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#  include <windows.h>
#endif

static char g_home[512];

const char *hf_home(void)
{
    const char *e;
    if (g_home[0]) return g_home;

    e = getenv("HF_HOME");
    if (e && *e) {
        snprintf(g_home, sizeof g_home, "%s", e);
    } else {
        const char *h = getenv("USERPROFILE");
        if (!h || !*h) h = getenv("HOME");
        if (!h || !*h) h = ".";
        snprintf(g_home, sizeof g_home, "%s/.heartflow", h);
    }
    hf_mkdir_p(g_home);
    return g_home;
}

void hf_data_path(const char *name, char *out, size_t n)
{
    snprintf(out, n, "%s/%s", hf_home(), name);
}

void hf_escape(const char *in, char *out, size_t n)
{
    size_t u = 0;
    const char *p = in ? in : "";
    while (*p && u + 2 < n) {
        switch (*p) {
        case '\\': out[u++] = '\\'; out[u++] = '\\'; break;
        case '\n': out[u++] = '\\'; out[u++] = 'n';  break;
        case '\r': out[u++] = '\\'; out[u++] = 'r';  break;
        case '\t': out[u++] = '\\'; out[u++] = 't';  break;
        case '|':  out[u++] = '\\'; out[u++] = 'p';  break;
        default:   out[u++] = *p; break;
        }
        p++;
    }
    out[u] = '\0';
}

void hf_unescape(const char *in, char *out, size_t n)
{
    size_t u = 0;
    const char *p = in ? in : "";
    while (*p && u + 1 < n) {
        if (*p == '\\' && p[1]) {
            p++;
            switch (*p) {
            case 'n': out[u++] = '\n'; break;
            case 'r': out[u++] = '\r'; break;
            case 't': out[u++] = '\t'; break;
            case 'p': out[u++] = '|';  break;
            case '\\': out[u++] = '\\'; break;
            default: out[u++] = *p; break;
            }
        } else {
            out[u++] = *p;
        }
        p++;
    }
    out[u] = '\0';
}

static int split_fields(char *line, char *f[], int max)
{
    int n = 1;
    char *p = line;
    f[0] = p;
    while (*p && n < max) {
        if (*p == '|') { *p = '\0'; f[n++] = p + 1; }
        p++;
    }
    return n;
}

static int parse_line(char *line, HfEntry *e)
{
    char *f[8];
    int nf;
    char tmp[HF_MAX_TEXT];

    nf = split_fields(line, f, 8);
    if (nf < 8) return 0;

    memset(e, 0, sizeof *e);
    e->id = (int64_t)strtoll(f[0], NULL, 10);
    e->ts = (int64_t)strtoll(f[1], NULL, 10);
    e->kind = f[2][0] ? f[2][0] : 'e';

    hf_unescape(f[3], tmp, sizeof tmp);
    snprintf(e->mood, sizeof e->mood, "%s", tmp);
    e->intensity = atoi(f[4]);
    hf_unescape(f[5], tmp, sizeof tmp);
    snprintf(e->topics, sizeof e->topics, "%s", tmp);
    hf_unescape(f[6], tmp, sizeof tmp);
    snprintf(e->note, sizeof e->note, "%s", tmp);
    hf_unescape(f[7], e->text, sizeof e->text);
    return 1;
}

int hf_store_load(HfEntry **out)
{
    char path[1024];
    char *buf;
    size_t len = 0;
    HfEntry *arr;
    int cap = 128, n = 0;
    char *p;

    *out = NULL;
    hf_data_path("journal.log", path, sizeof path);
    buf = hf_read_file(path, &len);
    if (!buf) return 0;

    arr = (HfEntry *)hf_xmalloc((size_t)cap * sizeof(HfEntry));
    p = buf;
    while (*p) {
        char *nl = strchr(p, '\n');
        if (nl) *nl = '\0';
        {
            size_t l = strlen(p);
            if (l > 0 && p[l - 1] == '\r') p[l - 1] = '\0';
        }
        if (*p) {
            if (n >= cap) {
                cap *= 2;
                arr = (HfEntry *)hf_xrealloc(arr, (size_t)cap * sizeof(HfEntry));
            }
            if (parse_line(p, &arr[n])) n++;
        }
        if (!nl) break;
        p = nl + 1;
    }
    free(buf);
    *out = arr;
    return n;
}

int hf_store_append(HfEntry *e)
{
    char path[1024];
    char line[HF_MAX_TEXT + 1024];
    char etxt[HF_MAX_TEXT * 2];
    char emood[128], etopics[HF_TOPICS_BUF * 2], enote[128];
    HfEntry *hist = NULL;
    int n, i;
    int64_t maxid = 0;

    hf_data_path("journal.log", path, sizeof path);

    n = hf_store_load(&hist);
    for (i = 0; i < n; i++)
        if (hist[i].id > maxid) maxid = hist[i].id;
    free(hist);

    if (e->id <= 0) e->id = maxid + 1;
    if (e->ts <= 0) e->ts = hf_now();
    if (!e->kind) e->kind = 'e';

    hf_escape(e->text, etxt, sizeof etxt);
    hf_escape(e->mood, emood, sizeof emood);
    hf_escape(e->topics, etopics, sizeof etopics);
    hf_escape(e->note, enote, sizeof enote);

    snprintf(line, sizeof line, "%lld|%lld|%c|%s|%d|%s|%s|%s",
             (long long)e->id, (long long)e->ts, e->kind,
             emood, e->intensity, etopics, enote, etxt);

    if (hf_append_line(path, line) != 0)
        return -1;
    return 0;
}

int hf_store_rewrite(const HfEntry *arr, int n)
{
    char path[1024], tmp[1100];
    FILE *f;
    int i;

    hf_data_path("journal.log", path, sizeof path);
    snprintf(tmp, sizeof tmp, "%s.tmp", path);

    f = fopen(tmp, "wb");
    if (!f) return -1;

    for (i = 0; i < n; i++) {
        char etxt[HF_MAX_TEXT * 2], emood[128], etopics[HF_TOPICS_BUF * 2], enote[128];
        hf_escape(arr[i].text, etxt, sizeof etxt);
        hf_escape(arr[i].mood, emood, sizeof emood);
        hf_escape(arr[i].topics, etopics, sizeof etopics);
        hf_escape(arr[i].note, enote, sizeof enote);
        fprintf(f, "%lld|%lld|%c|%s|%d|%s|%s|%s\n",
                (long long)arr[i].id, (long long)arr[i].ts, arr[i].kind,
                emood, arr[i].intensity, etopics, enote, etxt);
    }
    fclose(f);

    remove(path);
    if (rename(tmp, path) != 0) return -1;
    return 0;
}
