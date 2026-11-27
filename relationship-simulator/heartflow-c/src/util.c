/* util.c — 分配、时间、路径、文件读写 */
#define _POSIX_C_SOURCE 200809L

#include "hf.h"

#include <errno.h>
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>

#ifdef _WIN32
#  include <direct.h>
#  include <io.h>
#  define HF_MKDIR(p) _mkdir(p)
#else
#  include <unistd.h>
#  define HF_MKDIR(p) mkdir((p), 0755)
#endif

void *hf_xmalloc(size_t n)
{
    void *p = malloc(n ? n : 1);
    if (!p) hf_die("内存不足：请求 %lu 字节", (unsigned long)n);
    return p;
}

void *hf_xrealloc(void *p, size_t n)
{
    void *q = realloc(p, n ? n : 1);
    if (!q) hf_die("内存不足：扩展至 %lu 字节", (unsigned long)n);
    return q;
}

char *hf_xstrdup(const char *s)
{
    size_t n;
    char *p;
    if (!s) s = "";
    n = strlen(s) + 1;
    p = (char *)hf_xmalloc(n);
    memcpy(p, s, n);
    return p;
}

void hf_die(const char *fmt, ...)
{
    va_list ap;
    fflush(stdout);
    fputs("hf: ", stderr);
    va_start(ap, fmt);
    vfprintf(stderr, fmt, ap);
    va_end(ap);
    fputc('\n', stderr);
    exit(1);
}

int64_t hf_now(void)
{
    return (int64_t)time(NULL);
}

void hf_localtime(int64_t ts, struct tm *tm_out)
{
    time_t t = (time_t)ts;
#ifdef _WIN32
    localtime_s(tm_out, &t);
#else
    localtime_r(&t, tm_out);
#endif
}

void hf_strftime(int64_t ts, const char *fmt, char *out, size_t n)
{
    struct tm tm;
    hf_localtime(ts, &tm);
    strftime(out, n, fmt, &tm);
}

void hf_mkdir_p(const char *path)
{
    char buf[1024];
    size_t i, len;

    if (!path || !*path) return;
    len = strlen(path);
    if (len >= sizeof buf) hf_die("路径过长：%s", path);
    memcpy(buf, path, len + 1);

    for (i = 1; i < len; i++) {
        if (buf[i] == '/' || buf[i] == '\\') {
            char c = buf[i];
            buf[i] = '\0';
            /* 跳过盘符 "C:" */
            if (!(strlen(buf) == 2 && buf[1] == ':'))
                HF_MKDIR(buf);
            buf[i] = c;
        }
    }
    HF_MKDIR(buf);
}

int hf_file_exists(const char *path)
{
#ifdef _WIN32
    return _access(path, 0) == 0;
#else
    return access(path, 0) == 0;
#endif
}

char *hf_read_file(const char *path, size_t *len_out)
{
    FILE *f;
    long sz;
    char *buf;
    size_t got;

    f = fopen(path, "rb");
    if (!f) {
        if (len_out) *len_out = 0;
        return NULL;
    }
    if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return NULL; }
    sz = ftell(f);
    if (sz < 0) { fclose(f); return NULL; }
    rewind(f);

    buf = (char *)hf_xmalloc((size_t)sz + 1);
    got = fread(buf, 1, (size_t)sz, f);
    buf[got] = '\0';
    fclose(f);

    if (len_out) *len_out = got;
    return buf;
}

int hf_append_line(const char *path, const char *line)
{
    FILE *f = fopen(path, "ab");
    if (!f) return -1;
    fputs(line, f);
    fputc('\n', f);
    fclose(f);
    return 0;
}

/* 终端显示宽度：CJK 算 2 列，其余算 1 列 */
int hf_disp_width(const char *s)
{
    uint32_t cp[1024];
    int n = hf_utf8_decode(s, cp, 1024);
    int i, w = 0;
    for (i = 0; i < n; i++)
        w += hf_is_cjk(cp[i]) ? 2 : 1;
    return w;
}

void hf_pad(const char *s, int width, char *out, size_t n)
{
    int w, i;
    snprintf(out, n, "%s", s);
    w = hf_disp_width(s);
    for (i = w; i < width; i++) {
        size_t l = strlen(out);
        if (l + 2 > n) break;
        out[l] = ' ';
        out[l + 1] = '\0';
    }
}
