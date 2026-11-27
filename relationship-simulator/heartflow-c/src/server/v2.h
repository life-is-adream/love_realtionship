#ifndef HF_V2_H
#define HF_V2_H

#include "httpd.h"

/* 返回 1 表示请求已处理；所有 v2 数据默认只在本次请求中使用。 */
int hf_v2_route(HfConn *c);

#endif
