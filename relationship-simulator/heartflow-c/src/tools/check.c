/* check.c — 循环依赖检测（等价替代 scripts/check-circular.mjs）
 *
 * 为什么值得 C 化：这是 npm test 的门禁之一，且只依赖「读文件 + 提 import + DFS」，
 * 没有 JS 运行时语义。C 化后质量检查不必先装 Node。
 * 评测/浏览器自动化脚本不同——它们刻意 import 生产 JS 模块，C 化会失去评测意义，保留。
 *
 * 与 JS 版的对齐口径：
 *   - 先删块注释与「整行 //」注释（行尾 // 保留，但取第一个引号不受影响）
 *   - 每行以 import/export 开头（允许前导空白），或任意位置的 import(
 *   - 只解析以 "." 开头的相对 specifier；候选 base / base.js / base/index.js
 *   - 三色 DFS 判环
 */
#define _POSIX_C_SOURCE 200809L

#include "check.h"
#include "../server/config.h"   /* hf_fopen_utf8：项目路径含中文 */
#include "../json.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#  include <windows.h>
/* _getcwd 走 ANSI 代码页，项目路径含中文时会变成 GBK，
 * 再交给 hf_fopen_utf8（UTF-8→UTF-16）必然找不到文件。必须走宽字符 API。 */
static int hf_getcwd_utf8(char *out, int n)
{
    wchar_t w[1024];
    DWORD len = GetCurrentDirectoryW(1024, w);
    if (!len || len >= 1024) return 0;
    return WideCharToMultiByte(CP_UTF8, 0, w, -1, out, n, NULL, NULL) > 0 ? 1 : 0;
}
#  define HF_GETCWD hf_getcwd_utf8
#else
#  include <unistd.h>
#  define HF_GETCWD getcwd
#endif

typedef struct {
    char *path;
    int  *deps;
    int   ndeps, cap;
    int   color;          /* 0=白 1=灰 2=黑 */
    int   visited;
} Mod;

static Mod  *g_mods;
static int   g_n, g_cap;
static char  g_root[1200];
static int   g_errors;

/* ---------- 路径 ---------- */

static void slash(char *s)
{
    char *p;
    for (p = s; *p; p++) if (*p == '\\') *p = '/';
}

static void normalize(char *s)
{
    char seg[64][256];
    char prefix[8] = "";
    size_t start = 0;
    int n = 0, i;
    char *p, *q;

    slash(s);
    /* 前缀（"/" 或 "E:/"）单独保留，不能当普通段参与 .. 回退 */
    if (s[0] == '/') { snprintf(prefix, sizeof prefix, "/"); start = 1; }
    else if (s[0] && s[1] == ':') {
        prefix[0] = s[0]; prefix[1] = ':'; prefix[2] = '/'; prefix[3] = '\0';
        start = (s[2] == '/') ? 3 : 2;
    }
    p = s + start;
    while (*p) {
        while (*p == '/') p++;
        if (!*p) break;
        q = p;
        while (*p && *p != '/') p++;
        {
            size_t len = (size_t)(p - q);
            if (len >= sizeof seg[0]) len = sizeof seg[0] - 1;
            memcpy(seg[n], q, len);
            seg[n][len] = '\0';
        }
        if (strcmp(seg[n], ".") == 0) { /* 丢弃 */ }
        else if (strcmp(seg[n], "..") == 0) {
            if (n > 0 && strcmp(seg[n - 1], "..") != 0) n--;
            else if (n < 64) n++;   /* seg[n] 已是 ".." */
        } else if (n < 64) n++;
        else break;
    }
    q = s;
    for (i = 0; prefix[i]; i++) *q++ = prefix[i];
    for (i = 0; i < n; i++) {
        size_t l = strlen(seg[i]);
        if (i && q > s && q[-1] != '/') *q++ = '/';
        memcpy(q, seg[i], l); q += l;
    }
    *q = '\0';
}

static int file_exists(const char *path)
{
    FILE *f = hf_fopen_utf8(path, "rb");
    if (!f) return 0;
    fclose(f);
    return 1;
}

static char *xstrdup(const char *s)
{
    size_t n = strlen(s) + 1;
    char *p = (char *)malloc(n);
    if (p) memcpy(p, s, n);
    return p;
}

/* ---------- 模块表 ---------- */

static int intern(const char *path)
{
    int i;
    for (i = 0; i < g_n; i++) if (strcmp(g_mods[i].path, path) == 0) return i;
    if (g_n >= g_cap) {
        int nc = g_cap ? g_cap * 2 : 256;
        Mod *nm = (Mod *)realloc(g_mods, sizeof(Mod) * (size_t)nc);
        if (!nm) return -1;
        g_mods = nm; g_cap = nc;
    }
    memset(&g_mods[g_n], 0, sizeof g_mods[g_n]);
    g_mods[g_n].path = xstrdup(path);
    return g_n++;
}

static void add_dep(int from, int to)
{
    Mod *m = &g_mods[from];
    if (m->ndeps >= m->cap) {
        int nc = m->cap ? m->cap * 2 : 8;
        int *nv = (int *)realloc(m->deps, sizeof(int) * (size_t)nc);
        if (!nv) return;
        m->deps = nv; m->cap = nc;
    }
    m->deps[m->ndeps++] = to;
}

/* ---------- 源码扫描 ---------- */

static char *strip_comments(const char *src, size_t len)
{
    char *out = (char *)malloc(len + 2);
    size_t i = 0;
    size_t o = 0;
    int at_line_start = 1;
    if (!out) return NULL;
    while (i < len) {
        if (i + 1 < len && src[i] == '/' && src[i + 1] == '*') {
            i += 2;
            while (i + 1 < len && !(src[i] == '*' && src[i + 1] == '/')) {
                if (src[i] == '\n') { out[o++] = '\n'; at_line_start = 1; }
                i++;
            }
            if (i + 1 < len) i += 2;
            continue;
        }
        if (at_line_start && i + 1 < len && src[i] == '/' && src[i + 1] == '/') {
            while (i < len && src[i] != '\n') i++;
            continue;
        }
        if (at_line_start && (src[i] == ' ' || src[i] == '\t' || src[i] == '\r')) {
            out[o++] = src[i++]; continue;
        }
        at_line_start = (src[i] == '\n');
        out[o++] = src[i++];
    }
    out[o] = '\0';
    return out;
}

/* 对齐 JS 正则：
 *   ^\s*(?:import|export)\s+(?:[^'";]*?\s+from\s*)?(['"])([^'"\r\n]+)\1
 *   | \bimport\s*\(\s*(['"])([^'"\r\n]+)\1
 * export 分支只有在关键字与引号之间出现 from 才算依赖，
 * 否则 `export function f(){ q(".x") }` 会把选择器当成模块路径。
 * [^'";] 含换行，所以多行 `import {\n ...\n} from "./x.js"` 要跨行续读。
 */

typedef struct { char **v; int n, cap; } Specs;

static void add_spec(Specs *s, const char *a, const char *b)
{
    size_t l = (size_t)(b - a);
    char *p;
    if (l == 0 || l > 1024) return;
    p = (char *)malloc(l + 1);
    if (!p) return;
    memcpy(p, a, l); p[l] = '\0';
    if (s->n >= s->cap) {
        int nc = s->cap ? s->cap * 2 : 32;
        char **nv = (char **)realloc(s->v, sizeof(char *) * (size_t)nc);
        if (!nv) { free(p); return; }
        s->v = nv; s->cap = nc;
    }
    s->v[s->n++] = p;
}

/* 返回 1=找到引号 0=遇到分号提前结束 -1=到行尾没引号（需跨行续读） */
static int find_quote(const char *s, const char *e, const char **qs, const char **qe)
{
    for (; s < e; s++) {
        if (*s == ';') return 0;
        if (*s == '\'' || *s == '"') {
            char quote = *s;
            const char *t = s + 1;
            while (t < e && *t != quote && *t != '\r' && *t != '\n') t++;
            if (t < e && *t == quote) { *qs = s + 1; *qe = t; return 1; }
            return 0;
        }
    }
    return -1;
}

static int has_word(const char *s, const char *e, const char *w)
{
    size_t l = strlen(w);
    for (; (size_t)(e - s) >= l; s++) {
        if (strncmp(s, w, l) == 0 &&
            (s == e - (long)l || !((s[l] >= 'a' && s[l] <= 'z') || (s[l] >= 'A' && s[l] <= 'Z'))))
            return 1;
    }
    return 0;
}

static char **extract_imports(const char *text, int *count)
{
    Specs s = { NULL, 0, 0 };
    const char *p = text;
    int pending = 0;   /* 1=多行 import，2=多行 export */

    while (*p) {
        const char *ls = p, *le, *q, *kw, *qs, *qe;
        int rc, is_export = 0;
        while (*p && *p != '\n') p++;
        le = p;
        if (*p == '\n') p++;
        q = ls;
        while (q < le && (*q == ' ' || *q == '\t' || *q == '\r')) q++;

        if (pending) {
            is_export = (pending == 2);
            rc = find_quote(q, le, &qs, &qe);
            if (rc == 1) {
                if (!is_export || has_word(q, qs, "from")) add_spec(&s, qs, qe);
                pending = 0;
            } else if (rc == 0) pending = 0;
            continue;
        }

        kw = NULL;
        if ((size_t)(le - q) >= 6 && strncmp(q, "import", 6) == 0) kw = q + 6;
        else if ((size_t)(le - q) >= 6 && strncmp(q, "export", 6) == 0) { kw = q + 6; is_export = 1; }

        if (kw && kw < le && (*kw == ' ' || *kw == '\t')) {
            const char *first = kw;
            while (first < le && (*first == ' ' || *first == '\t')) first++;
            rc = find_quote(kw, le, &qs, &qe);
            if (rc == 1) {
                if (!is_export || has_word(kw, qs, "from")) add_spec(&s, qs, qe);
            } else if (rc == -1 && first < le && *first == '{') {
                /* 只有 `import {` / `export {` 才是跨行语句。
                 * `export function f() {` 不是 re-export，下一行的 import(...) 要独立扫描。 */
                pending = is_export ? 2 : 1;
            }
            continue;
        }
        if (kw && kw < le && *kw == '(') {          /* import("x") 在行首 */
            rc = find_quote(kw + 1, le, &qs, &qe);
            if (rc == 1) add_spec(&s, qs, qe);
            continue;
        }
        /* 任意位置的动态 import( */
        for (q = ls; q + 7 < le; q++) {
            if (strncmp(q, "import", 6) == 0) {
                const char *r = q + 6;
                while (r < le && (*r == ' ' || *r == '\t')) r++;
                if (r < le && *r == '(') {
                    rc = find_quote(r + 1, le, &qs, &qe);
                    if (rc == 1) add_spec(&s, qs, qe);
                    break;
                }
            }
        }
    }
    *count = s.n;
    return s.v;
}

/* ---------- 解析与建图 ---------- */

static void resolve_import(const char *from, const char *spec, char *out, size_t n)
{
    char joined[1400], dir[1200];
    const char *slashp;
    size_t slen, i;

    out[0] = '\0';
    if (!spec || spec[0] != '.') return;
    slen = strcspn(spec, "?#");
    if (slen >= sizeof joined) return;

    slashp = strrchr(from, '/');
    if (slashp) {
        size_t dl = (size_t)(slashp - from);
        if (dl >= sizeof dir) return;
        memcpy(dir, from, dl); dir[dl] = '\0';
    } else snprintf(dir, sizeof dir, "%s", ".");

    snprintf(joined, sizeof joined, "%s/%.*s", dir, (int)slen, spec);
    normalize(joined);

    {
        static const char *suffix[] = { "", ".js", "/index.js", NULL };
        for (i = 0; suffix[i]; i++) {
            char cand[1500];
            snprintf(cand, sizeof cand, "%s%s", joined, suffix[i]);
            if (file_exists(cand)) { snprintf(out, n, "%s", cand); return; }
        }
    }
    snprintf(out, n, "%s.js", joined);
}

static void walk(const char *path)
{
    int me;
    char full[1400];
    FILE *f;
    long size;
    char *src, *clean;
    char **specs;
    int nspec = 0, i;

    if (path[0] && path[1] == ':') snprintf(full, sizeof full, "%s", path);
    else if (path[0] == '/') snprintf(full, sizeof full, "%s", path);
    else snprintf(full, sizeof full, "%s/%s", g_root, path);
    normalize(full);

    me = intern(full);
    if (me < 0 || g_mods[me].visited) return;
    g_mods[me].visited = 1;

    f = hf_fopen_utf8(full, "rb");
    if (!f) {
        fprintf(stderr, "[error] %s: read failed\n", full);
        g_errors++;
        return;
    }
    fseek(f, 0, SEEK_END); size = ftell(f); rewind(f);
    if (size < 0) size = 0;
    src = (char *)malloc((size_t)size + 1);
    if (!src) { fclose(f); return; }
    if (size > 0 && fread(src, 1, (size_t)size, f) != (size_t)size) src[0] = '\0';
    src[size] = '\0';
    fclose(f);

    clean = strip_comments(src, (size_t)size);
    free(src);
    if (!clean) return;
    specs = extract_imports(clean, &nspec);
    free(clean);

    for (i = 0; i < nspec; i++) {
        char dep[1400];
        int di;
        resolve_import(full, specs[i], dep, sizeof dep);
        free(specs[i]);
        if (!dep[0]) continue;
        di = intern(dep);
        if (di >= 0) {
            add_dep(me, di);
            walk(dep);
        }
    }
    free(specs);
}

/* ---------- DFS ---------- */

static int g_stack[4096], g_top;
static int g_cycles;

static const char *rel(const char *p)
{
    size_t l = strlen(g_root);
    if (strncmp(p, g_root, l) == 0 && p[l] == '/') return p + l + 1;
    return p;
}

static void dfs(int node)
{
    int i;
    g_mods[node].color = 1;
    if (g_top < 4096) g_stack[g_top++] = node;
    for (i = 0; i < g_mods[node].ndeps; i++) {
        int nx = g_mods[node].deps[i];
        if (g_mods[nx].color == 1) {
            int k = 0;
            if (g_cycles == 0) fprintf(stderr, "circular: 发现循环依赖 ❌\n");
            g_cycles++;
            while (k < g_top && g_stack[k] != nx) k++;
            fprintf(stderr, "  环: ");
            for (; k < g_top; k++) fprintf(stderr, "%s -> ", rel(g_mods[g_stack[k]].path));
            fprintf(stderr, "%s\n", rel(g_mods[nx].path));
        } else if (g_mods[nx].color == 0) {
            dfs(nx);
        }
    }
    if (g_top > 0) g_top--;
    g_mods[node].color = 2;
}

static void free_all(void)
{
    int i;
    for (i = 0; i < g_n; i++) { free(g_mods[i].path); free(g_mods[i].deps); }
    free(g_mods);
    g_mods = NULL; g_n = g_cap = 0;
}

int hf_cmd_check(int argc, char **argv)
{
    const char *sub = argc > 2 ? argv[2] : "circular";
    int i, rc = 0, list = 0, nentry = 0;

    if (strcmp(sub, "circular") != 0) {
        fprintf(stderr, "用法：hf check circular [入口1 入口2 ...] [--list]\n");
        return 1;
    }
    for (i = 3; i < argc; i++) {
        if (strcmp(argv[i], "--list") == 0) list = 1;
        else nentry++;
    }
    if (!HF_GETCWD(g_root, sizeof g_root)) snprintf(g_root, sizeof g_root, "%s", ".");
    slash(g_root);
    g_errors = 0; g_cycles = 0; g_top = 0;

    if (nentry > 0) {
        for (i = 3; i < argc; i++) {
            if (strcmp(argv[i], "--list") == 0) continue;
            if (!file_exists(argv[i])) {
                fprintf(stderr, "[error] 入口不存在: %s\n", argv[i]);
                g_errors++;
            } else walk(argv[i]);
        }
    } else {
        const char *defaults[] = { "public/app.js", "server/index.js", NULL };
        for (i = 0; defaults[i]; i++) {
            char p[1400];
            snprintf(p, sizeof p, "%s/%s", g_root, defaults[i]);
            if (file_exists(p)) walk(p);
            else { fprintf(stderr, "[error] 入口不存在: %s\n", p); g_errors++; }
        }
    }

    printf("扫描模块数: %d\n", g_n);
    if (list) {
        for (i = 0; i < g_n; i++) printf("%s\n", rel(g_mods[i].path));
        free_all();
        return 0;
    }
    if (g_errors) { free_all(); return 2; }
    for (i = 0; i < g_n; i++) if (g_mods[i].color == 0) dfs(i);
    if (g_cycles == 0) { printf("circular: 0 ✅ 无循环依赖\n"); rc = 0; }
    else rc = 1;
    free_all();
    return rc;
}
