#define _POSIX_C_SOURCE 200809L

#include "httpd.h"
#include "config.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32

#include <process.h>
#include <ws2tcpip.h>

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

static unsigned __stdcall conn_thread(void *arg)
{
    HfConn *c = (HfConn *)arg;
    int guard;
    DWORD tv = 20000;

    setsockopt(c->fd, SOL_SOCKET, SO_RCVTIMEO, (const char *)&tv, sizeof tv);
    setsockopt(c->fd, SOL_SOCKET, SO_SNDTIMEO, (const char *)&tv, sizeof tv);

    for (guard = 0; guard < 200; guard++) {
        if (parse_request(c->fd, c) != 0) break;

        if (c->req.too_large) {
            c->keep_alive = 0;
            hf_send_error(c, 413, "payload_too_large", "请求体超过 2MB 限制。");
        } else {
            hf_route(c);
        }

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
