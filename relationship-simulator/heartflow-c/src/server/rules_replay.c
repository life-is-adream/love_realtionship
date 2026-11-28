#include "rules.h"
#include "rules_internal.h"

#include <ctype.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ================= 数据结构 ================= */

typedef struct {
    char *id;
    char *text;
    char speaker[8];
    int line;
    long long ts;
    int has_ts;
} RMsg;

typedef struct {
    RMsg *v;
    int n;
} RMsgs;

typedef struct {
    RMsgs msgs;
    char warnings[4][512];
    int warning_n;
    int parsed;
    int unknown;
} RParse;

typedef struct {
    const char *key;
    const char *label;
    int msg_index;
    char evidence[512];
    int signal_count;
    const char *signal_keys[8];
    const char *signal_labels[8];
} RBoundary;

typedef struct {
    RBoundary *v;
    int n;
} RBoundaries;

static void rmsgs_free(RMsgs *m)
{
    int i;
    for (i = 0; i < m->n; i++) {
        free(m->v[i].id);
        free(m->v[i].text);
    }
    free(m->v);
    m->v = NULL;
    m->n = 0;
}

static void rmsgs_push(RMsgs *m, const char *id, const char *text, const char *speaker,
                       int line, long long ts, int has_ts)
{
    m->v = (RMsg *)realloc(m->v, sizeof(RMsg) * (size_t)(m->n + 1));
    if (!m->v) abort();
    m->v[m->n].id = r_trim_dup(id ? id : "");
    m->v[m->n].text = r_trim_dup(text ? text : "");
    snprintf(m->v[m->n].speaker, sizeof m->v[m->n].speaker, "%s", speaker ? speaker : "unknown");
    m->v[m->n].line = line;
    m->v[m->n].ts = ts;
    m->v[m->n].has_ts = has_ts;
    m->n++;
}

/* ================= 解析粘贴文本 ================= */

static void skip_ws(const char **pp)
{
    const char *p = *pp;
    while (*p) {
        uint32_t cp = 0;
        int bytes = r_utf8_one(p, &cp);
        if (!r_is_ws_cp(cp)) break;
        p += bytes;
    }
    *pp = p;
}

static int digits_at(const char *p, int n)
{
    int i;
    for (i = 0; i < n; i++) if (!p[i] || p[i] < '0' || p[i] > '9') return 0;
    return 1;
}

static int extract_timestamp_prefix(const char *line, long long *ts, size_t *rest_off)
{
    const char *p = line;
    const char *ts_start, *ts_end;
    char ts_buf[80];
    size_t ts_len;
    int ok = 0;
    long long parsed;

    *rest_off = 0;
    skip_ws(&p);
    if (*p == '[') { p++; skip_ws(&p); }
    else if ((unsigned char)p[0] == 0xE3 && (unsigned char)p[1] == 0x80 && (unsigned char)p[2] == 0x90) { p += 3; skip_ws(&p); } /* 【 */

    ts_start = p;
    if (!digits_at(p, 4) || p[4] != '-') return 0;
    if (!digits_at(p + 5, 2) || p[7] != '-') return 0;
    if (!digits_at(p + 8, 2)) return 0;
    p += 10;
    if (*p != 'T' && *p != ' ') return 0;
    p++;
    if (!digits_at(p, 2) || p[2] != ':') return 0;
    if (!digits_at(p + 3, 2)) return 0;
    p += 5;
    if (*p == ':') {
        if (!digits_at(p + 1, 2)) return 0;
        p += 3;
        if (*p == '.') {
            int frac = 0;
            p++;
            while (frac < 3 && p[frac] >= '0' && p[frac] <= '9') frac++;
            if (!frac) return 0;
            p += frac;
        }
    }
    {
        const char *q = p;
        skip_ws(&q);
        if (*q == 'Z') { p = q + 1; }
        else if (*q == '+' || *q == '-') {
            const char *z = q + 1;
            if (digits_at(z, 2)) {
                z += 2;
                if (*z == ':') z++;
                if (digits_at(z, 2)) p = z + 2;
            }
        }
    }
    ts_end = p;

    skip_ws(&p);
    if (*p == ']') p++;
    else if ((unsigned char)p[0] == 0xE3 && (unsigned char)p[1] == 0x80 && (unsigned char)p[2] == 0x91) p += 3; /* 】 */
    skip_ws(&p);
    if (*p == '|' || *p == '-') p++;
    else if ((unsigned char)p[0] == 0xEF && (unsigned char)p[1] == 0xBD && (unsigned char)p[2] == 0x9C) p += 3; /* ｜ */
    skip_ws(&p);

    ts_len = (size_t)(ts_end - ts_start);
    if (ts_len >= sizeof ts_buf) return 0;
    memcpy(ts_buf, ts_start, ts_len);
    ts_buf[ts_len] = '\0';
    parsed = r_parse_time(ts_buf, &ok);
    if (!ok) return 0;
    *ts = parsed;
    *rest_off = (size_t)(p - line);
    return 1;
}

static const char *SPEAKER_LABELS[] = {
    "夏紫桐", "我方", "男方", "自己", "女生", "对方", "我", "她", NULL
};

static const char *speaker_key(const char *label)
{
    if (!strcmp(label, "我") || !strcmp(label, "我方") || !strcmp(label, "男方") || !strcmp(label, "自己")) return "self";
    if (!strcmp(label, "她") || !strcmp(label, "夏紫桐") || !strcmp(label, "对方") || !strcmp(label, "女生")) return "other";
    return "unknown";
}

/* 返回 1 表示识别到说话人；text_out 指向冒号之后的原始位置。 */
static int parse_speaker_prefix(const char *s, char speaker[8], const char **text_out)
{
    const char *p = s;
    int i;

    skip_ws(&p);
    if (p[0] == '*' && p[1] == '*') { p += 2; skip_ws(&p); }
    for (i = 0; SPEAKER_LABELS[i]; i++) {
        size_t len = strlen(SPEAKER_LABELS[i]);
        if (strncmp(p, SPEAKER_LABELS[i], len) == 0) {
            p += len;
            skip_ws(&p);
            if (p[0] == '*' && p[1] == '*') { p += 2; skip_ws(&p); }
            if (*p == ':' ||
                ((unsigned char)p[0] == 0xEF && (unsigned char)p[1] == 0xBC && (unsigned char)p[2] == 0x9A)) {
                p += (*p == ':') ? 1 : 3;
                skip_ws(&p);
                if (p[0] == '*' && p[1] == '*') { p += 2; }
                if (*p == ' ') p++;
                snprintf(speaker, 8, "%s", speaker_key(SPEAKER_LABELS[i]));
                *text_out = p;
                return 1;
            }
            return 0;
        }
    }
    return 0;
}

static void add_warning(RParse *out, const char *text)
{
    if (out->warning_n >= 4) return;
    snprintf(out->warnings[out->warning_n], sizeof out->warnings[out->warning_n], "%s", text);
    out->warning_n++;
}

static RParse rparse_text(const char *raw)
{
    RParse out;
    char *copy;
    char *p;
    int line_no = 0;
    int has_timestamp = 0;

    memset(&out, 0, sizeof out);
    copy = r_trim_dup(raw ? raw : "");
    /* 先统一换行，避免 \r\n 被当成两行。 */
    {
        char *r = copy, *w = copy;
        while (*r) {
            if (*r == '\r') {
                *w++ = '\n';
                r++;
                if (*r == '\n') r++;
            } else {
                *w++ = *r++;
            }
        }
        *w = '\0';
    }

    p = copy;
    while (1) {
        char *line_start = p;
        char *line_end;
        char *line;
        long long ts = -1;
        int has_ts = 0;
        size_t rest_off = 0;
        const char *candidate;
        const char *text_start = NULL;
        char speaker[8] = "unknown";

        line_no++;
        line_end = strchr(p, '\n');
        if (line_end) { *line_end = '\0'; p = line_end + 1; }
        else p += strlen(p);

        line = r_trim_dup(line_start);
        if (!*line) { free(line); if (!line_end) break; continue; }

        if (extract_timestamp_prefix(line, &ts, &rest_off)) {
            has_ts = 1;
            has_timestamp = 1;
            candidate = line + rest_off;
        } else {
            candidate = line;
        }
        {
            char *cand = r_trim_dup(candidate);
            char *text;
            if (parse_speaker_prefix(cand, speaker, &text_start)) {
                text = r_trim_dup(text_start);
                out.parsed++;
            } else {
                snprintf(speaker, sizeof speaker, "unknown");
                text = r_trim_dup(cand);
                out.unknown++;
            }
            {
                char id[32];
                snprintf(id, sizeof id, "replay-%d", out.msgs.n + 1);
                rmsgs_push(&out.msgs, id, text, speaker, line_no, ts, has_ts);
            }
            free(text);
            free(cand);
        }
        free(line);
        if (!line_end) break;
    }
    free(copy);

    if (out.msgs.n == 0) {
        add_warning(&out, "没有找到可分析的非空消息行，请粘贴聊天内容。");
    }
    if (out.unknown > 0) {
        char buf[512];
        snprintf(buf, sizeof buf,
                 "有 %d 行未识别说话人，已保留为 unknown；可改成“我：内容”或“她：内容”后重试。",
                 out.unknown);
        add_warning(&out, buf);
    }
    if (out.msgs.n > 0 && !has_timestamp) {
        add_warning(&out, "未检测到可用时间戳；分析不会对消息时机下结论。");
    }
    return out;
}

/* ================= 结构化消息输入 ================= */

static int json_line_value(const JNode *item, int index)
{
    JNode *n = json_get(item, "line");
    if (!n) return index + 1;
    if (n->type == JNUM) return (int)n->u.num;
    if (n->type == JSTR) {
        char *end = NULL;
        long v = strtol(n->u.str.s, &end, 10);
        if (end && end != n->u.str.s) return (int)v;
    }
    if (n->type == JNULL) return 0;
    return index + 1;
}

static RMsgs rmsgs_from_json(const JNode *messages)
{
    RMsgs out;
    int i, n = json_len(messages);
    memset(&out, 0, sizeof out);
    for (i = 0; i < n; i++) {
        JNode *item = json_at(messages, i);
        const char *speaker = "unknown";
        const char *text = "";
        const char *id = "";
        long long ts = -1;
        int has_ts = 0;
        char idbuf[32];

        if (item && item->type == JOBJ) {
            const char *s = json_str(item, "speaker", "unknown");
            if (!strcmp(s, "self") || !strcmp(s, "other") || !strcmp(s, "unknown")) speaker = s;
            text = json_str(item, "text", "");
            id = json_str(item, "id", "");
            {
                JNode *tn = json_get(item, "timestamp");
                JNode *cn = json_get(item, "createdAt");
                if (tn && tn->type != JNULL) ts = r_timestamp_value(tn, &has_ts);
                else if (cn && cn->type != JNULL) ts = r_timestamp_value(cn, &has_ts);
            }
        }
        if (!*id) {
            snprintf(idbuf, sizeof idbuf, "replay-%d", i + 1);
            id = idbuf;
        }
        rmsgs_push(&out, id, text, speaker, json_line_value(item, i), ts, has_ts);
    }
    return out;
}

/* ================= 问题 / 长度 ================= */

static int count_punct_questions(const char *text)
{
    const char *p = text ? text : "";
    int n = 0;
    while (*p) {
        if (*p == '?') { n++; p++; continue; }
        if ((unsigned char)p[0] == 0xEF && (unsigned char)p[1] == 0xBC && (unsigned char)p[2] == 0x9F) { n++; p += 3; continue; }
        p++;
    }
    return n;
}

static int ends_with_question_word(const char *text)
{
    char *trim = r_trim_dup(text ? text : "");
    int len = (int)strlen(trim);
    int ok = 0;
    /* 去掉末尾的标点后再看词尾。 */
    while (len > 0) {
        unsigned char c = (unsigned char)trim[len - 1];
        if (c == '!' || c == '?' || c == '\n') { trim[--len] = '\0'; continue; }
        if (len >= 3) {
            const char *t = trim + len - 3;
            if (!strcmp(t, "。") || !strcmp(t, "！") || !strcmp(t, "？")) { trim[len - 3] = '\0'; len -= 3; continue; }
        }
        break;
    }
    if (len >= 3) {
        const char *t = trim + len - 3;
        if (!strcmp(t, "吗") || !strcmp(t, "呢") || !strcmp(t, "嘛") || !strcmp(t, "么")) ok = 1;
    }
    free(trim);
    return ok;
}

static int starts_with_question_word(const char *text)
{
    static const char *LIST[] = {
        "有没有", "能不能", "可以不可以", "会不会", "是不是",
        "什么时候", "为什么", "怎么", "哪里", "哪个", "哪种", "多少",
        "你", "是否", NULL
    };
    int i;
    for (i = 0; LIST[i]; i++) if (r_starts_with(text, LIST[i])) return 1;
    return 0;
}

static int replay_question_count(const char *text)
{
    int punctuation;
    int lexical;
    char *trim = r_trim_dup(text ? text : "");
    punctuation = count_punct_questions(trim);
    lexical = ends_with_question_word(trim) || starts_with_question_word(trim);
    free(trim);
    return punctuation > lexical ? punctuation : (lexical ? 1 : 0);
    /* 注意：上面写法在 punctuation=0, lexical=1 时返回 1；punctuation=2 时返回 2。 */
}

static int has_question(const char *text)
{
    return replay_question_count(text) > 0;
}

/* ================= 边界信号 ================= */

typedef struct {
    const char *key;
    const char *label;
    const char **patterns;
} BoundaryRule;

static const char *B_BUSY[] = { "忙", "在开会", "有事要处理", NULL };
static const char *B_TIRED[] = { "累", "疲惫", "困", "精力不太够", NULL };
static const char *B_LATER[] = { "改天", "下次", "之后再", NULL };
static const char *B_REST[] = { "先休息", "早点休息", "想休息", "先睡", NULL };
static const char *B_INCONVENIENT[] = { "不太方便", "不方便", "不合适", NULL };
static const char *B_QUIET[] = { "想安静", "安静一会儿", "不想说了", "不想聊", NULL };
static const char *B_CLOSING[] = { "晚安", "明天再聊", "先这样", "先到这", NULL };

static BoundaryRule BOUNDARY_RULES[] = {
    { "busy", "忙", B_BUSY },
    { "tired", "累", B_TIRED },
    { "later", "改天", B_LATER },
    { "rest", "先休息", B_REST },
    { "inconvenient", "不太方便", B_INCONVENIENT },
    { "quiet", "想安静", B_QUIET },
    { "closing", "收尾", B_CLOSING }
};

static void detect_boundary_signals(RBoundary *out, const RMsg *msg)
{
    int i;
    out->key = NULL;
    out->label = NULL;
    out->msg_index = 0;
    out->signal_count = 0;
    out->evidence[0] = '\0';
    if (!msg || strcmp(msg->speaker, "other")) return;
    for (i = 0; i < (int)(sizeof BOUNDARY_RULES / sizeof BOUNDARY_RULES[0]); i++) {
        if (r_has_any(msg->text, BOUNDARY_RULES[i].patterns)) {
            if (out->signal_count < 8) {
                out->signal_keys[out->signal_count] = BOUNDARY_RULES[i].key;
                out->signal_labels[out->signal_count] = BOUNDARY_RULES[i].label;
                out->signal_count++;
            }
        }
    }
}

/* ================= 隐私脱敏（与 core/privacy.js 对齐） ================= */

static int is_url_stop(uint32_t cp)
{
    return cp == '<' || cp == '>' || cp == '"' || cp == '\'' || cp == 0xFF0C || cp == 0x3002 ||
           cp == 0xFF01 || cp == 0xFF1F || cp == 0xFF1B || cp == 0x3001 || cp == 0xFF09 ||
           cp == 0x300B || cp == 0x3011 || cp == 0x3009;
}

static int tld_matches(const char *s, size_t n)
{
    static const char *TLDS[] = {
        "com", "cn", "net", "org", "edu", "gov", "io", "me", "co", "top", "xyz", NULL
    };
    int i;
    for (i = 0; TLDS[i]; i++) {
        if (strlen(TLDS[i]) == n && strncmp(s, TLDS[i], n) == 0) return 1;
    }
    return 0;
}

/* 裸域名（example.com / foo.com.cn/path），对齐 privacy.js 的第二条 URL 规则。 */
static const char *bare_domain_end(const char *base, const char *p)
{
    const char *q = p;
    const char *last_label = NULL;
    int labels = 0;

    if (!*p) return NULL;
    if (p > base) {
        unsigned char prev = (unsigned char)p[-1];
        if (isalnum(prev) || prev == '_' || prev == '@') return NULL;
    }
    while (1) {
        const char *start = q;
        while (*q && (isalnum((unsigned char)*q) || *q == '-')) q++;
        if (q == start) break;
        labels++;
        last_label = start;
        if (*q == '.') { q++; continue; }
        break;
    }
    if (labels < 2 || !last_label) return NULL;
    if (!tld_matches(last_label, (size_t)(q - last_label))) return NULL;
    if (*q == '/') {
        while (*q) {
            uint32_t cp = 0;
            int bytes = r_utf8_one(q, &cp);
            if (r_is_ws_cp(cp) || is_url_stop(cp)) break;
            q += bytes;
        }
    }
    return q;
}

static char *redact_text(const char *input)
{
    HfBuf b;
    const char *p = input ? input : "";

    hf_buf_init(&b);
    while (*p) {
        /* email */
        if ((isalnum((unsigned char)*p) || *p == '.' || *p == '_' || *p == '%' || *p == '+' || *p == '-')) {
            const char *q = p;
            while (*q && (isalnum((unsigned char)*q) || *q == '.' || *q == '_' || *q == '%' || *q == '+' || *q == '-')) q++;
            if (*q == '@') {
                const char *r = q + 1;
                int dots = 0;
                while (*r && (isalnum((unsigned char)*r) || *r == '.' || *r == '-')) {
                    if (*r == '.') dots++;
                    r++;
                }
                if (dots >= 1 && r > q + 2) {
                    hf_buf_puts(&b, "[已隐藏邮箱]");
                    p = r;
                    continue;
                }
            }
        }
        /* url */
        if (!strncmp(p, "http://", 7) || !strncmp(p, "https://", 8) || !strncmp(p, "www.", 4)) {
            while (*p) {
                uint32_t cp = 0;
                int bytes = r_utf8_one(p, &cp);
                if (r_is_ws_cp(cp) || is_url_stop(cp)) break;
                p += bytes;
            }
            hf_buf_puts(&b, "[已隐藏网址]");
            continue;
        }
        /* 裸域名（example.com），与 privacy.js 的第二条 URL 规则对齐 */
        {
            const char *dom_end = bare_domain_end(input, p);
            if (dom_end && dom_end > p) {
                hf_buf_puts(&b, "[已隐藏网址]");
                p = dom_end;
                continue;
            }
        }
        /* 手机号 / 座机 / 长数字编号 */
        if (isdigit((unsigned char)*p)) {
            const char *q = p;
            int digits = 0;
            while (*q && (isdigit((unsigned char)*q) || *q == '-' || *q == ' ' || *q == '+')) {
                if (isdigit((unsigned char)*q)) digits++;
                q++;
            }
            if (digits >= 12 && digits <= 19 && q - p == digits) {
                hf_buf_puts(&b, "[已隐藏编号]");
                p = q;
                continue;
            }
            if (digits >= 7) {
                hf_buf_puts(&b, digits >= 11 ? "[已隐藏手机号]" : "[已隐藏电话]");
                p = q;
                continue;
            }
        }
        {
            uint32_t cp = 0;
            int bytes = r_utf8_one(p, &cp);
            hf_buf_add(&b, p, (size_t)bytes);
            p += bytes;
        }
    }
    return hf_buf_take(&b);
}

static char *evidence_snippet(const char *text)
{
    char *redacted = redact_text(text ? text : "");
    char *clean = r_clean_dup(redacted);
    char *out;
    if (r_cp_len(clean) <= 72) {
        free(redacted);
        return clean;
    }
    {
        char cut[512];
        r_utf8_cut_chars(clean, 71, cut, sizeof cut);
        out = (char *)malloc(strlen(cut) + 4);
        if (!out) abort();
        sprintf(out, "%s…", cut);
    }
    free(redacted);
    free(clean);
    return out;
}

/* ================= 分析 ================= */

typedef struct {
    char *items[8];
    int n;
} RStrList;

static void rstr_add_unique(RStrList *list, const char *s)
{
    int i;
    if (!s || !*s || list->n >= 8) return;
    for (i = 0; i < list->n; i++) if (!strcmp(list->items[i], s)) return;
    list->items[list->n++] = r_trim_dup(s);
}

static void rstr_free(RStrList *list)
{
    int i;
    for (i = 0; i < list->n; i++) free(list->items[i]);
    list->n = 0;
}

static int confidence_for_sample(int n)
{
    if (n >= 8) return 2;
    if (n >= 3) return 1;
    return 0;
}

static const char *confidence_name(int level)
{
    return level >= 2 ? "high" : (level >= 1 ? "medium" : "low");
}

typedef struct {
    int score;
    int status;          /* 0 unknown, 1 available, 2 partial */
    int confidence;
    long long duration;
    int has_duration;
    int comparable_gaps;
    int cooldown_count;
    int has_timing;
} RTiming;

static RTiming replay_timing(const RMsgs *m, const JNode *options)
{
    RTiming t;
    int i, timestamped = 0, known = 0;
    long long min_ts = 0, max_ts = 0;
    long long cooldown_ms = 120 * 60 * 1000;

    memset(&t, 0, sizeof t);
    t.confidence = 0;
    if (options) {
        JNode *n = json_get(options, "cooldownMinutes");
        double minutes = (n && n->type == JNUM) ? n->u.num : (n && n->type == JSTR ? strtod(n->u.str.s, NULL) : 120);
        if (isfinite(minutes) && minutes > 0) cooldown_ms = (long long)(minutes * 60000.0);
        else {
            JNode *msn = json_get(options, "cooldownThresholdMs");
            double ms = (msn && msn->type == JNUM) ? msn->u.num : (msn && msn->type == JSTR ? strtod(msn->u.str.s, NULL) : 0);
            if (isfinite(ms) && ms > 0) cooldown_ms = (long long)ms;
        }
    }

    for (i = 0; i < m->n; i++) {
        if (!strcmp(m->v[i].speaker, "unknown")) continue;
        known++;
        if (m->v[i].has_ts) {
            timestamped++;
            if (timestamped == 1) { min_ts = max_ts = m->v[i].ts; }
            else {
                if (m->v[i].ts < min_ts) min_ts = m->v[i].ts;
                if (m->v[i].ts > max_ts) max_ts = m->v[i].ts;
            }
        }
        if (i > 0 && m->v[i - 1].has_ts && m->v[i].has_ts) {
            long long gap = m->v[i].ts - m->v[i - 1].ts;
            if (gap >= 0) {
                t.comparable_gaps++;
                if (gap >= cooldown_ms) t.cooldown_count++;
            }
        }
    }
    t.has_timing = timestamped >= 2;
    if (t.has_timing) {
        t.duration = max_ts - min_ts;
        t.has_duration = 1;
        t.score = 82 - (t.cooldown_count * 15 > 60 ? 60 : t.cooldown_count * 15);
        t.status = (timestamped > 0 && timestamped < known) ? 2 : 1;
        t.confidence = (t.status == 2) ? 0 : confidence_for_sample(t.comparable_gaps);
    }
    return t;
}

static void add_observation(JNode *arr, const char *type, const char *severity,
                            const char *evidence, const char *confidence,
                            const char *dimension)
{
    JNode *o = json_new_obj();
    json_obj_set_str(o, "type", type);
    json_obj_set_str(o, "severity", severity);
    json_obj_set_str(o, "evidence", evidence);
    json_obj_set_str(o, "confidence", confidence);
    if (dimension) json_obj_set_str(o, "dimension", dimension);
    json_arr_push(arr, o);
}

static JNode *dimension_node(const RTiming *timing, double score, int has_score,
                             const char *status, const char *evidence, int sample_size,
                             const char *confidence)
{
    JNode *d = json_new_obj();
    if (has_score) json_obj_set_num(d, "score", r_clamp_score(score));
    else json_obj_set(d, "score", json_new_null());
    json_obj_set_str(d, "status", status);
    json_obj_set_num(d, "sampleSize", sample_size);
    json_obj_set_str(d, "confidence", confidence);
    {
        JNode *ev = json_new_arr();
        json_arr_push(ev, json_new_str(evidence));
        json_obj_set(d, "evidence", ev);
    }
    (void)timing;
    return d;
}

static void add_suggestion(JNode *arr, const char *dimension, const char *title, const char *action)
{
    int i;
    for (i = 0; i < json_len(arr); i++) {
        if (!strcmp(json_str(json_at(arr, i), "dimension", ""), dimension)) return;
    }
    {
        JNode *s = json_new_obj();
        json_obj_set_str(s, "dimension", dimension);
        json_obj_set_str(s, "title", title);
        json_obj_set_str(s, "action", action);
        json_arr_push(arr, s);
    }
}

static JNode *analyze_replay(const RMsgs *m, const JNode *options,
                             RBoundaries *boundaries_out, RTiming *timing_out)
{
    int i, known = 0, self_count = 0, other_count = 0;
    int self_questions = 0, other_questions = 0, question_messages = 0;
    int self_length = 0, other_length = 0;
    int reply_count = 0, consecutive = 0, current = 0;
    int has_misread = 0;
    double self_share = 0.0, other_share = 0.0;
    double question_rate = 0.0, reply_rate = 0.0, question_density = 0.0;
    RTiming timing;
    RBoundaries boundaries;
    JNode *analysis, *overview, *dimensions, *metrics, *observations, *suggestions;
    JNode *initiative, *curiosity, *boundary_dim, *timing_dim, *boundary_arr;

    memset(&boundaries, 0, sizeof boundaries);
    for (i = 0; i < m->n; i++) {
        if (strcmp(m->v[i].speaker, "unknown")) known++;
        if (!strcmp(m->v[i].speaker, "self")) {
            self_count++;
            self_questions += replay_question_count(m->v[i].text);
            if (has_question(m->v[i].text)) question_messages++;
            self_length += r_cp_len_no_ws(m->v[i].text);
        } else if (!strcmp(m->v[i].speaker, "other")) {
            other_count++;
            other_questions += replay_question_count(m->v[i].text);
            other_length += r_cp_len_no_ws(m->v[i].text);
        }
    }

    for (i = 0; i < m->n; i++) {
        if (!strcmp(m->v[i].speaker, "self")) {
            int j;
            for (j = i + 1; j < m->n; j++) {
                if (strcmp(m->v[j].speaker, "unknown")) {
                    if (!strcmp(m->v[j].speaker, "other")) reply_count++;
                    break;
                }
            }
        }
    }
    for (i = 0; i < m->n; i++) {
        if (!strcmp(m->v[i].speaker, "self")) {
            current++;
            if (current > consecutive) consecutive = current;
        } else {
            current = 0;
        }
    }

    /* 边界信号与证据。 */
    for (i = 0; i < m->n; i++) {
        RBoundary tmp;
        detect_boundary_signals(&tmp, &m->v[i]);
        if (tmp.signal_count > 0) {
            char *snippet = evidence_snippet(m->v[i].text);
            tmp.msg_index = i;
            snprintf(tmp.evidence, sizeof tmp.evidence, "%s", snippet);
            free(snippet);
            boundaries.v = (RBoundary *)realloc(boundaries.v, sizeof(RBoundary) * (size_t)(boundaries.n + 1));
            if (!boundaries.v) abort();
            boundaries.v[boundaries.n++] = tmp;
        }
    }

    if (known > 0) {
        self_share = (double)self_count / (double)known;
        other_share = (double)other_count / (double)known;
    }
    if (self_count > 0) {
        reply_rate = r_round3((double)reply_count / (double)self_count);
        question_rate = r_round3((double)question_messages / (double)self_count);
        question_density = r_round3((double)self_questions / (double)(self_length > 0 ? self_length : 1));
    }
    timing = replay_timing(m, options);

    observations = json_new_arr();
    suggestions = json_new_arr();

    if (known >= 2 && fabs(self_share - other_share) >= 0.4) {
        double gap = fabs(self_share - other_share);
        double max_share = self_share > other_share ? self_share : other_share;
        const char *dominant = self_share > other_share ? "你" : "对方";
        char evidence[512];
        snprintf(evidence, sizeof evidence,
                 "已识别消息中%s占比更高（%d%%）；消息数量只能反映互动分布，不能直接代表投入意愿。",
                 dominant, (int)r_round(max_share * 100.0));
        add_observation(observations, "initiative_balance", gap >= 0.6 ? "high" : "medium",
                        evidence, "medium", "initiative");
    }
    if ((self_count > 0 && question_rate >= 0.6) || self_questions >= 3) {
        char evidence[512];
        snprintf(evidence, sizeof evidence,
                 "你的消息中约 %d%% 含问题，共检测到 %d 个提问；建议结合回应，而不是连续索取信息。",
                 (int)r_round(question_rate * 100.0), self_questions);
        add_observation(observations, "question_density", question_rate >= 0.8 ? "high" : "medium",
                        evidence, "medium", "curiosity");
    }
    if (consecutive >= 2) {
        char evidence[512];
        snprintf(evidence, sizeof evidence,
                 "检测到最多连续 %d 条你的消息，可能提高对方接话压力；这只是节奏信号，不等于对方一定拒绝。",
                 consecutive);
        add_observation(observations, "consecutive_follow_up", consecutive >= 3 ? "high" : "medium",
                        evidence, "high", "timing");
    }
    if (timing.has_timing && timing.cooldown_count > 0) {
        long long longest = 0;
        char evidence[512];
        int j;
        for (j = 1; j < m->n; j++) {
            if (m->v[j - 1].has_ts && m->v[j].has_ts) {
                long long gap = m->v[j].ts - m->v[j - 1].ts;
                if (gap > longest) longest = gap;
            }
        }
        snprintf(evidence, sizeof evidence,
                 "检测到 %d 次较长间隔，最长约 %d 分钟；间隔本身不能说明关系走向。",
                 timing.cooldown_count, (int)r_round((double)longest / 60000.0));
        add_observation(observations, "cooldown", timing.cooldown_count >= 2 ? "medium" : "low",
                        evidence, confidence_name(timing.confidence), "timing");
    }
    if (boundaries.n > 0) {
        RStrList labels;
        char evidence[512];
        int j, k;
        memset(&labels, 0, sizeof labels);
        for (j = 0; j < boundaries.n; j++) {
            for (k = 0; k < boundaries.v[j].signal_count; k++) {
                rstr_add_unique(&labels, boundaries.v[j].signal_labels[k]);
            }
        }
        {
            char joined[256] = "";
            for (j = 0; j < labels.n; j++) {
                if (j) strncat(joined, "、", sizeof joined - strlen(joined) - 1);
                strncat(joined, labels.items[j], sizeof joined - strlen(joined) - 1);
            }
            snprintf(evidence, sizeof evidence,
                     "对方消息出现“%s”等可能需要空间的表达；这是可观察信号，不是确定意图。", joined);
        }
        add_observation(observations, "boundary_signal", boundaries.n >= 2 ? "medium" : "low",
                        evidence, "medium", "boundaries");
        rstr_free(&labels);
    }

    for (i = 0; i < boundaries.n; i++) {
        int next = -1, j;
        for (j = boundaries.v[i].msg_index + 1; j < m->n; j++) {
            if (strcmp(m->v[j].speaker, "unknown")) { next = j; break; }
        }
        if (next >= 0 && !strcmp(m->v[next].speaker, "self")) {
            static const char *PRESSURE_RE[] = {
                "必须", "一定", "马上", "赶紧", "你怎么还", "为什么不回", "在干嘛",
                "约吗", "出来吗", "确定关系", "做我", "男朋友", "女朋友", NULL
            };
            if (has_question(m->v[next].text) || r_has_any(m->v[next].text, PRESSURE_RE)) {
                char *snippet = evidence_snippet(m->v[next].text);
                char evidence[1024];
                has_misread = 1;
                snprintf(evidence, sizeof evidence,
                         "对方说“%s”后，你又发送了“%s”；可能把疲惫或收尾误读成了继续推进的开放信号。",
                         boundaries.v[i].evidence, snippet);
                add_observation(observations, "possible_misread", "medium",
                                evidence, "medium", "boundaries");
                free(snippet);
            }
        }
    }

    if (other_count >= 3) {
        int short_count = 0, j;
        for (j = 0; j < m->n; j++) {
            if (!strcmp(m->v[j].speaker, "other") && r_cp_len_no_ws(m->v[j].text) <= 8) short_count++;
        }
        if (short_count >= 2) {
            char evidence[512];
            snprintf(evidence, sizeof evidence,
                     "对方有 %d 条较短回复；短回复可能来自忙碌、疲惫或话题兴趣不同，不能单独判断态度。",
                     short_count);
            add_observation(observations, "short_replies", "low", evidence, "low", "boundaries");
        }
    }

    if (consecutive >= 2) add_suggestion(suggestions, "timing", "给对方一个回应窗口", "连续发送后先暂停，等对方有明确回应，再决定是否补充一句。");
    if (timing.has_timing && timing.cooldown_count > 0) add_suggestion(suggestions, "timing", "练习看见冷却间隔", "下一次先承认对方可能在忙，不把较长间隔直接解释成拒绝或冷淡。");
    if (boundaries.n > 0 || has_misread) add_suggestion(suggestions, "boundaries", "先接住空间信号", "遇到“累、忙、改天”等表达时，先收住追问并给出可退出的回应。");
    if (question_rate >= 0.6) add_suggestion(suggestions, "curiosity", "把问题变成好奇而非盘问", "一轮只保留一个具体问题，并先回应对方刚说的事实或感受。");
    if (self_share > 0.7) add_suggestion(suggestions, "initiative", "平衡双方投入", "发送前检查是否连续由你推动，给对方留一个自然接话点。");
    if (json_len(suggestions) == 0) add_suggestion(suggestions, "curiosity", "保留具体接话点", "下一轮回应一个细节，再补一个对方容易回答的轻量问题。");
    while (json_len(suggestions) > 4) {
        json_free(json_at(suggestions, json_len(suggestions) - 1));
        suggestions->u.arr.n--;
    }

    overview = json_new_obj();
    json_obj_set_num(overview, "totalMessages", m->n);
    json_obj_set_num(overview, "selfMessages", self_count);
    json_obj_set_num(overview, "otherMessages", other_count);
    if (timing.has_duration) json_obj_set_num(overview, "duration", (double)timing.duration);
    else json_obj_set(overview, "duration", json_new_null());

    dimensions = json_new_obj();
    {
        int has_initiative = (known >= 2);
        double initiative_score = has_initiative ? 100.0 - fabs(self_share - other_share) * 100.0 : 0.0;
        const char *status = "unknown";
        char evidence[256];
        if (self_share > 0.7) status = "self_heavy";
        else if (other_share > 0.7) status = "other_heavy";
        else if (known > 0) status = "balanced";
        if (known > 0) snprintf(evidence, sizeof evidence, "你的消息 %d 条，对方 %d 条。", self_count, other_count);
        else snprintf(evidence, sizeof evidence, "没有足够的已识别消息。");
        initiative = dimension_node(&timing, initiative_score, known >= 2, status, evidence,
                                    known, confidence_name(confidence_for_sample(known)));
    }
    {
        double curiosity_score = 55.0 + question_rate * 28.0 + reply_rate * 17.0;
        double extra = question_rate > 0.65 ? (question_rate - 0.65) * 35.0 : 0.0;
        char evidence[256];
        curiosity_score = r_clamp_raw(curiosity_score - extra, 0, 100);
        if (self_count > 0) snprintf(evidence, sizeof evidence, "问题消息占比约 %d%%。", (int)r_round(question_rate * 100.0));
        else snprintf(evidence, sizeof evidence, "没有可识别的你的消息。");
        curiosity = dimension_node(&timing, curiosity_score, self_count > 0,
                                   self_count > 0 ? "available" : "unknown", evidence,
                                   self_count, confidence_name(confidence_for_sample(self_count)));
    }
    {
        double boundary_score = 82.0 - (boundaries.n * 20 > 62 ? 62 : boundaries.n * 20) - (has_misread ? 10 : 0);
        const char *status = boundaries.n ? "space_signals_present" : (other_count ? "no_clear_signal" : "unknown");
        boundary_dim = json_new_obj();
        if (other_count > 0) json_obj_set_num(boundary_dim, "score", r_clamp_score(boundary_score));
        else json_obj_set(boundary_dim, "score", json_new_null());
        json_obj_set_str(boundary_dim, "status", status);
        boundary_arr = json_new_arr();
        if (boundaries.n) {
            int j;
            for (j = 0; j < boundaries.n; j++) json_arr_push(boundary_arr, json_new_str(boundaries.v[j].evidence));
        } else {
            json_arr_push(boundary_arr, json_new_str("未检测到明确空间信号；这不代表不存在未被规则覆盖的信号。"));
        }
        json_obj_set(boundary_dim, "evidence", boundary_arr);
        json_obj_set_num(boundary_dim, "sampleSize", other_count);
        json_obj_set_str(boundary_dim, "confidence", boundaries.n ? "medium" : "low");
    }
    {
        const char *status = timing.has_timing ? (timing.status == 2 ? "partial" : "available") : "unknown";
        char evidence[256];
        if (!timing.has_timing) snprintf(evidence, sizeof evidence, "没有可用时间戳，不对消息时机下结论。");
        else snprintf(evidence, sizeof evidence, "可比较的相邻时间间隔 %d 个。", timing.comparable_gaps);
        timing_dim = dimension_node(&timing, timing.has_timing ? (double)timing.score : 0.0, timing.has_timing,
                                    status, evidence, timing.comparable_gaps,
                                    confidence_name(timing.confidence));
    }
    json_obj_set(dimensions, "initiative", initiative);
    json_obj_set(dimensions, "curiosity", curiosity);
    json_obj_set(dimensions, "boundaries", boundary_dim);
    json_obj_set(dimensions, "timing", timing_dim);

    metrics = json_new_obj();
    if (known > 0) {
        json_obj_set_num(metrics, "selfInitiativeRate", self_share);
        json_obj_set_num(metrics, "otherInitiativeRate", other_share);
        json_obj_set_num(metrics, "selfMessageShare", self_share);
        json_obj_set_num(metrics, "otherMessageShare", other_share);
    } else {
        json_obj_set(metrics, "selfInitiativeRate", json_new_null());
        json_obj_set(metrics, "otherInitiativeRate", json_new_null());
        json_obj_set(metrics, "selfMessageShare", json_new_null());
        json_obj_set(metrics, "otherMessageShare", json_new_null());
    }
    if (self_count > 0) {
        json_obj_set_num(metrics, "replyRate", reply_rate);
        json_obj_set_num(metrics, "questionRate", question_rate);
        json_obj_set_num(metrics, "questionDensity", question_density);
    } else {
        json_obj_set(metrics, "replyRate", json_new_null());
        json_obj_set(metrics, "questionRate", json_new_null());
        json_obj_set(metrics, "questionDensity", json_new_null());
    }
    json_obj_set_num(metrics, "selfQuestionCount", self_questions);
    json_obj_set_num(metrics, "otherQuestionCount", other_questions);
    json_obj_set_num(metrics, "avgSelfLength", self_count ? r_round1((double)self_length / self_count) : 0);
    json_obj_set_num(metrics, "avgOtherLength", other_count ? r_round1((double)other_length / other_count) : 0);
    if (timing.has_timing) json_obj_set_num(metrics, "cooldownCount", timing.cooldown_count);
    else json_obj_set(metrics, "cooldownCount", json_new_null());
    json_obj_set_num(metrics, "consecutiveSelfCount", consecutive);
    {
        JNode *bs = json_new_arr();
        int j, k;
        for (j = 0; j < boundaries.n; j++) {
            JNode *item = json_new_obj();
            JNode *signals = json_new_arr();
            json_obj_set_str(item, "messageId", m->v[boundaries.v[j].msg_index].id);
            json_obj_set_str(item, "speaker", m->v[boundaries.v[j].msg_index].speaker);
            json_obj_set_num(item, "line", m->v[boundaries.v[j].msg_index].line);
            for (k = 0; k < boundaries.v[j].signal_count; k++) {
                JNode *s = json_new_obj();
                json_obj_set_str(s, "key", boundaries.v[j].signal_keys[k]);
                json_obj_set_str(s, "label", boundaries.v[j].signal_labels[k]);
                json_arr_push(signals, s);
            }
            json_obj_set(item, "signals", signals);
            json_obj_set_str(item, "evidence", boundaries.v[j].evidence);
            json_arr_push(bs, item);
        }
        json_obj_set(metrics, "boundarySignals", bs);
    }
    json_obj_set_num(metrics, "boundarySignalCount", boundaries.n);
    if (timing.has_duration) json_obj_set_num(metrics, "durationMinutes", r_round1((double)timing.duration / 60000.0));
    else json_obj_set(metrics, "durationMinutes", json_new_null());

    analysis = json_new_obj();
    json_obj_set(analysis, "overview", overview);
    json_obj_set(analysis, "dimensions", dimensions);
    json_obj_set(analysis, "metrics", metrics);
    json_obj_set(analysis, "observations", observations);
    json_obj_set(analysis, "suggestions", suggestions);
    json_obj_set_str(analysis, "source", "local-replay-v1");

    if (boundaries_out) *boundaries_out = boundaries;
    else {
        int j;
        for (j = 0; j < boundaries.n; j++) { /* nothing allocated inside except arrays */ }
        free(boundaries.v);
    }
    if (timing_out) *timing_out = timing;
    return analysis;
}

/* ================= 摘要 ================= */

static void fmt_rate(const JNode *node, char *out, size_t n)
{
    if (!node || node->type == JNULL) snprintf(out, n, "未知");
    else snprintf(out, n, "%d%%", (int)r_round(node->u.num * 100.0));
}

static void fmt_duration(const JNode *node, char *out, size_t n)
{
    double ms;
    int minutes, hours, rest;
    if (!node || node->type == JNULL) {
        snprintf(out, n, "未知");
        return;
    }
    ms = node->u.num;
    minutes = (int)r_round(ms / 60000.0);
    if (minutes < 60) {
        snprintf(out, n, "%d 分钟", minutes);
        return;
    }
    hours = minutes / 60;
    rest = minutes % 60;
    if (rest) snprintf(out, n, "%d 小时 %d 分钟", hours, rest);
    else snprintf(out, n, "%d 小时", hours);
}

static char *build_summary(const JNode *analysis)
{
    HfBuf b;
    JNode *overview, *metrics, *observations, *suggestions, *dimensions, *timing_dim;
    const char *timing_status;
    JNode *cooldown;
    char part[1024];

    hf_buf_init(&b);
    if (!analysis || analysis->type != JOBJ) {
        hf_buf_puts(&b, "暂无可总结的回放分析。");
        return hf_buf_take(&b);
    }
    overview = json_get(analysis, "overview");
    metrics = json_get(analysis, "metrics");
    observations = json_get(analysis, "observations");
    suggestions = json_get(analysis, "suggestions");
    dimensions = json_get(analysis, "dimensions");
    timing_dim = json_get(dimensions, "timing");
    timing_status = json_str(timing_dim, "status", "unknown");
    cooldown = json_get(metrics, "cooldownCount");

    snprintf(part, sizeof part, "共分析 %d 条消息：你 %d 条，对方 %d 条。",
             (int)json_num(overview, "totalMessages", 0),
             (int)json_num(overview, "selfMessages", 0),
             (int)json_num(overview, "otherMessages", 0));
    hf_buf_puts(&b, part);

    {
        char share[32], reply[32], question[32], duration[64];
        fmt_rate(json_get(metrics, "selfInitiativeRate"), share, sizeof share);
        fmt_rate(json_get(metrics, "replyRate"), reply, sizeof reply);
        fmt_rate(json_get(metrics, "questionRate"), question, sizeof question);
        fmt_duration(json_get(overview, "duration"), duration, sizeof duration);
        snprintf(part, sizeof part, "你的消息占比 %s，回复率 %s，问题消息占比 %s。",
                 share, reply, question);
        hf_buf_putc(&b, ' ');
        hf_buf_puts(&b, part);

        if (!strcmp(timing_status, "unknown") || !cooldown || cooldown->type == JNULL) {
            hf_buf_putc(&b, ' ');
            hf_buf_puts(&b, "未提供可用时间戳，因此不对消息时机下结论。");
        } else {
            snprintf(part, sizeof part, "可用时间范围约 %s，检测到 %d 次较长间隔。",
                     duration, (int)cooldown->u.num);
            hf_buf_putc(&b, ' ');
            hf_buf_puts(&b, part);
        }
    }

    if (json_len(observations) > 0) {
        int i, count = json_len(observations) < 3 ? json_len(observations) : 3;
        hf_buf_puts(&b, " 主要观察：");
        for (i = 0; i < count; i++) {
            const char *ev = json_str(json_at(observations, i), "evidence", "");
            if (i) hf_buf_puts(&b, "；");
            hf_buf_puts(&b, ev);
        }
    }
    if (json_len(suggestions) > 0) {
        const char *action = json_str(json_at(suggestions, 0), "action", "");
        hf_buf_puts(&b, " 建议先练习：");
        hf_buf_puts(&b, action);
    }
    return hf_buf_take(&b);
}

/* ================= 输出 ================= */

static JNode *rmsgs_to_json(const RMsgs *m)
{
    JNode *arr = json_new_arr();
    int i;
    for (i = 0; i < m->n; i++) {
        JNode *item = json_new_obj();
        char iso[40];
        json_obj_set_str(item, "id", m->v[i].id);
        json_obj_set_str(item, "speaker", m->v[i].speaker);
        json_obj_set_str(item, "text", m->v[i].text);
        json_obj_set_num(item, "line", m->v[i].line);
        if (m->v[i].has_ts) {
            r_iso_time(m->v[i].ts, iso);
            json_obj_set_str(item, "timestamp", iso);
        } else {
            json_obj_set(item, "timestamp", json_new_null());
        }
        json_arr_push(arr, item);
    }
    return arr;
}

static JNode *rparse_to_json(const RParse *p)
{
    JNode *root = json_new_obj();
    JNode *warnings = json_new_arr();
    JNode *stats = json_new_obj();
    int i;
    json_obj_set(root, "messages", rmsgs_to_json(&p->msgs));
    for (i = 0; i < p->warning_n; i++) json_arr_push(warnings, json_new_str(p->warnings[i]));
    json_obj_set(root, "warnings", warnings);
    json_obj_set_num(stats, "total", p->msgs.n);
    json_obj_set_num(stats, "parsed", p->parsed);
    json_obj_set_num(stats, "unknown", p->unknown);
    json_obj_set(root, "stats", stats);
    return root;
}

JNode *hf_rule_replay(const JNode *body)
{
    JNode *text_node = json_get(body, "text");
    JNode *messages = json_get(body, "messages");
    JNode *options = json_get(body, "options");
    JNode *root = json_new_obj();
    JNode *analysis;
    char *summary;
    RBoundaries boundaries;
    RTiming timing;

    memset(&boundaries, 0, sizeof boundaries);
    memset(&timing, 0, sizeof timing);

    if (text_node && text_node->type == JSTR) {
        RParse parsed = rparse_text(text_node->u.str.s);
        analysis = analyze_replay(&parsed.msgs, options, &boundaries, &timing);
        summary = build_summary(analysis);
        json_obj_set(root, "parse", rparse_to_json(&parsed));
        json_obj_set(root, "analysis", analysis);
        json_obj_set_str(root, "summary", summary);
        free(summary);
        rmsgs_free(&parsed.msgs);
    } else if (messages && messages->type == JARR) {
        RMsgs msgs = rmsgs_from_json(messages);
        analysis = analyze_replay(&msgs, options, &boundaries, &timing);
        summary = build_summary(analysis);
        json_obj_set(root, "analysis", analysis);
        json_obj_set_str(root, "summary", summary);
        free(summary);
        rmsgs_free(&msgs);
    } else {
        json_free(root);
        return NULL;
    }
    free(boundaries.v);
    return root;
}
