/* net.h — 出站 HTTP(S) 客户端
 *
 * 为什么用 WinHTTP 而不是自己写 TLS：本项目禁止外部依赖，
 * 而 TLS 自行实现既不可审计也不该出现在产品代码里。
 * WinHTTP 是 Windows 自带组件，属于操作系统能力，不是第三方库。
 */
#ifndef HF_NET_H
#define HF_NET_H

#include <stddef.h>

typedef struct {
    int    status;
    char  *body;
    size_t len;
    char   content_type[128];
    char  *header_block;   /* 原始响应头（UTF-8 / CRLF），用于按需转发上游头 */
} HfHttpResp;

int  hf_http_request(const char *method, const char *url, const char *bearer,
                     const char *content_type, const char *body, size_t body_len,
                     int timeout_ms, HfHttpResp *out, char *err, size_t errsz);

/* 对网络错误与 5xx 重试一次；4xx 与超时不重试。 */
int  hf_http_request_retry(const char *method, const char *url, const char *bearer,
                           const char *content_type, const char *body, size_t body_len,
                           int timeout_ms, HfHttpResp *out, char *err, size_t errsz);

void hf_http_free(HfHttpResp *r);

/* 从上游响应头里取一个值（大小写不敏感），复制到 out。
 * 值中的 CR/LF/控制字符会被丢弃，防止响应头注入。
 * 返回 1=找到，0=未找到。生命周期与 HfHttpResp 无关。 */
int  hf_http_header(const HfHttpResp *r, const char *name, char *out, size_t outsz);

#endif
