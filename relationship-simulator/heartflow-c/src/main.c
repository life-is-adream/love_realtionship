/* main.c — 命令分发
 *
 * 为什么在 Windows 上要自己重新解析命令行：
 * MSVC/MinGW 的 argv 走 ANSI 代码页，中文参数到程序里已经是 GBK，
 * 再按 UTF-8 解释就是乱码。GetCommandLineW + 转 UTF-8 是唯一可靠路径。
 * 这个细节决定了「能不能输入中文」，也就决定了这个工具能不能用。
 */
#define _POSIX_C_SOURCE 200809L

#include "hf.h"
#include "server/httpd.h"
#include "voice/tts.h"
#include "tools/check.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#  include <windows.h>
#  include <shellapi.h>
#endif

static int    g_argc;
static char **g_argv;

#ifdef _WIN32
static void win_args(void)
{
    int n = 0, i;
    LPWSTR *w = CommandLineToArgvW(GetCommandLineW(), &n);
    if (!w || n <= 0) return;

    g_argv = (char **)hf_xmalloc(sizeof(char *) * (size_t)(n + 1));
    for (i = 0; i < n; i++) {
        int len = WideCharToMultiByte(CP_UTF8, 0, w[i], -1, NULL, 0, NULL, NULL);
        if (len <= 0) len = 1;
        g_argv[i] = (char *)hf_xmalloc((size_t)len + 1);
        WideCharToMultiByte(CP_UTF8, 0, w[i], -1, g_argv[i], len, NULL, NULL);
    }
    g_argv[n] = NULL;
    g_argc = n;
    LocalFree(w);
}
#endif

static const char *opt(int argc, char **argv, const char *key, const char *def)
{
    int i;
    for (i = 2; i + 1 < argc; i++)
        if (strcmp(argv[i], key) == 0) return argv[i + 1];
    return def;
}

static int has_flag(int argc, char **argv, const char *key)
{
    int i;
    for (i = 2; i < argc; i++)
        if (strcmp(argv[i], key) == 0) return 1;
    return 0;
}

static const char *pos_arg(int argc, char **argv, int idx)
{
    int n = 0, i;
    for (i = 2; i < argc; i++) {
        if (strncmp(argv[i], "--", 2) == 0) { i++; continue; }
        if (n == idx) return argv[i];
        n++;
    }
    return NULL;
}

static char kind_of(const char *s)
{
    if (!s || !*s) return 'e';
    if (strlen(s) == 1 && strchr("ecrtb", s[0])) return s[0];
    if (strcmp(s, "事件") == 0) return 'e';
    if (strcmp(s, "冲突") == 0) return 'c';
    if (strcmp(s, "修复") == 0) return 'r';
    if (strcmp(s, "谈话") == 0) return 't';
    return 'e';
}

static int64_t parse_date(const char *s)
{
    int y, m, d;
    struct tm tm;
    if (!s) return 0;
    if (sscanf(s, "%d-%d-%d", &y, &m, &d) != 3) return 0;
    memset(&tm, 0, sizeof tm);
    tm.tm_year = y - 1900;
    tm.tm_mon = m - 1;
    tm.tm_mday = d;
    tm.tm_hour = 12;
    tm.tm_isdst = -1;
    return (int64_t)mktime(&tm);
}

static void rule(FILE *out)
{
    fprintf(out, "────────────────────────────────────────────\n");
}

static int cmd_add(int argc, char **argv)
{
    const char *ks = pos_arg(argc, argv, 0);
    const char *text = pos_arg(argc, argv, 1);
    const char *note = opt(argc, argv, "--note", "未定");
    const char *mood = opt(argc, argv, "--mood", NULL);
    const char *date = opt(argc, argv, "--date", NULL);
    HfEntry e;
    HfAffect a;
    HfEntry *hist = NULL;
    int n, i, same = 0;
    int64_t last_ts = 0;

    if (!text) {
        fprintf(stderr, "用法：hf add <事件|冲突|修复|谈话> \"发生了什么\" [--note 忍] [--date 2026-11-01]\n");
        return 1;
    }

    memset(&e, 0, sizeof e);
    e.kind = kind_of(ks);
    e.ts = parse_date(date);
    snprintf(e.text, sizeof e.text, "%s", text);
    snprintf(e.note, sizeof e.note, "%s", note);

    hf_affect(text, &a);
    snprintf(e.mood, sizeof e.mood, "%s", mood ? mood : (a.primary[0] ? a.primary : "未定"));
    {
        const char *is = opt(argc, argv, "--intensity", NULL);
        e.intensity = is ? atoi(is) : (a.intensity > 0 ? a.intensity : 30);
    }
    hf_keywords(text, e.topics, sizeof e.topics);

    if (hf_store_append(&e) != 0) {
        fprintf(stderr, "hf: 写入失败。\n");
        return 1;
    }

    {
        char tbuf[32];
        hf_strftime(e.ts, "%m-%d %H:%M", tbuf, sizeof tbuf);
        printf("\n已记 #%lld  %s  %s  强度 %d\n", (long long)e.id, tbuf,
               e.kind == 'c' ? "冲突" : e.kind == 'r' ? "修复" :
               e.kind == 't' ? "谈话" : "事件", e.intensity);
        if (a.hits == 0)
            printf("（没识别到情绪词，强度按 %d 记；可用 --intensity 覆盖）\n", e.intensity);
        printf("主题：%s\n", e.topics[0] ? e.topics : "（无）");
        if (e.note[0] && strcmp(e.note, "未定") != 0)
            printf("处置：%s\n", e.note);
    }

    /* 同主题的历史，只给一句，不展开 */
    n = hf_store_load(&hist);
    for (i = 0; i < n; i++) {
        char shared[64];
        if (hist[i].id == e.id) continue;
        if (!hf_topic_overlap(e.topics, hist[i].topics, shared, sizeof shared)) continue;
        same++;
        if (hist[i].ts > last_ts) last_ts = hist[i].ts;
    }
    if (same >= 2) {
        char top[64];
        hf_top_topic(e.topics, top, sizeof top);
        printf("\n  这是第 %d 次记到「%s」。想看清它，跑 hf memory。\n", same + 1, top);
    }
    free(hist);
    return 0;
}

static int cmd_reflect(int argc, char **argv)
{
    const char *text = pos_arg(argc, argv, 0);
    HfAffect a;
    HfBias b;
    char topics[HF_TOPICS_BUF];
    HfEntry *hist = NULL;
    int n;
    char head[120];

    if (!text) {
        fprintf(stderr, "用法：hf reflect \"你现在的想法，怎么说都行\"\n");
        return 1;
    }

    hf_affect(text, &a);
    hf_keywords(text, topics, sizeof topics);
    hf_bias(text, &b);
    n = hf_store_load(&hist);

    rule(stdout);
    hf_utf8_cut(text, 60, head, sizeof head);
    printf("  %s%s\n", head, hf_utf8_count(text) > 60 ? "…" : "");
    rule(stdout);

    hf_mirror(text, &a, stdout);
    hf_neutral(text, &b, stdout);
    hf_memory(text, topics, hist, n, stdout);

    rule(stdout);
    printf("主题：%s\n", topics[0] ? topics : "（无）");
    printf("以上三条都不是结论。它们的用途是让你少绕一圈。\n");
    printf("想把这次也存下来：hf add 冲突 \"%s\" --note 未定\n", head[0] ? head : "...");

    free(hist);
    return 0;
}

static int cmd_log(int argc, char **argv)
{
    int days = atoi(opt(argc, argv, "--days", "30"));
    int kindf = 0;
    const char *k = opt(argc, argv, "--kind", NULL);
    HfEntry *hist = NULL;
    int n, i, shown = 0;
    int64_t cutoff = hf_now() - (int64_t)days * 86400;

    if (k) kindf = kind_of(k);
    n = hf_store_load(&hist);

    printf("\n【最近 %d 天】\n\n", days);
    for (i = n - 1; i >= 0; i--) {
        char tbuf[32], body[200];
        if (hist[i].ts < cutoff) continue;
        if (kindf && hist[i].kind != kindf) continue;
        hf_strftime(hist[i].ts, "%m-%d %H:%M", tbuf, sizeof tbuf);
        hf_utf8_cut(hist[i].text, 34, body, sizeof body);
        printf("  #%-3lld %s  %-2s %3d  %s\n",
               (long long)hist[i].id, tbuf,
               hist[i].kind == 'c' ? "冲" : hist[i].kind == 'r' ? "修" :
               hist[i].kind == 't' ? "谈" : hist[i].kind == 'b' ? "刹" : "事",
               hist[i].intensity, body);
        if (hist[i].note[0] && strcmp(hist[i].note, "未定") != 0)
            printf("        └ 处置：%s   主题：%s\n", hist[i].note,
                   hist[i].topics[0] ? hist[i].topics : "-");
        shown++;
    }
    if (!shown) printf("  （没有记录）\n");
    printf("\n共 %d 条。\n", shown);
    free(hist);
    return 0;
}

typedef struct { char name[32]; int cnt; int sum; } TopicRow;
#define TROW 64

static int cmd_memory(int argc, char **argv)
{
    int days = atoi(opt(argc, argv, "--days", "90"));
    HfEntry *hist = NULL;
    TopicRow rows[TROW];
    int nr = 0, n, i, r;
    int64_t cutoff = hf_now() - (int64_t)days * 86400;

    n = hf_store_load(&hist);
    memset(rows, 0, sizeof rows);

    for (i = 0; i < n; i++) {
        char buf[HF_TOPICS_BUF], *p;
        if (hist[i].ts < cutoff) continue;
        snprintf(buf, sizeof buf, "%s", hist[i].topics);
        p = strtok(buf, ",");
        while (p) {
            for (r = 0; r < nr; r++)
                if (strcmp(rows[r].name, p) == 0) break;
            if (r == nr && nr < TROW) {
                snprintf(rows[nr].name, sizeof rows[nr].name, "%s", p);
                nr++;
            }
            if (r < TROW) { rows[r].cnt++; rows[r].sum += hist[i].intensity; }
            p = strtok(NULL, ",");
        }
    }

    printf("\n【主题排行 · 最近 %d 天】\n\n", days);
    if (nr == 0) {
        printf("  还没有记录。\n");
    } else {
        for (i = 0; i < nr - 1; i++) {
            for (r = i + 1; r < nr; r++) {
                if (rows[r].cnt > rows[i].cnt) {
                    TopicRow t = rows[i];
                    rows[i] = rows[r];
                    rows[r] = t;
                }
            }
        }
        for (i = 0; i < nr && i < 12; i++) {
            char pad[80];
            hf_pad(rows[i].name, 20, pad, sizeof pad);
            printf("  %s %2d 次   平均强度 %d\n", pad, rows[i].cnt,
                   rows[i].cnt ? rows[i].sum / rows[i].cnt : 0);
        }
        printf("\n  出现 3 次以上、且平均强度 ≥60 的主题，值得单独看一眼。\n");
    }
    free(hist);
    return 0;
}

static int cmd_export(int argc, char **argv)
{
    HfEntry *hist = NULL;
    int n, i;
    (void)argc; (void)argv;
    n = hf_store_load(&hist);
    printf("# hf export v1  records=%d\n", n);
    printf("id\tts\tkind\tmood\tintensity\ttopics\tnote\ttext\n");
    for (i = 0; i < n; i++) {
        printf("%lld\t%lld\t%c\t%s\t%d\t%s\t%s\t%s\n",
               (long long)hist[i].id, (long long)hist[i].ts, hist[i].kind,
               hist[i].mood, hist[i].intensity, hist[i].topics,
               hist[i].note, hist[i].text);
    }
    free(hist);
    return 0;
}

static int cmd_purge(int argc, char **argv)
{
    char path[1024];
    if (!has_flag(argc, argv, "--yes")) {
        fprintf(stderr, "这会删除全部本地记录，不可恢复。\n");
        fprintf(stderr, "确认：hf purge --yes\n");
        return 1;
    }
    hf_data_path("journal.log", path, sizeof path);
    remove(path);
    hf_data_path("brake.log", path, sizeof path);
    remove(path);
    printf("已清空。数据目录：%s\n", hf_home());
    return 0;
}

void hf_print_usage(FILE *out)
{
    fprintf(out, "\n");
    fprintf(out, "  hf %s — 关系档案引擎\n", HF_VERSION);
    fprintf(out, "  本地优先 · 单文件存储 · 无云端 · 无账号\n");
    fprintf(out, "\n");
    fprintf(out, "  hf reflect \"你现在的想法\"      把感受说清楚（不写入）\n");
    fprintf(out, "  hf add <类型> \"发生了什么\"     记一条（事件/冲突/修复/谈话）\n");
    fprintf(out, "        --note 忍|问|说清|逃|道歉\n");
    fprintf(out, "        --date 2026-11-01\n");
    fprintf(out, "  hf log [--days 30]             看最近记录\n");
    fprintf(out, "  hf memory [--days 90]          主题排行：你在为什么反复难受\n");
    fprintf(out, "  hf brake add \"想发的话\"        扣下一条消息，按强度自动冷静\n");
    fprintf(out, "  hf brake list                  看待发队列\n");
    fprintf(out, "  hf brake send <id> --yes       到点后放行\n");
    fprintf(out, "  hf brake drop <id>             撤回\n");
    fprintf(out, "  hf trace [--weeks 12]          看得见自己变了没有\n");
    fprintf(out, "  hf export                      导出全部记录（TSV）\n");
    fprintf(out, "  hf purge --yes                 删除全部本地数据\n");
    fprintf(out, "  hf demo                        用一段 12 周的故事跑一遍全部能力\n");
    fprintf(out, "  hf serve [--port 3000] [--root ..]  启动本地服务（静态站 + 7 个 API）\n");
    fprintf(out, "  hf tts normalize|split|wav|selftest  TTS 文本/音频层（供对照测试）\n");
    fprintf(out, "  hf check circular [入口...]          循环依赖检查（替代 JS 门禁脚本）\n");
    fprintf(out, "\n");
    fprintf(out, "  数据目录：%s\n", hf_home());
    fprintf(out, "\n");
}

int main(int argc, char **argv)
{
    const char *cmd;

#ifdef _WIN32
    SetConsoleOutputCP(CP_UTF8);
    win_args();
    argc = g_argc > 0 ? g_argc : argc;
    argv = g_argv ? g_argv : argv;
#endif

    if (argc < 2) {
        hf_print_usage(stdout);
        printf("  第一次用，先跑：hf demo\n\n");
        return 0;
    }

    cmd = argv[1];

    if (strcmp(cmd, "help") == 0 || strcmp(cmd, "--help") == 0 || strcmp(cmd, "-h") == 0) {
        hf_print_usage(stdout);
        return 0;
    }
    if (strcmp(cmd, "version") == 0 || strcmp(cmd, "--version") == 0) {
        printf("hf %s\n", HF_VERSION);
        return 0;
    }
    if (strcmp(cmd, "demo") == 0) return hf_cmd_demo();
    if (strcmp(cmd, "serve") == 0) return hf_server_main(argc, argv);
    if (strcmp(cmd, "tts") == 0) return hf_cmd_tts(argc, argv);
    if (strcmp(cmd, "check") == 0) return hf_cmd_check(argc, argv);
    if (strcmp(cmd, "add") == 0) return cmd_add(argc, argv);
    if (strcmp(cmd, "reflect") == 0) return cmd_reflect(argc, argv);
    if (strcmp(cmd, "log") == 0) return cmd_log(argc, argv);
    if (strcmp(cmd, "memory") == 0) return cmd_memory(argc, argv);
    if (strcmp(cmd, "export") == 0) return cmd_export(argc, argv);
    if (strcmp(cmd, "purge") == 0) return cmd_purge(argc, argv);
    if (strcmp(cmd, "trace") == 0) {
        HfEntry *hist = NULL;
        int n, weeks = atoi(opt(argc, argv, "--weeks", "12"));
        n = hf_store_load(&hist);
        hf_trace(weeks, hist, n, stdout);
        free(hist);
        return 0;
    }
    if (strcmp(cmd, "brake") == 0) {
        const char *sub = argc > 2 ? argv[2] : NULL;
        if (!sub) { fprintf(stderr, "用法：hf brake add|list|send|drop\n"); return 1; }
        if (strcmp(sub, "add") == 0) {
            const char *t = opt(argc, argv, "--text", NULL);
            if (!t) t = argc > 3 && strncmp(argv[3], "--", 2) != 0 ? argv[3] : NULL;
            if (!t) { fprintf(stderr, "用法：hf brake add \"想发的话\"\n"); return 1; }
            return hf_brake_add(t, atoi(opt(argc, argv, "--intensity", "0")));
        }
        if (strcmp(sub, "list") == 0) return hf_brake_list(stdout);
        if (strcmp(sub, "send") == 0) {
            int64_t id = argc > 3 ? (int64_t)strtoll(argv[3], NULL, 10) : 0;
            if (id <= 0) { fprintf(stderr, "用法：hf brake send <id>\n"); return 1; }
            return hf_brake_send(id, has_flag(argc, argv, "--yes"), stdout);
        }
        if (strcmp(sub, "drop") == 0) {
            int64_t id = argc > 3 ? (int64_t)strtoll(argv[3], NULL, 10) : 0;
            if (id <= 0) { fprintf(stderr, "用法：hf brake drop <id>\n"); return 1; }
            return hf_brake_drop(id, stdout);
        }
        fprintf(stderr, "未知子命令：%s\n", sub);
        return 1;
    }

    fprintf(stderr, "未知命令：%s\n跑 hf help 看用法。\n", cmd);
    return 1;
}
