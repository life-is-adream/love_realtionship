#!/bin/sh
# 构建脚本：单一可执行文件（CLI + 本地服务）
#
# 本机（Windows）没有 gcc/cc，用 PyPI 的 ziglang 充当 C 编译器：
#   python -m pip install ziglang -i https://mirrors.aliyun.com/pypi/simple/
# ziglang 可能装在某个特定 Python 下，脚本会自动探测；也可显式指定 ZIG_PY。
# 沙箱环境需把标准库放到 .toolchain/ziglib 并设 ZIG_LIB_DIR（当前目录或上一级均可）。
set -e

OUT="${1:-hf.exe}"

# --- 1. 找到能 import ziglang 的 Python ---
if [ -n "${ZIG_PY:-}" ]; then
    CC_PY="$ZIG_PY"
else
    CC_PY=""
    for cand in python python3 py \
        "/c/Users/${USERNAME:-lenovo}/AppData/Local/Programs/Python/Python310/python.exe"; do
        if command -v "$cand" >/dev/null 2>&1 && "$cand" -m ziglang version >/dev/null 2>&1; then
            CC_PY="$cand"
            break
        fi
    done
    if [ -z "$CC_PY" ]; then
        echo "找不到可用的 ziglang。请先安装：python -m pip install ziglang" >&2
        echo "若已装在其他 Python 下，用 ZIG_PY=<python路径> sh build.sh" >&2
        exit 1
    fi
fi

# --- 2. 找到 zig 标准库（子进程无法读 AppData 时需要） ---
if [ -z "${ZIG_LIB_DIR:-}" ]; then
    if [ -d "./.toolchain/ziglib" ]; then
        ZIG_LIB_DIR="$(pwd)/.toolchain/ziglib"
    elif [ -d "../.toolchain/ziglib" ]; then
        ZIG_LIB_DIR="$(cd .. && pwd)/.toolchain/ziglib"
    fi
    [ -n "${ZIG_LIB_DIR:-}" ] && export ZIG_LIB_DIR
fi

echo "[1/2] 编译 $OUT  (zig: $("$CC_PY" -m ziglang version 2>/dev/null))"
"$CC_PY" -m ziglang cc -O2 -std=c11 -Wall -Wextra -Isrc \
    -o "$OUT" src/*.c src/server/*.c src/voice/*.c src/tools/*.c -lshell32 -lws2_32 -lwinhttp

echo "[2/2] 完成："
ls -la "$OUT"
