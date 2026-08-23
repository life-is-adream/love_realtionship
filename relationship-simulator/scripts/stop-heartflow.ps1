# HeartFlow 停止脚本
# 读取 scripts/.heartflow.pid，结束对应进程树并清理 PID 文件
$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $PSScriptRoot ".heartflow.pid"

if (-not (Test-Path -LiteralPath $pidFile)) {
    Write-Host "未找到 PID 文件: $pidFile"
    Write-Host "HeartFlow 可能不是通过启动脚本/后台脚本启动的，无需用本脚本停止。"
    Write-Host "如果服务仍在运行，可用: netstat -ano | findstr :3000 找到进程，再用 taskkill /PID <pid> /F 结束。"
    exit 0
}

$pidValue = (Get-Content -LiteralPath $pidFile -Raw).Trim()
if ($pidValue -notmatch '^\d+$') {
    Write-Host "PID 文件内容无效（'$pidValue'），删除残留文件。"
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    exit 0
}

$target = [int]$pidValue
$proc = Get-Process -Id $target -ErrorAction SilentlyContinue
if (-not $proc) {
    Write-Host "进程 $target 已不存在（可能已自行退出），清理残留 PID 文件。"
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    exit 0
}

Write-Host "正在停止 HeartFlow (PID $target)..."
& taskkill /PID $target /T /F 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "taskkill 返回码 $LASTEXITCODE，进程可能已退出；仍会清理 PID 文件。"
}
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
Write-Host "HeartFlow 已停止。"
