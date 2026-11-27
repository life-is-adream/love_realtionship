#!/bin/sh
# 可行性探针（非产品代码）：验证 C 计算层能否编译为 wasm。
#
# 实测结论（2026-11-07，ziglang 0.17.1）：
#   1. wasm32-freestanding 可编最小 C，Node 能直接实例化并调用导出函数；
#      但该目标无 libc 头文件，现有源码用到 stdio/stdlib/string，编译不过。
#   2. wasm32-wasi 能编完整关系智能计算层（json/util/text/sha256/coach_analyze），
#      只差 timegm 的声明：wasi-libc 里其实有实现，只是 <time.h> 不声明。
#      用 -include wasi_compat.h 注入声明即可，无需改生产代码。
#   3. 产物 1.2MB（未裁剪，含 printf/sscanf/strtod 全套 libc），
#      且依赖 7 个 wasi_snapshot_preview1 导入（args_get/fd_write/proc_exit...），
#      浏览器必须额外引入 WASI shim（JS）才能实例化。
#
# 因此：技术上可行，但「前端全 C」不成立——DOM 操作与 wasm 加载都必须有 JS 胶水；
# 且计算层已在 C 服务端，再编一份浏览器 wasm 属于重复。
# 只有当目标是「无服务端的纯静态/离线单机版」时才值得做，
# 那时应改走 wasm32-freestanding + 自实现最小 libc，以去掉 WASI 导入。
set -e
cd "$(dirname "$0")/.." || exit 1

if [ -n "${ZIG_PY:-}" ]; then
    CC_PY="$ZIG_PY"
else
    CC_PY=""
    for cand in python python3 py \
        "/c/Users/${USERNAME:-lenovo}/AppData/Local/Programs/Python/Python310/python.exe"; do
        if command -v "$cand" >/dev/null 2>&1 && "$cand" -m ziglang version >/dev/null 2>&1; then
            CC_PY="$cand"; break
        fi
    done
    [ -n "$CC_PY" ] || { echo "找不到 ziglang，请设置 ZIG_PY" >&2; exit 1; }
fi

echo "[1/2] 最小探针（freestanding，无 libc）"
"$CC_PY" -m ziglang cc -target wasm32-freestanding -nostdlib -O2 \
    -Wl,--no-entry -Wl,--export=hf_add -Wl,--export=hf_ver -Wl,--export-memory \
    -o .wasm-probe/probe.wasm .wasm-probe/probe.c

echo "[2/2] 关系智能计算层（wasi）"
"$CC_PY" -m ziglang cc -target wasm32-wasi -O2 -Isrc \
    -include .wasm-probe/wasi_compat.h \
    -Wl,--no-entry -Wl,--export=hf_analyze -Wl,--export=hf_analysis_json \
    -Wl,--export=hf_parse_iso -Wl,--export-memory \
    -o .wasm-probe/coach-wasi.wasm \
    src/json.c src/util.c src/text.c src/sha256.c src/server/coach_analyze.c

ls -la .wasm-probe/*.wasm
echo "用 node 检查导入表："
node -e "
const fs=require('node:fs');
for (const f of ['probe.wasm','coach-wasi.wasm']) {
  const b=fs.readFileSync('.wasm-probe/'+f), m=new WebAssembly.Module(b);
  console.log(f, (b.length/1024).toFixed(1)+'KB',
    'exports='+WebAssembly.Module.exports(m).map(e=>e.name).join(','),
    'imports='+[...new Set(WebAssembly.Module.imports(m).map(i=>i.module))].join(',') || 'none');
}
"
