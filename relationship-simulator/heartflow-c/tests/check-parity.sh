#!/bin/sh
# hf check circular 与 scripts/check-circular.mjs 的行为对照。
# 覆盖：真实项目 0 环、构造的有环 fixture、构造的无环 fixture。
set -u
cd "$(dirname "$0")/../.." || exit 1

BIN="./heartflow-c/hf.exe"
JS="scripts/check-circular.mjs"
TMP=".tmp-check-parity-$$"
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
trap 'rm -rf "$TMP"' EXIT INT TERM

if [ ! -x "$BIN" ]; then printf '找不到 %s\n' "$BIN"; exit 1; fi

mkdir -p "$TMP/cyc" "$TMP/ok"
cat > "$TMP/cyc/a.js" <<'EOF'
import { b } from "./b.js";
export const a = b;
EOF
cat > "$TMP/cyc/b.js" <<'EOF'
export { a } from "./a.js";
export const b = 1;
EOF
cat > "$TMP/ok/a.js" <<'EOF'
import { b } from "./b.js";
export const a = b;
EOF
cat > "$TMP/ok/b.js" <<'EOF'
export const b = 1;
EOF

printf '\n循环依赖检查对照\n----------------------\n'

# ---- 1. 真实项目 ----
JS_ALL="$(node "$JS" 2>&1)"; JS_RC=$?
C_ALL="$("$BIN" check circular 2>&1)"; C_RC=$?
JS_N="$(printf '%s' "$JS_ALL" | sed -n 's/扫描模块数: //p')"
C_N="$(printf '%s' "$C_ALL" | sed -n 's/扫描模块数: //p')"
[ "$JS_N" = "$C_N" ] && check "项目模块数一致 ($C_N)" "1" "1" || check "项目模块数一致" "$JS_N" "$C_N"
check "JS 版 0 环"      "无循环依赖" "$JS_ALL"
check "C 版 0 环"       "无循环依赖" "$C_ALL"
[ "$JS_RC" -eq 0 ] && [ "$C_RC" -eq 0 ] && check "两边退出码 0" "1" "1" || check "两边退出码 0" "1" "0"

# ---- 2. 有环 fixture ----
JS_CYC="$(node "$JS" "$TMP/cyc/a.js" 2>&1)"; JS_RC=$?
C_CYC="$("$BIN" check circular "$TMP/cyc/a.js" 2>&1)"; C_RC=$?
check "JS 检出环"       "发现循环依赖" "$JS_CYC"
check "C 检出环"        "发现循环依赖" "$C_CYC"
check "C 环路径含 a.js" "a.js"         "$C_CYC"
[ "$JS_RC" -eq 1 ] && [ "$C_RC" -eq 1 ] && check "有环两边退出码 1" "1" "1" || check "有环两边退出码 1" "1" "0"

# ---- 3. 无环 fixture ----
JS_OK="$(node "$JS" "$TMP/ok/a.js" 2>&1)"; JS_RC=$?
C_OK="$("$BIN" check circular "$TMP/ok/a.js" 2>&1)"; C_RC=$?
check "JS 无环"         "无循环依赖"   "$JS_OK"
check "C 无环"          "无循环依赖"   "$C_OK"
[ "$JS_RC" -eq 0 ] && [ "$C_RC" -eq 0 ] && check "无环两边退出码 0" "1" "1" || check "无环两边退出码 0" "1" "0"

printf '\n结果：%d 通过，%d 失败\n\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
