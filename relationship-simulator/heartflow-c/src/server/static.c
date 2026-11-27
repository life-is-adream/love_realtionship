/* static.c — 静态资源服务
 *
 * 与 Node 版行为对齐的三点：
 *   1. 无扩展名且文件不存在 → 回退 index.html（SPA 兼容）
 *   2. 有扩展名但文件不存在 → 直接 404，绝不把 index.html 当 js 返回
 *   3. .js 内的相对 import 追加 ?v= 版本号，避免浏览器拿旧模块
 */
#define _POSIX_C_SOURCE 200809L

#include "config.h"
#include "httpd.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define APP_ASSET_VERSION "20261013-abilities-r1"

static const char *mime_of(const char *ext)
{
    if (strcmp(ext, ".html") == 0 || strcmp(ext, ".htm") == 0) return "text/html; charset=utf-8";
    if (strcmp(ext, ".js") == 0 || strcmp(ext, ".mjs") == 0) return "text/javascript; charset=utf-8";
    if (strcmp(ext, ".css") == 0) return "text/css; charset=utf-8";
    if (strcmp(ext, ".json") == 0) return "application/json; charset=utf-8";
    if (strcmp(ext, ".md") == 0 || strcmp(ext, ".txt") == 0) return "text/plain; charset=utf-8";
    if (strcmp(ext, ".png") == 0) return "image/png";
    if (strcmp(ext, ".jpg") == 0 || strcmp(ext, ".jpeg") == 0) return "image/jpeg";
    if (strcmp(ext, ".gif") == 0) return "image/gif";
    if (strcmp(ext, ".svg") == 0) return "image/svg+xml; charset=utf-8";
    if (strcmp(ext, ".ico") == 0) return "image/x-icon";
    if (strcmp(ext, ".woff2") == 0) return "font/woff2";
    if (strcmp(ext, ".mp3") == 0) return "audio/mpeg";
    if (strcmp(ext, ".wav") == 0) return "audio/wav";
    return "application/octet-stream";
}

static int needs_no_cache(const char *ext)
{
    return strcmp(ext, ".html") == 0 || strcmp(ext, ".htm") == 0 ||
           strcmp(ext, ".js") == 0 || strcmp(ext, ".mjs") == 0 ||
           strcmp(ext, ".css") == 0 || strcmp(ext, ".json") == 0 ||
           strcmp(ext, ".md") == 0 || strcmp(ext, ".txt") == 0;
}

static const char *ext_of(const char *path)
{
    const char *dot = strrchr(path, '.');
    const char *slash = strrchr(path, '/');
    if (!dot || (slash && dot < slash)) return "";
    return dot;
}

/* 百分号解码；失败返回 -1 */
static int url_decode(const char *in, char *out, size_t n)
{
    size_t u = 0;
    while (*in) {
        if (u + 1 >= n) return -1;
        if (*in == '%') {
            int hi, lo;
            if (!in[1] || !in[2]) return -1;
            hi = isdigit((unsigned char)in[1]) ? in[1] - '0' : (tolower((unsigned char)in[1]) - 'a' + 10);
            lo = isdigit((unsigned char)in[2]) ? in[2] - '0' : (tolower((unsigned char)in[2]) - 'a' + 10);
            if (hi < 0 || hi > 15 || lo < 0 || lo > 15) return -1;
            out[u++] = (char)((hi << 4) | lo);
            in += 3;
        } else {
            out[u++] = *in++;
        }
    }
    out[u] = '\0';
    return 0;
}

static char *read_file(const char *path, size_t *len_out)
{
    FILE *f = hf_fopen_utf8(path, "rb");
    long size;
    char *buf;

    if (!f) return NULL;
    if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return NULL; }
    size = ftell(f);
    if (size < 0) { fclose(f); return NULL; }
    rewind(f);
    buf = (char *)malloc((size_t)size + 1);
    if (!buf) { fclose(f); return NULL; }
    if (size > 0 && fread(buf, 1, (size_t)size, f) != (size_t)size) {
        free(buf);
        fclose(f);
        return NULL;
    }
    buf[size] = '\0';
    *len_out = (size_t)size;
    fclose(f);
    return buf;
}

static void version_js(const char *src, size_t len, HfBuf *out)
{
    size_t i = 0;
    hf_buf_add(out, "", 0);

    while (i < len) {
        /* 命中 from "  /  from '  /  import( "  /  import( ' */
        size_t mlen = 0;
        const char *marks[4] = { "from", "import(" , NULL, NULL };
        size_t k;
        for (k = 0; k < 2; k++) {
            size_t l = strlen(marks[k]);
            if (i + l < len && memcmp(src + i, marks[k], l) == 0) {
                size_t j = i + l;
                while (j < len && (src[j] == ' ' || src[j] == '\t')) j++;
                if (j < len && (src[j] == '"' || src[j] == '\'')) { mlen = j - i + 1; break; }
            }
        }
        if (!mlen) { hf_buf_putc(out, src[i]); i++; continue; }

        {
            size_t j = i + mlen;
            char quote = src[j - 1];
            size_t spec = j;
            size_t end = spec;
            while (end < len && src[end] != quote && src[end] != '\n') end++;
            if (end >= len || src[end] != quote || !(src[spec] == '.' &&
                (end - spec > 1) && (src[spec + 1] == '/' || (src[spec + 1] == '.' && end - spec > 2)))) {
                hf_buf_add(out, src + i, mlen);
                i += mlen;
                continue;
            }

            /* 原样输出前缀到 specifier 起始 */
            hf_buf_add(out, src + i, spec - i);
            {
                size_t q = spec;
                while (q < end && src[q] != '?' && src[q] != '#') q++;
                hf_buf_add(out, src + spec, q - spec);
                if (q < end && src[q] == '?') {
                    hf_buf_putc(out, '?');
                    {
                        size_t r = q + 1;
                        while (r < end && src[r] != '#') r++;
                        hf_buf_add(out, src + q + 1, r - (q + 1));
                        if (r > q + 1) hf_buf_putc(out, '&');
                        hf_buf_puts(out, "v=" APP_ASSET_VERSION);
                        if (r < end) hf_buf_add(out, src + r, end - r);
                    }
                } else {
                    if (q < end && src[q] == '#') {
                        hf_buf_puts(out, "?v=" APP_ASSET_VERSION);
                        hf_buf_add(out, src + q, end - q);
                    } else {
                        hf_buf_puts(out, "?v=" APP_ASSET_VERSION);
                    }
                }
            }
            i = end;
        }
    }
}

static int has_dotdot(const char *rel)
{
    const char *p = rel;
    while (*p) {
        if (p[0] == '.' && p[1] == '.' && (p[2] == '\0' || p[2] == '/')) return 1;
        p++;
    }
    return 0;
}

int hf_static_serve(HfConn *c)
{
    char decoded[2048];
    char rel[2048];
    char full[2600];
    char ext[16];
    const char *p;
    size_t len = 0;
    char *data;

    if (url_decode(c->req.path, decoded, sizeof decoded) != 0) {
        hf_send_text(c, 400, "Bad Request");
        return 0;
    }
    if (strchr(decoded, '\0') == NULL) { /* 不可达，保留以说明解码结果以 NUL 结尾 */ }

    snprintf(rel, sizeof rel, "%s", decoded[0] == '/' ? decoded + 1 : decoded);
    if (rel[0] == '\0') snprintf(rel, sizeof rel, "index.html");

    /* 拒绝点文件/点目录，避免 .env、.git 被 SPA 回退成 200 页面。 */
    if ((rel[0] == '.' && strstr(rel, "..") == NULL) || strstr(rel, "/.")) {
        hf_send_text(c, 404, "Not Found");
        return 0;
    }

    /* 拒绝穿越、盘符、反斜杠 */
    if (has_dotdot(rel) || strchr(rel, ':') || strchr(rel, '\\')) {
        hf_send_text(c, 403, "Forbidden");
        return 0;
    }

    snprintf(full, sizeof full, "%s/%s", g_cfg.public_dir, rel);

    /* 扩展名取自「请求路径」，用于区分 SPA 回退 */
    p = ext_of(rel);
    snprintf(ext, sizeof ext, "%s", p);

    data = read_file(full, &len);
    if (!data) {
        if (ext[0]) {                       /* 资源请求缺失 → 404 */
            hf_send_text(c, 404, "Not Found");
            return 0;
        }
        snprintf(full, sizeof full, "%s/index.html", g_cfg.public_dir);
        snprintf(ext, sizeof ext, ".html");
        data = read_file(full, &len);
        if (!data) { hf_send_text(c, 404, "Not Found"); return 0; }
    }

    if (strcmp(ext, ".js") == 0 || strcmp(ext, ".mjs") == 0) {
        HfBuf out;
        hf_buf_init(&out);
        version_js(data, len, &out);
        hf_send_bytes(c, 200, mime_of(ext), out.p, out.n,
                      needs_no_cache(ext) ? "no-cache" : "public, max-age=86400");
        hf_buf_free(&out);
    } else {
        hf_send_bytes(c, 200, mime_of(ext), data, len,
                      needs_no_cache(ext) ? "no-cache" : "public, max-age=86400");
    }

    free(data);
    return 0;
}
