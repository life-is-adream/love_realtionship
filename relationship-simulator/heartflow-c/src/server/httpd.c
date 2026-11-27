#define _POSIX_C_SOURCE 200809L

#include "httpd.h"
#include "config.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#ifdef _WIN32

#include <direct.h>
#include <io.h>
#include <process.h>
#include <ws2tcpip.h>

/* 统一安全响应头。页面渲染模型输出与导入的聊天文本，必须限制脚本来源；
 * 现有 index.html 全部外链脚本/样式，无 inline script，故 script-src 收紧到 self。
 * data:/blob: 仅开放给图片与音频（截图导入、TTS 播放），不给脚本。 */
/* ---- 访问日志 / 错误日志 ----
 * 默认写到 <root>/logs/access.log 与 error.log；HF_LOG_DIR 可覆盖目录，
 * HF_LOG_DISABLE=1 关闭。只记录 method/path/status/耗时/IP，绝不记录请求体或密钥。
 * 多线程写文件用 CRITICAL_SECTION 保护，单行写入保持原子。 */
static FILE *g_access_log = NULL;
static FILE *g_error_log = NULL;
static CRITICAL_SECTION g_log_cs;
static int g_log_init = 0;

static void log_init(void)
{
    char dir[600], path[700];
    const char *env_dir, *env_off;
    if (InterlockedCompareExchange((volatile LONG *)&g_log_init, 1, 0) != 0) return;
    InitializeCriticalSection(&g_log_cs);
    env_off = getenv("HF_LOG_DISABLE");
    if (env_off && (!strcmp(env_off, "1") || !_stricmp(env_off, "true"))) return;
    env_dir = getenv("HF_LOG_DIR");
    if (env_dir && *env_dir) snprintf(dir, sizeof dir, "%s", env_dir);
    else snprintf(dir, sizeof dir, "%s/logs", hf_cfg_root());
    _mkdir(dir);  /* 目录不存在则创建，已存在会失败但无妨 */
    snprintf(path, sizeof path, "%s/access.log", dir);
    g_access_log = hf_fopen_utf8(path, "a");
    snprintf(path, sizeof path, "%s/error.log", dir);
    g_error_log = hf_fopen_utf8(path, "a");
}

static void log_line(FILE *f, const char *line)
{
    if (!f) return;
    EnterCriticalSection(&g_log_cs);
    fputs(line, f);
    fflush(f);
    LeaveCriticalSection(&g_log_cs);
}

static void log_timestamp(char *out, size_t n)
{
    long long ms = hf_now_ms();
    time_t sec = (time_t)(ms / 1000);
    struct tm t;
    localtime_s(&t, &sec);
    snprintf(out, n, "%04d-%02d-%02d %02d:%02d:%02d.%03d",
             t.tm_year + 1900, t.tm_mon + 1, t.tm_mday,
             t.tm_hour, t.tm_min, t.tm_sec, (int)(ms % 1000));
}

static void log_request(HfConn *c, long long elapsed_ms)
{
    char ts[40], line[1200], ip[64];
    struct sockaddr_in a;
    int len = sizeof a;
    int status = c->last_status ? c->last_status : 200;

    log_init();
    if (!g_access_log && !g_error_log) return;

    if (getpeername(c->fd, (struct sockaddr *)&a, &len) == 0)
        snprintf(ip, sizeof ip, "%s", inet_ntoa(a.sin_addr));
    else
        snprintf(ip, sizeof ip, "-");
    log_timestamp(ts, sizeof ts);
    /* 末字段是请求体字节数（不含响应体；查问题看 status/耗时/路径已足够）。 */
    snprintf(line, sizeof line,
             "%s %s %s %s %d %lldms %lub\n",
             ts, ip, c->req.method, c->req.path, status, elapsed_ms,
             (unsigned long)c->req.content_length);
    log_line(g_access_log, line);
    if (status >= 400) log_line(g_error_log, line);
}

static void add_security_headers(HfBuf *head)
{
    hf_buf_printf(head,
        "X-Content-Type-Options: nosniff\r\n"
        "X-Frame-Options: DENY\r\n"
        "Referrer-Policy: no-referrer\r\n"
        "Permissions-Policy: geolocation=(), microphone=(), camera=()\r\n"
        "Content-Security-Policy: default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; "
        "media-src 'self' data: blob:; "
        "font-src 'self' data:; "
        "connect-src 'self'; "
        "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'\r\n");
}

static const char *status_text(int s)
{
    switch (s) {
    case 200: return "OK";
    case 204: return "No Content";
    case 400: return "Bad Request";
    case 403: return "Forbidden";
    case 404: return "Not Found";
    case 405: return "Method Not Allowed";
    case 413: return "Payload Too Large";
    case 429: return "Too Many Requests";
    case 500: return "Internal Server Error";
    case 502: return "Bad Gateway";
    case 503: return "Service Unavailable";
    case 504: return "Gateway Timeout";
    default:  return "OK";
    }
}

static void send_all(HfSocket fd, const char *p, size_t n)
{
    while (n > 0) {
        int chunk = (n > 1u << 20) ? (int)(1u << 20) : (int)n;
        int sent = send(fd, p, chunk, 0);
        if (sent <= 0) return;
        p += sent;
        n -= (size_t)sent;
    }
}

static int header_lookup(const char *headers, const char *name, char *out, size_t n)
{
    const char *p = headers;
    size_t nl = strlen(name);

    while (*p) {
        const char *eol = strstr(p, "\r\n");
        const char *colon;
        if (!eol) eol = p + strlen(p);
        colon = memchr(p, ':', (size_t)(eol - p));
        if (colon && (size_t)(colon - p) == nl) {
            size_t i;
            int same = 1;
            for (i = 0; i < nl; i++) {
                if (tolower((unsigned char)p[i]) != tolower((unsigned char)name[i])) { same = 0; break; }
            }
            if (same) {
                const char *v = colon + 1;
                size_t len;
                while (v < eol && (*v == ' ' || *v == '\t')) v++;
                len = (size_t)(eol - v);
                while (len && (v[len - 1] == ' ' || v[len - 1] == '\t')) len--;
                if (len >= n) len = n - 1;
                memcpy(out, v, len);
                out[len] = '\0';
                return 1;
            }
        }
        if (!*eol) break;
        p = eol + 2;
    }
    return 0;
}

static int read_headers(HfSocket fd, HfBuf *buf)
{
    for (;;) {
        char tmp[8192];
        int got;
        char *end;

        end = buf->p ? strstr(buf->p, "\r\n\r\n") : NULL;
        if (end) return 0;
        if (buf->n > 65536) return -1;

        got = recv(fd, tmp, sizeof tmp, 0);
        if (got <= 0) return -1;
        hf_buf_add(buf, tmp, (size_t)got);
    }
}

static int parse_request(HfSocket fd, HfConn *c)
{
    HfBuf buf;
    char *end, *line, *sp1, *sp2;
    char *headers_start;
    size_t header_len;
    char clen[64];

    memset(&c->req, 0, sizeof c->req);
    c->keep_alive = 1;

    hf_buf_init(&buf);
    if (read_headers(fd, &buf) != 0) { hf_buf_free(&buf); return -1; }

    end = strstr(buf.p, "\r\n\r\n");
    if (!end) { hf_buf_free(&buf); return -1; }
    header_len = (size_t)(end - buf.p) + 4;
    *end = '\0';

    line = buf.p;
    sp1 = strchr(line, ' ');
    if (!sp1) { hf_buf_free(&buf); return -1; }
    *sp1 = '\0';
    sp2 = strchr(sp1 + 1, ' ');
    if (sp2) *sp2 = '\0';

    snprintf(c->req.method, sizeof c->req.method, "%s", line);
    {
        /* 请求目标里的 ?query 不属于路径。静态资源会被注入 ?v=<版本>，
         * 不剥离的话浏览器请求的每个 JS 模块都会走到 404，前端整体起不来。 */
        char *target = sp1 + 1;
        char *q = strpbrk(target, "?#");
        if (q) *q = '\0';
        snprintf(c->req.path, sizeof c->req.path, "%s", target);
    }

    headers_start = sp2 ? sp2 + 1 : "";
    /* sp2 指向版本串，真正的头从下一行开始 */
    if (sp2) {
        char *nl = strstr(headers_start, "\r\n");
        headers_start = nl ? nl + 2 : "";
    }

    if (header_lookup(headers_start, "Content-Length", clen, sizeof clen))
        c->req.content_length = (size_t)strtoul(clen, NULL, 10);
    header_lookup(headers_start, "Origin", c->req.origin, sizeof c->req.origin);
    header_lookup(headers_start, "Host", c->req.host, sizeof c->req.host);
    header_lookup(headers_start, "Content-Type", c->req.content_type, sizeof c->req.content_type);
    {
        char conn[64];
        if (header_lookup(headers_start, "Connection", conn, sizeof conn)) {
            if (_stricmp(conn, "close") == 0) c->keep_alive = 0;
            if (_stricmp(conn, "keep-alive") == 0) c->keep_alive = 1;
        }
    }

    if (c->req.content_length > HF_MAX_BODY) {
        c->req.too_large = 1;
        hf_buf_free(&buf);
        return 0;
    }

    if (c->req.content_length) {
        size_t already = buf.n > header_len ? buf.n - header_len : 0;
        c->req.body = (char *)malloc(c->req.content_length + 1);
        if (!c->req.body) { hf_buf_free(&buf); return -1; }
        if (already > c->req.content_length) already = c->req.content_length;
        if (already) memcpy(c->req.body, buf.p + header_len, already);
        c->req.body_len = already;
        while (c->req.body_len < c->req.content_length) {
            int got = recv(fd, c->req.body + c->req.body_len,
                           (int)(c->req.content_length - c->req.body_len), 0);
            if (got <= 0) break;
            c->req.body_len += (size_t)got;
        }
        c->req.body[c->req.body_len] = '\0';
    }

    hf_buf_free(&buf);
    return 0;
}

int hf_bind_is_loopback(void)
{
    const char *host = g_cfg.bind_host;
    return !*host || !strcmp(host, "127.0.0.1") || !_stricmp(host, "localhost") ||
           !strcmp(host, "::1") || !strcmp(host, "[::1]");
}

int hf_origin_allowed(const char *origin)
{
    static const char *LOCAL[] = { "localhost", "127.0.0.1", "[::1]", NULL };
    char host[256];
    int i;
    if (!origin || !*origin) return 1; /* 命令行客户端通常不带 Origin。 */
    if (!(strncmp(origin, "http://", 7) == 0 || strncmp(origin, "https://", 8) == 0)) return 0;
    if (strchr(origin, '@')) return 0;
    if (!hf_url_host(origin, host, sizeof host)) return 0;
    for (i = 0; LOCAL[i]; i++)
        if (_stricmp(host, LOCAL[i]) == 0) return 1;
    if (hf_bind_is_loopback()) return 0; /* 默认只服务本机页面。 */
    if (strncmp(host, "10.", 3) == 0) return 1;
    if (strncmp(host, "192.168.", 8) == 0) return 1;
    if (strncmp(host, "172.", 4) == 0) {
        int second = atoi(host + 4);
        return second >= 16 && second <= 31;
    }
    {
        size_t l = strlen(host);
        return l > 6 && _stricmp(host + l - 6, ".local") == 0;
    }
}

int hf_host_allowed(const char *host)
{
    static const char *LOCAL[] = { "localhost", "127.0.0.1", "[::1]", NULL };
    char name[256];
    size_t len;
    const char *colon;
    int i;
    if (!host || !*host) return 1; /* 非浏览器客户端通常不带 Host；Rebinding 攻击一定带。 */
    if (host[0] == '[') {
        const char *end = strchr(host, ']');
        if (!end) return 0;
        len = (size_t)(end - host) + 1;
    } else {
        colon = strchr(host, ':');
        len = colon ? (size_t)(colon - host) : strlen(host);
    }
    if (len == 0 || len >= sizeof name) return 0;
    memcpy(name, host, len); name[len] = '\0';
    for (i = 0; LOCAL[i]; i++)
        if (_stricmp(name, LOCAL[i]) == 0) return 1;
    if (hf_bind_is_loopback()) return 0;
    if (strncmp(name, "10.", 3) == 0) return 1;
    if (strncmp(name, "192.168.", 8) == 0) return 1;
    if (strncmp(name, "172.", 4) == 0) {
        int second = atoi(name + 4);
        return second >= 16 && second <= 31;
    }
    {
        size_t l = strlen(name);
        return l > 6 && _stricmp(name + l - 6, ".local") == 0;
    }
}

const char *hf_cors_origin(const char *origin, char *buf, size_t n)
{
    snprintf(buf, n, "http://localhost:%d", g_cfg.port);
    if (hf_origin_allowed(origin) && origin && *origin) snprintf(buf, n, "%s", origin);
    return buf;
}

void hf_send_bytes_ex(HfConn *c, int status, const char *ctype,
                      const char *data, size_t len, const char *cache,
                      const char *extra_headers)
{
    HfBuf head;
    char cors[600];

    c->last_status = status;
    hf_buf_init(&head);
    hf_buf_printf(&head, "HTTP/1.1 %d %s\r\n", status, status_text(status));
    hf_buf_printf(&head, "Content-Type: %s\r\n", ctype ? ctype : "application/octet-stream");
    hf_buf_printf(&head, "Content-Length: %lu\r\n", (unsigned long)len);
    if (cache) hf_buf_printf(&head, "Cache-Control: %s\r\n", cache);
    if (extra_headers && *extra_headers) hf_buf_puts(&head, extra_headers);
    if (c->req.origin[0]) {
        hf_cors_origin(c->req.origin, cors, sizeof cors);
        hf_buf_printf(&head, "Access-Control-Allow-Origin: %s\r\n", cors);
    }
    add_security_headers(&head);
    hf_buf_printf(&head, "Connection: %s\r\n\r\n", c->keep_alive ? "keep-alive" : "close");

    send_all(c->fd, head.p, head.n);
    if (len) send_all(c->fd, data, len);
    hf_buf_free(&head);
}

void hf_send_bytes(HfConn *c, int status, const char *ctype,
                   const char *data, size_t len, const char *cache)
{
    hf_send_bytes_ex(c, status, ctype, data, len, cache, NULL);
}

long long hf_now_ms(void)
{
    FILETIME ft;
    ULARGE_INTEGER u;
    GetSystemTimeAsFileTime(&ft);
    u.LowPart = ft.dwLowDateTime;
    u.HighPart = ft.dwHighDateTime;
    /* 100ns since 1601 → ms since 1970 */
    return (long long)((u.QuadPart - 116444736000000000ULL) / 10000ULL);
}

void hf_send_text(HfConn *c, int status, const char *text)
{
    if (!text) text = "";
    hf_send_bytes(c, status, "text/plain; charset=utf-8", text, strlen(text), NULL);
}

void hf_send_json(HfConn *c, int status, JNode *n)
{
    HfBuf b;
    hf_buf_init(&b);
    json_write(n, &b, 1, 0);
    hf_send_bytes(c, status, "application/json; charset=utf-8", b.p, b.n, "no-store");
    hf_buf_free(&b);
    json_free(n);
}

void hf_send_error(HfConn *c, int status, const char *code, const char *message)
{
    JNode *o = json_new_obj();
    json_obj_set_str(o, "error", code ? code : "error");
    json_obj_set_str(o, "message", message ? message : "");
    hf_send_json(c, status, o);
}

/* ---- SSE 流式写出 ---- */

void hf_sse_begin(HfConn *c)
{
    HfBuf head;
    char cors[600];

    c->last_status = 200;
    hf_buf_init(&head);
    hf_buf_printf(&head, "HTTP/1.1 200 OK\r\n");
    hf_buf_printf(&head, "Content-Type: text/event-stream; charset=utf-8\r\n");
    hf_buf_printf(&head, "Cache-Control: no-cache, no-transform\r\n");
    hf_buf_printf(&head, "X-Accel-Buffering: no\r\n");
    /* SSE 流用 close 收尾：浏览器在连接关闭时自然知道流结束，无需 Content-Length。 */
    hf_buf_printf(&head, "Connection: close\r\n");
    if (c->req.origin[0]) {
        hf_cors_origin(c->req.origin, cors, sizeof cors);
        hf_buf_printf(&head, "Access-Control-Allow-Origin: %s\r\n", cors);
    }
    add_security_headers(&head);
    hf_buf_puts(&head, "\r\n");
    send_all(c->fd, head.p, head.n);
    hf_buf_free(&head);
    c->keep_alive = 0;  /* 连接仅供本次 SSE，读完即关，不回 keep-alive 循环 */
}

void hf_sse_event(HfConn *c, const JNode *n)
{
    HfBuf b;
    hf_buf_init(&b);
    json_write(n, &b, 0, 0);   /* compact：SSE 单帧必须是一行 */
    {
        HfBuf frame;
        hf_buf_init(&frame);
        hf_buf_puts(&frame, "data: ");
        hf_buf_add(&frame, b.p, b.n);
        hf_buf_puts(&frame, "\n\n");
        send_all(c->fd, frame.p, frame.n);
        hf_buf_free(&frame);
    }
    hf_buf_free(&b);
}

void hf_sse_done(HfConn *c)
{
    const char *tail = "data: [DONE]\n\n";
    send_all(c->fd, tail, strlen(tail));
}

static unsigned __stdcall conn_thread(void *arg)
{
    HfConn *c = (HfConn *)arg;
    int guard;
    DWORD tv = 20000;

    setsockopt(c->fd, SOL_SOCKET, SO_RCVTIMEO, (const char *)&tv, sizeof tv);
    setsockopt(c->fd, SOL_SOCKET, SO_SNDTIMEO, (const char *)&tv, sizeof tv);

    for (guard = 0; guard < 200; guard++) {
        long long t0;
        if (parse_request(c->fd, c) != 0) break;
        t0 = hf_now_ms();
        c->last_status = 0;

        if (c->req.too_large) {
            c->keep_alive = 0;
            hf_send_error(c, 413, "payload_too_large", "请求体超过 2MB 限制。");
        } else {
            hf_route(c);
        }

        log_request(c, hf_now_ms() - t0);
        free(c->req.body);
        c->req.body = NULL;
        if (!c->keep_alive) break;
    }

    free(c->req.body);
    closesocket(c->fd);
    free(c);
    return 0;
}

int hf_server_main(int argc, char **argv)
{
    WSADATA wsa;
    SOCKET srv;
    struct sockaddr_in addr;
    int port = 0;
    int i;
    const char *root = NULL;
    const char *bind_host = NULL;

    for (i = 2; i < argc; i++) {
        if (strcmp(argv[i], "--port") == 0 && i + 1 < argc) port = atoi(argv[++i]);
        else if (strcmp(argv[i], "--root") == 0 && i + 1 < argc) root = argv[++i];
        else if (strcmp(argv[i], "--bind") == 0 && i + 1 < argc) bind_host = argv[++i];
    }

    hf_config_load(root);
    if (port > 0) g_cfg.port = port;
    if (bind_host && *bind_host) snprintf(g_cfg.bind_host, sizeof g_cfg.bind_host, "%s", bind_host);

    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        fprintf(stderr, "hf: WSAStartup 失败\n");
        return 1;
    }

    srv = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (srv == INVALID_SOCKET) {
        fprintf(stderr, "hf: 创建 socket 失败\n");
        return 1;
    }
    {
        BOOL yes = TRUE;
        setsockopt(srv, SOL_SOCKET, SO_REUSEADDR, (const char *)&yes, sizeof yes);
    }

    memset(&addr, 0, sizeof addr);
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = inet_addr(g_cfg.bind_host);
    if (addr.sin_addr.s_addr == INADDR_NONE) {
        fprintf(stderr, "hf: 无效的监听地址 %s（请填写 IPv4 地址，默认 127.0.0.1）\n", g_cfg.bind_host);
        closesocket(srv);
        return 1;
    }
    addr.sin_port = htons((u_short)g_cfg.port);

    if (bind(srv, (struct sockaddr *)&addr, sizeof addr) == SOCKET_ERROR) {
        fprintf(stderr, "hf: 端口 %d 绑定失败（可能已被占用）\n", g_cfg.port);
        closesocket(srv);
        return 1;
    }
    if (listen(srv, 64) == SOCKET_ERROR) {
        fprintf(stderr, "hf: listen 失败\n");
        closesocket(srv);
        return 1;
    }

    printf("\n恋爱模拟器（C 版）已启动: http://localhost:%d\n", g_cfg.port);
    printf("监听地址: %s\n", g_cfg.bind_host);
    if (!hf_bind_is_loopback())
        printf("警告: 当前监听非回环地址，同网段设备可能访问；仅在确需局域网共享时使用。\n");
    printf("API 代理: POST http://localhost:%d/api/chat\n", g_cfg.port);
    printf("模型: %s\n", g_cfg.llm_model);
    {
        char masked[600];
        hf_mask_endpoint(g_cfg.llm_endpoint, masked, sizeof masked);
        printf("Endpoint: %s\n", masked);
    }
    printf("API Key: %s\n", g_cfg.llm_api_key[0] ? "已配置" : "未配置，调用真实模型会失败");
    printf("静态目录: %s\n\n", g_cfg.public_dir);
    fflush(stdout);

    for (;;) {
        SOCKET cli = accept(srv, NULL, NULL);
        HfConn *c;
        if (cli == INVALID_SOCKET) {
            if (WSAGetLastError() == WSAEINTR) break;
            continue;
        }
        c = (HfConn *)calloc(1, sizeof(HfConn));
        if (!c) { closesocket(cli); continue; }
        c->fd = cli;
        c->keep_alive = 1;
        if (_beginthreadex(NULL, 0, conn_thread, c, 0, NULL) == 0) {
            closesocket(cli);
            free(c);
        }
    }

    closesocket(srv);
    WSACleanup();
    return 0;
}

#else /* 非 Windows */

int hf_server_main(int argc, char **argv)
{
    (void)argc; (void)argv;
    fprintf(stderr, "hf: serve 目标平台是 Windows（Winsock + WinHTTP）\n");
    return 1;
}

#endif
