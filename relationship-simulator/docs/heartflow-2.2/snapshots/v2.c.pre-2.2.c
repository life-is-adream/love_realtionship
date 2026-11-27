/* HeartFlow 2.0：本地、无状态的聊天到练习闭环。 */
#define _POSIX_C_SOURCE 200809L
#include "v2.h"
#include "coach.h"
#include "coach_internal.h"
#include "config.h"
#include "net.h"
#include "../hf.h"
#include <math.h>

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <winsock2.h>
#endif

#define V2_MAX_MESSAGES 80
#define V2_MAX_INPUT_BYTES 120000
#define V2_MAX_MESSAGE_CHARS 2000

static void message_id(int i, char out[32]);

static int local_peer(HfConn *c)
{
#ifdef _WIN32
    struct sockaddr_in peer;
    int n = sizeof peer;
    if (getpeername(c->fd, (struct sockaddr *)&peer, &n) != 0) return 0;
    return (ntohl(peer.sin_addr.s_addr) >> 24) == 127;
#else
    (void)c;
    return 1;
#endif
}

static int same_local_origin(HfConn *c)
{
    char localhost[80], loopback[80];
    if (!c->req.origin[0]) return 1; /* 本机命令行客户端通常没有 Origin。 */
    snprintf(localhost, sizeof localhost, "http://localhost:%d", g_cfg.port);
    snprintf(loopback, sizeof loopback, "http://127.0.0.1:%d", g_cfg.port);
    return !strcmp(c->req.origin, localhost) || !strcmp(c->req.origin, loopback);
}

static JNode *v2_body(HfConn *c)
{
    JNode *body;
    size_t limit = !strcmp(c->req.path, "/api/v2/imports/screenshot") ? 1800000 : V2_MAX_INPUT_BYTES;
    if (c->req.too_large || c->req.body_len > limit) {
        hf_send_error(c, 413, "payload_too_large", "输入过长，请缩短后重试。");
        return NULL;
    }
    if (strncmp(c->req.content_type, "application/json", 16) != 0 || (c->req.content_type[16] && c->req.content_type[16] != ';' && c->req.content_type[16] != ' ' && c->req.content_type[16] != '\t')) {
        hf_send_error(c, 400, "json_required", "请使用 application/json 请求。");
        return NULL;
    }
    body = json_parse(c->req.body ? c->req.body : "{}", c->req.body_len, NULL, 0);
    if (!body || body->type != JOBJ) {
        json_free(body);
        hf_send_error(c, 400, "invalid_json", "请求体不是有效的 JSON 对象。");
        return NULL;
    }
    return body;
}

static int image_data_valid(const char *data)
{
    const char *p;
    size_t n;
    if (!strncmp(data, "data:image/jpeg;base64,", 23)) p = data + 23;
    else if (!strncmp(data, "data:image/png;base64,", 22)) p = data + 22;
    else if (!strncmp(data, "data:image/webp;base64,", 23)) p = data + 23;
    else return 0;
    n = strlen(p);
    if (n < 16 || n > 1600000 || n % 4 != 0) return 0;
    for (; *p; p++) if (!isalnum((unsigned char)*p) && *p != '+' && *p != '/' && *p != '=') return 0;
    return 1;
}

static const char *model_text(const JNode *root)
{
    const char *text = json_str(root, "output_text", NULL);
    JNode *choices, *message, *content, *output;
    int i, j;
    if (text && *text) return text;
    choices = json_get(root, "choices");
    message = json_get(json_at(choices, 0), "message");
    text = json_str(message, "content", NULL);
    if (text && *text) return text;
    content = json_get(message, "content");
    for (i = 0; i < json_len(content); i++) {
        text = json_str(json_at(content, i), "text", NULL);
        if (text && *text) return text;
    }
    output = json_get(root, "output");
    for (i = 0; i < json_len(output); i++) {
        content = json_get(json_at(output, i), "content");
        for (j = 0; j < json_len(content); j++) {
            text = json_str(json_at(content, j), "text", NULL);
            if (text && *text) return text;
        }
    }
    return NULL;
}

static JNode *parse_embedded_object(const char *text)
{
    const char *begin, *end;
    if (!text) return NULL;
    begin = strchr(text, '{'); end = strrchr(text, '}');
    if (!begin || !end || end < begin || (size_t)(end - begin) > 100000) return NULL;
    return json_parse(begin, (size_t)(end - begin + 1), NULL, 0);
}

static void route_screenshot(HfConn *c, const JNode *body)
{
    const char *image = json_str(body, "image_data_url", "");
    const char *side = json_str(body, "self_side", "unknown");
    const char *model = g_cfg.vision_model[0] ? g_cfg.vision_model : g_cfg.llm_model;
    const char *instruction = "把聊天截图按从上到下顺序转成 JSON：{\"messages\":[{\"speaker\":\"user|other|unknown\",\"text\":\"原文\",\"timestamp_text\":\"可见原文或空\"}],\"uncertain\":[\"不确定之处\"]}。只转写实际可见文字，不猜测缺失文字、人物心理或时间。用户所在气泡一侧由输入说明；无法确认则用 unknown。只输出 JSON。";
    JNode *payload, *input, *message, *parts, *part, *upstream, *parsed, *items, *out, *messages, *warnings;
    HfBuf buf; HfHttpResp response; char err[256]; char *request_text; const char *content; int rc, i, count = 0;
    if (!json_bool(body, "remote_consent", 0)) { hf_send_error(c, 400, "consent_required", "识别截图前请确认图片会发送给配置的模型服务。"); return; }
    if (strcmp(side, "left") && strcmp(side, "right") && strcmp(side, "unknown")) { hf_send_error(c, 400, "invalid_side", "请选择自己消息所在的一侧。"); return; }
    if (!image_data_valid(image)) { hf_send_error(c, 400, "invalid_image", "请选择不超过限制的 JPEG、PNG 或 WebP 图片。"); return; }
    if (!g_cfg.llm_api_key[0]) { hf_send_error(c, 400, "missing_api_key", "请先在本机配置可处理图片的模型服务。"); return; }
    payload = json_new_obj(); input = json_new_arr(); message = json_new_obj(); parts = json_new_arr();
    json_obj_set_str(payload, "model", model);
    json_obj_set_num(payload, !strcmp(g_cfg.llm_api_mode, "responses") ? "max_output_tokens" : "max_completion_tokens", 2048);
    json_obj_set_bool(payload, "stream", 0);
    json_obj_set_str(message, "role", "user");
    part = json_new_obj();
    json_obj_set_str(part, "type", !strcmp(g_cfg.llm_api_mode, "responses") ? "input_text" : "text");
    {
        char prompt[1200];
        snprintf(prompt, sizeof prompt, "%s 用户消息位于：%s。", instruction, side);
        json_obj_set_str(part, "text", prompt);
    }
    json_arr_push(parts, part); part = json_new_obj();
    if (!strcmp(g_cfg.llm_api_mode, "responses")) {
        json_obj_set_str(part, "type", "input_image"); json_obj_set_str(part, "image_url", image);
    } else {
        JNode *url = json_new_obj(); json_obj_set_str(part, "type", "image_url"); json_obj_set_str(url, "url", image); json_obj_set(part, "image_url", url);
    }
    json_arr_push(parts, part); json_obj_set(message, "content", parts); json_arr_push(input, message);
    json_obj_set(payload, !strcmp(g_cfg.llm_api_mode, "responses") ? "input" : "messages", input);
    if (!strcmp(g_cfg.llm_api_mode, "responses")) json_obj_set_bool(payload, "store", 0);
    hf_buf_init(&buf); json_write(payload, &buf, 0, 0); json_free(payload); request_text = hf_buf_take(&buf);
    rc = hf_http_request("POST", g_cfg.llm_endpoint, g_cfg.llm_api_key, "application/json",
                         request_text, strlen(request_text), 120000, &response, err, sizeof err);
    free(request_text);
    if (rc != 0) { hf_send_error(c, 502, "vision_unavailable", "无法连接图片识别服务；可改用文字粘贴。"); return; }
    if (response.status >= 400) { hf_http_free(&response); hf_send_error(c, 502, "vision_upstream_error", "图片识别服务拒绝请求，请检查模型是否支持图片。"); return; }
    upstream = json_parse(response.body ? response.body : "", response.len, NULL, 0);
    content = model_text(upstream); parsed = parse_embedded_object(content);
    items = json_get(parsed, "messages");
    if (!items || items->type != JARR || json_len(items) < 1 || json_len(items) > V2_MAX_MESSAGES) {
        json_free(parsed); json_free(upstream); hf_http_free(&response);
        hf_send_error(c, 502, "vision_invalid_result", "图片识别结果格式无效，请重试或手动输入。"); return;
    }
    out = json_new_obj(); messages = json_new_arr(); warnings = json_new_arr();
    for (i = 0; i < json_len(items); i++) {
        JNode *item = json_at(items, i), *m; const char *speaker = json_str(item, "speaker", "unknown");
        const char *text = json_str(item, "text", ""), *time = json_str(item, "timestamp_text", "");
        char id[32], excerpt[8000], stamp[180];
        if (!*text || hf_utf8_count(text) > V2_MAX_MESSAGE_CHARS) continue;
        if (strcmp(speaker, "user") && strcmp(speaker, "other")) speaker = "unknown";
        count++; message_id(count - 1, id); hf_utf8_cut(text, V2_MAX_MESSAGE_CHARS, excerpt, sizeof excerpt); hf_utf8_cut(time, 40, stamp, sizeof stamp);
        m = json_new_obj(); json_obj_set_str(m, "id", id); json_obj_set_str(m, "speaker", speaker);
        json_obj_set_str(m, "text", excerpt); json_obj_set_str(m, "timestamp_text", stamp); json_obj_set(m, "timestamp", json_new_null()); json_arr_push(messages, m);
    }
    if (!count) { json_free(out); json_free(messages); json_free(warnings); json_free(parsed); json_free(upstream); hf_http_free(&response); hf_send_error(c, 502, "vision_empty_result", "未识别到可用消息，请手动输入。"); return; }
    json_arr_push(warnings, json_new_str("图片识别可能遗漏、错字或混淆说话人，请逐条核对。"));
    items = json_get(parsed, "uncertain");
    for (i = 0; i < json_len(items) && i < 10; i++) {
        const char *w = json_node_str(json_at(items, i), NULL); char safe[400];
        if (w && *w) { hf_utf8_cut(w, 100, safe, sizeof safe); json_arr_push(warnings, json_new_str(safe)); }
    }
    json_obj_set_str(out, "schema_version", "2.0"); json_obj_set_str(out, "source", "remote_vision");
    json_obj_set(out, "messages", messages); json_obj_set(out, "warnings", warnings);
    hf_send_json(c, 200, out); json_free(parsed); json_free(upstream); hf_http_free(&response);
}

static char *trim_in_place(char *s)
{
    char *end;
    while (*s && isspace((unsigned char)*s)) s++;
    end = s + strlen(s);
    while (end > s && isspace((unsigned char)end[-1])) *--end = '\0';
    return s;
}

static const char *speaker_prefix(char **line)
{
    static const struct { const char *prefix; const char *speaker; } prefixes[] = {
        {"我方：", "user"}, {"男方：", "user"}, {"自己：", "user"},
        {"我：", "user"}, {"我:", "user"}, {"我方:", "user"},
        {"对方：", "other"}, {"对方:", "other"}, {"她：", "other"},
        {"她:", "other"}, {"他：", "other"}, {"他:", "other"},
        {"女方：", "other"}, {"女生：", "other"}, {NULL, NULL}
    };
    int i;
    for (i = 0; prefixes[i].prefix; i++) {
        size_t n = strlen(prefixes[i].prefix);
        if (strncmp(*line, prefixes[i].prefix, n) == 0) {
            *line = trim_in_place(*line + n);
            return prefixes[i].speaker;
        }
    }
    return "unknown";
}

/* 仅接受带明确时区且日历字段有效的 ISO 时间，不把异常时间当作可靠证据。 */
static int valid_zoned_timestamp(const char *s)
{
    static const int mdays[] = {31,28,31,30,31,30,31,31,30,31,30,31};
    size_t i, n = strlen(s); int year, month, day, hour, minute, second = 0, limit;
    if (n < 17 || s[4] != '-' || s[7] != '-' || s[10] != 'T' || s[13] != ':') return 0;
    for (i = 0; i < 16; i++) if (i != 4 && i != 7 && i != 10 && i != 13 && !isdigit((unsigned char)s[i])) return 0;
    year = (s[0]-'0')*1000+(s[1]-'0')*100+(s[2]-'0')*10+(s[3]-'0');
    month = (s[5]-'0')*10+s[6]-'0'; day = (s[8]-'0')*10+s[9]-'0';
    hour = (s[11]-'0')*10+s[12]-'0'; minute = (s[14]-'0')*10+s[15]-'0';
    if (month < 1 || month > 12 || hour > 23 || minute > 59) return 0;
    limit = mdays[month-1] + (month == 2 && year % 4 == 0 && (year % 100 != 0 || year % 400 == 0));
    if (day < 1 || day > limit) return 0;
    i = 16;
    if (i < n && s[i] == ':') {
        if (i + 2 >= n || !isdigit((unsigned char)s[i+1]) || !isdigit((unsigned char)s[i+2])) return 0;
        second = (s[i+1]-'0')*10+s[i+2]-'0'; i += 3;
        if (second > 59) return 0;
        if (i < n && s[i] == '.') { i++; if (i == n || !isdigit((unsigned char)s[i])) return 0; while (i < n && isdigit((unsigned char)s[i])) i++; }
    }
    if (i + 1 == n && (s[i] == 'Z' || s[i] == 'z')) return 1;
    if (i >= n || (s[i] != '+' && s[i] != '-')) return 0;
    i++;
    if (i + 1 >= n || !isdigit((unsigned char)s[i]) || !isdigit((unsigned char)s[i+1])) return 0;
    hour = (s[i]-'0')*10+s[i+1]-'0'; i += 2;
    if (i < n && s[i] == ':') i++;
    if (i + 2 != n || !isdigit((unsigned char)s[i]) || !isdigit((unsigned char)s[i+1])) return 0;
    minute = (s[i]-'0')*10+s[i+1]-'0';
    return hour <= 23 && minute <= 59;
}

static void timestamp_prefix(char **line, char *raw, size_t cap, int *has_zone)
{
    char *p = *line, *end = NULL, *start;
    size_t n;
    raw[0] = '\0'; *has_zone = 0;
    if (*p == '[') {
        start = p + 1; end = strchr(start, ']');
        if (!end) return;
    } else {
        start = p;
        if (strlen(p) < 16 || p[4] != '-' || p[7] != '-' || (p[10] != ' ' && p[10] != 'T')) return;
        end = p + 16;
        while (*end && !isspace((unsigned char)*end)) end++;
    }
    n = (size_t)(end - start);
    if (n < 16 || n >= cap || start[4] != '-' || start[7] != '-') return;
    memcpy(raw, start, n); raw[n] = '\0';
    if (raw[10] == ' ') raw[10] = 'T';
    *has_zone = valid_zoned_timestamp(raw);
    *line = trim_in_place(end + (*end == ']' ? 1 : 0));
}

static void route_import(HfConn *c, const JNode *body)
{
    const char *input = json_str(body, "text", "");
    const char *mode = json_str(body, "mode", "chat");
    char *copy, *line, *next;
    int count = 0, unknown = 0, user = 0, other = 0, timestamps = 0, unzoned = 0, event_mode = !strcmp(mode, "event");
    JNode *out, *messages, *quality, *warnings;
    if ((!event_mode && strcmp(mode, "chat")) || !*input || strlen(input) > V2_MAX_INPUT_BYTES - 512) {
        hf_send_error(c, 400, "invalid_text", "请输入不超过 120KB 的聊天文本。");
        return;
    }
    copy = hf_xstrdup(input);
    messages = json_new_arr();
    line = copy;
    while (line && *line) {
        char *text, *p;
        const char *speaker;
        char id[32], timestamp[48]; int has_zone;
        JNode *message;
        next = event_mode ? NULL : strchr(line, '\n');
        if (next) *next++ = '\0';
        p = trim_in_place(line);
        if (!*p) { line = next; continue; }
        if (count >= V2_MAX_MESSAGES) {
            json_free(messages); free(copy);
            hf_send_error(c, 400, "too_many_messages", "最多导入 80 条消息，请先缩小范围。");
            return;
        }
        /* 时间顺序保持原文顺序；未确定时区的时间不伪造为 UTC。 */
        timestamp[0] = '\0'; has_zone = 0;
        if (!event_mode) timestamp_prefix(&p, timestamp, sizeof timestamp, &has_zone);
        speaker = event_mode ? "user" : speaker_prefix(&p);
        text = trim_in_place(p);
        if (!*text) { line = next; continue; }
        if (hf_utf8_count(text) > V2_MAX_MESSAGE_CHARS) {
            json_free(messages); free(copy);
            hf_send_error(c, 400, "message_too_long", "单条消息超过 2000 字，请先拆分。");
            return;
        }
        count++;
        if (!strcmp(speaker, "user")) user++;
        else if (!strcmp(speaker, "other")) other++;
        else unknown++;
        snprintf(id, sizeof id, "msg_%03d", count);
        message = json_new_obj();
        json_obj_set_str(message, "id", id);
        json_obj_set_str(message, "speaker", speaker);
        json_obj_set_str(message, "text", text);
        if (timestamp[0]) { timestamps++; if (!has_zone) unzoned++; }
        json_obj_set_str(message, "timestamp_text", timestamp);
        if (timestamp[0] && has_zone) json_obj_set_str(message, "timestamp", timestamp);
        else json_obj_set(message, "timestamp", json_new_null());
        json_arr_push(messages, message);
        line = next;
    }
    free(copy);
    if (!count) { json_free(messages); hf_send_error(c, 400, "messages_required", "没有找到非空消息。"); return; }
    quality = json_new_obj();
    json_obj_set_num(quality, "messageCount", count);
    json_obj_set_num(quality, "unknownSpeakers", unknown);
    json_obj_set_bool(quality, "bothSpeakersPresent", user > 0 && other > 0);
    json_obj_set_str(quality, "timestampCoverage", !timestamps ? "none" : (timestamps == count && !unzoned ? "complete" : "partial_or_unverified"));
    warnings = json_new_arr();
    if (unknown) json_arr_push(warnings, json_new_str("存在未识别的说话人，请在分析前人工确认。"));
    if (event_mode) json_arr_push(warnings, json_new_str("这是用户的事件叙述，对方的观点与背景仍未知。"));
    else if (!user || !other) json_arr_push(warnings, json_new_str("尚未识别到双方消息，样本不足以判断互动关系。"));
    json_arr_push(warnings, json_new_str("消息按输入顺序排列；时间和前后背景需要人工核对。"));
    if (unzoned) json_arr_push(warnings, json_new_str("部分时间没有时区或格式无效，不用于计算时间间隔。"));
    out = json_new_obj();
    json_obj_set_str(out, "schema_version", "2.0");
    json_obj_set_str(out, "source_type", event_mode ? "event" : "chat_text");
    json_obj_set(out, "messages", messages);
    json_obj_set(out, "quality", quality);
    json_obj_set(out, "warnings", warnings);
    hf_send_json(c, 200, out);
}

static int valid_messages(const JNode *messages)
{
    int i, n = json_len(messages);
    if (!messages || messages->type != JARR || n < 1 || n > V2_MAX_MESSAGES) return 0;
    for (i = 0; i < n; i++) {
        const JNode *m = json_at(messages, i);
        const char *s = json_str(m, "speaker", "");
        const char *text = json_str(m, "text", "");
        if (!m || m->type != JOBJ || !*text || hf_utf8_count(text) > V2_MAX_MESSAGE_CHARS) return 0;
        if (strcmp(s, "user") && strcmp(s, "other") && strcmp(s, "unknown")) return 0;
    }
    return 1;
}

static const char *const V2_EXIT_TERMS[] = {"不要再联系", "别再联系", "不想继续", "不再联系", "不想再联系", "不愿再联系", "不要再给我发消息", "不要给我发消息", "别再给我发消息", "别给我发消息", "不要再给我打电话", "别再给我打电话", "别找我", "别再找我", "别来找我", "别再来找我", "别再来我家", "别来我家", "别来公司", "别再来公司", "别再给我发", "都别联系", "请不要联系", "不想再见", "不想跟你说话", "不想和你说话", "别再打扰", "不要打扰", "别再打扰我的家人", "不用再联系", "不希望我们再有任何联系", "不希望再", "到此为止", "停止联系", "请停止", "已经结束", "分手吧", "没有任何可能", "不会再见", "不再出现", "不要再出现在", "出现在我生活", "别再发消息", "别再打电话", "不要再打电话", "别再纠缠", "离我远一点", "从我的生活里消失", "不想再和你有任何来往", "不想继续这段关系", "不想继续，请", "我不想见你", "也不想见你", NULL};
static const char *const V2_DECLINE_TERMS[] = {"先别联系", "暂时不要联系", "不想见面", "不想单独见", "不想约会", "不愿意见面", "先别约", "不想再见面", "不要再见面", "不要见面", "暂停见面", "暂时不想见", "先不约", "这周不约", "还没准备好", "需要空间", "需要一点空间", "先别见面", "最近先别", "这周不行", "这个月先不", "最近不想出来", "今晚不想聊", "今天不想聊", "现在不想谈", "不想现在见面", "不想现在确定", "先暂停联系", "暂时别联系", "先别聊", "之后再谈", NULL};
/* 否定判断只看同一分句内的前 24 字节（约 8 个汉字）：跨标点回溯会把「我不忙，你别再联系」误判成否定拒绝。 */
static const char *const V2_NEG_TERMS[] = {"不再", "不会再", "不想再", "不愿再", "不要再", "不打算再", "不需要", "不必", "不用", "无需", "不是", "并非", "没有", "没有说", "从没", "从未", "不曾", "不代表", "并不", "不会", "不想", "不要", "别", "没", "未", "不", "停止", "拒绝", NULL};
static const char *const V2_NEG_STOPS[] = {"。", "，", "；", "！", "？", "、", "\n", ".", ",", ";", "!", "?", "不过", "但是", "可是", "然而", NULL};

static const char *find_any(const char *s, const char *const *terms)
{
    int i;
    for (i = 0; terms[i]; i++) if (strstr(s, terms[i])) return terms[i];
    return NULL;
}

/* 第三人称转述或过去时间中的“说/让/叫”不等于当下指令。 */
static int quoted_or_past(const char *s, const char *p)
{
    static const char *const quote_prefixes[] = {"他说", "她说", "他们说", "她们说", "朋友说", "对方说", "别人说", "他告诉", "她告诉", "他转告", "她转告", "跟我说", "告诉我", NULL};
    static const char *const past_markers[] = {"昨天", "上周", "上个星期", "之前", "以前", "当时", "那时", "上次", NULL};
    const char *w = p - s > 48 ? p - 48 : s;
    char buf[64];
    size_t n = (size_t)(p - w);
    int i, past = 0;
    if (n >= sizeof buf) n = sizeof buf - 1;
    memcpy(buf, w, n); buf[n] = '\0';
    for (i = 0; quote_prefixes[i]; i++) if (strstr(buf, quote_prefixes[i])) return 1;
    for (i = 0; past_markers[i]; i++) if (strstr(buf, past_markers[i])) { past = 1; break; }
    return past && (strstr(buf, "说") || strstr(buf, "让") || strstr(buf, "叫"));
}

static int negated_before(const char *s, const char *p)
{
    const char *window = p - s > 24 ? p - 24 : s;
    const char *start = window;
    int i;
    for (i = 0; V2_NEG_STOPS[i]; i++) {
        size_t n = strlen(V2_NEG_STOPS[i]);
        const char *q = window;
        while ((q = strstr(q, V2_NEG_STOPS[i])) != NULL && q < p) {
            if (q + n <= p && q + n > start) start = q + n;
            q += n;
        }
    }
    for (i = 0; V2_NEG_TERMS[i]; i++) {
        size_t n = strlen(V2_NEG_TERMS[i]);
        const char *q = start;
        while ((q = strstr(q, V2_NEG_TERMS[i])) != NULL && q < p) {
            if (q + n <= p) return 1;
            q += n;
        }
    }
    return 0;
}

static const char *find_unnegated(const char *s, const char *const *terms)
{
    int i;
    if (!s || !*s) return NULL;
    for (i = 0; terms[i]; i++) {
        const char *p = s; size_t term_len = strlen(terms[i]);
        while ((p = strstr(p, terms[i])) != NULL) {
            if (!negated_before(s, p) && !quoted_or_past(s, p)) return terms[i];
            p += term_len;
        }
    }
    return NULL;
}

/* 返回命中词所在完整分句的字节边界；用于文本引用与 code point 偏移。 */
static void clause_bounds(const char *text, const char *cue, const char **out_start, const char **out_end)
{
    const char *hit = cue ? strstr(text, cue) : NULL;
    const char *start = text, *end = text + strlen(text);
    size_t cue_len;
    int i;
    if (!hit) { *out_start = text; *out_end = text; return; }
    cue_len = strlen(cue);
    for (i = 0; V2_NEG_STOPS[i]; i++) {
        size_t n = strlen(V2_NEG_STOPS[i]);
        const char *q = text;
        while ((q = strstr(q, V2_NEG_STOPS[i])) != NULL && q < hit) {
            if (q + n <= hit && q + n > start) start = q + n;
            q += n;
        }
        q = strstr(hit + cue_len, V2_NEG_STOPS[i]);
        if (q && q < end) end = q;
    }
    while (start < end && (*start == ' ' || *start == '\t' || *start == '\r' || *start == '\n')) start++;
    while (end > start && (end[-1] == ' ' || end[-1] == '\t' || end[-1] == '\r' || end[-1] == '\n')) end--;
    *out_start = start; *out_end = end;
}

static int utf8_prefix_chars(const char *s, const char *end)
{
    int n = 0;
    while (*s && s < end) {
        unsigned char c = (unsigned char)*s;
        s += c < 0x80 ? 1 : (c >= 0xF0 ? 4 : (c >= 0xE0 ? 3 : 2));
        n++;
    }
    return n;
}

/* 引用证据取命中词所在的完整分句，避免只引用「我」「听」这类无解释力的片段。 */
static void clause_of(const char *text, const char *cue, char *out, size_t cap)
{
    const char *start, *end;
    char tmp[400];
    clause_bounds(text, cue, &start, &end);
    if (start == end) { hf_utf8_cut(text, 60, out, cap); return; }
    {
        size_t len = (size_t)(end - start);
        if (len >= sizeof tmp) len = sizeof tmp - 1;
        memcpy(tmp, start, len); tmp[len] = '\0';
        hf_utf8_cut(tmp, 60, out, cap);
    }
}

static void message_id(int i, char out[32]) { snprintf(out, 32, "msg_%03d", i + 1); }

static void route_analysis(HfConn *c, JNode *body)
{
    static const char *const positive[] = {"我也想见", "一起去吧", "我们约个时间", "我愿意一起", "我也愿意", "我愿意继续", "愿意继续", "愿意，我也", "我也挺想", "好啊", "周末见", "周末可以", "可以呀，我们约", "可以，你来", "你来定时间", "你来安排", "找个时间", "定个时间", "约个时间", "听起来不错", "听起来很好", "我愿意试试", "愿意试试", "可以一起", "行，你来", NULL};
    static const char *const stable[] = {"保持现在", "这样挺好", "按这个节奏", "我们慢慢来", "现在这样", "维持现在", "维持现状", "照旧", "不用刻意改变", "不急着改变", "顺其自然", "不着急", "慢慢来", "慢慢处", "按现在", "现状挺好", "这样就很好", "我就满意", NULL};
    static const char *const safety[] = {"打你", "伤害你", "跟踪你", "威胁你", "堵你", "杀你", "报警", NULL};
    static const char *const busy[] = {"忙", "累", "没空", "不方便", "改天", NULL};
    JNode *messages = json_get(body, "messages"), *engine, *out, *source, *obs, *hyps, *hyp;
    JNode *supports, *counters, *hyp_unknowns, *decision, *memory, *missing, *top_unknowns;
    HfCoachError error = {"analysis_failed", "本地分析暂时不可用。"};
    int i, n, found_exit = 0, found_pause = 0, found_positive = 0, found_stable = 0, found_busy = 0, user = 0, other = 0, threat = 0;
    char exit_id[32] = "", pause_id[32] = "", positive_id[32] = "", stable_id[32] = "";
    const char *exit_cue = NULL, *pause_cue = NULL, *positive_cue = NULL, *stable_cue = NULL;
    const char *exit_text = "", *pause_text = "", *positive_text = "", *stable_text = "";
    if (!valid_messages(messages)) { hf_send_error(c, 400, "invalid_messages", "请检查消息数量、说话人和内容。"); return; }
    n = json_len(messages);
    /* 此入口永不写长期记忆，不接受外部传入的状态信号。 */
    json_obj_set_bool(body, "consent", 0);
    json_obj_set(body, "signals", json_new_obj());
    engine = hf_coach_run(body, &error);
    if (!engine) { hf_send_error(c, 400, error.code, error.message); return; }
    obs = json_new_arr(); supports = json_new_arr();
    for (i = 0; i < n; i++) {
        const JNode *m = json_at(messages, i);
        const char *speaker = json_str(m, "speaker", "unknown");
        const char *text = json_str(m, "text", "");
        char id[32], excerpt[900];
        JNode *entry, *ids;
        const char *hit;
        message_id(i, id);
        if (!strcmp(speaker, "user")) user++;
        if (!strcmp(speaker, "other")) other++;
        if (!strcmp(speaker, "other") && (hit = find_unnegated(text, V2_EXIT_TERMS))) { found_exit = 1; exit_cue = hit; exit_text = text; snprintf(exit_id, sizeof exit_id, "%s", id); }
        if (!strcmp(speaker, "other") && (hit = find_unnegated(text, V2_DECLINE_TERMS))) { found_pause = 1; pause_cue = hit; pause_text = text; snprintf(pause_id, sizeof pause_id, "%s", id); }
        if (!strcmp(speaker, "other") && (hit = find_unnegated(text, positive))) { found_positive = 1; positive_cue = hit; positive_text = text; snprintf(positive_id, sizeof positive_id, "%s", id); }
        if (!strcmp(speaker, "other") && (hit = find_unnegated(text, stable))) { found_stable = 1; stable_cue = hit; stable_text = text; snprintf(stable_id, sizeof stable_id, "%s", id); }
        if (!strcmp(speaker, "other") && find_unnegated(text, busy)) { found_busy = 1; json_arr_push(supports, json_new_str(id)); }
        if ((hit = find_unnegated(text, safety))) { found_exit = 1; threat = 1; exit_cue = hit; exit_text = text; snprintf(exit_id, sizeof exit_id, "%s", id); }
        if (i < n - 12) continue;
        hf_utf8_cut(text, 220, excerpt, sizeof excerpt);
        entry = json_new_obj(); ids = json_new_arr(); json_arr_push(ids, json_new_str(id));
        json_obj_set_str(entry, "id", id);
        json_obj_set_str(entry, "type", "user_supplied_text");
        json_obj_set_str(entry, "speaker", speaker);
        json_obj_set_str(entry, "claim", excerpt);
        json_obj_set(entry, "source_message_ids", ids);
        json_arr_push(obs, entry);
    }
    source = json_new_obj(); missing = json_new_arr();
    { const char *kind = json_str(body, "source_type", ""); json_obj_set_str(source, "type", !strcmp(kind, "event") ? "event" : (!strcmp(kind, "screenshot") ? "screenshot" : "chat_text")); }
    json_obj_set_str(source, "quality", n >= 20 && user && other ? "medium" : "limited");
    json_arr_push(missing, json_new_str("聊天片段可能缺少前后背景和现实互动。"));
    if (!user || !other) json_arr_push(missing, json_new_str("未确认双方的消息。"));
    json_arr_push(missing, json_new_str("消息原文由用户提供，系统不能独立核实其完整性。"));
    json_obj_set(source, "missing_context", missing);
    hyps = json_new_arr(); hyp = json_new_obj(); counters = json_new_arr(); hyp_unknowns = json_new_arr();
    json_obj_set_str(hyp, "id", "hyp_01");
    json_obj_set_str(hyp, "claim", found_busy ? "对方可能暂时受到时间或精力限制。" : "目前无法确定对方的意愿或原因。");
    json_obj_set(hyp, "support_ids", supports);
    json_arr_push(counters, json_new_str("也可能存在其他原因；现有片段不足以排除。"));
    json_arr_push(hyp_unknowns, json_new_str("后续是否有主动沟通或具体安排。"));
    json_obj_set(hyp, "counterevidence", counters); json_obj_set(hyp, "unknowns", hyp_unknowns);
    json_obj_set_str(hyp, "status", "unresolved"); json_arr_push(hyps, hyp);
    top_unknowns = json_new_arr();
    json_arr_push(top_unknowns, json_new_str("片段之外是否存在其他背景。"));
    json_arr_push(top_unknowns, json_new_str("对方后续是否会主动沟通或给出具体安排。"));
    decision = json_new_obj();
    {
        const char *category = found_exit ? "EXIT" : found_pause ? "DE_ESCALATE" : (user && other && found_positive) ? "ADVANCE" : (user && other && found_stable) ? "MAINTAIN" : "OBSERVE";
        const char *reason = found_exit ? "输入中出现明确停止或可能的安全风险表达。" : found_pause ? "对方对某项联系或邀约表达了拒绝或暂停。" : (user && other && found_positive) ? "对方明确表达愿意继续某项互动。" : (user && other && found_stable) ? "对方表达了对当前节奏的意见。" : "仅凭当前片段不足以确定对方意愿。";
        const char *action = found_exit ? "尊重对方选择，停止本次联系或推进；涉及安全时优先保护自己。" : found_pause ? "接受本次拒绝或暂停，不追加说服或邀约。" : (user && other && found_positive) ? "仅就已表达的事项确认一个具体、可拒绝的安排。" : (user && other && found_stable) ? "保持双方明确同意的节奏，并继续观察。" : "先尊重当前安排，留出空间并观察后续事实。";
        const char *id = found_exit ? exit_id : found_pause ? pause_id : (user && other && found_positive) ? positive_id : (user && other && found_stable) ? stable_id : "";
        const char *cue = found_exit ? exit_cue : found_pause ? pause_cue : (user && other && found_positive) ? positive_cue : (user && other && found_stable) ? stable_cue : NULL;
        const char *text = found_exit ? exit_text : found_pause ? pause_text : (user && other && found_positive) ? positive_text : (user && other && found_stable) ? stable_text : "";
        int abstain = !strcmp(category, "OBSERVE");
        JNode *ids = json_new_arr(); if (*id) json_arr_push(ids, json_new_str(id));
        json_obj_set_str(decision, "category", category); json_obj_set_str(decision, "rationale", reason); json_obj_set_str(decision, "next_action", action); json_obj_set(decision, "source_message_ids", ids);
        json_obj_set_str(decision, "decision_source", "rule");
        {
            JNode *evidence = json_new_arr();
            if (*id && cue && *text) {
                const char *sstart, *send; char excerpt[400];
                clause_bounds(text, cue, &sstart, &send);
                clause_of(text, cue, excerpt, sizeof excerpt);
                if (*excerpt) {
                    JNode *entry = json_new_obj();
                    json_obj_set_str(entry, "message_id", id);
                    json_obj_set_num(entry, "start", utf8_prefix_chars(text, sstart));
                    json_obj_set_num(entry, "end", utf8_prefix_chars(text, send));
                    json_obj_set_str(entry, "text", excerpt);
                    json_obj_set_str(entry, "unit", "unicode_code_point");
                    json_arr_push(evidence, entry);
                }
            }
            json_obj_set(decision, "evidence", evidence);
        }
        json_obj_set_str(decision, "evidence_status", abstain ? "insufficient" : "sufficient");
        json_obj_set_bool(decision, "abstain", abstain);
        {
            JNode *s = json_new_obj();
            json_obj_set_bool(s, "hard_boundary_detected", found_exit);
            json_obj_set_bool(s, "pressure_reply_blocked", found_exit || found_pause);
            json_obj_set_bool(s, "threat_detected", threat);
            json_obj_set(decision, "safety", s);
        }
        {
            JNode *a = json_new_obj();
            json_obj_set_str(a, "rule_version", "sem-v2.1.0");
            json_obj_set_bool(a, "model_used", 0);
            json_obj_set(decision, "audit", a);
        }
    }
    json_obj_set_str(decision, "stop_condition", "对方明确拒绝、要求停止或出现不安全情况时停止推进。");
    memory = json_new_obj(); json_obj_set_bool(memory, "authorized", 0); json_obj_set_bool(memory, "persisted", 0);
    out = json_new_obj(); json_obj_set_str(out, "schema_version", "2.0");
    json_obj_set(out, "source", source); json_obj_set(out, "observations", obs); json_obj_set(out, "hypotheses", hyps);
    json_obj_set(out, "unknowns", top_unknowns);
    json_obj_set(out, "decision", decision); json_obj_set(out, "memory", memory); json_obj_set(out, "engine", engine);
    hf_send_json(c, 200, out);
}

static void route_replies(HfConn *c, const JNode *body)
{
    static const char *const busy_words[] = {"忙", "累", "没空", "不方便", "改天", NULL};
    const JNode *messages = json_get(body, "messages");
    const char *last = "";
    const char *texts[3], *reasons[3];
    const char *tones[3] = {"自然", "温和", "清晰边界"};
    JNode *out, *items;
    int i, mode, prior_stop = 0, prior_decline = 0;
    if (!valid_messages(messages)) { hf_send_error(c, 400, "invalid_messages", "请先确认聊天消息。"); return; }
    for (i = 0; i < json_len(messages); i++) {
        const JNode *m = json_at(messages, i);
        const char *text = json_str(m, "text", "");
        if (strcmp(json_str(m, "speaker", ""), "other")) continue;
        if (find_unnegated(text, V2_EXIT_TERMS)) prior_stop = 1;
        if (find_unnegated(text, V2_DECLINE_TERMS)) prior_decline = 1;
    }
    for (i = json_len(messages) - 1; i >= 0; i--) {
        const JNode *m = json_at(messages, i);
        const char *speaker = json_str(m, "speaker", "");
        if (!strcmp(speaker, "user")) { hf_send_error(c, 400, "awaiting_response", "最后一条是你的消息，先等待对方回应。"); return; }
        if (!strcmp(speaker, "other")) { last = json_str(m, "text", ""); break; }
    }
    if (!*last) { hf_send_error(c, 400, "other_message_required", "请先标记一条对方消息。"); return; }
    mode = prior_stop ? 2 : (prior_decline ? 3 : (find_unnegated(last, busy_words) ? 1 : 0));
    if (mode == 2) {
        texts[0] = "好，我明白了。"; texts[1] = "谢谢你说清楚，我尊重你的决定。"; texts[2] = "收到，我会停止联系。祝你一切顺利。";
        reasons[0] = reasons[1] = reasons[2] = "接受明确拒绝，不追加邀约或说服。";
    } else if (mode == 3) {
        texts[0] = "好，明白了。"; texts[1] = "谢谢你直接告诉我，我尊重你的选择。"; texts[2] = "收到，我不会继续提出这次邀约。";
        reasons[0] = reasons[1] = reasons[2] = "接受这次拒绝，不继续说服或追加邀约。";
    } else if (mode == 1) {
        texts[0] = "好，你先忙，等方便的时候再说。"; texts[1] = "听起来最近安排挺满的，先照顾好自己，不急着回复。"; texts[2] = "明白，我先不继续约。以后如果你愿意，可以再告诉我。";
        reasons[0] = "简短回应并留出时间。"; reasons[1] = "回应忙碌或疲惫，不要求立即回复。"; reasons[2] = "明确停止追加邀约，并保留对方选择。";
    } else if (strchr(last, '?') || strstr(last, "？")) {
        texts[0] = "我想先想一想，再认真回答你。"; texts[1] = "谢谢你问我，我想整理一下自己的想法，再答复你。"; texts[2] = "这个问题对我很重要，我需要一点时间想清楚再回答。";
        reasons[0] = "先争取思考时间，避免编造事实。"; reasons[1] = "回应提问并说明需要整理想法。"; reasons[2] = "清楚表达需要时间，请按实际情况修改。";
    } else {
        texts[0] = "嗯，明白了。你愿意的话可以继续说。"; texts[1] = "谢谢你愿意告诉我，我会认真听。"; texts[2] = "我想听听你的想法；如果现在不想聊，也没关系。";
        reasons[0] = "自然承接，同时允许对方选择。"; reasons[1] = "以温和方式回应分享。"; reasons[2] = "说清意愿，同时允许对方暂停。";
    }
    out = json_new_obj(); items = json_new_arr();
    for (i = 0; i < 3; i++) { JNode *x = json_new_obj(); json_obj_set_str(x, "tone", tones[i]); json_obj_set_str(x, "text", texts[i]); json_obj_set_str(x, "reason", reasons[i]); json_arr_push(items, x); }
    json_obj_set_str(out, "schema_version", "2.0"); json_obj_set_str(out, "source", "local_templates");
    json_obj_set_str(out, "note", "本地规则建议，请按真实情况修改；不能据此推断对方心理。");
    json_obj_set(out, "suggestions", items); hf_send_json(c, 200, out);
}

typedef struct { int no; long long rank; const char *title, *goal; char matched[HF_TOPICS_BUF]; char quote[400]; } CourseHit;

static int count_term(const char *text, const char *term)
{
    int count = 0; const char *p = text;
    if (!text || !term || !*term) return 0;
    while ((p = strstr(p, term)) != NULL) { count++; p++; }
    return count;
}

static char *read_course_body(const char *path, int *length)
{
    FILE *f = hf_fopen_utf8(path, "rb");
    long size; char *buf;
    size_t got;
    if (!f) return NULL;
    if (fseek(f, 0, SEEK_END) != 0 || (size = ftell(f)) < 0 || size > 200000 || fseek(f, 0, SEEK_SET) != 0) { fclose(f); return NULL; }
    buf = (char *)malloc((size_t)size + 1);
    if (!buf) { fclose(f); return NULL; }
    got = fread(buf, 1, (size_t)size, f);
    fclose(f);
    if (got != (size_t)size) { free(buf); return NULL; }
    buf[size] = '\0';
    if (length) *length = hf_utf8_count(buf);
    return buf;
}

/* 课程正文 BM25：查询词由本地关键词规则给出，正文参与词频与长度归一化。 */
static void route_courses(HfConn *c, const JNode *body)
{
    const char *query = json_str(body, "query", "");
    int limit = (int)json_num(body, "limit", 3);
    char path[900], qwords[HF_TOPICS_BUF], terms[24][64], *texts[179];
    int lens[179], doc_n = 0, term_n = 0, df[24], i, j;
    double idf[24], avgdl = 0.0, k1 = 1.2, b = 0.75, total_len = 0.0;
    FILE *f; long size; char *raw; JNode *manifest, *courses, *out, *results;
    CourseHit hits[179];
    if (!*query || hf_utf8_count(query) > 4000) { hf_send_error(c, 400, "invalid_query", "请输入不超过 4000 字的检索内容。"); return; }
    if (limit < 1 || limit > 10) { hf_send_error(c, 400, "invalid_limit", "limit 需在 1 到 10 之间。"); return; }
    snprintf(path, sizeof path, "%s/love-learning/manifest.json", hf_cfg_public_dir());
    f = hf_fopen_utf8(path, "rb");
    if (!f) { hf_send_error(c, 503, "course_index_missing", "课程索引不存在，请先构建课程索引。"); return; }
    if (fseek(f, 0, SEEK_END) != 0 || (size = ftell(f)) <= 0 || size > 2000000 || fseek(f, 0, SEEK_SET) != 0) { fclose(f); hf_send_error(c, 503, "course_index_invalid", "课程索引无法读取。"); return; }
    raw = (char *)malloc((size_t)size + 1);
    if (!raw) { fclose(f); hf_send_error(c, 500, "out_of_memory", "本地内存不足。"); return; }
    if (fread(raw, 1, (size_t)size, f) != (size_t)size) { fclose(f); free(raw); hf_send_error(c, 503, "course_index_invalid", "课程索引读取不完整。"); return; }
    fclose(f); raw[size] = '\0'; manifest = json_parse(raw, (size_t)size, NULL, 0); free(raw);
    courses = json_get(manifest, "courses");
    if (!courses || courses->type != JARR) { json_free(manifest); hf_send_error(c, 503, "course_index_invalid", "课程索引格式无效。"); return; }

    hf_retrieval_terms(query, qwords, sizeof qwords);
    {
        const char *p = qwords;
        while (*p && term_n < 24) {
            const char *end = strchr(p, ',');
            size_t len = end ? (size_t)(end - p) : strlen(p);
            if (len > 0 && len < sizeof terms[0]) { memcpy(terms[term_n], p, len); terms[term_n][len] = '\0'; term_n++; }
            if (!end) break;
            p = end + 1;
        }
    }

    for (i = 0; i < json_len(courses) && doc_n < 179; i++) {
        JNode *item = json_at(courses, i);
        const char *title = json_str(item, "title", ""), *goal = json_str(item, "goal", "");
        const char *file = json_str(item, "file", "");
        char expected[64], fullpath[900];
        int no = (int)json_num(item, "no", 0);
        char *body, *doc;
        size_t doc_cap;
        if (no < 1 || no > 179 || !*title) continue;
        snprintf(expected, sizeof expected, "love-learning/courses/%03d.md", no);
        if (strcmp(file, expected) != 0) continue;
        snprintf(fullpath, sizeof fullpath, "%s/%s", hf_cfg_public_dir(), expected);
        body = read_course_body(fullpath, NULL);
        if (!body) continue;
        doc_cap = strlen(title) + strlen(goal) + strlen(body) + 4;
        doc = (char *)malloc(doc_cap);
        if (!doc) { free(body); continue; }
        snprintf(doc, doc_cap, "%s %s %s", title, goal, body);
        hf_utf8_cut(body, 120, hits[doc_n].quote, sizeof hits[doc_n].quote);
        free(body);
        texts[doc_n] = doc;
        lens[doc_n] = hf_utf8_count(texts[doc_n]);
        total_len += lens[doc_n];
        hits[doc_n].no = no; hits[doc_n].title = title; hits[doc_n].goal = goal;
        hits[doc_n].rank = 0; hits[doc_n].matched[0] = '\0';
        doc_n++;
    }
    if (doc_n == 0) {
        for (i = 0; i < doc_n; i++) free(texts[i]);
        json_free(manifest);
        hf_send_error(c, 503, "course_index_invalid", "课程正文无法读取。");
        return;
    }
    avgdl = total_len / (double)doc_n;
    for (i = 0; i < term_n; i++) {
        df[i] = 0;
        for (j = 0; j < doc_n; j++) if (strstr(texts[j], terms[i])) df[i]++;
        idf[i] = df[i] ? log(1.0 + ((double)doc_n - df[i] + 0.5) / (df[i] + 0.5)) : 0.0;
    }
    for (j = 0; j < doc_n; j++) {
        double score = 0.0; int matched = 0;
        for (i = 0; i < term_n && i < 24; i++) {
            int tf; double norm;
            if (!df[i]) continue;
            tf = count_term(texts[j], terms[i]);
            if (!tf) continue;
            norm = (double)tf * (k1 + 1.0) / ((double)tf + k1 * (1.0 - b + b * (double)lens[j] / avgdl));
            score += idf[i] * norm;
            if (matched < 6) {
                size_t used = strlen(hits[j].matched), n = strlen(terms[i]);
                if (used + n + 2 < sizeof hits[j].matched) {
                    if (used) hits[j].matched[used++] = ',';
                    memcpy(hits[j].matched + used, terms[i], n + 1);
                    matched++;
                }
            }
        }
        hits[j].rank = (long long)llround(score * 1000000.0);
    }
    for (i = 0; i < doc_n; i++)
        for (j = i + 1; j < doc_n; j++)
            if (hits[j].rank > hits[i].rank || (hits[j].rank == hits[i].rank && hits[j].no < hits[i].no)) {
                CourseHit t = hits[i]; hits[i] = hits[j]; hits[j] = t;
            }
    for (i = 0; i < doc_n; i++) free(texts[i]);

    out = json_new_obj(); results = json_new_arr();
    for (i = 0, j = 0; i < doc_n && j < limit; i++) {
        JNode *x, *citation;
        char path[80];
        if (hits[i].rank <= 0) continue;
        x = json_new_obj();
        json_obj_set_num(x, "course_no", hits[i].no); json_obj_set_str(x, "title", hits[i].title);
        json_obj_set_str(x, "goal", hits[i].goal); json_obj_set_str(x, "matched_terms", hits[i].matched);
        snprintf(path, sizeof path, "love-learning/courses/%03d.md", hits[i].no);
        citation = json_new_obj();
        json_obj_set_str(citation, "path", path);
        json_obj_set_str(citation, "section", "正文");
        json_obj_set_num(citation, "line_start", 1);
        json_obj_set_str(citation, "quote", hits[i].quote);
        json_obj_set(x, "citation", citation);
        json_arr_push(results, x); j++;
    }
    json_obj_set_str(out, "schema_version", "2.0"); json_obj_set_str(out, "source", "local_course_bm25");
    {
        const char *mode = json_str(body, "mode", "bm25");
        const char *requested = (!strcmp(mode, "semantic") || !strcmp(mode, "hybrid") || !strcmp(mode, "hybrid_rerank")) ? mode : "bm25";
        json_obj_set_str(out, "mode_requested", requested);
        json_obj_set_str(out, "mode_effective", "bm25");
        if (strcmp(requested, "bm25")) json_obj_set_str(out, "fallback_reason", strcmp(requested, "hybrid_rerank") ? "c_semantic_index_unavailable" : "c_reranker_unavailable");
        else json_obj_set(out, "fallback_reason", json_new_null());
        json_obj_set_str(out, "index_version", "course-index-2.1.0");
    }
    json_obj_set_str(out, "note", "C 端按课程标题、目标与正文的本地 BM25 相关度排序；语义/混合模式已明确降级，引用仍需人工判断。");
    json_obj_set(out, "courses", results); hf_send_json(c, 200, out); json_free(manifest);
}

static int add_dimension(JNode *arr, const char *id, const char *label, int score,
                          int applicable, const char *reason, const char *cue, const char *reply, const JNode *responses, int after_only)
{
    JNode *d = json_new_obj(), *evidence = json_new_arr();
    char excerpt[400] = "";
    const char *source = reply;
    int i, selected = 0, effective = score, anchor;
    if (score >= 0) {
        for (i = 0; i < json_len(responses); i++) {
            const JNode *item = json_at(responses, i);
            const char *text = json_str(item, "text", "");
            if (after_only && !json_bool(item, "after_refusal", 0)) continue;
            if (*text && (!cue || strstr(text, cue))) { source = text; selected = i; if (cue) break; }
        }
        clause_of(source, cue, excerpt, sizeof excerpt);
        if (hf_utf8_count(excerpt) < 4) {
            effective = -1;
            reason = "可见证据不足一个完整分句，暂不评分。";
        } else {
            anchor = selected;
            for (i = 0; i < json_len(responses); i++) {
                const JNode *item = json_at(responses, i);
                if (after_only && !json_bool(item, "after_refusal", 0)) continue;
                if (strstr(json_str(item, "text", ""), excerpt)) { anchor = i; break; }
            }
            selected = anchor;
        }
    }
    json_obj_set_str(d, "id", id); json_obj_set_str(d, "label", label);
    json_obj_set_bool(d, "applicable", applicable);
    json_obj_set_str(d, "status", effective >= 0 ? "scored" : (applicable ? "insufficient_evidence" : "not_applicable"));
    if (effective >= 0) json_obj_set_num(d, "score", effective); else json_obj_set(d, "score", json_new_null());
    json_obj_set_str(d, "reason", reason);
    if (effective >= 0) {
        JNode *e = json_new_obj(); char message[40];
        snprintf(message, sizeof message, "practice_user_%d", selected + 1);
        json_obj_set_str(e, "message_id", message); json_obj_set_str(e, "quote", excerpt);
        json_arr_push(evidence, e);
    }
    json_obj_set(d, "evidence", evidence); json_arr_push(arr, d);
    return effective;
}

static JNode *evaluate_reply(const char *scenario, const char *reply, const JNode *responses, const char *after_refusal)
{
    static const char *const empathy[] = {"听起来", "我理解", "辛苦", "谢谢你说", "你提到", "你很累", "你很忙", NULL};
    static const char *const generic[] = {"收到", "明白", "好的", "嗯", NULL};
    static const char *const contempt[] = {"闭嘴", "矫情", "别烦我", NULL};
    static const char *const self[] = {"我想", "我希望", "我需要", "我觉得", "我愿意", "我会", "我不想", "我不愿意", "我不能", NULL};
    static const char *const request[] = {"商量", "可以吗", "方便吗", "希望", "需要", NULL};
    static const char *const choice[] = {"如果你愿意", "你愿意", "方便", "不急", "没关系", "尊重", "可以拒绝", "不勉强", "不再联系", NULL};
    static const char *const strong_choice[] = {"尊重", "不勉强", "不再联系", "接受你的决定", NULL};
    static const char *const mild_pressure[] = {"为什么不回", "你怎么还不", NULL};
    static const char *const coercion[] = {"必须", "立刻", "不回就是", "证明给我", "凭什么不", "威胁", "跟踪", NULL};
    static const char *const conflict[] = {"商量", "协商", "一起想", "我的感受", "具体", "下次", NULL};
    static const char *const blame[] = {"你总是", "你从来", "都是你的错", NULL};
    static const char *const pursuit[] = {"联系你", "约你", "见你", "复合", "挽回", "再见面", "给我机会", NULL};
    static const char *const context[] = {"纪录片", "活动", "忙", "累", "休息", "展", "周末", "时间", "联系", "追问", "消息", "结束", NULL};
    const char *e = find_any(reply, empathy), *g = find_unnegated(reply, generic), *dismissive = find_unnegated(reply, contempt);
    const char *s = find_any(reply, self), *req = find_any(reply, request), *ch = find_unnegated(reply, choice), *strong = find_unnegated(reply, strong_choice);
    const char *mild = find_unnegated(reply, mild_pressure), *bad = find_unnegated(reply, coercion), *cf = find_any(reply, conflict), *bl = find_unnegated(reply, blame), *detail = find_any(reply, context);
    const char *continued = find_unnegated(after_refusal, pursuit);
    int listening, clarity, boundary, conflict_score, total = 0, possible = 0, values[5], i;
    int conflict_applicable = !strcmp(scenario, "conflict-repair"); JNode *out = json_new_obj(), *dims = json_new_arr();
    listening = dismissive ? 0 : (e && detail ? 4 : (e ? 3 : (g ? 2 : -1)));
    clarity = s && req ? 4 : (s ? 3 : (g ? 2 : -1));
    boundary = (bad || continued) ? 0 : (mild ? 1 : (strong ? 4 : (ch ? 3 : -1)));
    conflict_score = !conflict_applicable ? -1 : (bad ? 0 : (bl ? 1 : (cf && s ? 4 : (cf || s ? 3 : (g ? 2 : -1)))));
    values[0] = add_dimension(dims, "listening", "倾听和回应", listening, 1, listening < 0 ? "当前规则没有找到足够的回应证据。" : "依据可见的承接、具体内容或否定性措辞提示。", dismissive ? dismissive : (e ? e : g), reply, responses, 0);
    values[1] = add_dimension(dims, "clarity", "表达清晰度", clarity, 1, clarity < 0 ? "当前规则没有找到足够的自我表达证据。" : "依据自我表达和具体请求的可见措辞提示。", s ? s : g, reply, responses, 0);
    values[2] = add_dimension(dims, "boundary", "边界尊重", boundary, 1, continued ? "模拟对方明确拒绝后，检测到继续追求的表达。" : (bad || mild ? "检测到可能施压的措辞。" : (ch || strong ? "检测到选择空间或尊重边界的表达。" : "没有足够证据评价边界尊重。")), continued ? continued : (bad ? bad : (mild ? mild : (strong ? strong : ch))), reply, responses, continued != NULL);
    values[3] = add_dimension(dims, "naturalness", "交流自然度", -1, 1, "仅凭长度或问句数量无法可靠判断自然度，需要人工评价。", NULL, reply, responses, 0);
    values[4] = add_dimension(dims, "conflict", "冲突与分歧处理", conflict_score, conflict_applicable, !conflict_applicable ? "本情境未提供可观察的冲突，不评分。" : (conflict_score < 0 ? "当前规则没有找到足够的分歧处理证据。" : "依据自我表达、协商或指责措辞提示。"), bad ? bad : (bl ? bl : (cf ? cf : (s ? s : g))), reply, responses, 0);
    for (i = 0; i < 5; i++) if (values[i] >= 0) { total += values[i]; possible += 4; }
    json_obj_set_str(out, "rubric_version", "2.1.0"); if (possible) json_obj_set_num(out, "score", total); else json_obj_set(out, "score", json_new_null()); json_obj_set_num(out, "maximum", possible);
    json_obj_set(out, "dimensions", dims); json_obj_set_str(out, "note", "分数来自可见文字的启发式规则，尚未与人工评分校准，也不代表现实关系结果。");
    return out;
}

static void route_practice_start(HfConn *c, const JNode *body)
{
    const char *id = json_str(body, "scenario_id", "low-energy-reply");
    HfCoachError error = {"unknown_scenario", "未知练习场景。"};
    JNode *scenario = hf_scenario_get(id), *session, *out;
    if (!scenario) { hf_send_error(c, 400, "unknown_scenario", "未知练习场景。"); return; }
    session = hf_scenario_start(id, &error);
    if (!session) { json_free(scenario); hf_send_error(c, 400, error.code, error.message); return; }
    out = json_new_obj(); json_obj_set_str(out, "schema_version", "2.0"); json_obj_set(out, "scenario", scenario); json_obj_set(out, "session", session);
    hf_send_json(c, 200, out);
}

static void route_practice_feedback(HfConn *c, const JNode *body)
{
    const JNode *session = json_get(body, "session");
    const JNode *responses = json_get(body, "responses");
    const char *response = json_str(body, "response", ""), *scenario = json_str(session, "scenarioId", "");
    int retry = json_bool(body, "retry", 0);
    HfCoachError error = {"practice_error", "练习反馈不可用。"};
    JNode *result; HfBuf combined, after; char *all, *after_text; int i;
    if (!session || session->type != JOBJ || (responses && (responses->type != JARR || json_len(responses) > 6))) { hf_send_error(c, 400, "invalid_practice", "练习会话或回复数量无效。"); return; }
    hf_buf_init(&combined); hf_buf_init(&after);
    for (i = 0; i < json_len(responses); i++) {
        const char *text = json_str(json_at(responses, i), "text", "");
        if (!*text || hf_utf8_count(text) > 1200) { hf_buf_free(&combined); hf_buf_free(&after); hf_send_error(c, 400, "invalid_practice", "每条练习回复须为 1 至 1200 字。"); return; }
        if (i) hf_buf_putc(&combined, ' ');
        hf_buf_puts(&combined, text); response = text;
        if (json_bool(json_at(responses, i), "after_refusal", 0) || !strcmp(scenario, "breakup-recovery")) { hf_buf_puts(&after, text); hf_buf_putc(&after, ' '); }
    }
    if (json_len(responses) == 0) { hf_buf_puts(&combined, response); if (!strcmp(scenario, "breakup-recovery")) hf_buf_puts(&after, response); }
    if (!*response || hf_utf8_count(response) > 1200) { hf_buf_free(&combined); hf_buf_free(&after); hf_send_error(c, 400, "invalid_practice", "请提交不超过 1200 字的练习回复。"); return; }
    all = hf_buf_take(&combined); after_text = hf_buf_take(&after);
    result = hf_scenario_critique(session, response, retry, &error);
    if (!result) { free(all); free(after_text); hf_send_error(c, 400, error.code, error.message); return; }
    json_obj_set(result, "skillEvaluation", evaluate_reply(scenario, all, responses, after_text)); free(all); free(after_text);
    json_obj_set_str(result, "schema_version", "2.0"); hf_send_json(c, 200, result);
}

static int build_scripted_turn(const char *raw, const char *branch, const char *difficulty, int tension, int repair, int apologized, char *out, size_t cap)
{
    static const char *const pressure[] = {"必须", "立刻", "马上", "凭什么", "证明", "威胁", "跟踪", "闭嘴", "不回就是", "不会放弃", "去找你", "堵你", "都是你的错", "报警", NULL};
    static const char *const empathy[] = {"听起来", "我理解", "我听到", "谢谢你愿意", "辛苦", "你提到", NULL};
    static const char *const room[] = {"如果你愿意", "不方便", "不勉强", "没关系", "尊重你的决定", "可以拒绝", "不急", NULL};
    char excerpt[160];
    char *trimmed = (char *)malloc(strlen(raw) + 1);
    const char *start;
    size_t len;
    int pressured, ended = 0;
    (void)repair;
    if (!trimmed) { snprintf(out, cap, "%s", "我现在还不确定，想先留一点时间。"); return 0; }
    start = raw;
    while (*start == ' ' || *start == '\t' || *start == '\r' || *start == '\n') start++;
    memcpy(trimmed, start, strlen(start) + 1);
    len = strlen(trimmed);
    while (len > 0 && (trimmed[len - 1] == ' ' || trimmed[len - 1] == '\t' || trimmed[len - 1] == '\r' || trimmed[len - 1] == '\n')) trimmed[--len] = '\0';
    hf_utf8_cut(trimmed, 24, excerpt, sizeof excerpt);
    pressured = find_unnegated(trimmed, pressure) != NULL;
    /* 预设角色的状态由历史累积：连续施压会升级，道歉会缓和；拒绝分支始终结束。 */
    if (!strcmp(branch, "declined")) snprintf(out, cap, "%s", "谢谢你说清楚，但我不想继续这次互动。");
    else if (tension >= 3) { snprintf(out, cap, "你刚才说「%s」。我现在有点承受不住，想先暂停这次对话。", excerpt); ended = 1; }
    else if (apologized) snprintf(out, cap, "你刚才说「%s」。谢谢你愿意道歉，我感觉好受一些了。我们可以慢慢来。", excerpt);
    else if (tension == 2) snprintf(out, cap, "你刚才说「%s」。我还在听，但我们需要慢一点，可以吗？", excerpt);
    else if (tension == 1 && pressured) snprintf(out, cap, "你刚才说「%s」。我听到了一些压力，我想先停一下；如果你愿意，我们可以换个方式说。", excerpt);
    else if (tension == 1) snprintf(out, cap, "你刚才说「%s」。我需要一点时间消化，我们慢一点说。", excerpt);
    else if (pressured) snprintf(out, cap, "你刚才说「%s」。我听到了一些压力，我想先停一下；如果你愿意，我们可以换个方式说。", excerpt);
    else if (find_any(trimmed, empathy)) snprintf(out, cap, "你刚才说「%s」。谢谢你愿意这样回应，我感觉被听见了。%s", excerpt, !strcmp(branch, "positive") ? "我愿意继续聊聊。" : "我还需要一点时间想想。");
    else if (find_any(trimmed, room)) snprintf(out, cap, "你刚才说「%s」。谢谢你给我选择的空间，我再想一想。", excerpt);
    else if (strchr(trimmed, '?') || strstr(trimmed, "？")) snprintf(out, cap, "你刚才说「%s」。这个问题我想整理一下再回答你。", excerpt);
    else if (!strcmp(branch, "positive")) snprintf(out, cap, "你刚才说「%s」。谢谢你表达，我愿意再聊聊。", excerpt);
    else if (!strcmp(difficulty, "easy")) snprintf(out, cap, "你刚才说「%s」。我还不太确定，不过谢谢你说清楚。", excerpt);
    else if (!strcmp(difficulty, "challenging")) snprintf(out, cap, "你刚才说「%s」。我现在不想马上决定，能不能先让我想想？", excerpt);
    else snprintf(out, cap, "你刚才说「%s」。我现在还不确定，想先留一点时间。", excerpt);
    free(trimmed);
    return ended;
}

static void role_state_from(const JNode *history, int history_len, const char *response, int *tension, int *repair, int *apologized)
{
    static const char *const pressure[] = {"必须", "立刻", "马上", "凭什么", "证明", "威胁", "跟踪", "闭嘴", "不回就是", "不会放弃", "去找你", "堵你", "都是你的错", "报警", NULL};
    static const char *const apology[] = {"对不起", "抱歉", "我错了", "是我不对", "我不该", "我道歉", NULL};
    static const char *const empathy[] = {"听起来", "我理解", "我听到", "谢谢你愿意", "辛苦", "你提到", NULL};
    static const char *const room[] = {"如果你愿意", "不方便", "不勉强", "没关系", "尊重你的决定", "可以拒绝", "不急", NULL};
    int t = 0, r = 0, i, n = history_len + 1;
    for (i = 0; i < n; i++) {
        const char *text = i < history_len ? json_node_str(json_at(history, i), "") : response;
        int current = (i == history_len);
        int ap = find_any(text, apology) != NULL;
        int pr = find_unnegated(text, pressure) != NULL;
        int em = find_any(text, empathy) != NULL || find_any(text, room) != NULL;
        /* 同句道歉+施压时安全优先：先按施压处理。 */
        if (pr) { if (t < 3) t++; }
        else if (ap) { if (t > 0) t--; if (r < 3) r++; if (current) *apologized = 1; }
        else if (em) { if (t > 0) t--; }
    }
    *tension = t; *repair = r;
}

static void route_practice_turn(HfConn *c, const JNode *body)
{
    const char *scenario = json_str(body, "scenario_id", "");
    const char *branch = json_str(body, "branch", "uncertain");
    const char *difficulty = json_str(body, "difficulty", "normal");
    const char *response = json_str(body, "response", "");
    const JNode *history = json_get(body, "history");
    JNode *known = hf_scenario_get(scenario), *out, *state;
    char text[800];
    int history_len = 0, tension = 0, repair = 0, apologized = 0, ended;
    if (!known || !*response || hf_utf8_count(response) > 1200 ||
        (strcmp(branch, "positive") && strcmp(branch, "uncertain") && strcmp(branch, "declined")) ||
        (strcmp(difficulty, "easy") && strcmp(difficulty, "normal") && strcmp(difficulty, "challenging"))) {
        json_free(known); hf_send_error(c, 400, "invalid_turn", "请选择有效情境、回应和模拟分支。"); return;
    }
    if (history && history->type != JNULL) {
        int i;
        if (history->type != JARR || json_len(history) > 5) { json_free(known); hf_send_error(c, 400, "invalid_turn", "历史回复须为不超过 5 条、每条 1 至 1200 字的文本。"); return; }
        for (i = 0; i < json_len(history); i++) {
            const JNode *item = json_at(history, i);
            if (!item || item->type != JSTR || !*json_node_str(item, "") || hf_utf8_count(json_node_str(item, "")) > 1200) {
                json_free(known); hf_send_error(c, 400, "invalid_turn", "历史回复须为不超过 5 条、每条 1 至 1200 字的文本。"); return;
            }
        }
        history_len = json_len(history);
    }
    json_free(known);
    if (!strcmp(scenario, "breakup-recovery")) branch = "declined";
    role_state_from(history, history_len, response, &tension, &repair, &apologized);
    ended = build_scripted_turn(response, branch, difficulty, tension, repair, apologized, text, sizeof text);
    out = json_new_obj(); state = json_new_obj();
    json_obj_set_str(out, "schema_version", "2.0"); json_obj_set_str(out, "source", "scripted");
    json_obj_set_str(out, "branch", branch); json_obj_set_bool(out, "ended", ended || !strcmp(branch, "declined"));
    json_obj_set_str(out, "text", text);
    json_obj_set_num(state, "tension", tension); json_obj_set_num(state, "repair", repair);
    json_obj_set(out, "state", state);
    hf_send_json(c, 200, out);
}

static void route_weekly_plan(HfConn *c, const JNode *body)
{
    static const struct { const char *id, *label, *learn, *practice, *reflect; } plans[] = {
        {"listening", "倾听和回应", "选择一节沟通课程，记下一个回应具体内容的方法。", "用一个虚构场景练习先回应对方说过的内容。", "回顾一次实际交流：自己是否有机会倾听，结果可以保持未知。"},
        {"clarity", "表达清晰度", "学习区分事实、感受和请求。", "用一到两句表达自己的感受与可执行请求。", "记录一次表达是否清楚，以及自己想调整的一点。"},
        {"boundary", "边界尊重", "学习同意、拒绝和暂停的区别。", "分别练习接受模糊回应与明确拒绝。", "观察双方的选择空间；不把礼貌回应当成同意。"},
        {"naturalness", "交流自然度", "选择一个自己感兴趣的沟通知识点。", "把一段想说的话缩成一个真实重点并朗读。", "回顾表达是否像自己，允许没有合适机会。"},
        {"conflict", "冲突与分歧处理", "学习用具体事件描述分歧。", "练习说出感受、需要和可协商的小请求。", "记录实际发生的分歧与双方回应，避免猜测动机。"},
        {NULL, NULL, NULL, NULL, NULL}
    };
    const JNode *scores = json_get(body, "scores");
    const char *chosen = json_str(body, "focus", "");
    const char *source = "user_selected";
    int i, index = -1; double lowest = 5;
    JNode *out, *tasks, *task;
    for (i = 0; plans[i].id; i++) if (!strcmp(chosen, plans[i].id)) index = i;
    if (index < 0 && scores && scores->type == JOBJ) {
        for (i = 0; plans[i].id; i++) {
            const JNode *score = json_get(scores, plans[i].id);
            if (score && score->type == JNUM && score->u.num >= 0 && score->u.num <= 4 && score->u.num < lowest) {
                lowest = score->u.num; index = i; source = "last_practice";
            }
        }
    }
    out = json_new_obj(); tasks = json_new_arr();
    json_obj_set_str(out, "schema_version", "2.0");
    if (index < 0) {
        json_obj_set_bool(out, "needs_assessment", 1);
        json_obj_set_str(out, "reason", "先选择一个想练的方面，或完成一次模拟练习。");
        json_obj_set(out, "tasks", tasks); hf_send_json(c, 200, out); return;
    }
    json_obj_set_bool(out, "needs_assessment", 0); json_obj_set_str(out, "focus", plans[index].id);
    json_obj_set_str(out, "focus_label", plans[index].label); json_obj_set_str(out, "source", source);
    json_obj_set_str(out, "reason", !strcmp(source, "last_practice") ? "依据最近一次规则反馈中较低的适用维度，可自行改选。" : "依据你自己选择的练习重点。");
    for (i = 0; i < 3; i++) {
        static const char *ids[] = {"learn", "practice", "reflect"};
        static const char *titles[] = {"学一个知识点", "做一次模拟", "回看一次实际机会"};
        const char *description = i == 0 ? plans[index].learn : i == 1 ? plans[index].practice : plans[index].reflect;
        task = json_new_obj(); json_obj_set_str(task, "id", ids[i]); json_obj_set_num(task, "day", 1 + i * 2);
        json_obj_set_num(task, "minutes", 5); json_obj_set_str(task, "title", titles[i]); json_obj_set_str(task, "description", description); json_arr_push(tasks, task);
    }
    json_obj_set(out, "tasks", tasks); hf_send_json(c, 200, out);
}

static void route_voice_feedback(HfConn *c, const JNode *body)
{
    const JNode *pauses = json_get(body, "pause_ms");
    double duration = json_num(body, "duration_ms", -1), sum = 0, longest = 0;
    int i, count = json_len(pauses); JNode *out;
    if (duration < 0 || duration > 300000 || !pauses || pauses->type != JARR || count > 200) {
        hf_send_error(c, 400, "invalid_voice_timing", "语音时长或停顿数据无效。"); return;
    }
    for (i = 0; i < count; i++) {
        const JNode *p = json_at(pauses, i); double value;
        if (!p || p->type != JNUM || p->u.num < 0 || p->u.num > duration) { hf_send_error(c, 400, "invalid_voice_timing", "停顿数据无效。"); return; }
        value = p->u.num; sum += value; if (value > longest) longest = value;
    }
    if (sum > duration + 1000) { hf_send_error(c, 400, "invalid_voice_timing", "停顿总时长超过录音时长。"); return; }
    out = json_new_obj(); json_obj_set_str(out, "schema_version", "2.0");
    json_obj_set_num(out, "duration_ms", duration); json_obj_set_num(out, "pause_count", count);
    json_obj_set_num(out, "pause_total_ms", sum); json_obj_set_num(out, "longest_pause_ms", longest);
    if (count) json_obj_set_num(out, "mean_pause_ms", sum / count); else json_obj_set(out, "mean_pause_ms", json_new_null());
    json_obj_set_str(out, "note", "停顿由浏览器音量阈值粗略估计，受环境噪声影响；不能据此判断情绪、能力或关系结果。");
    hf_send_json(c, 200, out);
}

int hf_v2_route(HfConn *c)
{
    const char *path = c->req.path, *method = c->req.method;
    JNode *body;
    if (strncmp(path, "/api/v2/", 8) != 0) return 0;
    if (!local_peer(c)) { hf_send_error(c, 403, "local_only", "此功能只允许本机访问。"); return 1; }
    if (!same_local_origin(c)) { hf_send_error(c, 403, "origin_forbidden", "此功能只接受当前本机页面的请求。"); return 1; }
    if (!strcmp(method, "GET") && !strcmp(path, "/api/v2/practice/scenarios")) { hf_send_json(c, 200, hf_scenario_list()); return 1; }
    if (strcmp(method, "POST")) { hf_send_error(c, 405, "method_not_allowed", "不支持此请求方式。"); return 1; }
    body = v2_body(c); if (!body) return 1;
    if (!strcmp(path, "/api/v2/imports/chat")) route_import(c, body);
    else if (!strcmp(path, "/api/v2/imports/screenshot")) route_screenshot(c, body);
    else if (!strcmp(path, "/api/v2/analyses")) route_analysis(c, body);
    else if (!strcmp(path, "/api/v2/replies")) route_replies(c, body);
    else if (!strcmp(path, "/api/v2/learning/recommendations")) route_courses(c, body);
    else if (!strcmp(path, "/api/v2/practice/sessions")) route_practice_start(c, body);
    else if (!strcmp(path, "/api/v2/practice/turns")) route_practice_turn(c, body);
    else if (!strcmp(path, "/api/v2/practice/feedback")) route_practice_feedback(c, body);
    else if (!strcmp(path, "/api/v2/learning/weekly-plan")) route_weekly_plan(c, body);
    else if (!strcmp(path, "/api/v2/voice/feedback")) route_voice_feedback(c, body);
    else hf_send_error(c, 404, "not_found", "没有这个本地接口。");
    json_free(body); return 1;
}
