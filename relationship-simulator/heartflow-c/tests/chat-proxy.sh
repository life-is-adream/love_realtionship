#!/bin/sh
# /api/chat 代理回归：用本地假上游验证转发逻辑，不消耗任何真实模型额度。
# 覆盖：chat_completions 转发 / responses 归一化 / 上游 5xx / 请求体超限 / 缺密钥
#
# 用法：sh tests/chat-proxy.sh [A端口] [B端口] [C端口] [上游端口]
# 默认：3110(chat) 3111(responses) 3112(无密钥) 3310(假上游)
set -u
cd "$(dirname "$0")/.." || exit 1

PORT_A="${1:-3110}"
PORT_B="${2:-3111}"
PORT_C="${3:-3112}"
UP_PORT="${4:-3310}"

BIN="./hf.exe"
PY="${PYTHON:-python}"
ROOT=".tmp-chat-test-$$"
UP="http://127.0.0.1:$UP_PORT"
FAKE_KEY="test-key-not-real"

pass=0
fail=0
PIDS=""

check() {
    desc="$1"; want="$2"; got="$3"
    if printf '%s' "$got" | grep -q "$want"; then
        printf '  PASS  %s\n' "$desc"; pass=$((pass + 1))
    else
        printf '  FAIL  %s\n        期望包含：%s\n        实际：%s\n' "$desc" "$want" "$(printf '%s' "$got" | head -c 400)"
        fail=$((fail + 1))
    fi
}

cleanup() {
    for p in $PIDS; do kill "$p" 2>/dev/null; done
    sleep 0.3
    rm -rf "$ROOT"
}
trap cleanup EXIT INT TERM

if [ ! -x "$BIN" ]; then
    printf '找不到 %s，请先运行 ./build.sh\n' "$BIN"
    exit 1
fi
if ! command -v "$PY" >/dev/null 2>&1; then
    printf '找不到 python，无法启动假上游；可用 PYTHON=<路径> 指定\n'
    exit 1
fi

# 隔离：不继承外部可能存在的真实密钥与端点
unset LLM_API_KEY LLM_ENDPOINT LLM_API_MODE LLM_MODEL SEARCH_API_KEY SEARCH_ENDPOINT

mkdir -p "$ROOT" || exit 1

wait_up() {
    i=0
    while [ $i -lt 60 ]; do
        if curl -s -m 1 "$1/api/health" >/dev/null 2>&1; then return 0; fi
        i=$((i + 1)); sleep 0.25
    done
    return 1
}

# --- 假上游 ---
"$PY" tests/fake_upstream.py "$UP_PORT" >"$ROOT/upstream.log" 2>&1 &
PIDS="$PIDS $!"

# --- 实例 A：chat_completions ---
LLM_ENDPOINT="$UP/v1/chat/completions" \
LLM_API_MODE=chat_completions \
LLM_API_KEY="$FAKE_KEY" \
LLM_MODEL=fake-model \
"$BIN" serve --port "$PORT_A" --root "$ROOT" >"$ROOT/a.log" 2>&1 &
PIDS="$PIDS $!"

# --- 实例 B：responses ---
LLM_ENDPOINT="$UP/v1/responses" \
LLM_API_MODE=responses \
LLM_API_KEY="$FAKE_KEY" \
LLM_MODEL=fake-model \
"$BIN" serve --port "$PORT_B" --root "$ROOT" >"$ROOT/b.log" 2>&1 &
PIDS="$PIDS $!"

# --- 实例 C：无密钥（root 下没有 .env） ---
LLM_ENDPOINT="$UP/v1/chat/completions" \
LLM_API_MODE=chat_completions \
"$BIN" serve --port "$PORT_C" --root "$ROOT" >"$ROOT/c.log" 2>&1 &
PIDS="$PIDS $!"

A="http://127.0.0.1:$PORT_A"
B="http://127.0.0.1:$PORT_B"
C="http://127.0.0.1:$PORT_C"

ok=1
for u in "$A" "$B" "$C"; do
    if ! wait_up "$u"; then printf '服务未就绪：%s\n' "$u"; ok=0; fi
done
if [ "$ok" -eq 0 ]; then
    printf '\n--- a.log ---\n'; cat "$ROOT/a.log"
    printf '\n--- c.log ---\n'; cat "$ROOT/c.log"
    exit 1
fi

printf '\n/api/chat 代理回归  A:%s  B:%s  C:%s  上游:%s\n' "$PORT_A" "$PORT_B" "$PORT_C" "$UP_PORT"
printf -- '--------------------------------------------------------------\n'

BODY='{"messages":[{"role":"user","content":"今天有点累"}]}'

# ---- A：chat_completions ----
RESP_A="$(curl -s -m 20 -X POST "$A/api/chat" -H 'Content-Type: application/json' -d "$BODY")"
check "A 状态码 200"              "200"                          "$(curl -s -m 20 -o /dev/null -w '%{http_code}' -X POST "$A/api/chat" -H 'Content-Type: application/json' -d "$BODY")"
check "A 转发最后一条消息"         "今天有点累"                     "$RESP_A"
check "A 把密钥转给上游"           "Bearer $FAKE_KEY"             "$RESP_A"
check "A 使用 .env/环境变量模型名"  "fake-model"                   "$RESP_A"

# ---- A：SSE 流式（stream:true）----
RESP_SSE="$(curl -s -m 20 -N -X POST "$A/api/chat" -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"hi"}],"stream":true}')"
check "SSE Content-Type"            "text/event-stream"            "$(curl -s -m 20 -D - -o /dev/null -X POST "$A/api/chat" -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"hi"}],"stream":true}' | grep -i 'content-type')"
check "SSE 逐帧 content 类型"       '"type":"content"'             "$RESP_SSE"
check "SSE reasoning 独立成帧"      '"type":"reasoning"'           "$RESP_SSE"
check "SSE 正文增量"                '"delta":"流式"'               "$RESP_SSE"
check "SSE [DONE] 收尾"             'data: \[DONE\]'               "$RESP_SSE"
check "SSE 帧单行紧凑格式"          'data: {"type":'               "$RESP_SSE"

# ---- A：上游 5xx（重试一次后仍 5xx → 502）----
RESP_FAIL="$(curl -s -m 20 -o /dev/null -w '%{http_code}' -X POST "$A/api/chat" -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"__FAKE_FAIL__"}]}')"
check "A 上游 5xx 映射 502"        "502"                          "$RESP_FAIL"
check "A 上游 5xx 错误码"          "upstream_unreachable"         "$(curl -s -m 20 -X POST "$A/api/chat" -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"__FAKE_FAIL__"}]}')"

# ---- A：请求体超过 2MB ----
"$PY" -c "open('$ROOT/big.json','w').write('{\"messages\":[{\"role\":\"user\",\"content\":\"' + 'x'*2200000 + '\"}]}')"
check "A 请求体超限 413"           "413"                          "$(curl -s -m 20 -o /dev/null -w '%{http_code}' -X POST "$A/api/chat" -H 'Content-Type: application/json' --data-binary "@$ROOT/big.json")"
check "A 超限错误码"               "payload_too_large"            "$(curl -s -m 20 -X POST "$A/api/chat" -H 'Content-Type: application/json' --data-binary "@$ROOT/big.json")"

# ---- B：responses 归一化 ----
RESP_B="$(curl -s -m 20 -X POST "$B/api/chat" -H 'Content-Type: application/json' -d "$BODY")"
check "B 补出 choices 结构"        '"choices"'                    "$RESP_B"
check "B 回复内容"                 "responses 模式回复"            "$RESP_B"
check "B 保留 output_text"         '"output_text"'                "$RESP_B"

# ---- C：缺密钥 ----
check "C 缺密钥 400"              "400"                          "$(curl -s -m 20 -o /dev/null -w '%{http_code}' -X POST "$C/api/chat" -H 'Content-Type: application/json' -d "$BODY")"
check "C 缺密钥错误码"             "missing_api_key"              "$(curl -s -m 20 -X POST "$C/api/chat" -H 'Content-Type: application/json' -d "$BODY")"

printf '\n结果：%d 通过，%d 失败\n\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
