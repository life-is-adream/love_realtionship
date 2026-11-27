/* coach.c — 关系智能循环（状态机 / 记忆 / 预测 / 场景）
 *
 * 移植纪律：数值与阈值必须与 JS 版一致，措辞允许一致但不得加强结论。
 * 这里没有任何模型调用——全部是确定性规则，便于审计与离线复现。
 */
#define _POSIX_C_SOURCE 200809L

#include "coach.h"
#include "coach_internal.h"

#include "../sha256.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ================= 常量 ================= */

static const char *STATES[] = {
    "UNKNOWN", "INITIAL_CONTACT", "MUTUAL_FAMILIARITY", "GROWING_INTEREST",
    "DATING_EXPLORATION", "COMMITTED_RELATIONSHIP", "CONFLICT", "REPAIR",
    "STABLE_RELATIONSHIP", "EXIT", NULL
};

static const char *SIGNAL_KEYS[] = {
    "safetyRisk", "relationshipEnded", "explicitExit", "explicitRejection",
    "contactPause", "initialContact", "repeatedInteraction", "conflict",
    "counterOffer", "concreteDatePlan", "repairAttempt", "repairSucceeded",
    "reciprocalInterest", "relationshipDefined", "stableRoutine", "lowReciprocity",
    NULL
};

typedef struct {
    int safetyRisk, relationshipEnded, explicitExit, explicitRejection, contactPause;
    int initialContact, repeatedInteraction, conflict, counterOffer, concreteDatePlan;
    int repairAttempt, repairSucceeded, reciprocalInterest, relationshipDefined;
    int stableRoutine, lowReciprocity, observationReplayed;
    int has_initial, has_repeated, has_conflict;
} Signals;

static int state_valid(const char *s)
{
    int i;
    for (i = 0; STATES[i]; i++) if (strcmp(s, STATES[i]) == 0) return 1;
    return 0;
}

/* ================= 记忆 ================= */

typedef struct {
    char id[112];
    char kind[80];
    char summary[512];
    char source[96];
    int  stage;                 /* -1 = null */
    char evidence[20][112];
    int  ev_n;
    char recorded_at[48];
} Obs;

typedef struct {
    char id[112];
    char prediction[512];
    char outcome[512];
    char update[512];
    char lessons[8][256];
    int  lesson_n;
    char recorded_at[48];
} Outcome;

typedef struct {
    char     case_id[80];
    int      consent;
    char     goal[512];
    char     state[40];
    Obs     *obs;
    int      obs_n, obs_cap;
    Outcome *out;
    int      out_n, out_cap;
    char     lessons[64][256];
    int      lesson_n;
} Memory;

static int sensitive_id_marker(const char *s)
{
    static const char *M[] = { "name", "phone", "mobile", "wechat", "weixin", "wx", "qq",
                               "email", "address", "password", "token", NULL };
    char low[128];
    size_t i;
    snprintf(low, sizeof low, "%s", s);
    for (i = 0; low[i]; i++) low[i] = (char)tolower((unsigned char)low[i]);
    for (i = 0; M[i]; i++) if (strstr(low, M[i])) return 1;
    return 0;
}

static int normalize_anon_id(const char *s, char *out, size_t n)
{
    if (!s || !hf_is_anon_id(s, 80) || sensitive_id_marker(s)) return 0;
    snprintf(out, n, "%s", s);
    return 1;
}

static void memory_init(Memory *m, const char *case_id, int consent, const char *goal)
{
    memset(m, 0, sizeof *m);
    snprintf(m->case_id, sizeof m->case_id, "%s", case_id ? case_id : "");
    m->consent = consent;
    snprintf(m->goal, sizeof m->goal, "%s", goal ? goal : "");
    snprintf(m->state, sizeof m->state, "UNKNOWN");
}

static void memory_free(Memory *m)
{
    free(m->obs);
    free(m->out);
    m->obs = NULL;
    m->out = NULL;
}

static Obs *obs_push(Memory *m)
{
    if (m->obs_n >= 100) return NULL;
    if (m->obs_n >= m->obs_cap) {
        int cap = m->obs_cap ? m->obs_cap * 2 : 16;
        Obs *p = (Obs *)realloc(m->obs, sizeof(Obs) * (size_t)cap);
        if (!p) return NULL;
        m->obs = p;
        m->obs_cap = cap;
    }
    memset(&m->obs[m->obs_n], 0, sizeof(Obs));
    m->obs[m->obs_n].stage = -1;
    return &m->obs[m->obs_n++];
}

static Outcome *out_push(Memory *m)
{
    if (m->out_n >= 100) return NULL;
    if (m->out_n >= m->out_cap) {
        int cap = m->out_cap ? m->out_cap * 2 : 16;
        Outcome *p = (Outcome *)realloc(m->out, sizeof(Outcome) * (size_t)cap);
        if (!p) return NULL;
        m->out = p;
        m->out_cap = cap;
    }
    memset(&m->out[m->out_n], 0, sizeof(Outcome));
    return &m->out[m->out_n++];
}

static int obs_exists(const Memory *m, const char *id)
{
    int i;
    for (i = 0; i < m->obs_n; i++) if (strcmp(m->obs[i].id, id) == 0) return 1;
    return 0;
}

static int out_exists(const Memory *m, const char *id)
{
    int i;
    for (i = 0; i < m->out_n; i++) if (strcmp(m->out[i].id, id) == 0) return 1;
    return 0;
}

static void memory_add_lesson(Memory *m, const char *s)
{
    int i;
    if (!s || !*s || m->lesson_n >= 64) return;
    for (i = 0; i < m->lesson_n; i++) if (strcmp(m->lessons[i], s) == 0) return;
    snprintf(m->lessons[m->lesson_n++], 256, "%s", s);
}

static void normalize_observation(const JNode *o, Obs *dst)
{
    const char *id = json_str(o, "id", "");
    const char *summary = json_str(o, "summary", "");
    const char *kind = json_str(o, "kind", "");
    const char *source = json_str(o, "source", "");
    const char *ts = json_str(o, "recordedAt", "");

    if (!normalize_anon_id(id, dst->id, sizeof dst->id)) return;
    hf_redact(summary, dst->summary, sizeof dst->summary, 500);
    if (!dst->summary[0]) { dst->id[0] = '\0'; return; }

    hf_redact(kind, dst->kind, sizeof dst->kind, 60);
    if (!dst->kind[0]) snprintf(dst->kind, sizeof dst->kind, "observation");
    hf_redact(source, dst->source, sizeof dst->source, 80);
    if (!dst->source[0]) snprintf(dst->source, sizeof dst->source, "user_input");

    {
        JNode *st = json_get(o, "stage");
        if (st && st->type == JNUM) {
            int v = (int)st->u.num;
            dst->stage = (v >= 0 && v <= 12) ? v : -1;
        }
    }

    {
        JNode *ev = json_get(o, "evidenceIds");
        int i;
        for (i = 0; i < json_len(ev) && dst->ev_n < 20; i++) {
            const char *s = json_node_str(json_at(ev, i), NULL);
            char tmp[112];
            if (s && normalize_anon_id(s, tmp, sizeof tmp))
                snprintf(dst->evidence[dst->ev_n++], 112, "%s", tmp);
        }
    }

    if (ts && hf_parse_iso(ts) >= 0) snprintf(dst->recorded_at, sizeof dst->recorded_at, "%s", ts);
}

static void normalize_outcome(const JNode *o, Outcome *dst)
{
    const char *id = json_str(o, "id", "outcome_pending");
    const char *pred = json_str(o, "prediction", "");
    const char *obs = json_str(o, "observedOutcome", json_str(o, "outcome", ""));
    const char *upd = json_str(o, "update", "");
    const char *ts = json_str(o, "recordedAt", "");

    if (!normalize_anon_id(id, dst->id, sizeof dst->id)) return;
    hf_redact(pred, dst->prediction, sizeof dst->prediction, 500);
    hf_redact(obs, dst->outcome, sizeof dst->outcome, 500);
    if (!dst->prediction[0] || !dst->outcome[0]) { dst->id[0] = '\0'; return; }
    hf_redact(upd, dst->update, sizeof dst->update, 500);

    {
        JNode *ls = json_get(o, "lessons");
        int i;
        for (i = 0; i < json_len(ls) && dst->lesson_n < 8; i++) {
            char tmp[256];
            hf_redact(json_node_str(json_at(ls, i), ""), tmp, sizeof tmp, 500);
            if (tmp[0]) snprintf(dst->lessons[dst->lesson_n++], 256, "%s", tmp);
        }
    }
    if (ts && hf_parse_iso(ts) >= 0) snprintf(dst->recorded_at, sizeof dst->recorded_at, "%s", ts);
}

static void memory_load(const JNode *in, Memory *m, const char *case_id)
{
    const char *state = json_str(in, "currentState", "");
    const char *goal = json_str(in, "goal", "");

    memory_init(m, case_id, 1, "");
    hf_redact(goal, m->goal, sizeof m->goal, 500);
    if (state_valid(state)) snprintf(m->state, sizeof m->state, "%s", state);

    {
        JNode *arr = json_get(in, "observations");
        int i, start = 0;
        if (json_len(arr) > 100) start = json_len(arr) - 100;
        for (i = start; i < json_len(arr); i++) {
            Obs tmp;
            memset(&tmp, 0, sizeof tmp);
            tmp.stage = -1;
            normalize_observation(json_at(arr, i), &tmp);
            if (!tmp.id[0] || obs_exists(m, tmp.id)) continue;
            {
                Obs *slot = obs_push(m);
                if (slot) *slot = tmp;
            }
        }
    }
    {
        JNode *arr = json_get(in, "outcomes");
        int i, start = 0;
        if (json_len(arr) > 100) start = json_len(arr) - 100;
        for (i = start; i < json_len(arr); i++) {
            Outcome tmp;
            memset(&tmp, 0, sizeof tmp);
            normalize_outcome(json_at(arr, i), &tmp);
            if (!tmp.id[0] || out_exists(m, tmp.id)) continue;
            {
                Outcome *slot = out_push(m);
                int k;
                if (!slot) continue;
                *slot = tmp;
                for (k = 0; k < tmp.lesson_n; k++) memory_add_lesson(m, tmp.lessons[k]);
            }
        }
    }
}

static JNode *memory_to_json(const Memory *m)
{
    JNode *o = json_new_obj();
    JNode *consent = json_new_obj();
    JNode *timeline = json_new_arr();
    JNode *obs = json_new_arr();
    JNode *outcomes = json_new_arr();
    JNode *lessons = json_new_arr();
    JNode *privacy = json_new_obj();
    int i, k;

    json_obj_set_num(o, "version", 1);
    json_obj_set_str(o, "caseId", m->case_id);
    json_obj_set_bool(consent, "granted", m->consent ? 1 : 0);
    json_obj_set_str(consent, "scope", m->consent ? "relationship_context" : "none");
    json_obj_set(consent, "recordedAt", json_new_null());
    json_obj_set(o, "consent", consent);
    json_obj_set_str(o, "goal", m->goal);
    json_obj_set_str(o, "currentState", m->state);

    for (i = 0; i < m->obs_n; i++) {
        JNode *e = json_new_obj();
        JNode *tl = json_new_obj();
        JNode *evs = json_new_arr();
        json_obj_set_str(e, "id", m->obs[i].id);
        json_obj_set_str(e, "kind", m->obs[i].kind);
        json_obj_set_str(e, "summary", m->obs[i].summary);
        if (m->obs[i].stage >= 0) json_obj_set_num(e, "stage", m->obs[i].stage);
        else json_obj_set(e, "stage", json_new_null());
        for (k = 0; k < m->obs[i].ev_n; k++) json_arr_push(evs, json_new_str(m->obs[i].evidence[k]));
        json_obj_set(e, "evidenceIds", evs);
        json_obj_set_str(e, "source", m->obs[i].source);
        if (m->obs[i].recorded_at[0]) json_obj_set_str(e, "recordedAt", m->obs[i].recorded_at);
        else json_obj_set(e, "recordedAt", json_new_null());
        json_arr_push(obs, e);

        {
            char tid[160];
            snprintf(tid, sizeof tid, "timeline_%s", m->obs[i].id);
            json_obj_set_str(tl, "id", tid);
            json_obj_set_str(tl, "kind", m->obs[i].kind);
            json_obj_set_str(tl, "summary", m->obs[i].summary);
            if (m->obs[i].recorded_at[0]) json_obj_set_str(tl, "recordedAt", m->obs[i].recorded_at);
            else json_obj_set(tl, "recordedAt", json_new_null());
            json_arr_push(timeline, tl);
        }
    }

    for (i = 0; i < m->out_n; i++) {
        JNode *e = json_new_obj();
        JNode *ls = json_new_arr();
        json_obj_set_str(e, "id", m->out[i].id);
        json_obj_set_str(e, "prediction", m->out[i].prediction);
        json_obj_set_str(e, "observedOutcome", m->out[i].outcome);
        json_obj_set_str(e, "update", m->out[i].update);
        for (k = 0; k < m->out[i].lesson_n; k++) json_arr_push(ls, json_new_str(m->out[i].lessons[k]));
        json_obj_set(e, "lessons", ls);
        if (m->out[i].recorded_at[0]) json_obj_set_str(e, "recordedAt", m->out[i].recorded_at);
        else json_obj_set(e, "recordedAt", json_new_null());
        json_arr_push(outcomes, e);
    }

    for (i = 0; i < m->lesson_n; i++) json_arr_push(lessons, json_new_str(m->lessons[i]));

    json_obj_set(o, "timeline", timeline);
    json_obj_set(o, "observations", obs);
    json_obj_set(o, "preferences", json_new_arr());
    json_obj_set(o, "conflicts", json_new_arr());
    json_obj_set(o, "promises", json_new_arr());
    json_obj_set(o, "lessons", lessons);
    json_obj_set(o, "outcomes", outcomes);

    json_obj_set_bool(privacy, "rawChatRetained", 0);
    json_obj_set_bool(privacy, "anonymized", 0);
    json_obj_set_bool(privacy, "knownIdentifiersRedacted", 1);
    json_obj_set_bool(privacy, "manualReviewRequired", 1);
    json_obj_set_str(privacy, "anonymizationScope", "known_patterns_and_controlled_identifiers");
    json_obj_set(privacy, "thirdPartyIdentifiers", json_new_null());
    json_obj_set(o, "privacy", privacy);

    return o;
}

/* ================= 消息归一化 ================= */

static int speaker_of(const JNode *m, char *out, size_t n)
{
    const char *s = json_str(m, "speaker", "");
    const char *type = json_str(m, "type", "");
    char low[24];
    size_t i;

    snprintf(low, sizeof low, "%s", s);
    for (i = 0; low[i]; i++) low[i] = (char)tolower((unsigned char)low[i]);

    if (strcmp(low, "user") == 0 || strcmp(low, "me") == 0 || strcmp(low, "mine") == 0 ||
        strcmp(low, "self") == 0 || strcmp(low, "我") == 0 || strcmp(low, "男方") == 0) {
        snprintf(out, n, "user");
        return 1;
    }
    if (strcmp(low, "other") == 0 || strcmp(low, "partner") == 0 || strcmp(low, "them") == 0 ||
        strcmp(low, "her") == 0 || strcmp(low, "对方") == 0 || strcmp(low, "她") == 0 ||
        strcmp(low, "女方") == 0) {
        snprintf(out, n, "other");
        return 1;
    }
    if (strcmp(type, "me") == 0) { snprintf(out, n, "user"); return 1; }
    if (strcmp(type, "her") == 0) { snprintf(out, n, "other"); return 1; }
    snprintf(out, n, "unknown");
    return 1;
}

static int normalize_id_or(const char *s, int index, char *out, size_t n)
{
    if (s && hf_is_anon_id(s, 80)) { snprintf(out, n, "%s", s); return 1; }
    snprintf(out, n, "heartflow_%d", index + 1);
    return 1;
}

static void msgs_from_body(const JNode *messages, HfMsgs *out)
{
    int total = json_len(messages);
    int i, start = total > HF_MAX_MSGS ? total - HF_MAX_MSGS : 0;

    out->v = NULL;
    out->n = 0;
    if (total <= 0) return;
    out->v = (HfMsg *)calloc((size_t)(total - start), sizeof(HfMsg));
    if (!out->v) abort();

    for (i = start; i < total; i++) {
        const JNode *m = json_at(messages, i);
        const char *text = json_str(m, "text", "");
        char *trimmed;
        if (!m || m->type != JOBJ) continue;
        trimmed = hf_trim_dup(text);
        if (!trimmed[0]) { free(trimmed); continue; }
        {
            HfMsg *slot = &out->v[out->n];
            char idbuf[96];
            char cut[HF_COACH_TEXT * 4 + 8];
            int chars = hf_utf8_chars(trimmed);
            if (chars > HF_COACH_TEXT) {
                int c = 0;
                size_t k = 0;
                while (trimmed[k] && c < HF_COACH_TEXT) {
                    if (((unsigned char)trimmed[k] & 0xC0) != 0x80) c++;
                    if (c > HF_COACH_TEXT) break;
                    k++;
                    while (trimmed[k] && ((unsigned char)trimmed[k] & 0xC0) == 0x80) k++;
                }
                memcpy(cut, trimmed, k);
                cut[k] = '\0';
                free(trimmed);
                trimmed = hf_trim_dup(cut);
            }
            normalize_id_or(json_str(m, "id", NULL), i, idbuf, sizeof idbuf);
            snprintf(slot->id, sizeof slot->id, "%s", idbuf);
            speaker_of(m, slot->speaker, sizeof slot->speaker);
            slot->text = trimmed;
            {
                const char *ts = json_str(m, "timestamp", json_str(m, "createdAt", NULL));
                slot->ts_ms = ts ? hf_parse_iso(ts) : -1;
            }
            out->n++;
        }
    }
}

/* ================= 状态机 ================= */

typedef struct {
    const char *from;
    const char *to;
    const char *reason;
    int reversible;
} Transition;

static Transition transition(const char *current, const Signals *s)
{
    Transition t;
    t.from = current;
    t.to = current;
    t.reason = "没有足够的新证据改变当前工作状态";
    t.reversible = 1;

    if (strcmp(current, "EXIT") == 0) {
        t.to = "EXIT"; t.reason = "已退出的关系保持退出状态"; t.reversible = 0; return t;
    }
    if (s->safetyRisk || s->explicitExit || s->relationshipEnded) {
        t.to = "EXIT"; t.reason = "安全风险、明确退出或关系结束信号优先"; t.reversible = 0; return t;
    }
    if (s->explicitRejection) {
        t.to = "EXIT"; t.reason = "明确关系拒绝优先于旧或冲突的推进信号，停止继续推进"; t.reversible = 0; return t;
    }
    if (s->contactPause) { t.reason = "明确要求暂时停止联系，保持状态并暂停推进"; return t; }
    if (s->observationReplayed) { t.reason = "同一观察重试不重复推进关系状态"; return t; }
    if (s->conflict) { t.to = "CONFLICT"; t.reason = "出现需要处理的冲突事实"; return t; }
    if (strcmp(current, "CONFLICT") == 0 && s->repairAttempt) {
        t.to = "REPAIR"; t.reason = "双方开始讨论具体行为、影响和修复请求"; return t;
    }
    if (strcmp(current, "REPAIR") == 0 && s->repairSucceeded) {
        t.to = "STABLE_RELATIONSHIP"; t.reason = "修复后出现可观察的稳定行为"; return t;
    }
    if (strcmp(current, "UNKNOWN") == 0 && s->initialContact) {
        t.to = "INITIAL_CONTACT"; t.reason = "出现首次或重新开始的互动"; return t;
    }
    if (strcmp(current, "INITIAL_CONTACT") == 0 && s->repeatedInteraction) {
        t.to = "MUTUAL_FAMILIARITY"; t.reason = "互动出现重复且双方都参与"; return t;
    }
    if (strcmp(current, "MUTUAL_FAMILIARITY") == 0 && s->reciprocalInterest) {
        t.to = "GROWING_INTEREST"; t.reason = "双方出现可观察的互惠投入"; return t;
    }
    if (strcmp(current, "GROWING_INTEREST") == 0 && s->concreteDatePlan) {
        t.to = "DATING_EXPLORATION"; t.reason = "形成具体、可拒绝的现实见面安排"; return t;
    }
    if (strcmp(current, "DATING_EXPLORATION") == 0 && s->relationshipDefined) {
        t.to = "COMMITTED_RELATIONSHIP"; t.reason = "双方明确讨论并同意关系定义"; return t;
    }
    if (strcmp(current, "COMMITTED_RELATIONSHIP") == 0 && s->stableRoutine) {
        t.to = "STABLE_RELATIONSHIP"; t.reason = "持续的互惠日常和边界协商可观察"; return t;
    }
    if (strcmp(current, "STABLE_RELATIONSHIP") == 0 && s->conflict) {
        t.to = "CONFLICT"; t.reason = "稳定关系中出现待修复冲突"; return t;
    }
    if (strcmp(current, "GROWING_INTEREST") == 0 && s->lowReciprocity) {
        t.to = "MUTUAL_FAMILIARITY"; t.reason = "互惠证据不足，回到较保守的工作状态"; return t;
    }
    return t;
}

/* ================= 决策 ================= */

static const char *decision_of(const HfAnalysis *a, const Signals *s, const char *state)
{
    if (strcmp(state, "EXIT") == 0 || s->safetyRisk || s->relationshipEnded || s->explicitExit) return "EXIT";
    if (s->explicitRejection || s->contactPause) return "DE_ESCALATE";
    if (s->conflict || a->m.conflict_count > 0) return "MAINTAIN";
    if (s->concreteDatePlan || s->counterOffer) return "ADVANCE";
    if (strcmp(a->m.data_quality, "limited") == 0 || !a->m.has_other_q_ratio) return "OBSERVE";
    if (a->m.other_q_ratio >= 0.5 && (!a->m.has_user_ratio || a->m.user_ratio <= 0.75)) return "MAINTAIN";
    return "OBSERVE";
}

static const char *action_of(const char *decision)
{
    if (strcmp(decision, "ADVANCE") == 0) return "给出一个具体、低压力且容易拒绝的现实选项，发出后等待对方回应。";
    if (strcmp(decision, "MAINTAIN") == 0) return "保持当前双方都能承受的节奏，把分歧改写成具体行为和请求。";
    if (strcmp(decision, "DE_ESCALATE") == 0) return "停止追加说服，降低投入并给对方空间；若没有新的互惠证据就退出推进。";
    if (strcmp(decision, "EXIT") == 0) return "停止推进和数据收集，保护隐私、边界与安全；必要时寻求现实支持。";
    return "保留至少两个解释，只做一个最小、可逆的观察，不连续追问。";
}

static const char *expected_of(const char *decision)
{
    if (strcmp(decision, "ADVANCE") == 0) return "对方确认或提出可行的替代安排";
    if (strcmp(decision, "MAINTAIN") == 0) return "双方继续出现可观察的互惠和边界协商";
    if (strcmp(decision, "DE_ESCALATE") == 0) return "降低投入后是否自然出现新的互惠证据";
    if (strcmp(decision, "EXIT") == 0) return "停止推进后安全和尊严得到保持";
    return "下一次互动提供更具体的投入、边界或现实安排信息";
}

/* ================= 观察 ID ================= */

static void observation_id(const HfMsgs *msgs, const Signals *s, char out[80])
{
    JNode *root = json_new_obj();
    JNode *content = json_new_arr();
    JNode *sig = json_new_obj();
    HfBuf b;
    char hex[65];
    int i;

    for (i = 0; i < msgs->n; i++) {
        JNode *m = json_new_obj();
        json_obj_set_str(m, "speaker", msgs->v[i].speaker);
        json_obj_set_str(m, "text", msgs->v[i].text);
        if (msgs->v[i].ts_ms >= 0) json_obj_set_num(m, "timestampMs", (double)msgs->v[i].ts_ms);
        else json_obj_set(m, "timestampMs", json_new_null());
        json_arr_push(content, m);
    }
    json_obj_set(root, "content", content);

    json_obj_set_bool(sig, "safetyRisk", s->safetyRisk);
    json_obj_set_bool(sig, "relationshipEnded", s->relationshipEnded);
    json_obj_set_bool(sig, "explicitExit", s->explicitExit);
    json_obj_set_bool(sig, "explicitRejection", s->explicitRejection);
    json_obj_set_bool(sig, "contactPause", s->contactPause);
    json_obj_set_bool(sig, "initialContact", s->initialContact);
    json_obj_set_bool(sig, "repeatedInteraction", s->repeatedInteraction);
    json_obj_set_bool(sig, "conflict", s->conflict);
    json_obj_set_bool(sig, "counterOffer", s->counterOffer);
    json_obj_set_bool(sig, "concreteDatePlan", s->concreteDatePlan);
    json_obj_set_bool(sig, "repairAttempt", s->repairAttempt);
    json_obj_set_bool(sig, "repairSucceeded", s->repairSucceeded);
    json_obj_set_bool(sig, "reciprocalInterest", s->reciprocalInterest);
    json_obj_set_bool(sig, "relationshipDefined", s->relationshipDefined);
    json_obj_set_bool(sig, "stableRoutine", s->stableRoutine);
    json_obj_set_bool(sig, "lowReciprocity", s->lowReciprocity);
    json_obj_set(root, "signals", sig);

    hf_buf_init(&b);
    json_write(root, &b, 0, 0);
    hf_sha256_hex(b.p, b.n, hex);
    hf_buf_free(&b);
    json_free(root);

    snprintf(out, 80, "loop_%s", hex);
}

/* ================= 主循环 ================= */

static JNode *ids_of_evidence(const HfAnalysis *a)
{
    JNode *arr = json_new_arr();
    int i;
    for (i = 0; i < a->ev_n; i++) json_arr_push(arr, json_new_str(a->ev[i].id));
    return arr;
}

static void signals_from_body(const JNode *body, Signals *s)
{
    const JNode *b = json_get(body, "signals");
    int i;
    memset(s, 0, sizeof *s);
    if (!b || b->type != JOBJ) return;

    for (i = 0; SIGNAL_KEYS[i]; i++) {
        const JNode *v = json_get(b, SIGNAL_KEYS[i]);
        int on = (v && v->type == JBOOL && v->u.b) ? 1 : 0;
        if (strcmp(SIGNAL_KEYS[i], "safetyRisk") == 0) s->safetyRisk = on;
        else if (strcmp(SIGNAL_KEYS[i], "relationshipEnded") == 0) s->relationshipEnded = on;
        else if (strcmp(SIGNAL_KEYS[i], "explicitExit") == 0) s->explicitExit = on;
        else if (strcmp(SIGNAL_KEYS[i], "explicitRejection") == 0) s->explicitRejection = on;
        else if (strcmp(SIGNAL_KEYS[i], "contactPause") == 0) s->contactPause = on;
        else if (strcmp(SIGNAL_KEYS[i], "initialContact") == 0) { s->initialContact = on; s->has_initial = 1; }
        else if (strcmp(SIGNAL_KEYS[i], "repeatedInteraction") == 0) { s->repeatedInteraction = on; s->has_repeated = 1; }
        else if (strcmp(SIGNAL_KEYS[i], "conflict") == 0) { s->conflict = on; s->has_conflict = 1; }
        else if (strcmp(SIGNAL_KEYS[i], "counterOffer") == 0) s->counterOffer = on;
        else if (strcmp(SIGNAL_KEYS[i], "concreteDatePlan") == 0) s->concreteDatePlan = on;
        else if (strcmp(SIGNAL_KEYS[i], "repairAttempt") == 0) s->repairAttempt = on;
        else if (strcmp(SIGNAL_KEYS[i], "repairSucceeded") == 0) s->repairSucceeded = on;
        else if (strcmp(SIGNAL_KEYS[i], "reciprocalInterest") == 0) s->reciprocalInterest = on;
        else if (strcmp(SIGNAL_KEYS[i], "relationshipDefined") == 0) s->relationshipDefined = on;
        else if (strcmp(SIGNAL_KEYS[i], "stableRoutine") == 0) s->stableRoutine = on;
        else if (strcmp(SIGNAL_KEYS[i], "lowReciprocity") == 0) s->lowReciprocity = on;
    }
}

JNode *hf_coach_run(const JNode *body, HfCoachError *err)
{
    HfMsgs msgs;
    HfAnalysis analysis;
    Signals sig;
    Memory mem;
    int has_memory = 0;
    char goal[512];
    char oid[80];
    const char *decision, *action, *expected, *current_state;
    Transition st;
    JNode *root, *dec, *allowed, *pred, *priv, *hyps;

    msgs_from_body(json_get(body, "messages"), &msgs);
    if (msgs.n == 0) {
        hf_msgs_free(&msgs);
        err->code = "messages_required";
        err->message = "`messages` 必须至少包含一条非空消息。";
        return NULL;
    }

    hf_analyze(&msgs, &analysis);

    hf_redact(json_str(body, "goal", ""), goal, sizeof goal, 300);

    if (json_bool(body, "consent", 0)) {
        const char *cid = json_str(body, "caseId", "");
        const JNode *min = json_get(body, "memory");
        JNode *empty = NULL;
        if (!hf_is_case_id(cid) || sensitive_id_marker(cid)) {
            hf_msgs_free(&msgs);
            err->code = "invalid_case_id";
            err->message = "启用匿名结构化记忆时，caseId 必须是 case_ 开头的匿名标识。";
            return NULL;
        }
        if (!min || min->type != JOBJ) { empty = json_new_obj(); min = empty; }
        memory_load(min, &mem, cid);
        json_free(empty);
        has_memory = 1;
    } else {
        memory_init(&mem, "", 0, goal);
    }

    signals_from_body(body, &sig);

    /* 合并文本证据 */
    if (analysis.m.safety_count > 0) sig.safetyRisk = 1;
    if (analysis.m.exit_count > 0) sig.explicitExit = 1;
    if (analysis.m.rejection_count > 0) sig.explicitRejection = 1;
    if (analysis.m.pause_count > 0) sig.contactPause = 1;
    if (!sig.has_initial) sig.initialContact = analysis.m.message_count > 0;
    if (!sig.has_repeated) sig.repeatedInteraction = analysis.m.message_count >= 4;
    if (!sig.has_conflict) sig.conflict = analysis.m.conflict_count > 0;

    current_state = has_memory && mem.state[0] ? mem.state : "UNKNOWN";

    if (has_memory) {
        int i;
        observation_id(&msgs, &sig, oid);
        for (i = 0; i < mem.obs_n; i++)
            if (strcmp(mem.obs[i].id, oid) == 0) { sig.observationReplayed = 1; break; }
    } else {
        oid[0] = '\0';
    }

    st = transition(current_state, &sig);
    decision = decision_of(&analysis, &sig, current_state);
    action = action_of(decision);
    expected = expected_of(decision);

    root = json_new_obj();
    json_obj_set_num(root, "version", 1);
    json_obj_set_str(root, "goal", goal);

    json_obj_set(root, "analysis", hf_analysis_json(&analysis));

    /* hypotheses */
    hyps = json_new_arr();
    {
        int has_low = 0, i;
        for (i = 0; i < analysis.m.emotion_label_count; i++)
            if (strcmp(analysis.m.emotion_labels[i], "low_energy") == 0) has_low = 1;
        if (has_low) {
            JNode *h = json_new_obj();
            JNode *sup = json_new_arr();
            JNode *ctr = json_new_arr();
            json_obj_set_str(h, "label", "对方当前精力或时间有限");
            json_obj_set_str(h, "confidence", "medium_low");
            json_arr_push(sup, json_new_str("文本出现忙碌或低能量表达"));
            json_arr_push(ctr, json_new_str("尚无足够现实安排信息"));
            json_obj_set(h, "support", sup);
            json_obj_set(h, "counter", ctr);
            json_arr_push(hyps, h);
        }
    }
    {
        JNode *h = json_new_obj();
        JNode *sup = json_new_arr();
        JNode *ctr = json_new_arr();
        int i;
        json_obj_set_str(h, "label", "当前互惠程度仍不明确");
        json_obj_set_str(h, "confidence", "insufficient_evidence");
        for (i = 0; i < analysis.ev_n && i < 2; i++)
            json_arr_push(sup, json_new_str(analysis.ev[i].observation));
        json_arr_push(ctr, json_new_str("后续具体安排或主动行为可能改变判断"));
        json_obj_set(h, "support", sup);
        json_obj_set(h, "counter", ctr);
        json_arr_push(hyps, h);
    }
    json_obj_set(root, "hypotheses", hyps);

    /* state */
    {
        JNode *sj = json_new_obj();
        JNode *ids = ids_of_evidence(&analysis);
        const JNode *extra = json_get(json_get(body, "signals"), "evidenceIds");
        int i;
        for (i = 0; i < json_len(extra) && json_len(ids) < 20; i++) {
            const char *s = json_node_str(json_at(extra, i), NULL);
            char tmp[112];
            if (s && normalize_anon_id(s, tmp, sizeof tmp)) json_arr_push(ids, json_new_str(tmp));
        }
        json_obj_set_str(sj, "from", st.from);
        json_obj_set_str(sj, "to", st.to);
        json_obj_set_bool(sj, "changed", strcmp(st.from, st.to) != 0);
        json_obj_set_str(sj, "reason", st.reason);
        json_obj_set(sj, "evidenceIds", ids);
        json_obj_set_bool(sj, "reversible", st.reversible);
        json_obj_set(root, "state", sj);
    }

    /* decision */
    dec = json_new_obj();
    allowed = json_new_arr();
    json_arr_push(allowed, json_new_str("ADVANCE"));
    json_arr_push(allowed, json_new_str("MAINTAIN"));
    json_arr_push(allowed, json_new_str("OBSERVE"));
    json_arr_push(allowed, json_new_str("DE_ESCALATE"));
    json_arr_push(allowed, json_new_str("EXIT"));
    json_obj_set_str(dec, "value", decision);
    json_obj_set(dec, "allowed", allowed);
    json_obj_set_str(dec, "reason", action);
    json_obj_set(dec, "evidenceIds", ids_of_evidence(&analysis));
    json_obj_set(root, "decision", dec);

    json_obj_set_str(root, "action", action);

    /* prediction */
    pred = json_new_obj();
    {
        char pid[64];
        snprintf(pid, sizeof pid, "prediction_%d", analysis.m.message_count);
        json_obj_set_num(pred, "version", 1);
        json_obj_set_str(pred, "id", pid);
        json_obj_set_str(pred, "decision", decision);
        json_obj_set_str(pred, "action", action);
        json_obj_set_str(pred, "expectedSignal", expected);
        json_obj_set(pred, "evidenceIds", ids_of_evidence(&analysis));
        json_obj_set_str(pred, "status", "pending");
    }
    json_obj_set(root, "prediction", pred);

    /* memory patch */
    if (has_memory) {
        JNode *patch;
        snprintf(mem.state, sizeof mem.state, "%s", st.to);
        snprintf(mem.goal, sizeof mem.goal, "%s", goal);
        if (!obs_exists(&mem, oid)) {
            Obs *slot = obs_push(&mem);
            if (slot) {
                char summary[300];
                snprintf(summary, sizeof summary,
                         "观察到%d条消息；当前建议为%s，仅保留结构化摘要。",
                         analysis.m.message_count, decision);
                snprintf(slot->id, sizeof slot->id, "%s", oid);
                snprintf(slot->kind, sizeof slot->kind, "agent_loop");
                hf_redact(summary, slot->summary, sizeof slot->summary, 500);
                snprintf(slot->source, sizeof slot->source, "conversation_analyzer");
                slot->stage = -1;
                {
                    int i;
                    for (i = 0; i < analysis.ev_n && slot->ev_n < 20; i++)
                        snprintf(slot->evidence[slot->ev_n++], 112, "%s", analysis.ev[i].id);
                }
                slot->recorded_at[0] = '\0';
            }
        }
        patch = memory_to_json(&mem);
        json_obj_set(root, "memoryPatch", patch);
    } else {
        json_obj_set(root, "memoryPatch", json_new_null());
    }

    priv = json_new_obj();
    json_obj_set_bool(priv, "rawMessagesReturned", 0);
    json_obj_set_bool(priv, "memoryWriteAttempted", has_memory);
    json_obj_set_bool(priv, "consentProvided", has_memory || json_bool(body, "consent", 0));
    json_obj_set(root, "privacy", priv);

    memory_free(&mem);
    hf_msgs_free(&msgs);
    return root;
}

/* ================= 场景训练 ================= */

typedef struct {
    const char *id;
    const char *title;
    int         stage;
    const char *context;
    const char *role;
    const char *boundary;
} Scenario;

static const Scenario SCENARIOS[] = {
    { "first-meeting", "活动后的第一次聊天", 2,
      "你们刚在一个公开活动中认识，对方提到最近在看一部纪录片。",
      "扮演一个有自己的安排、可以接受也可以拒绝继续聊天的对方；不要替用户写回复。",
      "用户可以随时暂停或退出练习。" },
    { "low-energy-reply", "对方回复较短", 4,
      "最近几次聊天都较短，对方说‘最近有点忙’，没有明确答应下一次聊天。",
      "只给简短但不侮辱用户的现实反应，等待用户自己选择是否给空间。",
      "不得通过冷处理、嫉妒或连续追问制造压力。" },
    { "low-pressure-invitation", "低压力邀约", 5,
      "你们已经有过几次自然交流，附近周末有一个双方都提过的公开展览。",
      "对具体、可拒绝的邀请作出有边界的答复；不因为拒绝而自动提供替代时间。",
      "练习重点是清楚表达和接受答案，不是拿到见面。" },
    { "conflict-repair", "联系频率冲突", 11,
      "一方觉得联系太少，另一方觉得被追问；双方都还没有说出具体请求。",
      "在用户先描述事实、影响和请求后，给出有限的可协商回应。",
      "不使用羞辱、冷暴力惩罚或威胁。" },
    { "breakup-recovery", "明确结束后的恢复", 12,
      "对方已经明确表示不想继续，用户想通过更强的话术挽回。",
      "保持明确边界，不被话术逼回关系；练习重点是体面退出和自我恢复。",
      "不模拟跟踪、威胁、自伤暗示或报复。" },
    { NULL, NULL, 0, NULL, NULL, NULL }
};

static JNode *scenario_json(const Scenario *s)
{
    JNode *o = json_new_obj();
    json_obj_set_str(o, "id", s->id);
    json_obj_set_str(o, "title", s->title);
    json_obj_set_num(o, "stage", s->stage);
    json_obj_set_str(o, "context", s->context);
    json_obj_set_str(o, "roleInstruction", s->role);
    json_obj_set_str(o, "boundary", s->boundary);
    return o;
}

static const Scenario *scenario_find(const char *id)
{
    int i;
    for (i = 0; SCENARIOS[i].id; i++) if (strcmp(SCENARIOS[i].id, id) == 0) return &SCENARIOS[i];
    return NULL;
}

JNode *hf_scenario_list(void)
{
    JNode *arr = json_new_arr();
    int i;
    for (i = 0; SCENARIOS[i].id; i++) json_arr_push(arr, scenario_json(&SCENARIOS[i]));
    return arr;
}

JNode *hf_scenario_get(const char *id)
{
    const Scenario *s = scenario_find(id);
    return s ? scenario_json(s) : NULL;
}

JNode *hf_scenario_start(const char *id, HfCoachError *err)
{
    const Scenario *s = scenario_find(id);
    JNode *o, *priv;
    if (!s) {
        err->code = "unknown_scenario";
        err->message = "未知的练习场景。";
        return NULL;
    }
    o = json_new_obj();
    json_obj_set_num(o, "version", 1);
    json_obj_set_str(o, "scenarioId", s->id);
    json_obj_set_num(o, "stage", s->stage);
    json_obj_set_num(o, "turn", 0);
    json_obj_set_str(o, "phase", "awaiting_user");
    json_obj_set_num(o, "attempts", 0);
    json_obj_set(o, "lastCritique", json_new_null());
    json_obj_set(o, "responseMeta", json_new_null());
    priv = json_new_obj();
    json_obj_set_bool(priv, "rawResponsesRetained", 0);
    json_obj_set_bool(priv, "anonymized", 1);
    json_obj_set(o, "privacy", priv);
    return o;
}

static int count_occurrences(const char *t, const char *w)
{
    int n = 0;
    const char *p = t;
    size_t l = strlen(w);
    while ((p = strstr(p, w)) != NULL) { n++; p += l; }
    return n;
}

static int directly_negated(const char *start, const char *match)
{
    static const char *negations[] = { "不再", "不会再", "不想再", "不愿再", "不要再", "不打算再", "不需要", "不必", "不用", "无需", "不会", "不想", "不要", "别", "不", "停止", "拒绝", NULL };
    int i;
    for (i = 0; negations[i]; i++) {
        size_t n = strlen(negations[i]);
        if ((size_t)(match - start) >= n && !strncmp(match - n, negations[i], n)) return 1;
    }
    return 0;
}

static int unnegated_occurrences(const char *text, const char *word)
{
    int count = 0; const char *p = text; size_t n = strlen(word);
    while ((p = strstr(p, word)) != NULL) { if (!directly_negated(text, p)) count++; p += n; }
    return count;
}

JNode *hf_scenario_critique(const JNode *session, const char *response, int retry, HfCoachError *err)
{
    const char *sid = json_str(session, "scenarioId", "");
    const Scenario *s = scenario_find(sid);
    char *trimmed;
    int len, questions, pressure;
    int ended, renewal = 0, ack = 0;
    int scores[6];
    JNode *out, *score, *prios, *sess, *meta, *priv;
    int attempts;

    if (!s) {
        err->code = "unknown_scenario";
        err->message = "未知的练习场景。";
        return NULL;
    }
    if (!retry) {
        const char *phase = json_str(session, "phase", "");
        if (strcmp(phase, "awaiting_user") != 0) {
            err->code = "scenario_not_awaiting";
            err->message = "scenario is not awaiting a user response";
            return NULL;
        }
    }
    trimmed = hf_trim_dup(response ? response : "");
    len = hf_utf8_chars(trimmed);
    if (!len) {
        free(trimmed);
        err->code = "response_required";
        err->message = "response is required";
        return NULL;
    }

    questions = count_occurrences(trimmed, "?") + count_occurrences(trimmed, "？");
    pressure = unnegated_occurrences(trimmed, "必须") + unnegated_occurrences(trimmed, "立刻") +
               unnegated_occurrences(trimmed, "不回就是") + unnegated_occurrences(trimmed, "你敢") +
               unnegated_occurrences(trimmed, "证明给我") + unnegated_occurrences(trimmed, "凭什么不");

    ended = strcmp(s->id, "breakup-recovery") == 0;
    if (ended) {
        renewal = unnegated_occurrences(trimmed, "复合") || unnegated_occurrences(trimmed, "挽回") ||
                  unnegated_occurrences(trimmed, "回心转意") || unnegated_occurrences(trimmed, "再见面") ||
                  unnegated_occurrences(trimmed, "再见一次") || unnegated_occurrences(trimmed, "给我一次") ||
                  unnegated_occurrences(trimmed, "给我个机会") || unnegated_occurrences(trimmed, "给我机会") ||
                  unnegated_occurrences(trimmed, "联系你") || unnegated_occurrences(trimmed, "约你") ||
                  unnegated_occurrences(trimmed, "见你");
        ack = hf_text_has(trimmed, "尊重") || hf_text_has(trimmed, "接受") ||
              hf_text_has(trimmed, "不再联系") || hf_text_has(trimmed, "结束") ||
              hf_text_has(trimmed, "退出") || hf_text_has(trimmed, "祝你") ||
              hf_text_has(trimmed, "告别") || hf_text_has(trimmed, "照顾自己");
    }

    scores[0] = (len >= 4 && len <= 100) ? 2 : 1;                       /* naturalness */
    scores[1] = questions <= 1 ? 2 : (questions == 2 ? 1 : 0);          /* questionDensity */
    scores[2] = (hf_text_has(trimmed, "听起来") || hf_text_has(trimmed, "我理解") ||
                 hf_text_has(trimmed, "你刚才") || hf_text_has(trimmed, "确实") ||
                 hf_text_has(trimmed, "原来") || hf_text_has(trimmed, "谢谢你说")) ? 2 : 1;
    scores[3] = (pressure > 0 || renewal) ? 0 : (ended ? (ack ? 2 : 1) : 2);   /* boundary */
    scores[4] = ended ? ((renewal || pressure > 0) ? 0 : (ack ? 2 : 1))
                      : (hf_text_has(trimmed, "一起") || hf_text_has(trimmed, "周末") ||
                         hf_text_has(trimmed, "明天") || hf_text_has(trimmed, "下周") ||
                         hf_text_has(trimmed, "方便的话") || hf_text_has(trimmed, "可以拒绝")) ? 2 : 1;
    scores[5] = (len > 120 || questions >= 3) ? 0 : 2;                  /* overExplanation */

    prios = json_new_arr();
    if (ended && renewal)
        json_arr_push(prios, json_new_str("关系已经明确结束，停止重新邀约或挽回，练习尊重退出和自我恢复"));
    if (pressure > 0) json_arr_push(prios, json_new_str("先去掉施压、证明和追责语言"));
    if (scores[1] == 0) json_arr_push(prios, json_new_str("一次只保留一个问题，并给对方退出空间"));
    if (scores[2] < 2) json_arr_push(prios, json_new_str("先回应对方已经说出的事实，再表达自己的话题"));
    if (scores[4] < 2 && !ended) json_arr_push(prios, json_new_str("需要推进时给出一个具体但可拒绝的选项"));
    if (ended && !ack && !renewal)
        json_arr_push(prios, json_new_str("明确承认关系已结束，把下一步放在停止联系和照顾自己"));
    if (json_len(prios) == 0)
        json_arr_push(prios, json_new_str(ended
            ? "保持对结束决定的尊重，停止推进，把注意力转向自己的生活和支持"
            : "保持这条表达的具体性，等待对方真实回应"));

    out = json_new_obj();
    sess = json_clone(session);
    attempts = (int)json_num(session, "attempts", 0) + 1;
    json_obj_set_str(sess, "phase", "awaiting_retry");
    json_obj_set_num(sess, "attempts", attempts);
    if (retry) json_obj_set_num(sess, "turn", json_num(session, "turn", 0) + 1);

    meta = json_new_obj();
    json_obj_set_num(meta, "length", len);
    json_obj_set_num(meta, "questionCount", questions);
    json_obj_set_num(meta, "pressureCount", pressure);
    json_obj_set_bool(meta, "concretePlan",
                      hf_text_has(trimmed, "一起") || hf_text_has(trimmed, "周末") ||
                      hf_text_has(trimmed, "明天") || hf_text_has(trimmed, "下周") ||
                      hf_text_has(trimmed, "如果你愿意") || hf_text_has(trimmed, "方便的话") ||
                      hf_text_has(trimmed, "可以拒绝"));
    json_obj_set(sess, "responseMeta", meta);
    priv = json_new_obj();
    json_obj_set_bool(priv, "rawResponsesRetained", 0);
    json_obj_set_bool(priv, "anonymized", 1);
    json_obj_set(sess, "privacy", priv);

    score = json_new_obj();    json_obj_set_num(score, "naturalness", scores[0]);
    json_obj_set_num(score, "questionDensity", scores[1]);
    json_obj_set_num(score, "listening", scores[2]);
    json_obj_set_num(score, "boundaryAwareness", scores[3]);
    json_obj_set_num(score, "momentum", scores[4]);
    json_obj_set_num(score, "overExplanation", scores[5]);

    json_obj_set(out, "session", sess);
    json_obj_set(out, "score", score);
    json_obj_set(out, "priorities", prios);
    json_obj_set(out, "standardAnswer", json_new_null());
    json_obj_set_str(out, "note", "这是对用户实际回复的训练反馈，不提供可背诵的标准答案。");

    free(trimmed);
    return out;
}
