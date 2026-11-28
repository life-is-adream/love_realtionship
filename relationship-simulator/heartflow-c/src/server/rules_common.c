#include "rules_internal.h"

#include <ctype.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#ifdef _WIN32
#include <io.h>
#endif

/* ================= UTF-8 ================= */

int r_utf8_one(const char *p, uint32_t *cp)
{
    const unsigned char *s = (const unsigned char *)p;
    unsigned char c = s[0];

    if (c < 0x80) { *cp = c; return 1; }
    if ((c & 0xE0) == 0xC0 && (s[1] & 0xC0) == 0x80) {
        *cp = ((uint32_t)(c & 0x1F) << 6) | (uint32_t)(s[1] & 0x3F);
        return 2;
    }
    if ((c & 0xF0) == 0xE0 && (s[1] & 0xC0) == 0x80 && (s[2] & 0xC0) == 0x80) {
        *cp = ((uint32_t)(c & 0x0F) << 12) | ((uint32_t)(s[1] & 0x3F) << 6) | (uint32_t)(s[2] & 0x3F);
        return 3;
    }
    if ((c & 0xF8) == 0xF0 && (s[1] & 0xC0) == 0x80 && (s[2] & 0xC0) == 0x80 && (s[3] & 0xC0) == 0x80) {
        *cp = ((uint32_t)(c & 0x07) << 18) | ((uint32_t)(s[1] & 0x3F) << 12) |
              ((uint32_t)(s[2] & 0x3F) << 6) | (uint32_t)(s[3] & 0x3F);
        return 4;
    }
    *cp = c;
    return 1;
}

int r_is_ws_cp(uint32_t cp)
{
    if (cp == 0x09 || cp == 0x0A || cp == 0x0B || cp == 0x0C || cp == 0x0D || cp == 0x20) return 1;
    if (cp == 0xA0 || cp == 0xFEFF || cp == 0x1680 || cp == 0x2028 || cp == 0x2029 ||
        cp == 0x202F || cp == 0x205F || cp == 0x3000) return 1;
    if (cp >= 0x2000 && cp <= 0x200A) return 1;
    return 0;
}

int r_utf16_len(const char *s)
{
    int n = 0;
    const char *p = s ? s : "";
    while (*p) {
        uint32_t cp = 0;
        p += r_utf8_one(p, &cp);
        n += (cp > 0xFFFF) ? 2 : 1;
    }
    return n;
}

int r_cp_len(const char *s)
{
    int n = 0;
    const char *p = s ? s : "";
    while (*p) {
        uint32_t cp = 0;
        p += r_utf8_one(p, &cp);
        n++;
    }
    return n;
}

int r_cp_len_no_ws(const char *s)
{
    int n = 0;
    const char *p = s ? s : "";
    while (*p) {
        uint32_t cp = 0;
        p += r_utf8_one(p, &cp);
        if (!r_is_ws_cp(cp)) n++;
    }
    return n;
}

void r_utf8_cut_chars(const char *s, int max_chars, char *out, size_t outsz)
{
    const char *p = s ? s : "";
    int chars = 0;
    size_t used = 0;
    if (!out || outsz == 0) return;
    while (*p) {
        uint32_t cp = 0;
        int bytes = r_utf8_one(p, &cp);
        if (chars >= max_chars) break;
        if (used + (size_t)bytes >= outsz) break;
        memcpy(out + used, p, (size_t)bytes);
        used += (size_t)bytes;
        chars++;
        p += bytes;
    }
    out[used] = '\0';
}

/* ================= 文本 ================= */

int r_has(const char *text, const char *phrase)
{
    return text && phrase && *phrase && strstr(text, phrase) != NULL;
}

int r_has_any(const char *text, const char **list)
{
    int i;
    if (!text || !list) return 0;
    for (i = 0; list[i]; i++) if (strstr(text, list[i])) return 1;
    return 0;
}

/* JS 的 `a.*b`：a 与 b 必须位于同一行（. 不匹配换行）。 */
int r_has_seq(const char *text, const char *a, const char *b)
{
    const char *p, *q, *end;
    if (!text || !a || !b) return 0;
    p = strstr(text, a);
    if (!p) return 0;
    end = p;
    while (*end && *end != '\n') end++;
    q = strstr(p + strlen(a), b);
    return q && q < end;
}

int r_has_seq3(const char *text, const char *a, const char *b, const char *c)
{
    const char *p, *q, *r, *end;
    if (!text || !a || !b || !c) return 0;
    p = strstr(text, a);
    if (!p) return 0;
    end = p;
    while (*end && *end != '\n') end++;
    q = strstr(p + strlen(a), b);
    if (!q || q >= end) return 0;
    r = strstr(q + strlen(b), c);
    return r && r < end;
}

int r_count_occ(const char *text, const char *phrase)
{
    int n = 0;
    size_t len;
    const char *p;
    if (!text || !phrase || !*phrase) return 0;
    len = strlen(phrase);
    p = text;
    while ((p = strstr(p, phrase)) != NULL) {
        n++;
        p += len;
    }
    return n;
}

int r_starts_with(const char *text, const char *prefix)
{
    return text && prefix && strncmp(text, prefix, strlen(prefix)) == 0;
}

int r_ends_with(const char *text, const char *suffix)
{
    size_t lt, ls;
    if (!text || !suffix) return 0;
    lt = strlen(text);
    ls = strlen(suffix);
    return lt >= ls && strcmp(text + lt - ls, suffix) == 0;
}

char *r_trim_dup(const char *s)
{
    const char *p = s ? s : "";
    const char *start, *end;
    size_t len;
    char *out;

    while (*p) {
        uint32_t cp = 0;
        int bytes = r_utf8_one(p, &cp);
        if (!r_is_ws_cp(cp)) break;
        p += bytes;
    }
    start = p;
    /* 从尾部回退：按 UTF-8 前导字节找到最后一个非空白字符的结束位置。 */
    {
        const char *last = start;
        const char *q = start;
        while (*q) {
            uint32_t cp = 0;
            int bytes = r_utf8_one(q, &cp);
            if (!r_is_ws_cp(cp)) last = q + bytes;
            q += bytes;
        }
        end = last;
    }
    len = (size_t)(end - start);
    out = (char *)malloc(len + 1);
    if (!out) abort();
    memcpy(out, start, len);
    out[len] = '\0';
    return out;
}

char *r_clean_dup(const char *s)
{
    HfBuf b;
    const char *p = s ? s : "";
    int pending_space = 0;
    char *out;

    hf_buf_init(&b);
    while (*p) {
        uint32_t cp = 0;
        int bytes = r_utf8_one(p, &cp);
        if (r_is_ws_cp(cp)) {
            if (b.n > 0) pending_space = 1;
        } else {
            if (pending_space) {
                hf_buf_putc(&b, ' ');
                pending_space = 0;
            }
            hf_buf_add(&b, p, (size_t)bytes);
        }
        p += bytes;
    }
    out = hf_buf_take(&b);
    return out ? out : r_trim_dup("");
}

int r_quote_reference(const char *text)
{
    const char *p = text ? text : "";
    while (*p) {
        uint32_t cp = 0;
        int bytes = r_utf8_one(p, &cp);
        if (cp == 0x201C || cp == 0x300C || cp == 0x300E || cp == 0x22) {
            const char *q = p + bytes;
            int count = 0;
            while (*q) {
                uint32_t inner = 0;
                int ib = r_utf8_one(q, &inner);
                /* JS 正则的收尾字符类只认 ” 」 』 "；再遇到开引号或 ' 就说明
                 * 这一段不是完整的引用，当前 opener 匹配失败。 */
                if (inner == 0x201D || inner == 0x300D || inner == 0x300F || inner == 0x22) {
                    if (count >= 1 && count <= 40) return 1;
                    break;
                }
                if (inner == 0x201C || inner == 0x300C || inner == 0x300E || inner == 0x27) break;
                count++;
                q += ib;
            }
        }
        p += bytes;
    }
    return 0;
}

/* ================= 数值 ================= */

double r_round(double x)
{
    return floor(x + 0.5);
}

double r_round1(double x)
{
    return r_round(x * 10.0) / 10.0;
}

double r_round3(double x)
{
    return r_round(x * 1000.0) / 1000.0;
}

double r_clamp_raw(double x, double min, double max)
{
    if (x < min) return min;
    if (x > max) return max;
    return x;
}

int r_clamp_score(double x)
{
    if (!isfinite(x)) return 0;
    return (int)r_clamp_raw(r_round(x), 0, 100);
}

int r_clamp_score_coach(double x)
{
    if (!isfinite(x)) return 70;
    return (int)r_clamp_raw(r_round(x), 0, 100);
}

/* ================= 时间 ================= */

static int parse_int_at(const char *s, int *out, int digits)
{
    int value = 0, i;
    for (i = 0; i < digits; i++) {
        if (!isdigit((unsigned char)s[i])) return 0;
        value = value * 10 + (s[i] - '0');
    }
    *out = value;
    return 1;
}

long long r_parse_time(const char *s, int *ok)
{
    char buf[128];
    const char *p;
    int Y = 0, M = 0, D = 0, h = 0, mi = 0, sec = 0, ms = 0;
    int has_time = 0, has_zone = 0, zone_sign = 1, zone_h = 0, zone_m = 0;
    struct tm tm;
    long long t;

    if (ok) *ok = 0;
    if (!s) return -1;
    {
        char *tmp = r_trim_dup(s);
        size_t len = strlen(tmp);
        if (len >= sizeof buf) len = sizeof buf - 1;
        memcpy(buf, tmp, len);
        buf[len] = '\0';
        free(tmp);
    }
    if (!buf[0]) return -1;

    p = buf;
    if (!parse_int_at(p, &Y, 4)) return -1;
    p += 4;
    if (*p != '-') return -1;
    p++;
    if (!parse_int_at(p, &M, 2)) return -1;
    p += 2;
    if (*p != '-') return -1;
    p++;
    if (!parse_int_at(p, &D, 2)) return -1;
    p += 2;

    if (*p == 'T' || *p == ' ') {
        has_time = 1;
        p++;
        if (!parse_int_at(p, &h, 2)) return -1;
        p += 2;
        if (*p != ':') return -1;
        p++;
        if (!parse_int_at(p, &mi, 2)) return -1;
        p += 2;
        if (*p == ':') {
            p++;
            if (!parse_int_at(p, &sec, 2)) return -1;
            p += 2;
        }
        if (*p == '.') {
            int frac = 0, digits = 0;
            p++;
            while (isdigit((unsigned char)*p) && digits < 3) {
                frac = frac * 10 + (*p - '0');
                p++;
                digits++;
            }
            while (isdigit((unsigned char)*p)) p++;
            while (digits < 3) { frac *= 10; digits++; }
            ms = frac;
        }
        while (*p == ' ' || *p == '\t') p++;
    }

    if (*p == 'Z') {
        has_zone = 1;
        zone_sign = 1;
        p++;
    } else if (*p == '+' || *p == '-') {
        has_zone = 1;
        zone_sign = (*p == '+') ? 1 : -1;
        p++;
        if (!parse_int_at(p, &zone_h, 2)) return -1;
        p += 2;
        if (*p == ':') p++;
        if (!parse_int_at(p, &zone_m, 2)) return -1;
        p += 2;
    }
    while (*p == ' ') p++;
    if (*p) return -1;

    if (M < 1 || M > 12 || D < 1 || D > 31) return -1;
    if (has_time && (h > 23 || mi > 59 || sec > 59)) return -1;
    if (has_zone && (zone_h > 23 || zone_m > 59)) return -1;

    memset(&tm, 0, sizeof tm);
    tm.tm_year = Y - 1900;
    tm.tm_mon = M - 1;
    tm.tm_mday = D;
    tm.tm_hour = h;
    tm.tm_min = mi;
    tm.tm_sec = sec;
    tm.tm_isdst = -1;

    if (has_zone || !has_time) {
#ifdef _WIN32
        time_t utc = _mkgmtime(&tm);
#else
        time_t utc = timegm(&tm);
#endif
        if (utc == (time_t)-1) return -1;
        t = (long long)utc;
        if (has_zone) t -= (long long)zone_sign * (zone_h * 3600 + zone_m * 60);
    } else {
        time_t local = mktime(&tm);
        if (local == (time_t)-1) return -1;
        t = (long long)local;
    }
    if (ok) *ok = 1;
    return t * 1000 + ms;
}

long long r_timestamp_value(const JNode *node, int *has)
{
    if (has) *has = 0;
    if (!node || node->type == JNULL) return -1;
    if (node->type == JNUM) {
        double v = node->u.num;
        long long ms;
        if (!isfinite(v)) return -1;
        if (fabs(v) < 1e12) v *= 1000.0;
        ms = (long long)v;
        if (has) *has = 1;
        return ms;
    }
    if (node->type == JSTR) {
        int ok = 0;
        long long ms = r_parse_time(node->u.str.s, &ok);
        if (ok && has) *has = 1;
        return ok ? ms : -1;
    }
    return -1;
}

void r_iso_time(long long ms, char out[40])
{
    time_t sec = (time_t)(ms / 1000);
    int milli = (int)(ms % 1000);
    struct tm tm;
    if (milli < 0) { milli += 1000; sec -= 1; }
#ifdef _WIN32
    gmtime_s(&tm, &sec);
#else
    gmtime_r(&sec, &tm);
#endif
    snprintf(out, 40, "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
             tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday,
             tm.tm_hour, tm.tm_min, tm.tm_sec, milli);
}

int r_local_hour(long long ms)
{
    time_t sec = (time_t)(ms / 1000);
    struct tm tm;
#ifdef _WIN32
    localtime_s(&tm, &sec);
#else
    localtime_r(&sec, &tm);
#endif
    return tm.tm_hour;
}

int r_is_late_night(long long ms)
{
    int hour = r_local_hour(ms);
    return hour >= 23 || hour < 7;
}

void r_format_elapsed(double minutes, char *out, size_t n)
{
    if (minutes < 1.0) {
        snprintf(out, n, "刚刚");
    } else if (minutes < 60.0) {
        snprintf(out, n, "约%d分钟", (int)r_round(minutes));
    } else {
        snprintf(out, n, "约%d小时", (int)r_round(minutes / 60.0));
    }
}

/* ================= 阶段 ================= */

int r_stage_valid(const char *stage)
{
    static const char *STAGES[] = {
        "刚加微信后的第一晚", "隔天轻联系", "第一次邀约", "第一次约会后",
        "暧昧推进", "表达好感", "确定关系", NULL
    };
    int i;
    if (!stage || !*stage) return 0;
    for (i = 0; STAGES[i]; i++) if (strcmp(stage, STAGES[i]) == 0) return 1;
    return 0;
}

/* ================= JSON ================= */

JNode *r_arr_of_strings(const char **values, int n)
{
    JNode *arr = json_new_arr();
    int i;
    for (i = 0; i < n; i++) json_arr_push(arr, json_new_str(values[i]));
    return arr;
}
