#define _POSIX_C_SOURCE 200809L

#include "coach.h"
#include "config.h"
#include "httpd.h"
#include "net.h"
#include "v2.h"
#include "../voice/tts.h"

#include "../hf.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#ifdef _WIN32
#  include <windows.h>
#endif

/* ================= 通用 ================= */

static void route_chat_stream(HfConn *c, JNode *body, const char *api_key);

static void utf8_truncate(const char *src, size_t max_bytes, char *out, size_t n)
{
    size_t len = strlen(src);
    if (len > max_bytes) {
        len = max_bytes;
        while (len > 0 && ((unsigned char)src[len] & 0xC0) == 0x80) len--;
    }
    if (len >= n) len = n - 1;
    memcpy(out, src, len);
    out[len] = '\0';
}

static JNode *body_of(HfConn *c)
{
    char err[128];
    JNode *n;

    if (c->req.too_large) {
        hf_send_error(c, 413, "payload_too_large", "请求体超过 2MB 限制。");
        return NULL;
    }
    if (!c->req.body || c->req.body_len == 0) return json_new_obj();

    n = json_parse(c->req.body, c->req.body_len, err, sizeof err);
    if (!n || n->type != JOBJ) {
        json_free(n);
        hf_send_error(c, 400, "invalid_json", "请求体不是合法 JSON。");
        return NULL;
    }
    return n;
}

static double clamp_num(const JNode *body, const char *key, const char *alt,
                        double lo, double hi, double def)
{
    JNode *v = json_get(body, key);
    double d;
    if (!v && alt) v = json_get(body, alt);
    if (!v || v->type != JNUM) return def;
    d = v->u.num;
    if (d < lo) d = lo;
    if (d > hi) d = hi;
    return d;
}

static int rate_limited(const char *ip)
{
    /* 测试豁免：一致性脚本需在单实例上批量请求（C/Node 对照），
     * 会远超正常用户的 24/分钟；设 HF_RATE_LIMIT_DISABLE=1 跳过。
     * 生产默认不设，限流照常生效（安全冒烟仍验证 429）。 */
    {
        const char *off = getenv("HF_RATE_LIMIT_DISABLE");
        if (off && (!strcmp(off, "1") || !_stricmp(off, "true"))) return 0;
    }
#ifdef _WIN32
    typedef struct { char ip[64]; DWORD start; int count; } Bucket;
    static Bucket buckets[128];
    static CRITICAL_SECTION cs;
    static LONG init = 0;
    DWORD now = GetTickCount();
    int i, free_slot = -1;

    if (InterlockedCompareExchange(&init, 1, 0) == 0) InitializeCriticalSection(&cs);
    EnterCriticalSection(&cs);
    for (i = 0; i < 128; i++) {
        if (buckets[i].ip[0] && strcmp(buckets[i].ip, ip) == 0) {
            if (now - buckets[i].start > 60000u) {
                buckets[i].start = now;
                buckets[i].count = 1;
                LeaveCriticalSection(&cs);
                return 0;
            }
            buckets[i].count++;
            i = buckets[i].count > 24;
            LeaveCriticalSection(&cs);
            return i;
        }
        if (!buckets[i].ip[0] && free_slot < 0) free_slot = i;
    }
    if (free_slot >= 0) {
        snprintf(buckets[free_slot].ip, sizeof buckets[free_slot].ip, "%s", ip);
        buckets[free_slot].start = now;
        buckets[free_slot].count = 1;
    }
    LeaveCriticalSection(&cs);
    return 0;
#else
    (void)ip;
    return 0;
#endif
}

static void peer_ip(HfConn *c, char *out, size_t n)
{
#ifdef _WIN32
    struct sockaddr_in a;
    int len = sizeof a;
    if (getpeername(c->fd, (struct sockaddr *)&a, &len) == 0)
        snprintf(out, n, "%s", inet_ntoa(a.sin_addr));
    else
        snprintf(out, n, "%s", "unknown");
#else
    (void)c;
    snprintf(out, n, "%s", "unknown");
#endif
}

/* ================= /api/health ================= */

static void route_health(HfConn *c)
{
    JNode *o = json_new_obj();
    char masked[600];
    hf_mask_endpoint(g_cfg.llm_endpoint, masked, sizeof masked);

    json_obj_set_bool(o, "ok", 1);
    json_obj_set_str(o, "service", "heartflow");
    json_obj_set_str(o, "endpoint", masked);
    json_obj_set_str(o, "model", g_cfg.llm_model);
    json_obj_set_str(o, "apiMode", g_cfg.llm_api_mode);
    json_obj_set_bool(o, "hasApiKey", g_cfg.llm_api_key[0] ? 1 : 0);
    hf_send_json(c, 200, o);
}

/* ================= /api/chat ================= */

static JNode *clone_messages(const JNode *messages)
{
    JNode *out = json_new_arr();
    int i;
    for (i = 0; i < json_len(messages); i++) {
        JNode *m = json_at(messages, i);
        if (m) json_arr_push(out, json_clone(m));
    }
    return out;
}

static void route_chat(HfConn *c)
{
    JNode *body, *messages, *payload;
    const char *api_key;
    char *req_text;
    HfBuf b;
    HfHttpResp resp;
    char err[256];
    int rc;

    /* 限流已统一上移到 hf_route 入口，避免 SSE 分支被计两次。 */
    body = body_of(c);
    if (!body) return;

    /* stream:true 走 SSE 流式分支；其余请求保持原样（非流式）不受影响。 */
    if (json_bool(body, "stream", 0)) {
        api_key = json_str(body, "apiKey", NULL);
        if (!api_key || !*api_key) api_key = g_cfg.llm_api_key;
        if (!api_key || !*api_key) {
            json_free(body);
            hf_send_error(c, 400, "missing_api_key",
                          "请在 .env 中配置 LLM_API_KEY，或在请求体中传 apiKey。");
            return;
        }
        route_chat_stream(c, body, api_key);
        json_free(body);
        return;
    }

    messages = json_get(body, "messages");
    if (!messages || messages->type != JARR || json_len(messages) == 0) {
        json_free(body);
        hf_send_error(c, 400, "bad_request", "`messages` 必须是非空数组。");
        return;
    }
    if (json_len(messages) > 200) {
        json_free(body);
        hf_send_error(c, 400, "bad_request", "`messages` 最多 200 条。");
        return;
    }

    api_key = json_str(body, "apiKey", NULL);
    if (!api_key || !*api_key) api_key = g_cfg.llm_api_key;
    if (!api_key || !*api_key) {
        json_free(body);
        hf_send_error(c, 400, "missing_api_key",
                      "请在 .env 中配置 LLM_API_KEY，或在请求体中传 apiKey。建议使用 .env。");
        return;
    }

    payload = json_new_obj();
    json_obj_set_str(payload, "model", g_cfg.llm_model);
    json_obj_set_num(payload, "temperature",
                     clamp_num(body, "temperature", NULL, 0, 2, g_cfg.llm_temperature));
    json_obj_set_num(payload, "top_p", clamp_num(body, "top_p", NULL, 0, 1, g_cfg.llm_top_p));
    json_obj_set_bool(payload, "stream", 0);

    if (strcmp(g_cfg.llm_api_mode, "responses") == 0) {
        json_obj_set(payload, "input", clone_messages(messages));
        json_obj_set_num(payload, "max_output_tokens",
                         clamp_num(body, "max_output_tokens", "max_completion_tokens", 1, 4096,
                                   (double)g_cfg.llm_max_tokens));
        {
            JNode *reason = json_new_obj();
            const char *eff = json_str(body, "reasoning_effort", g_cfg.llm_reasoning_effort);
            if (strcmp(eff, "low") != 0 && strcmp(eff, "medium") != 0 && strcmp(eff, "high") != 0)
                eff = g_cfg.llm_reasoning_effort;
            json_obj_set_str(reason, "effort", eff);
            json_obj_set(payload, "reasoning", reason);
        }
        json_obj_set_bool(payload, "store", 0);
    } else {
        json_obj_set(payload, "messages", clone_messages(messages));
        json_obj_set_num(payload, "max_completion_tokens",
                         clamp_num(body, "max_completion_tokens", "max_output_tokens", 1, 4096,
                                   (double)g_cfg.llm_max_tokens));
        {
            JNode *th = json_get(body, "thinking");
            const char *ty = th ? json_str(th, "type", NULL) : NULL;
            if (ty && (strcmp(ty, "disabled") == 0 || strcmp(ty, "enabled") == 0)) {
                JNode *t = json_new_obj();
                json_obj_set_str(t, "type", ty);
                json_obj_set(payload, "thinking", t);
            }
        }
    }

    {
        JNode *rf = json_get(body, "response_format");
        if (rf && rf->type == JOBJ) {
            if (strcmp(g_cfg.llm_api_mode, "responses") == 0) {
                JNode *text = json_new_obj();
                json_obj_set(text, "format", json_clone(rf));
                json_obj_set(payload, "text", text);
            } else {
                json_obj_set(payload, "response_format", json_clone(rf));
            }
        }
    }

    {
        JNode *stop = json_get(body, "stop");
        if (stop && stop->type == JARR) {
            JNode *out = json_new_arr();
            int i;
            for (i = 0; i < json_len(stop) && i < 4; i++) {
                JNode *s = json_at(stop, i);
                if (s && s->type == JSTR) json_arr_push(out, json_clone(s));
            }
            if (json_len(out)) json_obj_set(payload, "stop", out);
            else json_free(out);
        }
    }
    {
        JNode *fp = json_get(body, "frequency_penalty");
        JNode *pp = json_get(body, "presence_penalty");
        if (fp && fp->type == JNUM) json_obj_set_num(payload, "frequency_penalty",
            clamp_num(body, "frequency_penalty", NULL, -2, 2, 0));
        if (pp && pp->type == JNUM) json_obj_set_num(payload, "presence_penalty",
            clamp_num(body, "presence_penalty", NULL, -2, 2, 0));
    }

    hf_buf_init(&b);
    json_write(payload, &b, 0, 0);
    json_free(payload);
    json_free(body);
    req_text = hf_buf_take(&b);

    rc = hf_http_request_retry("POST", g_cfg.llm_endpoint, api_key,
                               "application/json", req_text, strlen(req_text),
                               120000, &resp, err, sizeof err);
    free(req_text);

    if (rc != 0) {
        int timeout = strstr(err, "timed out") != NULL || strstr(err, "timeout") != NULL;
        hf_send_error(c, timeout ? 504 : 502,
                      timeout ? "upstream_timeout" : "upstream_unreachable",
                      timeout ? "上游模型响应超时（120s）。" : "无法连接上游模型服务。");
        return;
    }

    if (resp.status >= 400) {
        char detail[320];
        JNode *ej = resp.body ? json_parse(resp.body, resp.len, NULL, 0) : NULL;
        const char *msg = ej ? json_str(json_get(ej, "error"), "message", NULL) : NULL;
        if (!msg && ej) msg = json_str(ej, "message", NULL);
        if (!msg) msg = resp.body ? resp.body : "";
        utf8_truncate(msg, 300, detail, sizeof detail);
        {
            JNode *o = json_new_obj();
            json_obj_set_str(o, "error", "upstream_error");
            json_obj_set_num(o, "upstreamStatus", resp.status);
            {
                char line[420];
                snprintf(line, sizeof line, "上游模型服务返回 %d：%s", resp.status, detail);
                json_obj_set_str(o, "message", line);
            }
            hf_send_json(c, 502, o);
        }
        json_free(ej);
        hf_http_free(&resp);
        return;
    }

    /* Responses 模式：把 output 结构补成前端通用的 choices 结构 */
    if (strcmp(g_cfg.llm_api_mode, "responses") == 0 && strstr(resp.content_type, "json") != NULL) {
        JNode *j = resp.body ? json_parse(resp.body, resp.len, NULL, 0) : NULL;
        if (j && j->type == JOBJ) {
            char content[8192];
            int found = 0;
            JNode *ot = json_get(j, "output_text");
            content[0] = '\0';

            if (ot && ot->type == JSTR && ot->u.str.n) {
                snprintf(content, sizeof content, "%s", ot->u.str.s);
                found = 1;
            }
            if (!found) {
                JNode *output = json_get(j, "output");
                int i, k;
                for (i = 0; i < json_len(output) && !found; i++) {
                    JNode *item = json_at(output, i);
                    JNode *cs = item ? json_get(item, "content") : NULL;
                    for (k = 0; k < json_len(cs); k++) {
                        JNode *cc = json_at(cs, k);
                        const char *ty = cc ? json_str(cc, "type", "") : "";
                        const char *tx = cc ? json_str(cc, "text", NULL) : NULL;
                        if (strcmp(ty, "output_text") == 0 && tx && *tx) {
                            snprintf(content, sizeof content, "%s", tx);
                            found = 1;
                            break;
                        }
                    }
                }
            }
            if (found && content[0]) {
                JNode *choice = json_new_obj();
                JNode *msg = json_new_obj();
                JNode *choices = json_new_arr();
                JNode *out = json_clone(j);

                json_obj_set_str(msg, "role", "assistant");
                json_obj_set_str(msg, "content", content);
                json_obj_set_num(choice, "index", 0);
                json_obj_set(choice, "message", msg);
                json_obj_set_str(choice, "finish_reason", "stop");
                json_arr_push(choices, choice);
                json_obj_set(out, "choices", choices);
                json_obj_set_str(out, "output_text", content);

                hf_send_json(c, resp.status, out);
                json_free(j);
                hf_http_free(&resp);
                return;
            }
        }
        json_free(j);
    }

    hf_send_bytes(c, resp.status > 0 ? resp.status : 200,
                  resp.content_type[0] ? resp.content_type : "application/json; charset=utf-8",
                  resp.body ? resp.body : "", resp.len, NULL);
    hf_http_free(&resp);
}

/* ================= /api/chat 的 SSE 流式分支 ================= */

typedef struct {
    HfConn *c;
    char   *line;       /* 累积的行缓冲（跨 WinHTTP 块） */
    size_t  line_len, line_cap;
    int     began;      /* 是否已写出 SSE HTTP 头 */
    int     sent_any;   /* 是否已发出任何内容帧 */
    int     stopped;    /* 调用方请求提前结束 */
} StreamCtx;

static void sse_ensure_begin(StreamCtx *s)
{
    if (!s->began) { hf_sse_begin(s->c); s->began = 1; }
}

static void sse_line_append(StreamCtx *s, const char *p, size_t n)
{
    while (s->line_len + n + 1 > s->line_cap) {
        size_t nc = s->line_cap ? s->line_cap * 2 : 8192;
        char *np = (char *)realloc(s->line, nc);
        if (!np) return;
        s->line = np; s->line_cap = nc;
    }
    memcpy(s->line + s->line_len, p, n);
    s->line_len += n;
    s->line[s->line_len] = '\0';
}

/* 处理一个完整的 SSE data 行。返回 0 继续，非 0 停止。 */
static int sse_data_line(StreamCtx *s, const char *jsonline)
{
    JNode *frame, *choices, *choice, *delta;
    const char *content, *reasoning;
    int stop = 0;

    if (strcmp(jsonline, "[DONE]") == 0) { sse_ensure_begin(s); return 1; }
    frame = json_parse(jsonline, strlen(jsonline), NULL, 0);
    if (!frame || frame->type != JOBJ) { json_free(frame); return 0; }
    choices = json_get(frame, "choices");
    choice = (choices && choices->type == JARR) ? json_at(choices, 0) : NULL;
    delta = choice ? json_get(choice, "delta") : NULL;
    if (delta && delta->type == JOBJ) {
        content = json_str(delta, "content", NULL);
        reasoning = json_str(delta, "reasoning_content", NULL);
        if (content && *content) {
            JNode *ev = json_new_obj();
            json_obj_set_str(ev, "type", "content");
            json_obj_set_str(ev, "delta", content);
            sse_ensure_begin(s);
            hf_sse_event(s->c, ev);
            json_free(ev);
            s->sent_any = 1;
        }
        /* 思维链单独成帧，前端可据此显示"正在思考"；不混入正文。 */
        if (reasoning && *reasoning) {
            JNode *ev = json_new_obj();
            json_obj_set_str(ev, "type", "reasoning");
            json_obj_set_str(ev, "delta", reasoning);
            sse_ensure_begin(s);
            hf_sse_event(s->c, ev);
            json_free(ev);
            s->sent_any = 1;
        }
    } else {
        /* 上游错误帧（无 choices）：把 message 透出，便于前端报错。 */
        const char *em = json_str(frame, "message", NULL);
        if (em && *em) {
            JNode *ev = json_new_obj();
            json_obj_set_str(ev, "type", "error");
            json_obj_set_str(ev, "message", em);
            sse_ensure_begin(s);
            hf_sse_event(s->c, ev);
            json_free(ev);
            stop = 1;
        }
    }
    json_free(frame);
    return stop;
}

/* 逐块回调：按行拆分上游 SSE。WinHTTP 块边界与 data 帧边界无关。 */
static int sse_chunk_cb(const char *chunk, size_t len, void *user, int first)
{
    StreamCtx *s = (StreamCtx *)user;
    size_t i;
    (void)first;
    /* 逐字节累积到行缓冲，遇 \n 处理完整行。
     * WinHTTP 的块边界与 SSE 的 data 帧边界无关，必须跨块拼行。 */
    for (i = 0; i < len; i++) {
        if (chunk[i] == '\n') {
            if (s->line_len > 0) {
                if (s->line[s->line_len - 1] == '\r') s->line_len--;
                s->line[s->line_len] = '\0';
                if (strncmp(s->line, "data:", 5) == 0) {
                    const char *payload = s->line + 5;
                    while (*payload == ' ') payload++;
                    if (sse_data_line(s, payload)) { s->stopped = 1; s->line_len = 0; return 1; }
                }
                s->line_len = 0;
            }
        } else {
            sse_line_append(s, chunk + i, 1);
        }
    }
    return 0;
}

/* 流式 handler：与 route_chat 共用 payload 构造，但向上游发 stream=true，
 * 并把上游 SSE 实时翻译成前端协议。仅在请求体带 stream:true 时进入。 */
static void route_chat_stream(HfConn *c, JNode *body, const char *api_key)
{
    char ip[64];
    JNode *messages, *payload, *th;
    const char *ty;
    char *req_text;
    HfBuf b;
    StreamCtx s;
    int rc, status = 0;
    char err[256];

    /* 限流已统一上移到 hf_route 入口。 */
    (void)ip;
    messages = json_get(body, "messages");
    if (!messages || messages->type != JARR || json_len(messages) == 0) {
        hf_send_error(c, 400, "bad_request", "`messages` 必须是非空数组。");
        return;
    }
    if (json_len(messages) > 200) {
        hf_send_error(c, 400, "bad_request", "`messages` 最多 200 条。");
        return;
    }

    /* 只支持 chat_completions 的 SSE；responses 模式回退到非流式。 */
    if (strcmp(g_cfg.llm_api_mode, "responses") == 0) {
        hf_send_error(c, 400, "stream_unsupported",
                      "流式仅支持 chat_completions 模式，请调整 LLM_API_MODE。");
        return;
    }

    payload = json_new_obj();
    json_obj_set_str(payload, "model", g_cfg.llm_model);
    json_obj_set_num(payload, "temperature",
                     clamp_num(body, "temperature", NULL, 0, 2, g_cfg.llm_temperature));
    json_obj_set_num(payload, "top_p", clamp_num(body, "top_p", NULL, 0, 1, g_cfg.llm_top_p));
    json_obj_set_bool(payload, "stream", 1);           /* 关键：上游开流 */
    json_obj_set(payload, "messages", clone_messages(messages));
    json_obj_set_num(payload, "max_completion_tokens",
                     clamp_num(body, "max_completion_tokens", "max_output_tokens", 1, 4096,
                               (double)g_cfg.llm_max_tokens));
    th = json_get(body, "thinking");
    ty = th ? json_str(th, "type", NULL) : NULL;
    if (ty && (strcmp(ty, "disabled") == 0 || strcmp(ty, "enabled") == 0)) {
        JNode *t = json_new_obj();
        json_obj_set_str(t, "type", ty);
        json_obj_set(payload, "thinking", t);
    }
    {
        JNode *fp = json_get(body, "frequency_penalty");
        JNode *pp = json_get(body, "presence_penalty");
        if (fp && fp->type == JNUM) json_obj_set_num(payload, "frequency_penalty",
            clamp_num(body, "frequency_penalty", NULL, -2, 2, 0));
        if (pp && pp->type == JNUM) json_obj_set_num(payload, "presence_penalty",
            clamp_num(body, "presence_penalty", NULL, -2, 2, 0));
    }

    hf_buf_init(&b);
    json_write(payload, &b, 0, 0);
    json_free(payload);
    req_text = hf_buf_take(&b);

    memset(&s, 0, sizeof s);
    s.c = c;
    rc = hf_http_stream("POST", g_cfg.llm_endpoint, api_key, "application/json",
                        req_text, strlen(req_text), 120000, &status,
                        sse_chunk_cb, &s, err, sizeof err);
    free(req_text);
    free(s.line);

    if (rc != 0 && status == 0) {
        /* 还没写流头就失败了，可以正常回 JSON 错误。 */
        int timeout = strstr(err, "timed out") != NULL || strstr(err, "timeout") != NULL;
        hf_send_error(c, timeout ? 504 : 502,
                      timeout ? "upstream_timeout" : "upstream_unreachable",
                      timeout ? "上游模型响应超时（120s）。" : "无法连接上游模型服务。");
        return;
    }
    if (status >= 400 || (rc != 0 && !s.sent_any)) {
        /* 上游非 2xx：错误体在 err 里（hf_http_stream 约定）。此时尚未写流头。 */
        char detail[300];
        utf8_truncate(err[0] ? err : "上游模型服务返回错误。", 260, detail, sizeof detail);
        {
            JNode *o = json_new_obj();
            json_obj_set_str(o, "error", "upstream_error");
            json_obj_set_num(o, "upstreamStatus", status);
            json_obj_set_str(o, "message", detail);
            hf_send_json(c, 502, o);
        }
        return;
    }

    /* 到这里已写过若干 SSE 帧（或上游 2xx 但零帧）：补 [DONE] 收尾。 */
    if (!s.began) hf_sse_begin(c);
    hf_sse_done(c);
}

/* ================= /api/search ================= */

static const char *today_stamp(char *out, size_t n)
{
    static const char *wd[] = { "星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六" };
    time_t t = time(NULL);
    struct tm tm;
#ifdef _WIN32
    localtime_s(&tm, &t);
#else
    tm = *localtime(&t);
#endif
    snprintf(out, n, "%d年%d月%d日%s", tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday, wd[tm.tm_wday]);
    return out;
}

static JNode *normalize_results_from_json(JNode *json)
{
    static const char *keys[] = { "results", "items", "data", NULL };
    JNode *arr = NULL;
    JNode *out = json_new_arr();
    int i, k;

    for (k = 0; keys[k]; k++) {
        JNode *v = json_get(json, keys[k]);
        if (v && v->type == JARR) { arr = v; break; }
    }
    for (i = 0; i < json_len(arr) && i < 5; i++) {
        JNode *it = json_at(arr, i);
        const char *url, *title, *snippet;
        char safe[512];
        if (!it || it->type != JOBJ) continue;
        url = json_str(it, "url", json_str(it, "link", json_str(it, "href", "")));
        if (!hf_url_safe(url) || !hf_domain_allowed(url)) continue;
        strncpy(safe, url, sizeof safe - 1);
        safe[sizeof safe - 1] = '\0';
        title = json_str(it, "title", json_str(it, "name", ""));
        snippet = json_str(it, "snippet", json_str(it, "description", json_str(it, "text", "")));
        {
            JNode *o = json_new_obj();
            char tb[210], sb[310];
            utf8_truncate(title, 200, tb, sizeof tb);
            utf8_truncate(snippet, 300, sb, sizeof sb);
            json_obj_set_str(o, "title", tb);
            json_obj_set_str(o, "url", safe);
            json_obj_set_str(o, "snippet", sb);
            json_obj_set_str(o, "source", safe);
            json_arr_push(out, o);
        }
    }
    return out;
}

static JNode *normalize_citations(JNode *message)
{
    JNode *ann = json_get(message, "annotations");
    JNode *out = json_new_arr();
    int i;
    for (i = 0; i < json_len(ann) && json_len(out) < 5; i++) {
        JNode *it = json_at(ann, i);
        JNode *cit;
        const char *type, *url, *title, *summary;
        char safe[512];
        if (!it || it->type != JOBJ) continue;
        type = json_str(it, "type", "");
        if (strcmp(type, "url_citation") != 0) continue;
        cit = json_get(it, "url_citation");
        if (!cit || cit->type != JOBJ) cit = it;
        url = json_str(cit, "url", "");
        if (!hf_url_safe(url) || !hf_domain_allowed(url)) continue;
        strncpy(safe, url, sizeof safe - 1);
        safe[sizeof safe - 1] = '\0';
        title = json_str(cit, "title", "");
        summary = json_str(cit, "summary", "");
        {
            JNode *o = json_new_obj();
            char tb[210], sb[310];
            utf8_truncate(title, 200, tb, sizeof tb);
            utf8_truncate(summary, 300, sb, sizeof sb);
            json_obj_set_str(o, "title", tb);
            json_obj_set_str(o, "url", safe);
            json_obj_set_str(o, "snippet", sb);
            json_obj_set_str(o, "source", safe);
            json_arr_push(out, o);
        }
    }
    return out;
}

static void route_search(HfConn *c)
{
    JNode *body = body_of(c);
    const char *query;
    char q[256];

    if (!body) return;
    query = json_str(body, "query", "");
    utf8_truncate(query, 120, q, sizeof q);
    json_free(body);

    if (!q[0]) { hf_send_error(c, 400, "bad_request", "`query` 不能为空。"); return; }

    printf("[search] query=\"%s\"\n", q);
    fflush(stdout);

    if (g_cfg.search_enabled) {
        JNode *payload = json_new_obj();
        HfBuf b;
        HfHttpResp resp;
        char err[256];
        char *text;
        int rc;

        json_obj_set_str(payload, "query", q);
        json_obj_set_num(payload, "count", 5);
        hf_buf_init(&b);
        json_write(payload, &b, 0, 0);
        json_free(payload);
        text = hf_buf_take(&b);

        rc = hf_http_request("POST", g_cfg.search_endpoint, g_cfg.search_api_key,
                             "application/json", text, strlen(text), 15000,
                             &resp, err, sizeof err);
        free(text);
        if (rc != 0) {
            hf_send_error(c, 502, "search_unreachable", "无法连接搜索服务。");
            return;
        }

        {
            JNode *j = resp.body ? json_parse(resp.body, resp.len, NULL, 0) : NULL;
            if (resp.status >= 400 || !j) {
                JNode *o = json_new_obj();
                json_obj_set_str(o, "error", "search_upstream_error");
                json_obj_set_num(o, "upstreamStatus", resp.status);
                {
                    char msg[160];
                    snprintf(msg, sizeof msg, "搜索服务返回 %d。", resp.status);
                    json_obj_set_str(o, "message", msg);
                }
                hf_send_json(c, 502, o);
                json_free(j);
                hf_http_free(&resp);
                return;
            }
            {
                JNode *o = json_new_obj();
                JNode *results = normalize_results_from_json(j);
                int raw_count = 0;
                {
                    static const char *keys[] = { "results", "items", "data", NULL };
                    int k;
                    for (k = 0; keys[k]; k++) {
                        JNode *v = json_get(j, keys[k]);
                        if (v && v->type == JARR) { raw_count = json_len(v); break; }
                    }
                }
                json_obj_set(o, "results", results);
                json_obj_set_num(o, "filtered", raw_count - json_len(results));
                json_obj_set_str(o, "engine", "external-endpoint");
                json_obj_set_str(o, "sourcePolicy", "allowlist");
                json_obj_set_str(o, "note", json_len(results) ? "" : "没有找到符合来源白名单的公开链接。");
                hf_send_json(c, 200, o);
            }
            json_free(j);
            hf_http_free(&resp);
        }
        return;
    }

    if (!g_cfg.llm_api_key[0]) {
        hf_send_error(c, 503, "search_disabled",
                      "联网搜索未启用：请在 .env 配置 LLM_API_KEY（模型联网搜索），或配置 SEARCH_ENDPOINT 与 SEARCH_API_KEY（外部搜索服务）。");
        return;
    }
    if (strcmp(g_cfg.llm_api_mode, "chat_completions") != 0 ||
        strstr(g_cfg.llm_endpoint, "/responses") != NULL) {
        hf_send_error(c, 503, "search_api_mode_unsupported",
                      "模型联网搜索仅支持 MiMo Chat Completions：请配置对应 LLM_ENDPOINT 和 LLM_API_MODE=chat_completions，或配置独立 SEARCH_ENDPOINT 与 SEARCH_API_KEY。Responses 模式尚不支持联网搜索。");
        return;
    }

    {
        JNode *payload = json_new_obj();
        JNode *msgs = json_new_arr();
        JNode *sys = json_new_obj();
        JNode *usr = json_new_obj();
        JNode *tools = json_new_arr();
        JNode *tool = json_new_obj();
        HfBuf b, sysbuf;
        char *text;
        HfHttpResp resp;
        char err[256];
        int rc;

        hf_buf_init(&sysbuf);
        hf_buf_printf(&sysbuf, "你是证据检索助手。今天是%s。只输出与查询相关的客观事实与公开来源，不要输出对话建议，不要编造。",
                      today_stamp(err, sizeof err));
        json_obj_set_str(sys, "role", "system");
        json_obj_set_str(sys, "content", sysbuf.p ? sysbuf.p : "");
        json_obj_set_str(usr, "role", "user");
        json_obj_set_str(usr, "content", q);
        json_arr_push(msgs, sys);
        json_arr_push(msgs, usr);
        json_obj_set_str(tool, "type", "web_search");
        json_obj_set_num(tool, "max_keyword", 2);
        json_obj_set_bool(tool, "force_search", 1);
        json_arr_push(tools, tool);

        json_obj_set_str(payload, "model", g_cfg.search_model);
        json_obj_set(payload, "messages", msgs);
        json_obj_set_num(payload, "max_tokens", 1024);
        json_obj_set(payload, "tools", tools);
        json_obj_set_str(payload, "tool_choice", "auto");

        hf_buf_init(&b);
        json_write(payload, &b, 0, 0);
        json_free(payload);
        hf_buf_free(&sysbuf);
        text = hf_buf_take(&b);

        rc = hf_http_request("POST", g_cfg.llm_endpoint, g_cfg.llm_api_key,
                             "application/json", text, strlen(text), 90000,
                             &resp, err, sizeof err);
        free(text);
        if (rc != 0) {
            hf_send_error(c, 502, "search_unreachable", "无法连接模型联网搜索服务。");
            return;
        }

        {
            JNode *j = resp.body ? json_parse(resp.body, resp.len, NULL, 0) : NULL;
            if (resp.status >= 400 || !j) {
                if (resp.status == 400 && resp.body && strstr(resp.body, "webSearchEnabled")) {
                    hf_send_error(c, 503, "search_plugin_disabled",
                                  "MiMo 联网服务插件未开通：请到 MiMo 控制台 → 插件管理，开通「联网服务插件」后重试。");
                } else {
                    JNode *o = json_new_obj();
                    char msg[160];
                    json_obj_set_str(o, "error", "search_upstream_error");
                    json_obj_set_num(o, "upstreamStatus", resp.status);
                    snprintf(msg, sizeof msg, "模型联网搜索返回 %d。", resp.status);
                    json_obj_set_str(o, "message", msg);
                    hf_send_json(c, 502, o);
                }
                json_free(j);
                hf_http_free(&resp);
                return;
            }
            {
                JNode *choices = json_get(j, "choices");
                JNode *message = json_get(json_at(choices, 0), "message");
                if (!message || message->type != JOBJ) {
                    hf_send_error(c, 502, "search_response_unsupported",
                                  "模型搜索返回了不支持的响应结构；当前仅支持 MiMo Chat Completions 搜索响应。");
                } else {
                    JNode *o = json_new_obj();
                    JNode *results = normalize_citations(message);
                    json_obj_set(o, "results", results);
                    json_obj_set_num(o, "filtered", 0);
                    json_obj_set_str(o, "engine", "mimo-web-search");
                    json_obj_set_str(o, "model", g_cfg.search_model);
                    json_obj_set_str(o, "sourcePolicy", "allowlist");
                    json_obj_set_str(o, "note", json_len(results) ? "" : "没有找到符合来源白名单的公开链接。");
                    hf_send_json(c, 200, o);
                }
            }
            json_free(j);
            hf_http_free(&resp);
        }
    }
}

/* ================= /api/long-content ================= */

static const char *CHAPTERS[11] = {
    NULL,
    "03_第1章_重新联系与重新认识.md",
    "04_第2章_稳定联系与日常靠近.md",
    "05_第3章_低谷边界与信任考验.md",
    "06_第4章_喜欢出现但不急着命名.md",
    "07_第5章_确认关系与第一轮磨合.md",
    "08_第6章_亲密之后的普通日子.md",
    "09_第7章_现实冲突与关系修复.md",
    "10_第8章_家庭朋友与外部目光.md",
    "11_第9章_金钱时间与未来选择.md",
    "12_第10章_继续练习而不是童话结尾.md"
};

static void route_long_content(HfConn *c)
{
    const char *p = c->req.path + strlen("/api/long-content/");
    char num[16];
    size_t i = 0;
    int n;
    char full[700];
    FILE *f;
    long size;
    char *buf;

    while (*p && *p != '/' && *p != '?' && *p != '#' && i + 1 < sizeof num) num[i++] = *p++;
    num[i] = '\0';

    if (!num[0] || (num[0] == '0') || strspn(num, "0123456789") != strlen(num)) {
        hf_send_text(c, 400, "Bad Request: chapter must be an integer between 1 and 10");
        return;
    }
    n = atoi(num);
    if (n < 1 || n > 10) {
        hf_send_text(c, 400, "Bad Request: chapter must be an integer between 1 and 10");
        return;
    }

    snprintf(full, sizeof full, "%s/%s", g_cfg.long_dir, CHAPTERS[n]);
    f = hf_fopen_utf8(full, "rb");
    if (!f) { hf_send_text(c, 404, "Not Found: chapter file not found on disk"); return; }
    fseek(f, 0, SEEK_END);
    size = ftell(f);
    rewind(f);
    if (size < 0) { fclose(f); hf_send_text(c, 404, "Not Found: chapter file not found on disk"); return; }
    buf = (char *)malloc((size_t)size + 1);
    if (!buf) { fclose(f); hf_send_error(c, 500, "server_error", "内存不足"); return; }
    if (size > 0) fread(buf, 1, (size_t)size, f);
    buf[size] = '\0';
    fclose(f);

    hf_send_bytes(c, 200, "text/plain; charset=utf-8", buf, (size_t)size, "no-store");
    free(buf);
}

/* ================= /api/tts ================= */

static void route_tts_health(HfConn *c)
{
    char url[400];
    HfHttpResp resp;
    char err[256];

    snprintf(url, sizeof url, "%s/health", g_cfg.tts_base);
    if (hf_http_request("GET", url, NULL, NULL, NULL, 0, g_cfg.tts_timeout_ms,
                        &resp, err, sizeof err) != 0) {
        hf_send_error(c, 503, "tts_unavailable",
                      "本地语音服务未启动：请双击项目根目录的「启动语音服务.cmd」（ChatTTS 用 E:\\heartflow-voice\\venv-chattts，Kokoro 用 voice/venv）。");
        return;
    }
    hf_send_bytes(c, resp.status >= 200 && resp.status < 300 ? 200 : 503,
                  "application/json; charset=utf-8",
                  resp.body ? resp.body : "{}", resp.len, "no-store");
    hf_http_free(&resp);
}

/* ================= /api/tts/online — 在线语音运行时开关 =================
 * 只把「显式同意」这一个布尔转发给本机 sidecar，不把任意请求体透传。
 * GET 查询状态、POST {enabled:bool} 切换；两个方法都不触发联网合成。
 * 服务端自己兜底：未解锁时直连上游请求 engine=edge 也会被 403 拒绝。 */
static void route_tts_online(HfConn *c)
{
    char url[400], err[256], req[64];
    HfHttpResp resp;
    int is_post = strcmp(c->req.method, "POST") == 0;
    int enabled = 0, rc;
    JNode *body;

    if (is_post) {
        body = body_of(c);
        if (!body) return;
        enabled = json_bool(body, "enabled", 2);   /* 2 = 缺失或不是布尔 */
        json_free(body);
        if (enabled == 2) {
            hf_send_error(c, 400, "bad_request", "`enabled` 必须是布尔值。");
            return;
        }
        snprintf(req, sizeof req, "{\"enabled\":%s}", enabled ? "true" : "false");
    }

    snprintf(url, sizeof url, "%s/online", g_cfg.tts_base);
    rc = hf_http_request(is_post ? "POST" : "GET", url, NULL,
                         is_post ? "application/json" : NULL,
                         is_post ? req : NULL, is_post ? strlen(req) : 0,
                         g_cfg.tts_timeout_ms, &resp, err, sizeof err);
    if (rc != 0) {
        hf_send_error(c, 503, "tts_unavailable",
                      "本地语音服务未启动：请双击项目根目录的「启动语音服务.cmd」。");
        return;
    }
    hf_send_bytes(c, resp.status >= 200 && resp.status < 300 ? 200 : 502,
                  "application/json; charset=utf-8",
                  resp.body ? resp.body : "{}", resp.len, "no-store");
    hf_http_free(&resp);
}

/* 只转发白名单内的上游响应头；值里的 CR/LF 由 hf_http_header 剔除，
 * 避免本地 sidecar 的内容被用来做响应头注入。 */
static void append_tts_header(char *buf, size_t cap, const HfHttpResp *r, const char *name)
{
    char v[128];
    size_t used;
    if (!hf_http_header(r, name, v, sizeof v)) return;
    used = strlen(buf);
    if (used + strlen(v) + strlen(name) + 8 < cap)
        snprintf(buf + used, cap - used, "%s: %s\r\n", name, v);
}

static void route_tts(HfConn *c)
{
    JNode *body = body_of(c);
    const char *text, *voice, *engine;
    const char *errcode;
    JNode *payload;
    HfBuf b;
    char *req, *clean;
    HfHttpResp resp;
    char err[256];
    int rc;

    if (!body) return;
    text = json_str(body, "text", "");
    errcode = hf_tts_validate_text(text);
    if (errcode) {
        json_free(body);
        hf_send_error(c, 400, errcode, strcmp(errcode, "text_too_long") == 0
                      ? "单次最多 300 字。" : "`text` 不能为空。");
        return;
    }

    voice = json_str(body, "voice", NULL);
    engine = json_str(body, "engine", NULL);
    if (engine && !hf_tts_engine_known(engine)) engine = NULL;

    /* 文本清洗与语速钳制在 C 侧完成；推理后端只需读文本。
     * format=pcm 请求后端返回 raw float32，WAV 封装也由 C 做；
     * 旧版 sidecar 不认识该字段时仍返回 WAV，下面按 content-type 分流透传。 */
    clean = hf_tts_normalize(text);
    payload = json_new_obj();
    json_obj_set_str(payload, "text", clean ? clean : text);
    free(clean);
    json_obj_set_str(payload, "format", "pcm");
    if (engine) json_obj_set_str(payload, "engine", engine);
    if (voice && *voice) json_obj_set_str(payload, "voice", voice);
    {
        JNode *sp = json_get(body, "speed");
        if (sp && sp->type == JNUM)
            json_obj_set_num(payload, "speed", hf_tts_clamp_speed(sp->u.num));
    }

    hf_buf_init(&b);
    json_write(payload, &b, 0, 0);
    json_free(payload);
    json_free(body);
    req = hf_buf_take(&b);

    {
        char url[400];
        snprintf(url, sizeof url, "%s/tts", g_cfg.tts_base);
        rc = hf_http_request("POST", url, NULL, "application/json", req, strlen(req),
                             g_cfg.tts_timeout_ms, &resp, err, sizeof err);
    }
    free(req);

    if (rc != 0) {
        hf_send_error(c, 503, "tts_unavailable",
                      "本地语音服务未启动：请双击项目根目录的「启动语音服务.cmd」（ChatTTS 用 E:\\heartflow-voice\\venv-chattts，Kokoro 用 voice/venv）。");
        return;
    }

    if (resp.status < 200 || resp.status >= 300) {
        JNode *d = resp.body ? json_parse(resp.body, resp.len, NULL, 0) : NULL;
        const char *code = d ? json_str(d, "error", NULL) : NULL;
        const char *msg = d ? json_str(d, "message", NULL) : NULL;
        char line[200];
        if (!msg) {
            snprintf(line, sizeof line, "语音服务返回 %d。", resp.status);
            msg = line;
        }
        hf_send_error(c, resp.status == 503 ? 503 : 502,
                      code ? code : "tts_upstream_error", msg);
        json_free(d);
        hf_http_free(&resp);
        return;
    }

    /* Python/Node 版都会带上引擎与耗时信息，C 版同样透传（前端目前不读，但契约要一致）。 */
    {
        char extra[512] = "";
        append_tts_header(extra, sizeof extra, &resp, "X-Tts-Engine");
        append_tts_header(extra, sizeof extra, &resp, "X-Tts-Latency-Ms");

        /* 新版后端返回 raw float32 PCM：C 侧做 RMS 归一化与 WAV 封装。
         * 旧版后端返回现成 WAV，直接透传，保证向后兼容。 */
        if (resp.body && strstr(resp.content_type, "octet-stream") != NULL && resp.len % 4 == 0) {
            HfBuf wb;
            hf_buf_init(&wb);
            if (hf_tts_float_to_wav((const float *)resp.body, resp.len / 4,
                                    HF_TTS_SAMPLE_RATE, &wb) == 0 && wb.p) {
                hf_send_bytes_ex(c, 200, "audio/wav", wb.p, wb.n, "no-store",
                                 extra[0] ? extra : NULL);
                hf_buf_free(&wb);
                hf_http_free(&resp);
                return;
            }
            hf_buf_free(&wb);
        }
        hf_send_bytes_ex(c, 200, "audio/wav", resp.body ? resp.body : "", resp.len,
                         "no-store", extra[0] ? extra : NULL);
        hf_http_free(&resp);
    }
}

/* ================= 路由 ================= */

void hf_route(HfConn *c)
{
    const char *m = c->req.method;
    const char *p = c->req.path;

    if (!hf_host_allowed(c->req.host[0] ? c->req.host : NULL)) {
        hf_send_error(c, 403, "host_forbidden", "此本机服务只接受本机地址的请求。");
        return;
    }

    /* 统一入口限流：覆盖所有 API 端点（含 v2、search、tts、relationship-intelligence），
     * 不再只限 chat。health 探活、CORS 预检与纯本地规则计算不计入配额：
     * /api/v2/rules/ 不调用上游、不消耗模型额度，且时机面板会周期性重算，
     * 与聊天共用同一个桶会把正常对话挤成 429。
     * 放在 host 校验之后、分发之前，SSE 与非流式各计一次（不再双计）。 */
    if (strncmp(p, "/api/", 5) == 0 && strcmp(p, "/api/health") != 0 &&
        strncmp(p, "/api/v2/rules/", 14) != 0 &&
        strcmp(m, "OPTIONS") != 0) {
        char ip[64];
        peer_ip(c, ip, sizeof ip);
        if (rate_limited(ip)) {
            hf_send_error(c, 429, "rate_limited", "请求过于频繁，请稍后再试。");
            return;
        }
    }

    if (strcmp(m, "OPTIONS") == 0 && strncmp(p, "/api/", 5) == 0) {
        hf_send_bytes_ex(c, 204, "text/plain; charset=utf-8", "", 0, NULL,
                         "Access-Control-Allow-Methods: GET,POST,OPTIONS\r\n"
                         "Access-Control-Allow-Headers: Content-Type\r\n"
                         "Access-Control-Max-Age: 86400\r\n");
        return;
    }

    if (hf_v2_route(c)) return;

    /* 旧接口同样校验页面来源：避免任意网页借本机服务代理模型请求。 */
    if (strncmp(p, "/api/", 5) == 0 && !hf_origin_allowed(c->req.origin[0] ? c->req.origin : NULL)) {
        hf_send_error(c, 403, "origin_forbidden", "此本机服务只接受本机页面的请求。");
        return;
    }

    if (strcmp(m, "GET") == 0 && strcmp(p, "/api/health") == 0) { route_health(c); return; }
    if (strcmp(m, "POST") == 0 && strcmp(p, "/api/chat") == 0) { route_chat(c); return; }
    if (strcmp(m, "POST") == 0 && strcmp(p, "/api/search") == 0) { route_search(c); return; }
    if (strcmp(m, "POST") == 0 && strcmp(p, "/api/relationship-intelligence") == 0) {
        JNode *body = body_of(c);
        if (!body) return;
        {
            HfCoachError e = { "relationship_intelligence_error", "本地关系分析暂时不可用。" };
            JNode *out = hf_coach_run(body, &e);
            if (out) hf_send_json(c, 200, out);
            else hf_send_error(c, 400, e.code, e.message);
        }
        json_free(body);
        return;
    }
    if (strcmp(m, "GET") == 0 && strcmp(p, "/api/tts/health") == 0) { route_tts_health(c); return; }
    if (strcmp(m, "GET") == 0 && strcmp(p, "/api/tts/online") == 0) { route_tts_online(c); return; }
    if (strcmp(m, "POST") == 0 && strcmp(p, "/api/tts/online") == 0) { route_tts_online(c); return; }
    if (strcmp(m, "POST") == 0 && strcmp(p, "/api/tts") == 0) { route_tts(c); return; }
    if (strcmp(m, "GET") == 0 && strncmp(p, "/api/long-content/", 18) == 0) { route_long_content(c); return; }

    if (strcmp(m, "GET") != 0 && strcmp(m, "HEAD") != 0) {
        hf_send_text(c, 405, "Method Not Allowed");
        return;
    }
    hf_static_serve(c);
}
