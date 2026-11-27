#define _POSIX_C_SOURCE 200809L

#include "net.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32

#include <windows.h>
#include <winhttp.h>

static wchar_t *widen(const char *s)
{
    int n = MultiByteToWideChar(CP_UTF8, 0, s, -1, NULL, 0);
    wchar_t *w;
    if (n <= 0) return NULL;
    w = (wchar_t *)malloc(sizeof(wchar_t) * (size_t)n);
    if (!w) return NULL;
    MultiByteToWideChar(CP_UTF8, 0, s, -1, w, n);
    return w;
}

static void set_err(char *err, size_t n, const char *what, DWORD code)
{
    if (err && n) snprintf(err, n, "%s (winhttp error %lu)", what, (unsigned long)code);
}

static void append(HfHttpResp *r, const char *p, DWORD n)
{
    char *np = (char *)realloc(r->body, r->len + n + 1);
    if (!np) return;
    r->body = np;
    memcpy(r->body + r->len, p, n);
    r->len += n;
    r->body[r->len] = '\0';
}

static int do_request(const char *method, const char *url, const char *bearer,
                      const char *ctype, const char *body, size_t body_len,
                      int timeout_ms, HfHttpResp *out, char *err, size_t errsz)
{
    wchar_t *wurl = NULL, *whost = NULL, *wpath = NULL, *wmethod = NULL, *wctype = NULL;
    wchar_t hostbuf[256], pathbuf[4096], extrabuf[2048];
    wchar_t headers[1024];
    URL_COMPONENTS uc;
    HINTERNET ses = NULL, con = NULL, req = NULL;
    DWORD status = 0, sz;
    int ok = -1;

    memset(out, 0, sizeof *out);
    if (err && errsz) err[0] = '\0';

    wurl = widen(url);
    wmethod = widen(method);
    if (!wurl || !wmethod) { set_err(err, errsz, "url encode failed", 0); goto done; }

    memset(&uc, 0, sizeof uc);
    uc.dwStructSize = sizeof uc;
    uc.lpszHostName = hostbuf;
    uc.dwHostNameLength = 256;
    uc.lpszUrlPath = pathbuf;
    uc.dwUrlPathLength = 4096;
    uc.lpszExtraInfo = extrabuf;
    uc.dwExtraInfoLength = 2048;

    if (!WinHttpCrackUrl(wurl, 0, 0, &uc)) {
        set_err(err, errsz, "bad url", GetLastError());
        goto done;
    }
    if (uc.dwHostNameLength >= 256 || uc.dwUrlPathLength >= 4096) {
        set_err(err, errsz, "url too long", 0);
        goto done;
    }
    hostbuf[uc.dwHostNameLength] = L'\0';
    pathbuf[uc.dwUrlPathLength] = L'\0';
    extrabuf[uc.dwExtraInfoLength] = L'\0';
    whost = _wcsdup(hostbuf);
    if (uc.dwExtraInfoLength) {
        size_t a = wcslen(pathbuf), b = wcslen(extrabuf);
        wpath = (wchar_t *)malloc(sizeof(wchar_t) * (a + b + 1));
        if (!wpath) { set_err(err, errsz, "oom", 0); goto done; }
        wcscpy(wpath, pathbuf);
        wcscat(wpath, extrabuf);
    } else {
        wpath = _wcsdup(pathbuf);
    }
    if (!whost || !wpath) { set_err(err, errsz, "oom", 0); goto done; }

    ses = WinHttpOpen(L"heartflow/0.1", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                      WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!ses) { set_err(err, errsz, "WinHttpOpen", GetLastError()); goto done; }

    WinHttpSetTimeouts(ses, 5000, timeout_ms, timeout_ms, timeout_ms);

    con = WinHttpConnect(ses, whost, (INTERNET_PORT)uc.nPort, 0);
    if (!con) { set_err(err, errsz, "connect", GetLastError()); goto done; }

    req = WinHttpOpenRequest(con, wmethod, wpath, NULL, WINHTTP_NO_REFERER,
                             WINHTTP_DEFAULT_ACCEPT_TYPES,
                             uc.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0);
    if (!req) { set_err(err, errsz, "open request", GetLastError()); goto done; }

    headers[0] = L'\0';
    if (ctype && *ctype) {
        wchar_t wct[128];
        if (MultiByteToWideChar(CP_UTF8, 0, ctype, -1, wct, 128) > 0) {
            wcscpy(headers, L"Content-Type: ");
            wcscat(headers, wct);
            wcscat(headers, L"\r\n");
        }
    }
    if (bearer && *bearer) {
        wchar_t wauth[512];
        if (MultiByteToWideChar(CP_UTF8, 0, bearer, -1, wauth, 512) > 0) {
            wcscat(headers, L"Authorization: Bearer ");
            wcscat(headers, wauth);
            wcscat(headers, L"\r\n");
        }
    }

    if (!WinHttpSendRequest(req, headers[0] ? headers : WINHTTP_NO_ADDITIONAL_HEADERS,
                            (DWORD)-1L, (LPVOID)body, (DWORD)body_len,
                            (DWORD)body_len, 0)) {
        set_err(err, errsz, "send", GetLastError());
        goto done;
    }
    if (!WinHttpReceiveResponse(req, NULL)) {
        set_err(err, errsz, "receive", GetLastError());
        goto done;
    }

    sz = sizeof status;
    if (!WinHttpQueryHeaders(req, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                             WINHTTP_HEADER_NAME_BY_INDEX, &status, &sz, WINHTTP_NO_HEADER_INDEX)) {
        set_err(err, errsz, "status", GetLastError());
        goto done;
    }
    out->status = (int)status;

    {
        wchar_t ctw[128];
        DWORD ctsz = sizeof ctw;
        if (WinHttpQueryHeaders(req, WINHTTP_QUERY_CONTENT_TYPE, WINHTTP_HEADER_NAME_BY_INDEX,
                                ctw, &ctsz, WINHTTP_NO_HEADER_INDEX)) {
            WideCharToMultiByte(CP_UTF8, 0, ctw, -1, out->content_type, sizeof out->content_type, NULL, NULL);
        }
    }

    /* 保留完整响应头：C 侧 /api/tts 需要把上游的 X-Tts-* 透传给前端。
     * WinHTTP 只在请求句柄存活期间可查，所以这里一次性拷出来。 */
    {
        DWORD need = 0;
        WinHttpQueryHeaders(req, WINHTTP_QUERY_RAW_HEADERS_CRLF,
                            WINHTTP_HEADER_NAME_BY_INDEX, NULL, &need, WINHTTP_NO_HEADER_INDEX);
        if (need > 0 && need <= 65536) {
            wchar_t *hw = (wchar_t *)malloc(need);
            if (hw) {
                DWORD sz2 = need;
                hw[need / sizeof(wchar_t) - 1] = 0;
                if (WinHttpQueryHeaders(req, WINHTTP_QUERY_RAW_HEADERS_CRLF,
                                        WINHTTP_HEADER_NAME_BY_INDEX, hw, &sz2,
                                        WINHTTP_NO_HEADER_INDEX)) {
                    int n = WideCharToMultiByte(CP_UTF8, 0, hw, -1, NULL, 0, NULL, NULL);
                    if (n > 0) {
                        out->header_block = (char *)malloc((size_t)n);
                        if (out->header_block)
                            WideCharToMultiByte(CP_UTF8, 0, hw, -1, out->header_block, n, NULL, NULL);
                    }
                }
                free(hw);
            }
        }
    }

    for (;;) {
        char buf[32768];
        DWORD got = 0;
        if (!WinHttpReadData(req, buf, sizeof buf, &got)) {
            set_err(err, errsz, "read", GetLastError());
            goto done;
        }
        if (got == 0) break;
        append(out, buf, got);
    }
    if (!out->body) { out->body = (char *)calloc(1, 1); }
    ok = 0;

done:
    if (req) WinHttpCloseHandle(req);
    if (con) WinHttpCloseHandle(con);
    if (ses) WinHttpCloseHandle(ses);
    free(wurl); free(wmethod); free(wctype);
    free(whost); free(wpath);
    if (ok != 0) {
        free(out->body); free(out->header_block);
        out->body = NULL; out->header_block = NULL; out->len = 0;
    }
    return ok;
}

int hf_http_request(const char *method, const char *url, const char *bearer,
                    const char *ctype, const char *body, size_t body_len,
                    int timeout_ms, HfHttpResp *out, char *err, size_t errsz)
{
    return do_request(method, url, bearer, ctype, body, body_len, timeout_ms, out, err, errsz);
}

int hf_http_request_retry(const char *method, const char *url, const char *bearer,
                          const char *ctype, const char *body, size_t body_len,
                          int timeout_ms, HfHttpResp *out, char *err, size_t errsz)
{
    int attempt;
    for (attempt = 1; attempt <= 2; attempt++) {
        int rc = do_request(method, url, bearer, ctype, body, body_len, timeout_ms, out, err, errsz);
        if (rc == 0 && out->status < 500) return 0;
        if (rc == 0 && out->status >= 500) {
            hf_http_free(out);
            if (attempt < 2) Sleep(400u * (DWORD)attempt);
            continue;
        }
        if (attempt < 2) Sleep(400u * (DWORD)attempt);
    }
    return -1;
}

static int ci_eq(const char *a, const char *b, size_t n)
{
    size_t i;
    for (i = 0; i < n; i++) {
        unsigned char x = (unsigned char)a[i], y = (unsigned char)b[i];
        if (x >= 'A' && x <= 'Z') x = (unsigned char)(x - 'A' + 'a');
        if (y >= 'A' && y <= 'Z') y = (unsigned char)(y - 'A' + 'a');
        if (x != y) return 0;
    }
    return 1;
}

int hf_http_header(const HfHttpResp *r, const char *name, char *out, size_t outsz)
{
    const char *p;
    size_t nlen;

    if (!r || !r->header_block || !name || !out || outsz == 0) return 0;
    nlen = strlen(name);
    if (nlen == 0) return 0;
    out[0] = '\0';

    p = r->header_block;
    while (*p) {
        const char *e = strchr(p, '\n');
        size_t linelen = e ? (size_t)(e - p) : strlen(p);
        const char *v;
        size_t vlen, i, w = 0;

        while (linelen > 0 && (p[linelen - 1] == '\r' || p[linelen - 1] == '\n')) linelen--;
        if (linelen > nlen && p[nlen] == ':' && ci_eq(p, name, nlen)) {
            v = p + nlen + 1;
            vlen = linelen - nlen - 1;
            while (vlen > 0 && (*v == ' ' || *v == '\t')) { v++; vlen--; }
            for (i = 0; i < vlen && w + 1 < outsz; i++) {
                unsigned char ch = (unsigned char)v[i];
                if (ch < 0x20 || ch == 0x7f) continue;  /* 防响应头注入 */
                out[w++] = (char)ch;
            }
            out[w] = '\0';
            return 1;
        }
        if (!e) break;
        p = e + 1;
    }
    return 0;
}

void hf_http_free(HfHttpResp *r)
{
    if (!r) return;
    free(r->body);
    free(r->header_block);
    r->body = NULL;
    r->header_block = NULL;
    r->len = 0;
    r->status = 0;
    r->content_type[0] = '\0';
}

#else /* 非 Windows：服务器目标平台是 Windows，这里保留可编译的空实现 */

int hf_http_request(const char *method, const char *url, const char *bearer,
                    const char *ctype, const char *body, size_t body_len,
                    int timeout_ms, HfHttpResp *out, char *err, size_t errsz)
{
    (void)method; (void)url; (void)bearer; (void)ctype;
    (void)body; (void)body_len; (void)timeout_ms;
    memset(out, 0, sizeof *out);
    if (err && errsz) snprintf(err, errsz, "outbound http requires Windows WinHTTP");
    return -1;
}

int hf_http_request_retry(const char *method, const char *url, const char *bearer,
                          const char *ctype, const char *body, size_t body_len,
                          int timeout_ms, HfHttpResp *out, char *err, size_t errsz)
{
    return hf_http_request(method, url, bearer, ctype, body, body_len, timeout_ms, out, err, errsz);
}

void hf_http_free(HfHttpResp *r)
{
    if (!r) return;
    free(r->body);
    free(r->header_block);
    r->body = NULL;
    r->header_block = NULL;
    r->len = 0;
}

int hf_http_header(const HfHttpResp *r, const char *name, char *out, size_t outsz)
{
    (void)r; (void)name;
    if (out && outsz) out[0] = '\0';
    return 0;
}

#endif
