/* tts.h — TTS 协议/文本/音频层（C 实现）
 *
 * 移植自 voice/tts_server.py 中不依赖模型的部分。
 * 模型推理（ChatTTS/PyTorch/CUDA、Kokoro/onnxruntime）仍留在 Python sidecar，
 * 原因见 heartflow-c/README.md「已知边界」：这两者没有可用的纯 C 推理路径。
 *
 * 所有文本处理都在**码点层面**进行：Python 的 len() 数字是字符数不是字节数，
 * 分句合并的 min_len/max_len 与 300 字上限都必须按码点算，否则中文会被算成 3 倍。
 */
#ifndef HF_TTS_H
#define HF_TTS_H

#include "../json.h"     /* HfBuf */
#include <stddef.h>

#define HF_TTS_MAX_TEXT      300
#define HF_TTS_SAMPLE_RATE   24000
#define HF_TTS_TARGET_RMS    0.09
#define HF_TTS_PEAK_LIMIT    0.95

/* 文本清洗：去舞台提示/emoji、统一标点、合并省略号与重复句号、折叠空白。
 * 返回 malloc 的 UTF-8 串，调用方 free；清洗后为空时返回原文副本。 */
char *hf_tts_normalize(const char *text);

/* 按标点切短句并按 min_len/max_len（码点）合并。
 * 返回 malloc 的字符串数组 + 个数，用 hf_tts_split_free 释放。 */
char **hf_tts_split(const char *text, int min_len, int max_len, int *out_n);
void   hf_tts_split_free(char **v, int n);

/* float32 PCM -> 16bit 单声道 WAV，含 RMS 响度归一化与峰值限幅。
 * 输出追加到 HfBuf；返回 0 成功。 */
int hf_tts_float_to_wav(const float *pcm, size_t n, int sample_rate, HfBuf *out);

/* 请求校验：返回错误码（NULL 表示通过）。chars 按码点计。 */
const char *hf_tts_validate_text(const char *text);
int         hf_tts_engine_known(const char *engine);
double      hf_tts_clamp_speed(double v);

/* CLI 入口（src/voice/cli.c） */
int hf_cmd_tts(int argc, char **argv);

#endif /* HF_TTS_H */
