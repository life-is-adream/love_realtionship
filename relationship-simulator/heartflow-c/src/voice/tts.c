/* tts.c — TTS 协议/文本/音频层，逐行为对齐 voice/tts_server.py。
 *
 * 为什么按码点而不是字节：Python 侧的 len()、正则字符类都作用在 Unicode 字符上。
 * 用 strpbrk / 字节索引会把汉字从中间切断（本项目已在关系智能分句上踩过一次）。
 */
#define _POSIX_C_SOURCE 200809L

#include "tts.h"
#include "../hf.h"

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ---------- 码点数组 ---------- */

typedef struct { uint32_t *v; int n, cap; } CPs;

static int cps_push(CPs *a, uint32_t c)
{
    if (a->n >= a->cap) {
        int nc = a->cap ? a->cap * 2 : 256;
        uint32_t *nv = (uint32_t *)realloc(a->v, sizeof(uint32_t) * (size_t)nc);
        if (!nv) return -1;
        a->v = nv; a->cap = nc;
    }
    a->v[a->n++] = c;
    return 0;
}

static CPs cp_decode(const char *s)
{
    const unsigned char *p = (const unsigned char *)(s ? s : "");
    CPs a = { NULL, 0, 0 };
    while (*p) {
        uint32_t c;
        int step = 1;
        if (p[0] < 0x80) { c = p[0]; }
        else if ((p[0] & 0xE0) == 0xC0 && p[1] && (p[1] & 0xC0) == 0x80) {
            c = ((uint32_t)(p[0] & 0x1F) << 6) | (uint32_t)(p[1] & 0x3F); step = 2;
        } else if ((p[0] & 0xF0) == 0xE0 && p[1] && p[2] &&
                   (p[1] & 0xC0) == 0x80 && (p[2] & 0xC0) == 0x80) {
            c = ((uint32_t)(p[0] & 0x0F) << 12) | ((uint32_t)(p[1] & 0x3F) << 6) |
                (uint32_t)(p[2] & 0x3F); step = 3;
        } else if ((p[0] & 0xF8) == 0xF0 && p[1] && p[2] && p[3] &&
                   (p[1] & 0xC0) == 0x80 && (p[2] & 0xC0) == 0x80 && (p[3] & 0xC0) == 0x80) {
            c = ((uint32_t)(p[0] & 0x07) << 18) | ((uint32_t)(p[1] & 0x3F) << 12) |
                ((uint32_t)(p[2] & 0x3F) << 6) | (uint32_t)(p[3] & 0x3F); step = 4;
        } else { p += 1; continue; }
        if (cps_push(&a, c) != 0) break;
        p += step;
    }
    return a;
}

static char *cp_encode(const uint32_t *v, int n)
{
    HfBuf b;
    char tmp[8];
    int i;
    hf_buf_init(&b);
    for (i = 0; i < n; i++) {
        int k = hf_utf8_encode(v[i], tmp);
        hf_buf_add(&b, tmp, (size_t)k);
    }
    {
        char *out = (char *)malloc(b.n + 1);
        if (!out) { hf_buf_free(&b); return NULL; }
        if (b.n) memcpy(out, b.p, b.n);
        out[b.n] = '\0';
        hf_buf_free(&b);
        return out;
    }
}

/* ---------- 字符类（对齐 Python 正则） ---------- */

static int is_open(uint32_t c)
{
    return c == 0xFF08 /* （ */ || c == '(' || c == 0x3010 /* 【 */ || c == '[';
}
static int is_close(uint32_t c)
{
    return c == 0xFF09 /* ） */ || c == ')' || c == 0x3011 /* 】 */ || c == ']';
}
static int is_emoji(uint32_t c)
{
    return (c >= 0x1F300 && c <= 0x1FAFF) ||
           (c >= 0x2600 && c <= 0x27BF) || c == 0xFE0F;
}
static int is_ws(uint32_t c)
{
    if (c == ' ' || (c >= 0x09 && c <= 0x0D)) return 1;
    if (c >= 0x1C && c <= 0x1F) return 1;
    return c == 0x85 || c == 0xA0 || c == 0x1680 ||
           (c >= 0x2000 && c <= 0x200A) || c == 0x2028 || c == 0x2029 ||
           c == 0x202F || c == 0x205F || c == 0x3000;
}

/* [^。！？!?；;\n] —— 分句正则的排除集合 */
static int is_sep(uint32_t c)
{
    return c == 0x3002 /* 。 */ || c == 0xFF01 /* ！ */ || c == 0xFF1F /* ？ */ ||
           c == '!' || c == '?' || c == 0xFF1B /* ； */ || c == ';' || c == '\n';
}
/* [。！？!?；;] —— 尾随标点（不含 \n） */
static int is_tail(uint32_t c)
{
    return is_sep(c) && c != '\n';
}

static uint32_t map_punct(uint32_t c)
{
    switch (c) {
    case 0xFF1F: /* ？ */ return 0x3002;
    case '?':             return 0x3002;
    case 0xFF1B: /* ； */ return 0x3002;
    case ';':             return 0x3002;
    case 0xFF1A: /* ： */ return 0xFF0C;
    case ':':             return 0xFF0C;
    case 0x3001: /* 、 */ return 0xFF0C;
    default: return c;
    }
}

/* ---------- normalize_for_tts ---------- */

char *hf_tts_normalize(const char *text)
{
    CPs src = cp_decode(text);
    CPs a = { NULL, 0, 0 }, b = { NULL, 0, 0 };
    char *out;
    int i, j;

    /* 1. 舞台提示：成对括号（中间 <=20 非闭括号字符）或未闭合到串尾 */
    for (i = 0; i < src.n; ) {
        if (!is_open(src.v[i])) { cps_push(&a, src.v[i]); i++; continue; }
        j = i + 1;
        while (j < src.n && !is_close(src.v[j])) j++;
        if (j < src.n && j - i - 1 <= 20) { i = j + 1; continue; }   /* 成对 */
        if (j == src.n && src.n - i - 1 <= 20) { i = src.n; continue; } /* 到串尾 */
        cps_push(&a, src.v[i]);
        i++;
    }

    /* 2. emoji 删除 + 3. 标点映射 */
    for (i = 0; i < a.n; i++) {
        if (is_emoji(a.v[i])) continue;
        cps_push(&b, map_punct(a.v[i]));
    }

    /* 4. \.{2,} -> 。   5. (。)\1+ -> 。   6. \s+ -> 空格 + strip */
    {
        CPs c = { NULL, 0, 0 };
        for (i = 0; i < b.n; ) {
            if (b.v[i] == '.' && i + 1 < b.n && b.v[i + 1] == '.') {
                while (i < b.n && b.v[i] == '.') i++;
                cps_push(&c, 0x3002);
                continue;
            }
            cps_push(&c, b.v[i]);
            i++;
        }
        free(b.v);
        b = c;
    }
    {
        CPs c = { NULL, 0, 0 };
        for (i = 0; i < b.n; ) {
            if (b.v[i] == 0x3002) {
                while (i < b.n && b.v[i] == 0x3002) i++;
                cps_push(&c, 0x3002);
                continue;
            }
            cps_push(&c, b.v[i]);
            i++;
        }
        free(b.v);
        b = c;
    }
    {
        CPs c = { NULL, 0, 0 };
        int pending = 0;
        for (i = 0; i < b.n; i++) {
            if (is_ws(b.v[i])) { pending = 1; continue; }
            if (pending) {
                /* 首尾空格由 strip 去掉：这里先都写，再统一 trim */
                if (c.n > 0) cps_push(&c, ' ');
                pending = 0;
            }
            cps_push(&c, b.v[i]);
        }
        /* Python: re.sub(r"\s+", " ", s).strip() —— 折叠后首尾是 ASCII 空格 */
        i = 0; j = c.n;
        while (i < j && c.v[i] == ' ') i++;
        while (j > i && c.v[j - 1] == ' ') j--;
        free(b.v);
        b.v = c.v; b.n = j - i; b.cap = c.cap;
        if (i) memmove(b.v, b.v + i, sizeof(uint32_t) * (size_t)b.n);
    }

    out = b.n > 0 ? cp_encode(b.v, b.n) : NULL;
    if (!out) {
        /* Python 的 `return cleaned or text`：清洗结果为空时原样返回（不 strip） */
        out = (char *)malloc(strlen(text ? text : "") + 1);
        if (out) strcpy(out, text ? text : "");
    }
    free(src.v); free(a.v); free(b.v);
    return out;
}

/* ---------- split_sentences ---------- */

static void trim_cps(const uint32_t *v, int *from, int *to)
{
    while (*from < *to && is_ws(v[*from])) (*from)++;
    while (*to > *from && is_ws(v[*to - 1])) (*to)--;
}

char **hf_tts_split(const char *text, int min_len, int max_len, int *out_n)
{
    CPs src = cp_decode(text);
    char **out = NULL;
    CPs buf = { NULL, 0, 0 };
    int count = 0, cap = 0, i = 0, raw_n = 0;

    if (out_n) *out_n = 0;
    if (min_len < 1) min_len = 6;
    if (max_len < 1) max_len = 80;

#define PUSH_PIECE(sv, sn) do {                                              \
        char *piece = cp_encode((sv), (sn));                                 \
        if (count >= cap) {                                                  \
            int nc = cap ? cap * 2 : 16;                                     \
            char **nv = (char **)realloc(out, sizeof(char *) * (size_t)nc);  \
            if (!nv) { free(piece); goto done; }                             \
            out = nv; cap = nc;                                              \
        }                                                                    \
        out[count++] = piece;                                                \
    } while (0)

    /* 按 [^sep]+[tail]? 切出 raw pieces */
    for (i = 0; i < src.n; ) {
        int s = i, e, f, t;
        while (i < src.n && is_sep(src.v[i])) i++;   /* 跳过前导分隔符 */
        s = i;
        while (i < src.n && !is_sep(src.v[i])) i++;
        e = i;
        if (e > s && i < src.n && is_tail(src.v[i])) i++;  /* 可选尾随标点 */
        e = i;
        if (e <= s) continue;
        f = s; t = e;
        trim_cps(src.v, &f, &t);
        if (f >= t) continue;
        raw_n++;

        /* 合并：len 一律是码点数 */
        if (buf.n + (t - f) <= max_len && (buf.n == 0 || buf.n < min_len)) {
            int k;
            for (k = f; k < t; k++) cps_push(&buf, src.v[k]);
        } else {
            if (buf.n > 0) PUSH_PIECE(buf.v, buf.n);
            buf.n = 0;
            {
                int k;
                for (k = f; k < t; k++) cps_push(&buf, src.v[k]);
            }
        }
    }

    if (buf.n > 0) PUSH_PIECE(buf.v, buf.n);
    if (raw_n == 0 || count == 0) {
        /* Python: return merged or [text] —— 原文，不 strip */
        int k;
        size_t len;
        for (k = 0; k < count; k++) free(out[k]);
        count = 0;
        if (cap == 0) {
            out = (char **)malloc(sizeof(char *));
            if (!out) goto done;
            cap = 1;
        }
        len = strlen(text ? text : "");
        out[0] = (char *)malloc(len + 1);
        if (out[0]) { memcpy(out[0], text ? text : "", len); out[0][len] = '\0'; count = 1; }
    }

#undef PUSH_PIECE
done:
    if (out_n) *out_n = count;
    free(src.v); free(buf.v);
    return out;
}

void hf_tts_split_free(char **v, int n)
{
    int i;
    if (!v) return;
    for (i = 0; i < n; i++) free(v[i]);
    free(v);
}

/* ---------- float_to_wav ---------- */

static void put_u32(HfBuf *b, uint32_t v)
{
    hf_buf_putc(b, (char)(v & 0xFF));
    hf_buf_putc(b, (char)((v >> 8) & 0xFF));
    hf_buf_putc(b, (char)((v >> 16) & 0xFF));
    hf_buf_putc(b, (char)((v >> 24) & 0xFF));
}
static void put_u16(HfBuf *b, uint16_t v)
{
    hf_buf_putc(b, (char)(v & 0xFF));
    hf_buf_putc(b, (char)((v >> 8) & 0xFF));
}

int hf_tts_float_to_wav(const float *pcm, size_t n, int sample_rate, HfBuf *out)
{
    float gain = 1.0f, peak = 0.0f;
    double sum = 0.0;
    size_t i;
    uint32_t data_len;

    if (!out) return -1;
    if (sample_rate <= 0) sample_rate = HF_TTS_SAMPLE_RATE;

    if (n > 0 && pcm) {
        for (i = 0; i < n; i++) {
            float x = pcm[i];
            sum += (double)x * (double)x;
            { float ax = fabsf(x); if (ax > peak) peak = ax; }
        }
        {
            float rms = (float)sqrt(sum / (double)n);
            if (rms > 1e-5f) {
                gain = (float)(HF_TTS_TARGET_RMS / rms);
                if (peak * gain > (float)HF_TTS_PEAK_LIMIT)
                    gain = (float)(HF_TTS_PEAK_LIMIT / (peak > 1e-6f ? peak : 1e-6f));
            }
        }
    }

    data_len = (uint32_t)n * 2u;
    hf_buf_add(out, "RIFF", 4);
    put_u32(out, 36u + data_len);
    hf_buf_add(out, "WAVEfmt ", 8);
    put_u32(out, 16u);
    put_u16(out, 1);                              /* PCM */
    put_u16(out, 1);                              /* mono */
    put_u32(out, (uint32_t)sample_rate);
    put_u32(out, (uint32_t)sample_rate * 2u);     /* byte rate */
    put_u16(out, 2);                              /* block align */
    put_u16(out, 16);                             /* bits */
    hf_buf_add(out, "data", 4);
    put_u32(out, data_len);

    for (i = 0; i < n; i++) {
        float v = pcm ? pcm[i] * gain : 0.0f;
        int32_t s;
        if (v > 1.0f) v = 1.0f;
        if (v < -1.0f) v = -1.0f;
        /* numpy astype(int16) 是向零截断，不是四舍五入 */
        s = (int32_t)(v * 32767.0f);
        if (s > 32767) s = 32767;
        if (s < -32767) s = -32767;
        put_u16(out, (uint16_t)(s < 0 ? 65536 + s : s));
    }
    return 0;
}

/* ---------- 校验 ---------- */

const char *hf_tts_validate_text(const char *text)
{
    if (!text || !*text) return "bad_request";
    if (hf_utf8_count(text) > HF_TTS_MAX_TEXT) return "text_too_long";
    return NULL;
}

int hf_tts_engine_known(const char *engine)
{
    return engine && (strcmp(engine, "chattts") == 0 ||
                      strcmp(engine, "kokoro") == 0 ||
                      strcmp(engine, "edge") == 0 ||
                      strcmp(engine, "character") == 0);
}

double hf_tts_clamp_speed(double v)
{
    if (v < 0.8) return 0.8;
    if (v > 1.2) return 1.2;
    return v;
}
