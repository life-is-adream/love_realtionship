#define _POSIX_C_SOURCE 200809L

#include "config.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#  include <direct.h>
#  include <windows.h>
#  define HF_GETCWD _getcwd
#else
#  include <unistd.h>
#  define HF_GETCWD getcwd
#endif

FILE *hf_fopen_utf8(const char *path, const char *mode)
{
#ifdef _WIN32
    wchar_t wpath[1024], wmode[16];
    if (MultiByteToWideChar(CP_UTF8, 0, path, -1, wpath, 1024) <= 0) return NULL;
    if (MultiByteToWideChar(CP_UTF8, 0, mode, -1, wmode, 16) <= 0) return NULL;
    return _wfopen(wpath, wmode);
#else
    return fopen(path, mode);
#endif
}

HfConfig g_cfg;

static void set_defaults(void)
{
    memset(&g_cfg, 0, sizeof g_cfg);
    g_cfg.port = 3000;
    snprintf(g_cfg.bind_host, sizeof g_cfg.bind_host, "%s", "127.0.0.1");
    snprintf(g_cfg.llm_endpoint, sizeof g_cfg.llm_endpoint, "%s", "https://api.openai.com/v1/responses");
    snprintf(g_cfg.llm_model, sizeof g_cfg.llm_model, "%s", "mimo-v2.5-pro");
    snprintf(g_cfg.llm_api_mode, sizeof g_cfg.llm_api_mode, "%s", "chat_completions");
    g_cfg.llm_max_tokens = 2048;
    g_cfg.llm_temperature = 1.0;
    g_cfg.llm_top_p = 0.95;
    snprintf(g_cfg.llm_reasoning_effort, sizeof g_cfg.llm_reasoning_effort, "%s", "medium");
    snprintf(g_cfg.search_model, sizeof g_cfg.search_model, "%s", "mimo-v2.6-flash");
    snprintf(g_cfg.search_domains, sizeof g_cfg.search_domains, "%s",
             "edu.cn,gov.cn,who.int,apa.org,psychologytoday.com,healthychildren.org,nhs.uk");
    snprintf(g_cfg.tts_base, sizeof g_cfg.tts_base, "%s", "http://127.0.0.1:5001");
    g_cfg.tts_timeout_ms = 150000;
}

static char *trim(char *s)
{
    char *e;
    while (*s && isspace((unsigned char)*s)) s++;
    e = s + strlen(s);
    while (e > s && isspace((unsigned char)e[-1])) *--e = '\0';
    return s;
}

static void copy_env(char *dst, size_t n, const char *v)
{
    snprintf(dst, n, "%s", v);
}

static void apply_kv(const char *key, const char *val)
{
    if (strcmp(key, "PORT") == 0) g_cfg.port = atoi(val);
    else if (strcmp(key, "HF_BIND_HOST") == 0 || strcmp(key, "BIND_HOST") == 0) copy_env(g_cfg.bind_host, sizeof g_cfg.bind_host, val);
    else if (strcmp(key, "LLM_ENDPOINT") == 0) copy_env(g_cfg.llm_endpoint, sizeof g_cfg.llm_endpoint, val);
    else if (strcmp(key, "LLM_MODEL") == 0) copy_env(g_cfg.llm_model, sizeof g_cfg.llm_model, val);
    else if (strcmp(key, "VISION_MODEL") == 0) copy_env(g_cfg.vision_model, sizeof g_cfg.vision_model, val);
    else if (strcmp(key, "LLM_API_MODE") == 0) copy_env(g_cfg.llm_api_mode, sizeof g_cfg.llm_api_mode, val);
    else if (strcmp(key, "LLM_API_KEY") == 0) copy_env(g_cfg.llm_api_key, sizeof g_cfg.llm_api_key, val);
    else if (strcmp(key, "LLM_MAX_OUTPUT_TOKENS") == 0 || strcmp(key, "LLM_MAX_COMPLETION_TOKENS") == 0)
        g_cfg.llm_max_tokens = atoi(val);
    else if (strcmp(key, "LLM_TEMPERATURE") == 0) g_cfg.llm_temperature = atof(val);
    else if (strcmp(key, "LLM_TOP_P") == 0) g_cfg.llm_top_p = atof(val);
    else if (strcmp(key, "LLM_REASONING_EFFORT") == 0) copy_env(g_cfg.llm_reasoning_effort, sizeof g_cfg.llm_reasoning_effort, val);
    else if (strcmp(key, "SEARCH_ENDPOINT") == 0) copy_env(g_cfg.search_endpoint, sizeof g_cfg.search_endpoint, val);
    else if (strcmp(key, "SEARCH_API_KEY") == 0) copy_env(g_cfg.search_api_key, sizeof g_cfg.search_api_key, val);
    else if (strcmp(key, "SEARCH_MODEL") == 0) copy_env(g_cfg.search_model, sizeof g_cfg.search_model, val);
    else if (strcmp(key, "SEARCH_ALLOWED_DOMAINS") == 0) copy_env(g_cfg.search_domains, sizeof g_cfg.search_domains, val);
    else if (strcmp(key, "TTS_SERVICE_URL") == 0) copy_env(g_cfg.tts_base, sizeof g_cfg.tts_base, val);
    else if (strcmp(key, "TTS_TIMEOUT_MS") == 0) g_cfg.tts_timeout_ms = atoi(val);
}

static void apply_env_overrides(void)
{
    static const char *KEYS[] = {
        "PORT", "HF_BIND_HOST", "BIND_HOST", "LLM_ENDPOINT", "LLM_MODEL", "VISION_MODEL", "LLM_API_MODE", "LLM_API_KEY",
        "LLM_MAX_OUTPUT_TOKENS", "LLM_MAX_COMPLETION_TOKENS", "LLM_TEMPERATURE",
        "LLM_TOP_P", "LLM_REASONING_EFFORT", "SEARCH_ENDPOINT", "SEARCH_API_KEY",
        "SEARCH_MODEL", "SEARCH_ALLOWED_DOMAINS", "TTS_SERVICE_URL", "TTS_TIMEOUT_MS",
        NULL
    };
    int i;
    for (i = 0; KEYS[i]; i++) {
        const char *v = getenv(KEYS[i]);
        if (v && *v) apply_kv(KEYS[i], v);
    }
}

static void load_env_file(const char *path)
{
    FILE *f = hf_fopen_utf8(path, "rb");
    char line[2048];

    if (!f) return;
    while (fgets(line, sizeof line, f)) {
        char *s = trim(line);
        char *eq;
        char *key, *val;

        if (!*s || *s == '#') continue;
        eq = strchr(s, '=');
        if (!eq) continue;
        *eq = '\0';
        key = trim(s);
        val = trim(eq + 1);
        if (*val == '"' || *val == '\'') {
            size_t l = strlen(val);
            if (l >= 2 && val[l - 1] == val[0]) {
                val[l - 1] = '\0';
                val++;
            }
        }
        /* 真实环境变量优先：先记 .env，再由 apply_env_overrides 覆盖 */
        apply_kv(key, val);
    }
    fclose(f);
}

static void normalize_mode(void)
{
    char tmp[64];
    size_t i = 0;
    const char *p;

    for (p = g_cfg.llm_api_mode; *p && i + 1 < sizeof tmp; p++) {
        char c = *p;
        if (c == '-' || c == ' ') c = '_';
        tmp[i++] = (char)tolower((unsigned char)c);
    }
    tmp[i] = '\0';

    if (strcmp(tmp, "responses") == 0)
        snprintf(g_cfg.llm_api_mode, sizeof g_cfg.llm_api_mode, "responses");
    else
        snprintf(g_cfg.llm_api_mode, sizeof g_cfg.llm_api_mode, "chat_completions");

    if (!g_cfg.llm_api_mode[0]) snprintf(g_cfg.llm_api_mode, sizeof g_cfg.llm_api_mode, "chat_completions");
}

void hf_config_load(const char *root)
{
    char env_path[700];

    set_defaults();

    if (root && *root) snprintf(g_cfg.root, sizeof g_cfg.root, "%s", root);
    else {
        char cwd[512];
        if (HF_GETCWD(cwd, sizeof cwd)) snprintf(g_cfg.root, sizeof g_cfg.root, "%s", cwd);
        else snprintf(g_cfg.root, sizeof g_cfg.root, ".");
    }

    /* 允许用环境变量覆盖端口，便于测试并发 */
    {
        const char *p = getenv("PORT");
        if (p && *p) g_cfg.port = atoi(p);
    }

    snprintf(env_path, sizeof env_path, "%s/.env", g_cfg.root);
    load_env_file(env_path);
    apply_env_overrides();

    snprintf(g_cfg.public_dir, sizeof g_cfg.public_dir, "%s/public", g_cfg.root);
    snprintf(g_cfg.long_dir, sizeof g_cfg.long_dir, "%s/long-simulation", g_cfg.root);

    normalize_mode();
    g_cfg.search_enabled = (g_cfg.search_endpoint[0] && g_cfg.search_api_key[0]) ? 1 : 0;
}

const char *hf_cfg_public_dir(void) { return g_cfg.public_dir; }
const char *hf_cfg_root(void) { return g_cfg.root; }

int hf_url_host(const char *url, char *out, size_t n)
{
    const char *p;
    const char *start;
    size_t len;

    if (!url || !*url) return 0;
    p = strstr(url, "://");
    if (!p) return 0;
    p += 3;
    start = p;
    while (*p && *p != '/' && *p != '?' && *p != '#') p++;
    len = (size_t)(p - start);
    if (len == 0 || len >= n) return 0;
    memcpy(out, start, len);
    out[len] = '\0';

    /* 去掉 userinfo 与端口 */
    {
        char *at = strrchr(out, '@');
        if (at) memmove(out, at + 1, strlen(at + 1) + 1);
    }
    {
        char *colon = strchr(out, ':');
        if (colon) *colon = '\0';
    }
    return out[0] ? 1 : 0;
}

int hf_url_safe(const char *url)
{
    const char *p;
    char host[256];

    if (!url || !*url) return 0;
    if (!(strncmp(url, "http://", 7) == 0 || strncmp(url, "https://", 8) == 0)) return 0;
    for (p = url; *p; p++) {
        unsigned char c = (unsigned char)*p;
        if (c <= 0x20 || c == 0x7f || c == '\\') return 0;
    }
    /* 任何 userinfo 都拒绝，包括 https://@host */
    {
        const char *auth = strstr(url, "://") + 3;
        const char *slash = strpbrk(auth, "/?#");
        const char *at = strchr(auth, '@');
        if (at && (!slash || at < slash)) return 0;
    }
    if (!hf_url_host(url, host, sizeof host)) return 0;
    return 1;
}

void hf_mask_endpoint(const char *url, char *out, size_t n)
{
    const char *p, *auth;
    const char *scheme_end;
    size_t scheme_len, auth_len;

    if (!url || !*url) { snprintf(out, n, "%s", ""); return; }
    p = strstr(url, "://");
    if (!p) { snprintf(out, n, "%s", url); return; }
    scheme_len = (size_t)(p - url) + 3;
    scheme_end = url + scheme_len;

    auth = scheme_end;
    {
        const char *slash = strpbrk(auth, "/?#");
        const char *at = strchr(auth, '@');
        if (at && (!slash || at < slash)) auth = at + 1;
    }
    p = auth;
    while (*p && *p != '?' && *p != '#') p++;
    auth_len = (size_t)(p - auth);

    if (scheme_len + auth_len >= n) auth_len = n - 1 - scheme_len;
    memcpy(out, url, scheme_len);
    memcpy(out + scheme_len, auth, auth_len);
    out[scheme_len + auth_len] = '\0';
}

int hf_domain_allowed(const char *url)
{
    char host[256];
    char list[512];
    char *tok;
    char *save = NULL;
    int ok = 0;

    if (!hf_url_safe(url)) return 0;
    if (!hf_url_host(url, host, sizeof host)) return 0;
    {
        size_t i;
        for (i = 0; host[i]; i++) host[i] = (char)tolower((unsigned char)host[i]);
    }

    snprintf(list, sizeof list, "%s", g_cfg.search_domains);
    for (tok = strtok_r(list, ",", &save); tok; tok = strtok_r(NULL, ",", &save)) {
        char *d = trim(tok);
        size_t hl, dl;
        if (!*d) continue;
        if (*d == '.') d++;
        dl = strlen(d);
        if (dl == 0) continue;
        hl = strlen(host);
        if (strcmp(host, d) == 0) { ok = 1; break; }
        if (hl > dl && strcmp(host + hl - dl, d) == 0 && host[hl - dl - 1] == '.') { ok = 1; break; }
    }
    return ok;
}
