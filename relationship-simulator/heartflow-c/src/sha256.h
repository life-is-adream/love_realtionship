/* sha256.h — 观察 ID 需要稳定摘要，且不能引入 OpenSSL */
#ifndef HF_SHA256_H
#define HF_SHA256_H

#include <stddef.h>
#include <stdint.h>

typedef struct {
    uint32_t h[8];
    uint64_t bits;
    uint8_t  buf[64];
    size_t   used;
} HfSha256;

void hf_sha256_init(HfSha256 *s);
void hf_sha256_update(HfSha256 *s, const void *data, size_t len);
void hf_sha256_final(HfSha256 *s, uint8_t out[32]);
void hf_sha256_hex(const void *data, size_t len, char out[65]);

#endif
