/* cli.c — hf tts 子命令：让 C 侧的文本/音频处理可被脚本逐字节对照。
 *
 * 用途不是给人用，是给 tests/tts-parity.py 当 golden 对照入口：
 *   hf tts normalize --text "..."      -> 清洗后文本 + \n
 *   hf tts split     --text "..."      -> 每句一行
 *   hf tts wav --in x.f32 --out x.wav  -> float32 PCM 转 WAV
 *   hf tts selftest                    -> 内置断言，退出码 0/1
 */
#define _POSIX_C_SOURCE 200809L

#include "tts.h"
#include "../hf.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *arg(int argc, char **argv, const char *key)
{
    int i;
    for (i = 3; i + 1 < argc; i++)
        if (strcmp(argv[i], key) == 0) return argv[i + 1];
    return NULL;
}

static char *read_file(const char *path, size_t *len)
{
    FILE *f = fopen(path, "rb");
    char *p;
    long n;
    if (!f) return NULL;
    fseek(f, 0, SEEK_END); n = ftell(f); rewind(f);
    if (n < 0) { fclose(f); return NULL; }
    p = (char *)malloc((size_t)n + 1);
    if (!p) { fclose(f); return NULL; }
    if (n > 0 && fread(p, 1, (size_t)n, f) != (size_t)n) {
        free(p); fclose(f); return NULL;
    }
    p[n] = '\0';
    fclose(f);
    *len = (size_t)n;
    return p;
}

static int cmd_wav(int argc, char **argv)
{
    const char *in = arg(argc, argv, "--in");
    const char *out = arg(argc, argv, "--out");
    const char *rate_s = arg(argc, argv, "--rate");
    size_t len = 0;
    char *raw;
    HfBuf b;
    FILE *f;
    int rc = 1;

    if (!in || !out) {
        fprintf(stderr, "用法：hf tts wav --in <float32.pcm> --out <out.wav> [--rate 24000]\n");
        return 1;
    }
    raw = read_file(in, &len);
    if (!raw) { fprintf(stderr, "读不到 %s\n", in); return 1; }
    if (len % 4 != 0) { fprintf(stderr, "float32 文件长度必须是 4 的倍数\n"); free(raw); return 1; }

    hf_buf_init(&b);
    if (hf_tts_float_to_wav((const float *)raw, len / 4,
                            rate_s ? atoi(rate_s) : HF_TTS_SAMPLE_RATE, &b) != 0 || !b.p) {
        fprintf(stderr, "WAV 生成失败\n");
    } else {
        f = fopen(out, "wb");
        if (f) {
            fwrite(b.p, 1, b.n, f);
            fclose(f);
            printf("wav %s: %lu 字节 / %lu 采样\n", out,
                   (unsigned long)b.n, (unsigned long)(len / 4));
            rc = 0;
        } else fprintf(stderr, "写不到 %s\n", out);
    }
    hf_buf_free(&b);
    free(raw);
    return rc;
}

static int cmd_selftest(void)
{
    int pass = 0, fail = 0;
    char *s;

#define T(desc, cond) do {                                     \
        if (cond) { pass++; }                                  \
        else { printf("  FAIL %s\n", desc); fail++; }          \
    } while (0)

    s = hf_tts_normalize("（微笑）你好？");
    T("舞台提示与问号", s && strcmp(s, "你好。") == 0); free(s);

    s = hf_tts_normalize("真的....吗??");
    T("省略号与叠问", s && strcmp(s, "真的。吗。") == 0); free(s);

    s = hf_tts_normalize("  A  \t B  ");
    T("空白折叠", s && strcmp(s, "A B") == 0); free(s);

    s = hf_tts_normalize("（微笑）");
    T("全被清洗时回退原文", s && strcmp(s, "（微笑）") == 0); free(s);

    T("300 字上限", hf_tts_validate_text("好") == NULL);
    T("引擎白名单", hf_tts_engine_known("kokoro") && hf_tts_engine_known("edge")
                    && !hf_tts_engine_known("evil"));
    T("语速钳制", hf_tts_clamp_speed(9.0) == 1.2 && hf_tts_clamp_speed(0.1) == 0.8);

    {
        char **v;
        int n = 0, i;
        v = hf_tts_split("今天有点累。早点休息吧！明天再说。", 6, 80, &n);
        T("分句有结果", n >= 1 && v != NULL);
        for (i = 0; i < n; i++) printf("    句%d: %s\n", i + 1, v[i]);
        hf_tts_split_free(v, n);
    }
    {
        HfBuf b;
        float pcm[256];
        int i;
        for (i = 0; i < 256; i++) pcm[i] = (float)(0.2 * (i % 2 ? 1.0 : -1.0));
        hf_buf_init(&b);
        hf_tts_float_to_wav(pcm, 256, 24000, &b);
        T("WAV 头", b.n == 44 + 512 && b.p && memcmp(b.p, "RIFF", 4) == 0);
        hf_buf_free(&b);
    }
#undef T
    printf("\ntts selftest: %d 通过，%d 失败\n", pass, fail);
    return fail ? 1 : 0;
}

int hf_cmd_tts(int argc, char **argv)
{
    const char *sub = argc > 2 ? argv[2] : NULL;
    const char *text;
    if (!sub || strcmp(sub, "selftest") == 0) return cmd_selftest();
    if (strcmp(sub, "normalize") == 0) {
        char *out;
        text = arg(argc, argv, "--text");
        if (!text) { fprintf(stderr, "用法：hf tts normalize --text \"...\"\n"); return 1; }
        out = hf_tts_normalize(text);
        printf("%s\n", out ? out : "");
        free(out);
        return 0;
    }
    if (strcmp(sub, "split") == 0) {
        char **v;
        int n = 0, i;
        text = arg(argc, argv, "--text");
        if (!text) { fprintf(stderr, "用法：hf tts split --text \"...\"\n"); return 1; }
        v = hf_tts_split(text, 6, 80, &n);
        for (i = 0; i < n; i++) printf("%s\n", v[i] ? v[i] : "");
        hf_tts_split_free(v, n);
        return 0;
    }
    if (strcmp(sub, "wav") == 0) return cmd_wav(argc, argv);
    fprintf(stderr, "未知子命令：%s（可用 normalize|split|wav|selftest）\n", sub);
    return 1;
}
