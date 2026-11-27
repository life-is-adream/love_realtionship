#!/bin/sh
# 一次跑完全部回归：CLI 冒烟 + 服务端冒烟 + Node 对照 + chat 代理
#                    + TTS 算法对照 + TTS 接线回归 + 循环依赖门禁对照
# 用法：sh tests/run-all.sh
# 需要：hf.exe 已构建；node（可选）；python（假上游与对照脚本）
#       voice/venv 的 Python（可选，TTS 算法对照需要 numpy；缺失则跳过该组）
set -u
cd "$(dirname "$0")/.." || exit 1

BIN="./hf.exe"
PY="${PYTHON:-python}"
ROOT_DIR=".."
fails=0

if [ ! -x "$BIN" ]; then
    printf '找不到 %s，请先运行 ./build.sh\n' "$BIN"
    exit 1
fi

banner() { printf '\n\033[1m===== %s =====\033[0m\n' "$1"; }

# ---------- 1. CLI 五能力 ----------
banner "1/7 CLI 冒烟"
if sh tests/smoke.sh; then :; else fails=$((fails + 1)); fi

# ---------- 2. HTTP 服务 ----------
banner "2/7 服务端冒烟"
if sh tests/server-smoke.sh 3101 "$ROOT_DIR"; then :; else fails=$((fails + 1)); fi

# ---------- 3. Node 对照 ----------
banner "3/7 C 与 Node 输出对照"
if ! command -v node >/dev/null 2>&1; then
    printf '  SKIP  未安装 node，跳过对照\n'
elif ! command -v "$PY" >/dev/null 2>&1; then
    printf '  SKIP  未安装 python，跳过对照\n'
else
    C_PORT=3102
    N_PORT=3201
    "$BIN" serve --port "$C_PORT" --root "$ROOT_DIR" >.tmp-parity-c.log 2>&1 &
    C_PID=$!
    ( cd "$ROOT_DIR" && PORT=$N_PORT exec node server/index.js ) >.tmp-parity-node.log 2>&1 &
    N_PID=$!

    i=0
    while [ $i -lt 60 ]; do
        if curl -s -m 1 "http://127.0.0.1:$C_PORT/api/health" >/dev/null 2>&1 &&
           curl -s -m 1 "http://127.0.0.1:$N_PORT/api/health" >/dev/null 2>&1; then break; fi
        i=$((i + 1)); sleep 0.25
    done

    if "$PY" tests/parity.py "http://127.0.0.1:$C_PORT" "http://127.0.0.1:$N_PORT"; then :; else fails=$((fails + 1)); fi

    kill "$C_PID" "$N_PID" 2>/dev/null
    sleep 0.3
    rm -f .tmp-parity-c.log .tmp-parity-node.log
fi

# ---------- 4. chat 代理 ----------
banner "4/7 /api/chat 代理（本地假上游）"
if sh tests/chat-proxy.sh 3110 3111 3112 3310; then :; else fails=$((fails + 1)); fi

# ---------- 5. TTS 算法对照（需要 numpy） ----------
banner "5/7 TTS 文本/音频层与 Python 逐字节对照"
if "$BIN" tts selftest; then :; else fails=$((fails + 1)); fi
VENV_PY="../voice/venv/Scripts/python.exe"
if [ -x "$VENV_PY" ] && "$VENV_PY" -c 'import numpy' >/dev/null 2>&1; then
    if "$VENV_PY" tests/tts-parity.py; then :; else fails=$((fails + 1)); fi
else
    printf '  SKIP  voice/venv 无 numpy，跳过算法对照（接线回归仍会跑）\n'
fi

# ---------- 6. TTS 接线回归 ----------
banner "6/7 /api/tts 接线（本地假推理后端）"
if "$PY" tests/tts-proxy.py 3120 3320; then :; else fails=$((fails + 1)); fi

# ---------- 7. 循环依赖门禁对照 ----------
banner "7/7 循环依赖门禁 C/JS 对照"
if ! command -v node >/dev/null 2>&1; then
    printf '  SKIP  未安装 node，跳过 JS 对照（C 版仍可直接跑 hf check circular）\n'
elif sh tests/check-parity.sh; then :; else fails=$((fails + 1)); fi

printf '\n================================\n'
if [ "$fails" -eq 0 ]; then
    printf ' 全部回归通过\n'
else
    printf ' 有 %d 组回归失败\n' "$fails"
fi
printf '================================\n\n'
[ "$fails" -eq 0 ]
