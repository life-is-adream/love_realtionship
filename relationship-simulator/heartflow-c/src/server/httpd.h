/* httpd.h — 本地 HTTP 服务（Winsock）与响应工具 */
#ifndef HF_HTTPD_H
#define HF_HTTPD_H

#include "../json.h"

#ifdef _WIN32
#  include <winsock2.h>
typedef SOCKET HfSocket;
#else
typedef int HfSocket;
#endif

#define HF_MAX_BODY (2 * 1000 * 1000)

typedef struct {
    char    method[8];
    char    path[2048];
    char    origin[512];
    char    host[300];
    char    content_type[128];
    size_t  content_length;
    char   *body;
    size_t  body_len;
    int     too_large;
} HfRequest;

typedef struct {
    HfSocket  fd;
    int       keep_alive;
    HfRequest req;
} HfConn;

int  hf_server_main(int argc, char **argv);

void hf_send_json(HfConn *c, int status, JNode *n);          /* 接管 n */
void hf_send_text(HfConn *c, int status, const char *text);
void hf_send_bytes(HfConn *c, int status, const char *ctype,
                   const char *data, size_t len, const char *cache);
void hf_send_bytes_ex(HfConn *c, int status, const char *ctype,
                      const char *data, size_t len, const char *cache,
                      const char *extra_headers);
int  hf_static_serve(HfConn *c);
long long hf_now_ms(void);
void hf_send_error(HfConn *c, int status, const char *code, const char *message);
/* SSE 流式响应：先写头（text/event-stream + Connection: close + 禁缓冲），
 * 再用 hf_sse_event 逐帧写 "data: ...\n\n"。写完后调用方不复用连接。 */
void hf_sse_begin(HfConn *c);
void hf_sse_event(HfConn *c, const JNode *n);   /* 序列化为一个 data 事件 */
void hf_sse_done(HfConn *c);                    /* 写 data: [DONE]，结束流 */
const char *hf_cors_origin(const char *origin, char *buf, size_t n);
/* 默认仅回环监听；只有显式配置 bind_host 才放行局域网来源。 */
int  hf_bind_is_loopback(void);
int  hf_origin_allowed(const char *origin);
/* 校验 Host，防止 DNS rebinding 用外部域名借本机服务读数据。 */
int  hf_host_allowed(const char *host);
void hf_route(HfConn *c);

#endif
