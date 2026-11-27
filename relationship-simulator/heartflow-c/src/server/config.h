/* config.h — .env 载入与运行期配置 */
#ifndef HF_CONFIG_H
#define HF_CONFIG_H

#include <stddef.h>
#include <stdio.h>

typedef struct {
    int   port;
    char  bind_host[64];      /* 默认 127.0.0.1；显式配置后才监听其他地址 */
    char  root[512];          /* 项目根目录 */
    char  public_dir[600];
    char  long_dir[600];

    char  llm_endpoint[512];
    char  llm_model[128];
    char  vision_model[128]; /* 可选；未设置时使用 LLM_MODEL */
    char  llm_api_mode[32];   /* responses | chat_completions */
    char  llm_api_key[256];
    int   llm_max_tokens;
    double llm_temperature;
    double llm_top_p;
    char  llm_reasoning_effort[16];

    int   search_enabled;
    char  search_endpoint[512];
    char  search_api_key[256];
    char  search_model[128];
    char  search_domains[512];

    char  tts_base[256];
    int   tts_timeout_ms;
} HfConfig;

extern HfConfig g_cfg;

void hf_config_load(const char *root);
/* Windows 上 fopen 走 ANSI 代码页，中文路径会直接失败；统一用这个包装。 */
FILE *hf_fopen_utf8(const char *path, const char *mode);
const char *hf_cfg_public_dir(void);
const char *hf_cfg_root(void);

/* 判断来源域名是否在检索白名单内（后缀匹配，不允许任意子串） */
int  hf_domain_allowed(const char *url);
/* 提取 URL 的 host，失败返回 0 */
int  hf_url_host(const char *url, char *out, size_t n);
/* 仅接受 http(s)、无 userinfo、无空白字符的绝对链接 */
int  hf_url_safe(const char *url);
/* 掩码 endpoint：去掉 query 与 userinfo */
void hf_mask_endpoint(const char *url, char *out, size_t n);

#endif
