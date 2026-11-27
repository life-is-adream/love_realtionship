/* 仅 wasm 构建通过 -include 注入：wasi-libc 的 <time.h> 不声明 timegm。 */
#ifndef HF_WASI_COMPAT_H
#define HF_WASI_COMPAT_H
#include <time.h>
extern time_t timegm(struct tm *tm);
#endif
