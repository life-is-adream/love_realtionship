#define _POSIX_C_SOURCE 200809L

#include "coach_internal.h"
#include "../hf.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

/* ================= 文本工具 ================= */

static int utf8_len_at(const char *p);
static char *find_clause_sep(char *s);

char *hf_trim_dup(const char *s)
{
    const char *b = s ? s : "";
    const char *e;
    size_t len;
    char *out;

    while (*b && isspace((unsigned char)*b)) b++;
    e = b + strlen(b);
    while (e > b && isspace((unsigned char)e[-1])) e--;
    len = (size_t)(e - b);
    out = (char *)malloc(len + 1);
    if (!out) abort();
    memcpy(out, b, len);
    out[len] = '\0';
    return out;
}

int hf_text_has(const char *text, const char *phrase)
{
    return text && phrase && *phrase && strstr(text, phrase) != NULL;
}

int hf_text_near(const char *text, const char *a, const char *b, int max_bytes)
{
    const char *p, *q;
    if (!text || !a || !b) return 0;
    p = strstr(text, a);
    if (p) {
        q = strstr(p + strlen(a), b);
        if (q && (int)(q - p) <= max_bytes) return 1;
    }
    p = strstr(text, b);
    if (p) {
        const char *start = text;
        while (start < p) {
            const char *qa = strstr(start, a);
            if (!qa || qa > p) break;
            if ((int)(p - qa) <= max_bytes) return 1;
            start = qa + 1;
        }
    }
    return 0;
}

int hf_utf8_chars(const char *s)
{
    int n = 0;
    const unsigned char *p = (const unsigned char *)(s ? s : "");
    while (*p) {
        if ((*p & 0xC0) != 0x80) n++;
        p++;
    }
    return n;
}

static int is_sensitive_marker(const char *t)
{
    static const char *M[] = {
        "姓名", "真实名字", "手机号", "手机号码", "身份证", "学号", "住址", "地址",
        "宿舍", "精确定位", "原始聊天", "私密照片", "密码", "API密钥", "api_key",
        "full_name", "phone", "mobile", "email", "wechat", "weixin", "password",
        "token", NULL
    };
    int i;
    for (i = 0; M[i]; i++) if (hf_text_has(t, M[i])) return 1;
    /* 「微信：」「电话=」这类字段赋值也算 */
    {
        static const char *F[] = { "微信", "QQ", "电话", "手机", "邮箱", NULL };
        int k;
        for (k = 0; F[k]; k++) {
            const char *p = strstr(t, F[k]);
            while (p) {
                const char *r = p + strlen(F[k]);
                while (*r == ' ' || *r == '\t') r++;
                if (*r == ':' || *r == '=' || strncmp(r, "：", 3) == 0) return 1;
                p = strstr(p + 1, F[k]);
            }
        }
    }
    return 0;
}

static int looks_like_url_at(const char *p)
{
    return strncmp(p, "http://", 7) == 0 || strncmp(p, "https://", 8) == 0 || strncmp(p, "www.", 4) == 0;
}

void hf_redact(const char *in, char *out, size_t n, int limit)
{
    HfBuf b;
    const char *p = in ? in : "";

    if (n == 0) return;
    if (is_sensitive_marker(p)) {
        snprintf(out, n, "%s", "[sensitive field redacted]");
        return;
    }

    hf_buf_init(&b);
    while (*p) {
        unsigned char c = (unsigned char)*p;

        /* URL */
        if (looks_like_url_at(p)) {
            while (*p && !isspace((unsigned char)*p)) p++;
            hf_buf_puts(&b, "[url redacted]");
            continue;
        }

        /* 邮箱：局部串@域.后缀 */
        if (isalnum(c) || c == '.' || c == '_' || c == '+' || c == '-') {
            const char *q = p;
            int has_at = 0, dots = 0;
            while (*q && (isalnum((unsigned char)*q) || *q == '.' || *q == '_' || *q == '+' || *q == '-')) q++;
            if (*q == '@') {
                const char *r = q + 1;
                while (*r && (isalnum((unsigned char)*r) || *r == '.' || *r == '-')) {
                    if (*r == '.') dots++;
                    r++;
                }
                if (dots >= 1 && r > q + 2) {
                    p = r;
                    hf_buf_puts(&b, "[email redacted]");
                    continue;
                }
            }
            (void)has_at;
        }

        /* 连续 8 位以上数字 */
        if (isdigit(c)) {
            const char *q = p;
            int digits = 0;
            while (*q && (isdigit((unsigned char)*q) || *q == ' ' || *q == '-')) {
                if (isdigit((unsigned char)*q)) digits++;
                q++;
            }
            if (digits >= 8) {
                p = q;
                hf_buf_puts(&b, digits >= 9 ? "[phone redacted]" : "[identifier redacted]");
                continue;
            }
        }

        hf_buf_putc(&b, (char)c);
        p++;
    }

    if (limit > 0 && (int)b.n > limit * 4) {
        /* 按 UTF-8 字符截断 */
        int chars = 0;
        size_t i = 0, cut = b.n;
        while (i < b.n) {
            if (((unsigned char)b.p[i] & 0xC0) != 0x80) {
                chars++;
                if (chars > limit) { cut = i; break; }
            }
            i++;
        }
        b.n = cut;
        b.p[cut] = '\0';
    }
    snprintf(out, n, "%s", b.p ? b.p : "");
    hf_buf_free(&b);
}

int hf_is_anon_id(const char *s, int maxlen)
{
    int i = 0;
    if (!s || !*s) return 0;
    if (!isalpha((unsigned char)s[0])) return 0;
    while (s[i]) {
        if (i >= maxlen) return 0;
        if (!(isalnum((unsigned char)s[i]) || s[i] == '_' || s[i] == '-')) return 0;
        i++;
    }
    return i > 0;
}

int hf_is_case_id(const char *s)
{
    size_t i, len;
    if (!s) return 0;
    len = strlen(s);
    if (len < 6 || len > 69) return 0;                 /* case_ + 2..64 */
    if (strncmp(s, "case_", 5) != 0) return 0;
    if (!isalnum((unsigned char)s[5])) return 0;
    for (i = 5; i < len; i++) {
        if (!(isalnum((unsigned char)s[i]) || s[i] == '_' || s[i] == '-')) return 0;
    }
    return 1;
}

long long hf_parse_iso(const char *s)
{
    int Y = 0, M = 0, D = 0, h = 0, m = 0, sec = 0, ms = 0, off_sign = 0, off_h = 0, off_m = 0;
    const char *p;
    struct tm tm;
    time_t t;

    if (!s || !*s) return -1;
    if (sscanf(s, "%d-%d-%dT%d:%d:%d", &Y, &M, &D, &h, &m, &sec) < 3) return -1;

    p = strchr(s, 'T');
    if (p) {
        const char *frac = strchr(p, '.');
        if (frac) ms = (int)strtol(frac + 1, NULL, 10);
        {
            const char *z = p + 1;
            while (*z && *z != 'Z' && *z != '+' && *z != '-') z++;
            if (*z == '+' || *z == '-') {
                off_sign = (*z == '+') ? 1 : -1;
                sscanf(z + 1, "%2d:%2d", &off_h, &off_m);
            }
        }
    }

    memset(&tm, 0, sizeof tm);
    tm.tm_year = Y - 1900;
    tm.tm_mon = M - 1;
    tm.tm_mday = D;
    tm.tm_hour = h;
    tm.tm_min = m;
    tm.tm_sec = sec;
    tm.tm_isdst = 0;
#ifdef _WIN32
    t = _mkgmtime(&tm);
#else
    t = timegm(&tm);
#endif
    if (t == (time_t)-1) return -1;
    return (long long)t * 1000 + ms - (long long)off_sign * (off_h * 3600 + off_m * 60) * 1000;
}

void hf_fmt_ratio(double v, char *out, size_t n)
{
    double r = (double)((long long)(v * 10000.0 + 0.5)) / 10000.0;
    snprintf(out, n, "%.4f", r);
}

/* ================= 词表 ================= */

static const char *WARM[] = { "谢谢", "开心", "期待", "喜欢", "高兴", "愿意", "哈哈", "好呀", "可以呀", "有趣", NULL };
static const char *LOW_ENERGY[] = { "忙", "累", "最近有点", "改天", "先休息", "晚点", "之后再说", "哈哈还好", NULL };
static const char *BOUNDARY[] = { "不想", "不方便", "别再", "不用了", "停止", "停下", "拒绝", "不需要", "先这样", NULL };
static const char *CONFLICT[] = { "生气", "失望", "不舒服", "吵", "误会", "为什么总", "别这样", "受不了", "不尊重", NULL };

static int has_any(const char *t, const char **list)
{
    int i;
    for (i = 0; list[i]; i++) if (hf_text_has(t, list[i])) return 1;
    return 0;
}

static int has_question(const char *t)
{
    if (hf_text_has(t, "?") || hf_text_has(t, "？")) return 1;
    /* 句末疑问语气：吗 / 么 / 呢，后接标点或结束 */
    {
        size_t l = strlen(t);
        if (l >= 3) {
            const char *tail = t + l - 3;
            if (strcmp(tail, "吗") == 0 || strcmp(tail, "么") == 0 || strcmp(tail, "呢") == 0) return 1;
        }
        if (strstr(t, "吗。") || strstr(t, "吗？") || strstr(t, "吗，") ||
            strstr(t, "么？") || strstr(t, "呢？") || strstr(t, "吗!") || strstr(t, "吗！")) return 1;
    }
    return 0;
}

static int clause_has_no_contact(const char *clause)
{
    return hf_text_has(clause, "别再联系") || hf_text_has(clause, "不要联系") ||
           hf_text_has(clause, "不用联系") || hf_text_has(clause, "请勿联系") ||
           hf_text_has(clause, "不许联系") || hf_text_has(clause, "不要再来找我") ||
           hf_text_has(clause, "别来找我") || hf_text_has(clause, "不要找我") ||
           hf_text_has(clause, "别给我发消息") || hf_text_has(clause, "不要给我发消息") ||
           hf_text_has(clause, "别给我打电话") || hf_text_has(clause, "停止联系") ||
           hf_text_has(clause, "不想再联系") || hf_text_has(clause, "不想联系") ||
           hf_text_has(clause, "不想再见面") || hf_text_has(clause, "不要再纠缠") ||
           hf_text_has(clause, "别纠缠");
}

static int has_contact_pause(const char *t)
{
    if (hf_text_has(t, "先别联系") || hf_text_has(t, "先不要联系") ||
        hf_text_has(t, "先停止联系") || hf_text_has(t, "先停下")) return 1;
    if ((hf_text_has(t, "现在") || hf_text_has(t, "今天") || hf_text_has(t, "暂时") ||
         hf_text_has(t, "这几天") || hf_text_has(t, "目前")) &&
        (hf_text_has(t, "不想聊") || hf_text_has(t, "不想联系") ||
         hf_text_has(t, "别联系") || hf_text_has(t, "不要联系"))) return 1;
    return 0;
}

static int has_declared_exit(const char *t)
{
    return (hf_text_has(t, "退出") || hf_text_has(t, "结束")) && hf_text_has(t, "关系") &&
           (hf_text_has(t, "我决定") || hf_text_has(t, "我想要") || hf_text_has(t, "我") );
}

static int has_self_exit(const char *t)
{
    if (hf_text_has(t, "我决定退出") || hf_text_has(t, "我决定结束") ||
        hf_text_has(t, "我想退出") || hf_text_has(t, "我想结束")) return 1;
    if ((hf_text_has(t, "我不想") || hf_text_has(t, "我不愿意") ||
         hf_text_has(t, "我不打算")) &&
        (hf_text_has(t, "再发展") || hf_text_has(t, "继续发展") ||
         hf_text_has(t, "再交往") || hf_text_has(t, "这段关系"))) return 1;
    return 0;
}

static void scrub_negations(const char *in, char *out, size_t n)
{
    /* 去掉「不是不想在一起」这类被否定的拒绝表达，避免假阳性 */
    static const char *NEG[] = {
        "不是不想在一起", "并非不想在一起", "没有说不想在一起", "没说不想在一起",
        "不是不喜欢你", "并非不喜欢你", "没有说不喜欢你", "没说喜欢你",
        "不会伤害", "不想伤害", "不要伤害", "不愿伤害", "避免伤害", "停止伤害",
        "不会跟踪", "不会尾随", "不担心", "并不担心", NULL
    };
    int i;
    snprintf(out, n, "%s", in);
    for (i = 0; NEG[i]; i++) {
        char *p;
        while ((p = strstr(out, NEG[i])) != NULL) {
            size_t l = strlen(NEG[i]);
            memmove(p, p + l, strlen(p + l) + 1);
        }
    }
}

typedef struct {
    int rejection, exit, pause, safety;
} Flags;

static Flags explicit_flags(const HfMsg *m)
{
    Flags f;
    char *clean;
    char scrubbed[4096];
    const char *t;

    memset(&f, 0, sizeof f);

    /* 语言/影视讨论不是真实拒绝 */
    if (hf_text_has(m->text, "这句台词") || hf_text_has(m->text, "这句话")) {
        if (hf_text_has(m->text, "翻译") || hf_text_has(m->text, "语法") ||
            hf_text_has(m->text, "意思")) return f;
    }
    if ((hf_text_has(m->text, "剧情") || hf_text_has(m->text, "电影") ||
         hf_text_has(m->text, "小说") || hf_text_has(m->text, "台词")) &&
        (hf_text_has(m->text, "翻译") || hf_text_has(m->text, "意思") ||
         hf_text_has(m->text, "语法"))) return f;

    clean = hf_trim_dup(m->text);
    {
        char *p;
        const char *QUOTES[] = { "“", "”", "‘", "’", "\"", "「", "」", "『", "』", NULL };
        int i;
        for (i = 0; QUOTES[i]; i++) {
            while ((p = strstr(clean, QUOTES[i])) != NULL)
                memmove(p, p + strlen(QUOTES[i]), strlen(p + strlen(QUOTES[i])) + 1);
        }
    }
    scrub_negations(clean, scrubbed, sizeof scrubbed);
    t = scrubbed;

    /* 关系拒绝：只在对方说话时判定 */
    if (strcmp(m->speaker, "other") == 0) {
        if (hf_text_has(t, "不喜欢你") || hf_text_has(t, "对你没有恋爱的感觉")) f.rejection = 1;
        if ((hf_text_has(t, "不想和你在一起") || hf_text_has(t, "不想跟你在一起") ||
             hf_text_has(t, "不愿意和你在一起") || hf_text_has(t, "不愿跟你在一起") ||
             hf_text_has(t, "不想谈恋爱") || hf_text_has(t, "不想发展") ||
             hf_text_has(t, "不打算发展") || hf_text_has(t, "不希望发展")) &&
            (hf_text_has(t, "和你") || hf_text_has(t, "跟你") || hf_text_has(t, "交往") ||
             hf_text_has(t, "恋爱") || hf_text_has(t, "发展"))) f.rejection = 1;
        if (hf_text_has(t, "分手") || (hf_text_has(t, "结束") && hf_text_has(t, "关系"))) f.rejection = 1;
    }

    /* 退出：明确结束关系，或「别再联系」类，但不含「先别联系」这种暂停 */
    f.exit = has_declared_exit(t) || has_self_exit(t);
    {
        char *copy = hf_trim_dup(t);
        char *clause = copy;
        while (clause && *clause) {
            char *sep = find_clause_sep(clause);
            int l = sep ? utf8_len_at(sep) : 0;
            if (sep) *sep = '\0';
            if (clause_has_no_contact(clause) && !has_contact_pause(clause)) { f.exit = 1; }
            if (!sep) break;
            clause = sep + l;
        }
        free(copy);
    }
    f.pause = has_contact_pause(t);

    /* 安全风险 */
    if (hf_text_near(t, "去", "堵你", 36) || hf_text_near(t, "到", "堵你", 36) ||
        hf_text_near(t, "在", "堵你", 36) || hf_text_near(t, "去", "堵她", 36) ||
        hf_text_has(t, "跟踪你") || hf_text_has(t, "跟踪她") || hf_text_has(t, "跟踪他") ||
        hf_text_has(t, "尾随")) f.safety = 1;
    if (hf_text_has(t, "打死") || hf_text_has(t, "杀了")) f.safety = 1;
    if ((hf_text_has(t, "威胁我") || hf_text_has(t, "打我") || hf_text_has(t, "打我")) &&
        (hf_text_has(t, "他") || hf_text_has(t, "她") || hf_text_has(t, "对方") || hf_text_has(t, "你"))) f.safety = 1;
    if ((hf_text_has(t, "会伤害我") || hf_text_has(t, "要伤害我") || hf_text_has(t, "想伤害我"))) f.safety = 1;
    if ((hf_text_has(t, "担心") || hf_text_has(t, "害怕")) &&
        (hf_text_has(t, "伤害") || hf_text_has(t, "暴力"))) f.safety = 1;
    if (hf_text_has(t, "自杀") || hf_text_has(t, "自伤") || hf_text_has(t, "伤害自己")) f.safety = 1;

    free(clean);
    return f;
}

/* ================= 主题连续性 ================= */

typedef struct {
    char t[256][24];
    int  n;
} TokSet;

static void tok_add(TokSet *s, const char *tok)
{
    int i;
    if (s->n >= 256) return;
    for (i = 0; i < s->n; i++) if (strcmp(s->t[i], tok) == 0) return;
    snprintf(s->t[s->n++], 24, "%s", tok);
}

static int utf8_len_at(const char *p)
{
    unsigned char c = (unsigned char)*p;
    if ((c & 0xE0) == 0xC0) return 2;
    if ((c & 0xF0) == 0xE0) return 3;
    if ((c & 0xF8) == 0xF0) return 4;
    return 1;
}

/* 分句不能对 UTF-8 用 strpbrk：分隔符集合里的字节会命中汉字内部的字节。
 * 必须先解码成码点再比较。 */
static unsigned utf8_cp_at(const char *p, int *len_out)
{
    unsigned char c = (unsigned char)*p;
    int len = utf8_len_at(p);
    unsigned v;
    if (len == 1) v = c;
    else if (len == 2) v = ((unsigned)(c & 0x1F) << 6) | ((unsigned char)p[1] & 0x3F);
    else if (len == 3) v = ((unsigned)(c & 0x0F) << 12) | (((unsigned char)p[1] & 0x3F) << 6) | ((unsigned char)p[2] & 0x3F);
    else v = ((unsigned)(c & 0x07) << 18) | (((unsigned char)p[1] & 0x3F) << 12) | (((unsigned char)p[2] & 0x3F) << 6) | ((unsigned char)p[3] & 0x3F);
    if (len_out) *len_out = len;
    return v;
}

static int is_clause_sep(unsigned cp)
{
    return cp == ',' || cp == '.' || cp == '!' || cp == '?' || cp == ';' || cp == '\n' ||
           cp == 0xFF0C || cp == 0x3002 || cp == 0xFF01 || cp == 0xFF1F ||
           cp == 0xFF1B || cp == 0x3001;
}

static char *find_clause_sep(char *s)
{
    while (*s) {
        int len = 1;
        unsigned cp = utf8_cp_at(s, &len);
        if (is_clause_sep(cp)) return s;
        s += len;
    }
    return NULL;
}

static int is_punct_cp(unsigned cp)
{
    if (cp < 0x80) return !(isalnum((int)cp));
    if (cp >= 0x3000 && cp <= 0x303F) return 1;   /* CJK 标点 */
    if (cp >= 0xFF00 && cp <= 0xFF65) return 1;   /* 全角标点 */
    if (cp >= 0x2000 && cp <= 0x206F) return 1;   /* 通用标点 */
    if (cp >= 0x00A0 && cp <= 0x00BF) return 1;
    return 0;
}

static void tokenize(const char *text, TokSet *out)
{
    unsigned cp[4096];
    int n = 0, i;
    const char *p = text;

    out->n = 0;
    while (*p && n < 4096) {
        unsigned char c = (unsigned char)*p;
        int len = 1;
        unsigned v;
        if ((c & 0xE0) == 0xC0) len = 2;
        else if ((c & 0xF0) == 0xE0) len = 3;
        else if ((c & 0xF8) == 0xF0) len = 4;
        if (len == 1) v = c;
        else if (len == 2) v = ((unsigned)(c & 0x1F) << 6) | ((unsigned char)p[1] & 0x3F);
        else if (len == 3) v = ((unsigned)(c & 0x0F) << 12) | (((unsigned char)p[1] & 0x3F) << 6) | ((unsigned char)p[2] & 0x3F);
        else v = ((unsigned)(c & 0x07) << 18) | (((unsigned char)p[1] & 0x3F) << 12) | (((unsigned char)p[2] & 0x3F) << 6) | ((unsigned char)p[3] & 0x3F);
        /* 去掉空白与标点：JS 版先做 replace(/[\s\p{P}\p{S}]+/)，二元组会跨过标点 */
        if (v == ' ' || v == '\t' || v == '\n' || v == '\r') { p += len; continue; }
        if (is_punct_cp(v)) { p += len; continue; }
        cp[n++] = v;
        p += len;
    }

    /* 拉丁/数字串 */
    for (i = 0; i < n; i++) {
        if (cp[i] < 0x80 && isalnum((int)cp[i])) {
            char tok[24];
            int l = 0;
            while (i < n && cp[i] < 0x80 && isalnum((int)cp[i]) && l < 23)
                tok[l++] = (char)tolower((int)cp[i++]);
            tok[l] = '\0';
            if (l >= 2) tok_add(out, tok);
            i--;
        }
    }

    /* CJK 二元组：只在连续汉字之间取 */
    for (i = 0; i + 1 < n; i++) {
        if (cp[i] >= 0x3400 && cp[i] <= 0x9FFF && cp[i + 1] >= 0x3400 && cp[i + 1] <= 0x9FFF) {
            char tok[16];
            int l1 = hf_utf8_encode(cp[i], tok);
            int l2 = hf_utf8_encode(cp[i + 1], tok + l1);
            tok[l1 + l2] = '\0';
            tok_add(out, tok);
        }
    }
}

static double jaccard(const TokSet *a, const TokSet *b)
{
    int i, j, inter = 0;
    if (!a->n || !b->n) return 0.0;
    for (i = 0; i < a->n; i++)
        for (j = 0; j < b->n; j++)
            if (strcmp(a->t[i], b->t[j]) == 0) { inter++; break; }
    return (double)inter / (double)(a->n + b->n - inter);
}

/* ================= 分析 ================= */

static void emotion_labels(const HfEmotionCount *c, char out[4][24], int *n)
{
    struct { const char *name; int count; } arr[4];
    int i, j;

    arr[0].name = "warm";       arr[0].count = c->warm;
    arr[1].name = "low_energy"; arr[1].count = c->low_energy;
    arr[2].name = "boundary";   arr[2].count = c->boundary;
    arr[3].name = "conflict";   arr[3].count = c->conflict;

    for (i = 0; i < 3; i++)
        for (j = i + 1; j < 4; j++)
            if (arr[j].count > arr[i].count) {
                const char *tn = arr[i].name; int tc = arr[i].count;
                arr[i].name = arr[j].name; arr[i].count = arr[j].count;
                arr[j].name = tn; arr[j].count = tc;
            }

    *n = 0;
    for (i = 0; i < 4; i++)
        if (arr[i].count > 0) snprintf(out[(*n)++], 24, "%s", arr[i].name);
}

static void add_ev(HfAnalysis *a, const char *id, const char *kind,
                   const char *obs, const char *source)
{
    if (a->ev_n >= HF_MAX_EVIDENCE) return;
    a->ev[a->ev_n].id = id;
    a->ev[a->ev_n].kind = kind;
    a->ev[a->ev_n].observation = obs;
    a->ev[a->ev_n].source = source;
    a->ev_n++;
}

void hf_analyze(const HfMsgs *msgs, HfAnalysis *a)
{
    HfEmotionCount ec;
    int i, with_ts = 0, starts = 0, user_starts = 0;
    long long gap_sum = 0;
    int gaps = 0;
    int other_msgs = 0, other_questions = 0;

    memset(a, 0, sizeof *a);
    memset(&ec, 0, sizeof ec);

    a->m.message_count = msgs->n;

    for (i = 0; i < msgs->n; i++) {
        const HfMsg *m = &msgs->v[i];
        Flags f;

        if (strcmp(m->speaker, "user") == 0) a->m.user_count++;
        else if (strcmp(m->speaker, "other") == 0) { a->m.other_count++; other_msgs++; }
        else a->m.unknown_count++;

        if (has_any(m->text, WARM)) ec.warm++;
        if (has_any(m->text, LOW_ENERGY)) ec.low_energy++;
        if (has_any(m->text, BOUNDARY)) ec.boundary++;
        if (has_any(m->text, CONFLICT)) ec.conflict++;

        if (has_any(m->text, BOUNDARY)) a->m.boundary_count++;
        if (has_any(m->text, CONFLICT)) a->m.conflict_count++;
        if (strcmp(m->speaker, "other") == 0 && has_question(m->text)) other_questions++;

        f = explicit_flags(m);
        if (f.rejection) a->m.rejection_count++;
        if (f.exit) a->m.exit_count++;
        if (f.pause) a->m.pause_count++;
        if (f.safety) a->m.safety_count++;

        if (m->ts_ms >= 0) with_ts++;
    }

    /* 会话开端 */
    for (i = 0; i < msgs->n; i++) {
        int is_start = 0;
        if (i == 0) is_start = 1;
        else if (msgs->v[i].ts_ms >= 0 && msgs->v[i - 1].ts_ms >= 0 &&
                 msgs->v[i].ts_ms - msgs->v[i - 1].ts_ms >= 12LL * 3600 * 1000) is_start = 1;
        if (is_start && (strcmp(msgs->v[i].speaker, "user") == 0 ||
                         strcmp(msgs->v[i].speaker, "other") == 0)) {
            starts++;
            if (strcmp(msgs->v[i].speaker, "user") == 0) user_starts++;
        }
    }
    a->m.has_user_ratio = starts > 0;
    a->m.user_ratio = starts > 0 ? (double)user_starts / (double)starts : 0.0;

    /* 回复间隔 */
    for (i = 1; i < msgs->n; i++) {
        const HfMsg *p = &msgs->v[i - 1];
        const HfMsg *c = &msgs->v[i];
        if (strcmp(p->speaker, "user") == 0 && strcmp(c->speaker, "other") == 0 &&
            p->ts_ms >= 0 && c->ts_ms >= 0 && c->ts_ms >= p->ts_ms) {
            gap_sum += c->ts_ms - p->ts_ms;
            gaps++;
        }
    }
    if (gaps) {
        a->m.has_avg_gap = 1;
        a->m.avg_gap_ms = (gap_sum + gaps / 2) / gaps;
        a->m.gap_samples = gaps;
    }

    a->m.has_other_q_ratio = other_msgs > 0;
    a->m.other_q_ratio = other_msgs > 0 ? (double)other_questions / (double)other_msgs : 0.0;

    /* 连续追问 */
    for (i = 1; i < msgs->n; i++)
        if (strcmp(msgs->v[i - 1].speaker, "user") == 0 &&
            strcmp(msgs->v[i].speaker, "user") == 0) a->m.consecutive_followups++;

    /* 主题连续性 */
    if (msgs->n < 2) {
        snprintf(a->m.topic_label, sizeof a->m.topic_label, "insufficient_data");
        a->m.has_topic_sim = 0;
    } else {
        double sum = 0;
        int pairs = 0;
        for (i = 1; i < msgs->n; i++) {
            TokSet A, B;
            tokenize(msgs->v[i - 1].text, &A);
            tokenize(msgs->v[i].text, &B);
            sum += jaccard(&A, &B);
            pairs++;
        }
        {
            double mean = pairs ? sum / pairs : 0;
            a->m.has_topic_sim = 1;
            a->m.topic_sim = mean;
            snprintf(a->m.topic_label, sizeof a->m.topic_label, "%s",
                     mean >= 0.35 ? "high" : mean >= 0.12 ? "medium" : "low");
        }
    }

    emotion_labels(&ec, a->m.emotion_labels, &a->m.emotion_label_count);
    snprintf(a->m.emotional_exchange, sizeof a->m.emotional_exchange, "%s",
             a->m.emotion_label_count ? a->m.emotion_labels[0] : "neutral");

    a->m.has_conflict_freq = msgs->n > 0;
    a->m.conflict_freq = msgs->n > 0 ? (double)a->m.conflict_count / (double)msgs->n : 0.0;

    if (!with_ts) snprintf(a->m.timestamp_coverage, sizeof a->m.timestamp_coverage, "missing");
    else if (with_ts == msgs->n) snprintf(a->m.timestamp_coverage, sizeof a->m.timestamp_coverage, "complete");
    else snprintf(a->m.timestamp_coverage, sizeof a->m.timestamp_coverage, "partial");

    snprintf(a->m.data_quality, sizeof a->m.data_quality, "%s",
             (msgs->n >= 4 && strcmp(a->m.timestamp_coverage, "complete") == 0) ? "adequate" : "limited");

    /* 证据 */
    if (msgs->n < 4)
        add_ev(a, "conversation_evidence_1", "data_quality", "消息样本较少，无法稳定判断互动模式", "message_count");
    if (strcmp(a->m.timestamp_coverage, "complete") != 0)
        add_ev(a, "conversation_evidence_2", "data_quality", "时间戳不完整，不能把回复速度当作结论", "timestamps");
    if (a->m.has_user_ratio && a->m.user_ratio >= 0.65)
        add_ev(a, "conversation_evidence_3", "investment", "可观察到的会话开端更多由用户发起", "conversation_starts");
    if (a->m.has_other_q_ratio && a->m.other_q_ratio >= 0.5)
        add_ev(a, "conversation_evidence_4", "reciprocity", "对方消息中出现较多问题句", "question_marks");
    if (a->m.boundary_count > 0)
        add_ev(a, "conversation_evidence_5", "boundary", "文本中出现需要尊重的边界表达", "lexical_flags");
    if (a->m.conflict_count > 0)
        add_ev(a, "conversation_evidence_6", "conflict", "文本中出现冲突或受伤表达", "lexical_flags");
    if (a->m.rejection_count > 0 || a->m.exit_count > 0)
        add_ev(a, "conversation_evidence_7", "boundary", "文本明确表达关系拒绝、退出或停止联系，旧推进信号不能覆盖", "explicit_statement_flags");
    if (a->m.pause_count > 0)
        add_ev(a, "conversation_evidence_8", "boundary", "文本明确要求暂时停止聊天或联系，当前不应继续推进", "explicit_statement_flags");
    if (a->m.safety_count > 0)
        add_ev(a, "conversation_evidence_9", "safety", "文本出现人身威胁或跟踪表达，应停止推进并优先处理安全", "explicit_statement_flags");
    if (a->ev_n == 0)
        add_ev(a, "conversation_evidence_0", "data_quality", "当前文本未提供足够区分性信号", "feature_extraction");
}

static double round4(double v)
{
    return (double)((long long)(v * 10000.0 + (v >= 0 ? 0.5 : -0.5))) / 10000.0;
}

static void set_ratio(JNode *m, const char *key, int has, double v)
{
    if (has) json_obj_set_num(m, key, round4(v));
    else json_obj_set(m, key, json_new_null());
}

JNode *hf_analysis_json(const HfAnalysis *a)
{
    JNode *root = json_new_obj();
    JNode *m = json_new_obj();
    JNode *sc = json_new_obj();
    JNode *labels = json_new_arr();
    JNode *tc = json_new_obj();
    JNode *ev = json_new_arr();
    JNode *lim = json_new_arr();
    JNode *priv = json_new_obj();
    int i;

    json_obj_set_num(m, "messageCount", a->m.message_count);
    json_obj_set_num(sc, "user", a->m.user_count);
    json_obj_set_num(sc, "other", a->m.other_count);
    json_obj_set_num(sc, "unknown", a->m.unknown_count);
    json_obj_set(m, "speakerCounts", sc);

    set_ratio(m, "userInitiationRatio", a->m.has_user_ratio, a->m.user_ratio);
    set_ratio(m, "otherQuestionRatio", a->m.has_other_q_ratio, a->m.other_q_ratio);

    if (a->m.has_avg_gap) json_obj_set_num(m, "averageReplyGapMs", (double)a->m.avg_gap_ms);
    else json_obj_set(m, "averageReplyGapMs", json_new_null());
    json_obj_set_num(m, "replyGapSampleCount", a->m.gap_samples);

    json_obj_set_str(m, "emotionalExchange", a->m.emotional_exchange);
    for (i = 0; i < a->m.emotion_label_count; i++)
        json_arr_push(labels, json_new_str(a->m.emotion_labels[i]));
    if (!a->m.emotion_label_count) json_arr_push(labels, json_new_str("neutral"));
    json_obj_set(m, "emotionLabels", labels);

    json_obj_set_str(tc, "label", a->m.topic_label);
    if (a->m.has_topic_sim) json_obj_set_num(tc, "meanSimilarity", round4(a->m.topic_sim));
    else json_obj_set(tc, "meanSimilarity", json_new_null());
    json_obj_set(m, "topicContinuity", tc);

    set_ratio(m, "conflictFrequency", a->m.has_conflict_freq, a->m.conflict_freq);
    json_obj_set_num(m, "consecutiveFollowups", a->m.consecutive_followups);
    json_obj_set_num(m, "boundaryMessageCount", a->m.boundary_count);
    json_obj_set_num(m, "conflictMessageCount", a->m.conflict_count);
    json_obj_set_num(m, "explicitRejectionMessageCount", a->m.rejection_count);
    json_obj_set_num(m, "explicitExitMessageCount", a->m.exit_count);
    json_obj_set_num(m, "contactPauseMessageCount", a->m.pause_count);
    json_obj_set_num(m, "safetyRiskMessageCount", a->m.safety_count);
    json_obj_set_str(m, "timestampCoverage", a->m.timestamp_coverage);
    json_obj_set_str(m, "dataQuality", a->m.data_quality);

    for (i = 0; i < a->ev_n; i++) {
        JNode *e = json_new_obj();
        json_obj_set_str(e, "id", a->ev[i].id);
        json_obj_set_str(e, "kind", a->ev[i].kind);
        json_obj_set_str(e, "observation", a->ev[i].observation);
        json_obj_set_str(e, "source", a->ev[i].source);
        json_arr_push(ev, e);
    }

    json_obj_set_bool(priv, "rawMessagesRetained", 0);
    json_obj_set_bool(priv, "anonymized", 1);

    json_arr_push(lim, json_new_str("指标描述文本和时间的可观察特征，不等同于兴趣、人格或心理状态。"));
    json_arr_push(lim, json_new_str("缺少时间戳时不计算回复间隔；样本过少时不外推长期模式。"));

    json_obj_set_num(root, "version", 1);
    json_obj_set(root, "metrics", m);
    json_obj_set(root, "evidence", ev);
    json_obj_set(root, "privacy", priv);
    json_obj_set(root, "limitations", lim);
    return root;
}

void hf_msgs_free(HfMsgs *m)
{
    int i;
    for (i = 0; i < m->n; i++) free(m->v[i].text);
    free(m->v);
    m->v = NULL;
    m->n = 0;
}
