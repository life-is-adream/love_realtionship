# HeartFlow 停止脚本
# 读取 scripts/.heartflow.pid，结束核验后的服务进程并清理自己的 PID 文件
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "process-identity.ps1")

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
    Write-Host "PID 文件内容无效，已保留待核对。"
    exit 1
}

$target = [int]$pidValue
$proc = Get-Process -Id $target -ErrorAction SilentlyContinue
if (-not $proc) {
    Write-Host "进程 $target 已不存在（可能已自行退出），清理残留 PID 文件。"
    Remove-HeartFlowPidFileIfOwned -Path $pidFile -ProcessId $target
    exit 0
}

# PID 可能被系统复用。只允许停止带本项目绝对入口的 Node 进程。
# 无法核验时保留 PID 文件并退出，避免误杀其它任务。
try {
    $proc = Get-VerifiedHeartFlowProcess -ProcessId $target -ProjectDir $projectDir
} catch {
    Write-Host "无法确认服务进程属于本项目，已拒绝停止并保留 PID 文件。"
    exit 1
}

Write-Host "正在停止 HeartFlow (PID $target)..."
try {
    if ($proc -and -not $proc.HasExited) { $proc.Kill(); $proc.WaitForExit(5000) | Out-Null }
    if ($proc -and -not $proc.HasExited) { throw "服务进程未退出。" }
    Remove-HeartFlowPidFileIfOwned -Path $pidFile -ProcessId $target
} catch {
    Write-Host "停止进程失败，已保留 PID 文件供核对。"
    exit 1
}
Write-Host "HeartFlow 已停止。"
