#!/bin/sh
# 服务端冒烟测试：只验证行为，不调用真实模型
# 用法：sh tests/server-smoke.sh [端口] [根目录]
set -u
cd "$(dirname "$0")/.." || exit 1

PORT="${1:-3100}"
ROOT="${2:-..}"
BIN="./hf.exe"

pass=0
fail=0

check() {
    desc="$1"; want="$2"; got="$3"
    if printf '%s' "$got" | grep -q "$want"; then
        printf '  PASS  %s\n' "$desc"; pass=$((pass + 1))
    else
        printf '  FAIL  %s\n        期望包含：%s\n        实际：%s\n' "$desc" "$want" "$(printf '%s' "$got" | head -2)"
        fail=$((fail + 1))
    fi
}

code() { printf '%s' "$1" | head -1; }

"$BIN" serve --port "$PORT" --root "$ROOT" >/tmp/hf-server-smoke.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT INT TERM

i=0
while [ $i -lt 40 ]; do
    if curl -s -m 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then break; fi
    i=$((i + 1)); sleep 0.25
done

B="http://127.0.0.1:$PORT"
printf '\n服务端冒烟测试 :%s\n----------------------\n' "$PORT"

check "health 返回 ok"        '"ok": true'      "$(curl -s -m 5 $B/api/health)"
check "health 不含密钥"        '"hasApiKey"'     "$(curl -s -m 5 $B/api/health)"

check "首页 200"              "200"             "$(curl -s -m 5 -o /dev/null -w '%{http_code}' $B/)"
check "首页是 html"           "text/html"       "$(curl -s -m 5 -o /dev/null -w '%{content_type}' $B/)"
check "模块带版本号"           "?v="             "$(curl -s -m 5 $B/modules/core/api-client.js | head -1)"
check "缺失 js 是 404"         "404"             "$(curl -s -m 5 -o /dev/null -w '%{http_code}' $B/missing.js)"
check "无扩展名回退 SPA"       "200"             "$(curl -s -m 5 -o /dev/null -w '%{http_code}' $B/some/deep/path)"

# 浏览器真实请求形态：静态资源会被注入 ?v=<版本>。曾因请求行未剥离 query
# 导致所有 JS 模块 404、前端整体起不来（API 不带 query 所以旧冒烟没发现）。
Q="$B/modules/core/api-client.js?v=20261013-abilities-r1"
check "带 ?v= 的 JS 200"       "200"             "$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$Q")"
check "带 ?v= 的 JS MIME"      "text/javascript" "$(curl -s -m 5 -o /dev/null -w '%{content_type}' "$Q")"
check "带 ?v= 的 JS 内容"      "?v="             "$(curl -s -m 5 "$Q" | head -1)"
check "带 query 的 API 仍匹配" "200"             "$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$B/api/health?x=1")"
check "带 query 的缺失资源 404" "404"            "$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$B/missing.js?v=1")"

check "章节 1 可读"            "200"             "$(curl -s -m 5 -o /dev/null -w '%{http_code}' $B/api/long-content/1)"
check "章节 11 拒绝"           "400"             "$(curl -s -m 5 -o /dev/null -w '%{http_code}' $B/api/long-content/11)"
check "章节非数字拒绝"         "400"             "$(curl -s -m 5 -o /dev/null -w '%{http_code}' $B/api/long-content/abc)"

RI='{"messages":[{"speaker":"user","text":"在吗"},{"speaker":"other","text":"在"}]}'
check "关系智能 200"           "200"             "$(curl -s -m 5 -o /dev/null -w '%{http_code}' -X POST $B/api/relationship-intelligence -H 'Content-Type: application/json' -d "$RI")"
check "关系智能含状态机"       '"state"'         "$(curl -s -m 5 -X POST $B/api/relationship-intelligence -H 'Content-Type: application/json' -d "$RI")"
check "空消息报错码"           "messages_required" "$(curl -s -m 5 -X POST $B/api/relationship-intelligence -H 'Content-Type: application/json' -d '{"messages":[]}')"
check "非法 caseId 报错"       "invalid_case_id"  "$(curl -s -m 5 -X POST $B/api/relationship-intelligence -H 'Content-Type: application/json' -d '{"consent":true,"caseId":"bad","messages":[{"speaker":"user","text":"在吗"}]}')"

check "chat 空消息 400"        "400"             "$(curl -s -m 5 -o /dev/null -w '%{http_code}' -X POST $B/api/chat -H 'Content-Type: application/json' -d '{"messages":[]}')"
check "chat 非法 JSON 400"     "400"             "$(curl -s -m 5 -o /dev/null -w '%{http_code}' -X POST $B/api/chat -H 'Content-Type: application/json' -d 'not-json')"
check "OPTIONS 204"            "204"             "$(curl -s -m 5 -o /dev/null -w '%{http_code}' -X OPTIONS $B/api/chat -H 'Origin: http://localhost:3100')"
check "CORS 放行本机来源"       "Access-Control-Allow-Origin: http://localhost:3100" "$(curl -s -m 5 -D - -o /dev/null $B/api/health -H 'Origin: http://localhost:3100')"
check "CORS 拒绝公网来源"       "Access-Control-Allow-Origin: http://localhost:" "$(curl -s -m 5 -D - -o /dev/null $B/api/health -H 'Origin: https://evil.example.com')"

printf '\n结果：%d 通过，%d 失败\n\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
