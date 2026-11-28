#include "rules.h"
#include "rules_internal.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

/* ================= 输入 ================= */

typedef struct {
    char *text;
    char speaker[8];
    long long ts;
    int has_ts;
} TMsg;

typedef struct {
    TMsg *v;
    int n;
} TMsgs;

static void tmsgs_free(TMsgs *m)
{
    int i;
    if (!m) return;
    for (i = 0; i < m->n; i++) free(m->v[i].text);
    free(m->v);
    m->v = NULL;
    m->n = 0;
}

static const char *msg_text_node(const JNode *item, const char *key)
{
    JNode *n = json_get(item, key);
    return (n && n->type == JSTR) ? n->u.str.s : NULL;
}

static const char *msg_speaker_node(const JNode *item)
{
    static const char *KEYS[] = { "type", "speaker", "role", "from", NULL };
    int i;
    for (i = 0; KEYS[i]; i++) {
        JNode *n = json_get(item, KEYS[i]);
        if (n && n->type == JSTR) return n->u.str.s;
    }
    return "";
}

static void lower_copy(char *out, size_t n, const char *in)
{
    size_t i;
    if (!out || n == 0) return;
    if (!in) { out[0] = '\0'; return; }
    for (i = 0; i + 1 < n && in[i]; i++) {
        unsigned char c = (unsigned char)in[i];
        out[i] = (char)((c >= 'A' && c <= 'Z') ? c + 32 : c);
    }
    out[i] = '\0';
}

static void tmsg_speaker(const JNode *item, char out[8])
{
    char low[64];
    lower_copy(low, sizeof low, msg_speaker_node(item));
    if (!strcmp(low, "me") || !strcmp(low, "self") || !strcmp(low, "user") ||
        !strcmp(low, "male") || !strcmp(low, "我") || !strcmp(low, "男方")) {
        snprintf(out, 8, "me");
    } else if (!strcmp(low, "her") || !strcmp(low, "other") || !strcmp(low, "assistant") ||
               !strcmp(low, "female") || !strcmp(low, "她") || !strcmp(low, "女方")) {
        snprintf(out, 8, "her");
    } else {
        snprintf(out, 8, "unknown");
    }
}

static long long tmsg_time(const JNode *item, int *has)
{
    static const char *KEYS[] = { "createdAt", "timestamp", "time", NULL };
    int i;
    *has = 0;
    for (i = 0; KEYS[i]; i++) {
        JNode *n = json_get(item, KEYS[i]);
        if (n && n->type != JNULL) return r_timestamp_value(n, has);
    }
    return -1;
}

static TMsgs tmsgs_parse(const JNode *messages)
{
    TMsgs out;
    int i, n = json_len(messages);
    out.v = NULL;
    out.n = 0;
    if (!messages || messages->type != JARR) return out;
    out.v = (TMsg *)calloc((size_t)n, sizeof(TMsg));
    if (!out.v) abort();
    for (i = 0; i < n; i++) {
        JNode *item = json_at(messages, i);
        const char *text = NULL;
        char speaker[8];
        char *clean;
        int has_ts = 0;
        long long ts;

        if (!item) continue;
        if (item->type == JSTR) {
            text = item->u.str.s;
            snprintf(speaker, sizeof speaker, "unknown");
            ts = -1;
        } else if (item->type == JOBJ) {
            text = msg_text_node(item, "text");
            if (!text) text = msg_text_node(item, "content");
            if (!text) text = msg_text_node(item, "message");
            tmsg_speaker(item, speaker);
            ts = tmsg_time(item, &has_ts);
        } else {
            continue;
        }
        clean = r_clean_dup(text ? text : "");
        if (!*clean) { free(clean); continue; }
        out.v[out.n].text = clean;
        snprintf(out.v[out.n].speaker, sizeof out.v[out.n].speaker, "%s", speaker);
        out.v[out.n].ts = has_ts ? ts : -1;
        out.v[out.n].has_ts = has_ts;
        out.n++;
    }
    return out;
}

/* ================= 文本规则 ================= */

static int timing_part_question(const char *part)
{
    return r_ends_with(part, "吗") || r_ends_with(part, "呢") ||
           r_has(part, "是不是") || r_has(part, "为什么") ||
           r_has(part, "怎么") || r_has(part, "哪个") ||
           r_has(part, "多少") || r_has(part, "如何");
}

static int timing_sep_len(const char *p)
{
    if (*p == '\0') return -1;
    if (*p == ',' || *p == '!' || *p == ';' || *p == ':') return 1;
    if ((unsigned char)p[0] == 0xEF && (unsigned char)p[1] == 0xBC && (unsigned char)p[2] == 0x8C) return 3; /* ， */
    if ((unsigned char)p[0] == 0xE3 && (unsigned char)p[1] == 0x80 && (unsigned char)p[2] == 0x82) return 3; /* 。 */
    if ((unsigned char)p[0] == 0xEF && (unsigned char)p[1] == 0xBC && (unsigned char)p[2] == 0x81) return 3; /* ！ */
    if ((unsigned char)p[0] == 0xEF && (unsigned char)p[1] == 0xBC && (unsigned char)p[2] == 0x9B) return 3; /* ； */
    if ((unsigned char)p[0] == 0xEF && (unsigned char)p[1] == 0xBC && (unsigned char)p[2] == 0x9A) return 3; /* ： */
    return 0;
}

static int count_questions(const char *text)
{
    const char *p = text ? text : "";
    const char *start = p;
    int count = 0;

    while (*p) {
        if (*p == '?') count++;
        else if ((unsigned char)p[0] == 0xEF && (unsigned char)p[1] == 0xBC && (unsigned char)p[2] == 0x9F) {
            count++;
            p += 3;
            continue;
        }
        p++;
    }

    p = text ? text : "";
    start = p;
    while (1) {
        int sep = timing_sep_len(p);
        if (sep < 0) {
            size_t len = (size_t)(p - start);
            char *part = (char *)malloc(len + 1);
            char *trim;
            if (!part) abort();
            memcpy(part, start, len);
            part[len] = '\0';
            trim = r_trim_dup(part);
            if (*trim && !strchr(trim, '?') && !strstr(trim, "？") && timing_part_question(trim)) count++;
            free(trim);
            free(part);
            break;
        }
        if (sep > 0) {
            size_t len = (size_t)(p - start);
            char *part = (char *)malloc(len + 1);
            char *trim;
            if (!part) abort();
            memcpy(part, start, len);
            part[len] = '\0';
            trim = r_trim_dup(part);
            if (*trim && !strchr(trim, '?') && !strstr(trim, "？") && timing_part_question(trim)) count++;
            free(trim);
            free(part);
            p += sep;
            start = p;
        } else {
            uint32_t cp = 0;
            int bytes = r_utf8_one(p, &cp);
            p += bytes;
        }
    }
    return count;
}

/* ================= 上下文 ================= */

typedef struct {
    TMsgs msgs;
    char *draft;
    char *stage;
    long long now;
    int now_valid;
    int has_last;
    int last_idx;
    int has_last_her;
    int last_her_idx;
    int timestamp_available;
    double elapsed_minutes;
    int has_elapsed;
    int question_count;
    int draft_length;
    int consecutive_me;
    int other_closing;
    int other_fatigued;
    int other_boundary;
    int unanswered_follow_up;
    int continuous_send;
    int late_night;
    int stage_score;
    char stage_reason[256];
    int draft_acknowledges_space;
    int has_return_point;
    int concise;
    int has_draft;
} TimingContext;

static const char *CLOSING[] = {
    "早点休息", "晚安", "先睡", "睡了", "明天再聊", "下次聊", "先这样",
    "不早了", "改天聊", "回头聊", "到这里", "先忙", NULL
};
static const char *FATIGUE[] = {
    "累", "困", "忙", "加班", "开会", "赶", "没电", "低落", "难受",
    "状态不好", "疲惫", "休息", NULL
};
static const char *BOUNDARY[] = {
    "不想聊", "不想说", "不用了", "别问", "先别", "不方便", "算了",
    "不太想", "想一个人", NULL
};
static const char *ACKNOWLEDGE[] = {
    "收到", "明白", "好", "你先", "先忙", "先休息", "早点休息", "晚安",
    "不打扰", "改天", "明天", "有空再", "你忙完", "辛苦了", "注意休息", NULL
};
static const char *PRESSURE[] = {
    "必须", "你得", "赶紧", "现在就", "不回我", "为什么不回", "是不是不在乎",
    "给个准话", "答应我", "不许", "你应该", NULL
};
static const char *TOO_INTENSE[] = {
    "爱你", "想你", "喜欢你", "离不开", "女朋友", "在一起", "确定关系",
    "表白", "见家长", "一辈子", NULL
};
static const char *RETURN_POINT[] = {
    "有空再聊", "有空时", "改天", "明天", "下次", "周末", "到时候",
    "等你方便", "你忙完", "回头", "晚点", NULL
};
static const char *INVITATION[] = {
    "一起", "约", "见面", "咖啡", "散步", "吃饭", "看电影", "周末", "有空", NULL
};

static int low_pressure(const char *text)
{
    return !r_has_any(text, PRESSURE) && !r_has_any(text, BOUNDARY);
}

static int has_clear_return_point(const char *text)
{
    return r_has_any(text, RETURN_POINT) ||
           r_has(text, "你方便") || r_has(text, "不方便也没关系") ||
           r_has(text, "你觉得呢") || r_has(text, "你更想") || r_has(text, "你愿意");
}

static int stage_fit(const char *stage, const char *text, char *reason, size_t reason_n)
{
    int early = !strcmp(stage, "刚加微信后的第一晚") || !strcmp(stage, "隔天轻联系");

    reason[0] = '\0';
    if (!*stage || !r_stage_valid(stage)) return 0;

    if (early && r_has_any(text, TOO_INTENSE)) {
        snprintf(reason, reason_n, "当前阶段适合轻量建立熟悉感，草稿里的关系推进偏快。");
        return -16;
    }
    if (!strcmp(stage, "第一次邀约") && r_has_any(text, INVITATION) && !r_has_any(text, PRESSURE)) {
        snprintf(reason, reason_n, "草稿包含了具体但可选择的推进点，和第一次邀约阶段匹配。");
        return 7;
    }
    if (!strcmp(stage, "第一次约会后") &&
        (r_has(text, "今天") || r_has(text, "见到你") || r_has(text, "见面") ||
         r_has(text, "开心") || r_has(text, "下次") || r_has(text, "回家") || r_has(text, "到家")) &&
        low_pressure(text)) {
        snprintf(reason, reason_n, "草稿承接了约会后的共同经历，推进幅度比较自然。");
        return 5;
    }
    if (!strcmp(stage, "暧昧推进") &&
        (r_has(text, "下次") || r_has(text, "一起") || r_has(text, "有空") ||
         r_has(text, "喜欢") || r_has(text, "想见") || r_has(text, "感觉")) &&
        low_pressure(text)) {
        snprintf(reason, reason_n, "草稿有轻量的情绪或行动推进，同时保留了选择空间。");
        return 5;
    }
    if (!strcmp(stage, "表达好感") &&
        (r_has(text, "喜欢") || r_has(text, "在意") || r_has(text, "想见") ||
         r_has(text, "开心") || r_has(text, "认真")) &&
        !r_has_any(text, PRESSURE)) {
        snprintf(reason, reason_n, "表达方式直接但没有把回应变成对方必须完成的任务。");
        return 5;
    }
    if (!strcmp(stage, "确定关系") &&
        (r_has(text, "一起") || r_has(text, "计划") || r_has(text, "沟通") ||
         r_has(text, "感受") || r_has(text, "安排") || r_has(text, "约")) &&
        !r_has_any(text, PRESSURE)) {
        snprintf(reason, reason_n, "草稿更偏向共同安排和沟通，符合确定关系后的阶段。");
        return 4;
    }
    if (early && r_cp_len(text) <= 60 && count_questions(text) <= 1 && low_pressure(text)) {
        snprintf(reason, reason_n, "草稿保持了轻量、单一重点，适合当前关系阶段。");
        return 4;
    }
    snprintf(reason, reason_n, "暂未发现明显的阶段错配，仍建议保留对方的选择空间。");
    return 0;
}

static void build_context(const JNode *body, TimingContext *ctx)
{
    JNode *messages = json_get(body, "messages");
    const char *draft = json_str(body, "latestDraft", "");
    const char *stage = json_str(body, "stage", "");
    JNode *now_node = json_get(body, "now");
    int i;

    memset(ctx, 0, sizeof *ctx);
    ctx->msgs = tmsgs_parse(messages);
    ctx->draft = r_clean_dup(draft);
    ctx->stage = r_clean_dup(stage);
    ctx->has_draft = *ctx->draft != '\0';

    if (!now_node) {
        ctx->now = (long long)time(NULL) * 1000;
        ctx->now_valid = 1;
    } else {
        ctx->now = r_timestamp_value(now_node, &ctx->now_valid);
    }

    ctx->has_last = ctx->msgs.n > 0;
    ctx->last_idx = ctx->msgs.n - 1;
    for (i = ctx->msgs.n - 1; i >= 0; i--) {
        if (!strcmp(ctx->msgs.v[i].speaker, "her")) {
            ctx->has_last_her = 1;
            ctx->last_her_idx = i;
            break;
        }
    }
    ctx->timestamp_available = ctx->has_last && ctx->msgs.v[ctx->last_idx].has_ts && ctx->now_valid;
    if (ctx->timestamp_available) {
        ctx->elapsed_minutes = (double)(ctx->now - ctx->msgs.v[ctx->last_idx].ts) / 60000.0;
        if (ctx->elapsed_minutes < 0) ctx->elapsed_minutes = 0;
        ctx->has_elapsed = 1;
    }
    ctx->question_count = count_questions(ctx->draft);
    ctx->draft_length = r_cp_len(ctx->draft);

    for (i = ctx->msgs.n - 1; i >= 0; i--) {
        if (strcmp(ctx->msgs.v[i].speaker, "me")) break;
        ctx->consecutive_me++;
    }
    if (ctx->has_last_her) {
        const char *her = ctx->msgs.v[ctx->last_her_idx].text;
        ctx->other_closing = r_has_any(her, CLOSING);
        ctx->other_fatigued = r_has_any(her, FATIGUE);
        ctx->other_boundary = r_has_any(her, BOUNDARY) || r_has_seq(her, "需要", "空间") || r_has_seq(her, "需要", "安静");
    }
    ctx->unanswered_follow_up = ctx->has_last && !strcmp(ctx->msgs.v[ctx->last_idx].speaker, "me");
    ctx->continuous_send = ctx->consecutive_me > 0;
    ctx->late_night = ctx->now_valid && r_is_late_night(ctx->now);
    ctx->stage_score = stage_fit(ctx->stage, ctx->draft, ctx->stage_reason, sizeof ctx->stage_reason);
    ctx->draft_acknowledges_space = r_has_any(ctx->draft, ACKNOWLEDGE);
    ctx->has_return_point = has_clear_return_point(ctx->draft);
    ctx->concise = ctx->draft_length > 0 && ctx->draft_length <= 60 && ctx->question_count <= 1;
}

static void ctx_free(TimingContext *ctx)
{
    tmsgs_free(&ctx->msgs);
    free(ctx->draft);
    free(ctx->stage);
    ctx->draft = NULL;
    ctx->stage = NULL;
}

/* ================= 输出构建 ================= */

typedef struct {
    char items[24][768];
    int n;
} TextList;

static void list_add_unique(TextList *list, const char *text)
{
    int i;
    if (!text || !*text || list->n >= 24) return;
    for (i = 0; i < list->n; i++) if (!strcmp(list->items[i], text)) return;
    snprintf(list->items[list->n], sizeof list->items[list->n], "%s", text);
    list->n++;
}

static void build_reasons(const TimingContext *c, TextList *list)
{
    char buf[768];

    if (!c->timestamp_available) {
        list_add_unique(list, "当前对话没有足够的有效时间戳，无法判断消息间隔；不对等待时长作推测。");
    }
    if (!c->has_draft) {
        list_add_unique(list, "还没有待发送的草稿，暂时只能判断数据是否齐全。");
    }
    if (c->continuous_send) {
        list_add_unique(list, "对方上一条消息后你已经连续发送，当前草稿会继续形成连发节奏。");
    }
    if (c->unanswered_follow_up) {
        list_add_unique(list, "对方仍未回应上一条消息，继续追问容易让对方感到需要立即回应。");
    }
    if (c->other_closing) {
        list_add_unique(list, "对方上一条消息带有收尾信号，先回应收尾比立即开启新话题更合适。");
    }
    if (c->other_fatigued) {
        list_add_unique(list, "对方表达了疲惫、忙碌或低电量，继续增加问题可能会提高沟通负担。");
    }
    if (c->other_boundary) {
        list_add_unique(list, "对方表达了边界或需要空间，草稿应先尊重边界，不要把关心变成追问。");
    }
    if (c->draft_length > 120) {
        list_add_unique(list, "草稿偏长，一次塞入太多内容会增加对方理解和回应的成本。");
    } else if (c->draft_length > 60) {
        list_add_unique(list, "草稿偏长，建议只保留一个重点，让对方更容易接住。");
    }
    if (c->question_count > 2) {
        list_add_unique(list, "草稿包含多个问题，容易变成连续追问；建议合并成一个最重要的问题。");
    } else if (c->question_count == 2) {
        list_add_unique(list, "草稿包含两个问题，建议删掉一个，把回应空间留给对方。");
    }
    if (c->late_night && (c->draft_length > 60 || c->question_count > 1 || c->other_fatigued)) {
        list_add_unique(list, "当前处于较晚时段，长消息或多问题更容易让对方感到有压力。");
    }
    if (c->has_elapsed && c->unanswered_follow_up && c->elapsed_minutes < 30) {
        char elapsed[32];
        r_format_elapsed(c->elapsed_minutes, elapsed, sizeof elapsed);
        snprintf(buf, sizeof buf, "上一条消息距现在%s，在未获回应时继续发送会显得偏急。", elapsed);
        list_add_unique(list, buf);
    }
    if (c->stage_reason[0]) list_add_unique(list, c->stage_reason);
    if (c->concise && !c->continuous_send && !c->other_closing && !c->other_fatigued && !c->other_boundary) {
        list_add_unique(list, "草稿短而集中，没有明显的连环追问，给对方留下了自然的回应空间。");
    }
    if (c->has_return_point && !c->other_boundary) {
        list_add_unique(list, "草稿给出了清晰的回点或选择，方便对方按自己的节奏继续。");
    }
}

static void build_suggestions(const TimingContext *c, TextList *list)
{
    if (!c->timestamp_available) {
        list_add_unique(list, "补齐真实发送时间后再看节奏分数；在此之前只参考文字层面的提示。");
    }
    if (c->other_boundary || c->other_closing || c->other_fatigued) {
        list_add_unique(list, "先简短承接对方的状态，必要时收尾并留出空间，不要立刻追加新问题。");
    }
    if (c->continuous_send || c->unanswered_follow_up) {
        list_add_unique(list, "把当前草稿先放下，等对方回应后再继续；不要用第二条消息补解释或催促。");
    }
    if (c->draft_length > 60 || c->question_count > 1) {
        list_add_unique(list, "压缩成一个重点，最多保留一个问题，其他内容等对方接住后再展开。");
    }
    if (c->has_return_point && c->stage_score > 0 && !c->continuous_send) {
        list_add_unique(list, "当前推进点比较清楚，可以保留轻量、可选择的邀约或回点，让对方可以自然地说“不方便”。");
    }
    if (list->n == 0 && c->concise) {
        list_add_unique(list, "可以发送；保持一条消息一个重点，发送后留出回应空间。");
    }
    if (list->n == 0) {
        list_add_unique(list, "先让草稿更短、更具体，再决定是否发送。");
    }
}

JNode *hf_rule_timing(const JNode *body)
{
    TimingContext c;
    TextList reasons, suggestions;
    JNode *root, *arr, *flags, *metrics, *evidence;
    int score = 0;
    int data_available;
    const char *label;
    const char *confidence;
    int i;

    build_context(body, &c);
    data_available = c.timestamp_available && c.has_draft;
    confidence = data_available ? "medium" : "low";

    memset(&reasons, 0, sizeof reasons);
    memset(&suggestions, 0, sizeof suggestions);
    build_reasons(&c, &reasons);
    build_suggestions(&c, &suggestions);

    if (data_available) {
        score = 76;
        if (c.continuous_send) score -= 14;
        if (c.unanswered_follow_up) score -= 12;
        if (c.unanswered_follow_up && c.has_elapsed && c.elapsed_minutes < 30) score -= 8;
        if (c.other_closing && !c.draft_acknowledges_space) score -= 18;
        if (c.other_fatigued && !c.draft_acknowledges_space) score -= 15;
        if (c.other_boundary && !c.draft_acknowledges_space) score -= 22;
        if (c.draft_length > 120) score -= 14;
        else if (c.draft_length > 60) score -= 8;
        if (c.question_count > 2) score -= 12;
        else if (c.question_count == 2) score -= 7;
        if (c.late_night && (c.draft_length > 60 || c.question_count > 1 || c.other_fatigued)) score -= 6;
        score += c.stage_score;
        if (c.concise && !c.continuous_send && !c.other_boundary) score += 6;
        if (c.draft_acknowledges_space && (c.other_closing || c.other_fatigued || c.other_boundary)) score += 8;
        if (c.has_return_point && !c.other_boundary) score += 4;
        score = r_clamp_score(score);
        label = score >= 80 ? "节奏自然" : (score >= 60 ? "可以发送，但注意留白" : "建议先调整节奏");
    } else {
        label = "数据不足";
    }

    root = json_new_obj();
    json_obj_set_str(root, "source", "local");
    json_obj_set_str(root, "confidence", confidence);
    json_obj_set_bool(root, "dataAvailable", data_available);
    if (data_available) json_obj_set_num(root, "score", score);
    else json_obj_set(root, "score", json_new_null());
    json_obj_set_str(root, "label", label);

    arr = json_new_arr();
    for (i = 0; i < reasons.n; i++) json_arr_push(arr, json_new_str(reasons.items[i]));
    json_obj_set(root, "reasons", arr);

    arr = json_new_arr();
    for (i = 0; i < suggestions.n; i++) json_arr_push(arr, json_new_str(suggestions.items[i]));
    json_obj_set(root, "suggestions", arr);

    evidence = json_new_arr();
    for (i = 0; i < reasons.n; i++) {
        JNode *e = json_new_obj();
        json_obj_set_str(e, "type", "timing");
        json_obj_set_str(e, "text", reasons.items[i]);
        json_arr_push(evidence, e);
    }
    json_obj_set(root, "evidence", evidence);

    flags = json_new_obj();
    json_obj_set_bool(flags, "continuousSend", c.continuous_send);
    json_obj_set_bool(flags, "unansweredFollowUp", c.unanswered_follow_up);
    json_obj_set_bool(flags, "otherClosing", c.other_closing);
    json_obj_set_bool(flags, "otherFatigued", c.other_fatigued);
    json_obj_set_bool(flags, "otherBoundary", c.other_boundary);
    json_obj_set_bool(flags, "tooLong", c.draft_length > 60);
    json_obj_set_bool(flags, "multipleQuestions", c.question_count > 1);
    json_obj_set_bool(flags, "lateNight", c.late_night);
    json_obj_set_bool(flags, "stageMatched", c.stage_score > 0);
    json_obj_set_bool(flags, "clearReturnPoint", c.has_return_point);
    json_obj_set(root, "flags", flags);

    metrics = json_new_obj();
    if (c.has_elapsed) json_obj_set_num(metrics, "elapsedMinutes", r_round1(c.elapsed_minutes));
    else json_obj_set(metrics, "elapsedMinutes", json_new_null());
    json_obj_set_num(metrics, "consecutiveMe", c.consecutive_me);
    json_obj_set_num(metrics, "questionCount", c.question_count);
    json_obj_set_num(metrics, "draftLength", c.draft_length);
    if (c.has_last) json_obj_set_str(metrics, "lastSpeaker", c.msgs.v[c.last_idx].speaker);
    else json_obj_set(metrics, "lastSpeaker", json_new_null());
    if (c.has_last && c.msgs.v[c.last_idx].has_ts) {
        char iso[40];
        r_iso_time(c.msgs.v[c.last_idx].ts, iso);
        json_obj_set_str(metrics, "lastMessageAt", iso);
    } else {
        json_obj_set(metrics, "lastMessageAt", json_new_null());
    }
    json_obj_set(root, "metrics", metrics);

    ctx_free(&c);
    return root;
}
