# HeartFlow 启动器（健壮版）
# - 单实例：端口已被本项目占用时直接打开浏览器；被其他程序占用时明确警告并退出
# - 后台隐藏启动 node server/index.js，日志写入 scripts/heartflow.out.log / heartflow.err.log
# - 20 秒就绪等待；Chrome/Edge 找不到时降级为系统默认浏览器
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "process-identity.ps1")

$projectDir = Split-Path -Parent $PSScriptRoot
$defaultPort = 3000
$port = $defaultPort
$envFile = Join-Path $projectDir ".env"
$pidFile = Join-Path $PSScriptRoot ".heartflow.pid"
$outLog = Join-Path $PSScriptRoot "heartflow.out.log"
$errLog = Join-Path $PSScriptRoot "heartflow.err.log"

if (-not (Test-Path -LiteralPath (Join-Path $projectDir "package.json"))) {
    throw "HeartFlow 项目目录不存在: $projectDir"
}

# ---- 读取 .env 中的 PORT ----
if (Test-Path -LiteralPath $envFile) {
    $portLine = Get-Content -LiteralPath $envFile -ErrorAction SilentlyContinue |
        Where-Object { $_ -match '^\s*PORT\s*=\s*\d+' } |
        Select-Object -First 1
    if ($portLine -match '=\s*(\d+)') {
        $port = [int]$Matches[1]
    }
}

$url = "http://127.0.0.1:$port"

# ---- 探测浏览器（Chrome / Edge） ----
$browserCandidates = @(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\Application\msedge.exe")
)
$browser = $browserCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1

# ---- 健康检查：/api/health 返回 ok:true 即视为本项目已就绪 ----
function Test-HeartFlowReady {
    try {
        $health = Invoke-RestMethod -Uri ($url + "/api/health") -Method Get -TimeoutSec 2
        if (-not (Test-HeartFlowServiceResponse $health)) { return $false }
        foreach ($listenerId in (Get-HeartFlowListenerProcessIds -Port $port)) {
            $verified = Get-VerifiedHeartFlowProcess -ProcessId $listenerId -ProjectDir $projectDir
            if ($verified) { return $true }
        }
        return $false
    } catch {
        return $false
    }
}

# ---- 端口是否被监听（PS5.1 兼容：Get-NetTCPConnection 不可用时回退 netstat） ----
function Test-PortListening {
    param([int]$Port)
    try {
        $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
        return ($null -ne $listeners)
    } catch {
        $line = netstat -ano 2>$null | Select-String -Pattern ("TCP\s+.*:{0}\s+.*LISTENING" -f $Port) | Select-Object -First 1
        return ($null -ne $line)
    }
}

function Open-Browser {
    param([string]$TargetUrl)
    if ($browser) {
        Start-Process -FilePath $browser -ArgumentList $TargetUrl | Out-Null
    } else {
        Write-Host "未找到 Chrome/Edge，使用系统默认浏览器打开。"
        Start-Process $TargetUrl | Out-Null
    }
}

# ---- 单实例 + 端口归属判断 ----
if (Test-PortListening -Port $port) {
    if (Test-HeartFlowReady) {
        Write-Host "检测到 HeartFlow 已在运行，直接打开浏览器，不重复启动服务。"
        Open-Browser -TargetUrl $url
        Write-Host "HeartFlow is ready: $url"
        exit 0
    }

    Write-Host ""
    Write-Host "警告：端口 $port 已被占用，但该端口上的 /api/health 未通过，说明占用者不是本项目。"
    Write-Host "请先关闭占用该端口的程序，或修改 .env 中的 PORT 换一个端口后重试。"
    Write-Host "排查命令：netstat -ano | findstr :$port"
    exit 1
}

# ---- 启动服务（隐藏后台 + 日志 + PID） ----
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) {
    throw "未找到 node，请先安装 Node.js 并确保其在 PATH 中。"
}

Write-Host "正在后台启动 HeartFlow 服务 (端口 $port)..."
# --- Work around a PowerShell 5.1 defect: Start-Process throws
# "ArgumentException: An item with the same key has already been added"
# when the inherited environment contains case-duplicated keys (for
# example HTTP_PROXY and http_proxy, injected by MSYS-style launchers or
# some proxy agents). Drop every *_PROXY / NO_PROXY spelling from this
# process so the child-process environment dictionary builds cleanly.
# Safe for this local launcher: core training features run fully offline.
$proxyEnvKeys = @([System.Environment]::GetEnvironmentVariables("Process").Keys) |
    Where-Object { $_ -match "(?i)^(http|https|all|no)_proxy$" }
foreach ($proxyKey in $proxyEnvKeys) {
    [System.Environment]::SetEnvironmentVariable($proxyKey, $null, "Process")
}

$proc = Start-Process -FilePath $nodePath `
    -ArgumentList ('"' + (Join-Path $projectDir "server\index.js") + '"') `
    -WorkingDirectory $projectDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -PassThru

$null = $proc.Handle

Set-Content -LiteralPath $pidFile -Value $proc.Id -Encoding ASCII

# ---- 就绪等待（20 秒） ----
$ready = $false
for ($attempt = 1; $attempt -le 20; $attempt++) {
    Start-Sleep -Seconds 1
    if (Test-HeartFlowReady) {
        $ready = $true
        break
    }
}

if (-not $ready) {
    Write-Host ""
    Write-Host "HeartFlow 未能在 20 秒内就绪，正在回滚本次启动。"
    try {
        # 只操作 Start-Process 返回的原始进程对象，不从共享 PID 文件选目标。
        if (-not $proc.HasExited) { $proc.Kill(); $proc.WaitForExit(5000) | Out-Null }
        if ($proc.HasExited) { Remove-HeartFlowPidFileIfOwned -Path $pidFile -ProcessId $proc.Id }
    } catch {
        Write-Host "本次进程回滚失败，已保留 PID 文件。"
    }
    Write-Host "请查看错误日志: $errLog"
    throw "HeartFlow 启动超时（20 秒未就绪）。请检查 $errLog"
}

Write-Host "HeartFlow is ready: $url"
Open-Browser -TargetUrl $url
