#!/bin/sh
# 冒烟测试：只验证「行为」，不验证「文案质量」
set -u
cd "$(dirname "$0")/.." || exit 1

BIN="${BIN:-./hf.exe}"
export HF_HOME="$(pwd)/.hf-smoke"
rm -rf "$HF_HOME"

pass=0
fail=0

check() {
    desc="$1"; want="$2"; got="$3"
    if printf '%s' "$got" | grep -q "$want"; then
        printf '  PASS  %s\n' "$desc"; pass=$((pass + 1))
    else
        printf '  FAIL  %s\n        期望包含：%s\n        实际：%s\n' "$desc" "$want" "$(printf '%s' "$got" | head -3)"
        fail=$((fail + 1))
    fi
}

printf '\nhf 冒烟测试\n------------\n'

check "help 有输出"            "关系档案引擎" "$($BIN help 2>&1)"
check "reflect 分析三个模块"    "你在说的"     "$($BIN reflect "我特别难受，他每次都敷衍我" 2>&1)"
check "reflect 给出第三方视角"  "另一个视角"   "$($BIN reflect "我特别难受，他每次都敷衍我" 2>&1)"

$BIN add 冲突 "他答应的事又没做到，我等到晚上十点" --note 忍 >/dev/null 2>&1
check "add 后能查到"           "共 1 条"      "$($BIN log --days 7 2>&1)"

check "同主题会提醒历史"       "这条你走过"   "$($BIN reflect "他还是没回消息，我很难受" 2>&1)"

$BIN brake add "你现在到底什么意思？不想谈就直说" >/dev/null 2>&1
check "brake 生成队列"         "待发"         "$($BIN brake list 2>&1)"
check "冷静期内拒绝发送"       "才能发"       "$($BIN brake send 1 2>&1)"
check "加 --yes 也不能绕过"    "才能发"       "$($BIN brake send 1 --yes 2>&1)"

check "trace 无跨度时如实说"   "不足"         "$($BIN trace --weeks 12 2>&1)"

$BIN purge --yes >/dev/null 2>&1
check "purge 后为空"           "共 0 条"      "$($BIN log --days 7 2>&1)"

printf '\n结果：%d 通过，%d 失败\n\n' "$pass" "$fail"
rm -rf "$HF_HOME"
[ "$fail" -eq 0 ]
