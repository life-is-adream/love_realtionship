# 供启动/停止脚本共用：只核验身份和处理自己拥有的 PID 文件。
function Test-HeartFlowProcessIdentity {
    param($ProcessInfo, [string]$ProjectDir)
    if (-not $ProcessInfo) { return $false }
    $entry = [System.IO.Path]::GetFullPath((Join-Path $ProjectDir "server\index.js"))
    $command = ([string]$ProcessInfo.CommandLine).Replace('/', '\')
    $pattern = '(?i)^\s*"?[^"]*node(?:\.exe)?"?\s+"?' + [regex]::Escape($entry) + '"?\s*$'
    return ([System.IO.Path]::GetFileName($ProcessInfo.ExecutablePath) -ieq "node.exe" -and $command -match $pattern)
}

function Get-VerifiedHeartFlowProcess {
    param([int]$ProcessId, [string]$ProjectDir)
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $process) { return $null }
    # 提前打开原进程的 OS 句柄；后续退出或 PID 复用不能把 Kill 转向另一个进程。
    $null = $process.Handle
    $info = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
    if ($process.HasExited -or -not (Test-HeartFlowProcessIdentity $info $ProjectDir)) {
        throw "无法确认服务进程属于本项目，已拒绝操作。"
    }
    return $process
}

function Remove-HeartFlowPidFileIfOwned {
    param([string]$Path, [int]$ProcessId)
    if (Test-Path -LiteralPath $Path) {
        $saved = (Get-Content -LiteralPath $Path -Raw).Trim()
        if ($saved -eq [string]$ProcessId) {
            Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
        }
    }
}

function Test-HeartFlowServiceResponse {
    param($Response)
    return ($Response.ok -eq $true -and $Response.service -eq "heartflow")
}

function Get-HeartFlowListenerProcessIds {
    param([int]$Port)
    try {
        return @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
            Select-Object -ExpandProperty OwningProcess -Unique)
    } catch {
        $ids = @()
        foreach ($line in (netstat -ano 2>$null)) {
            if ($line -match ("TCP\s+.*:{0}\s+.*LISTENING\s+(\d+)\s*$" -f $Port)) {
                $ids += [int]$Matches[1]
            }
        }
        return @($ids | Select-Object -Unique)
    }
}
