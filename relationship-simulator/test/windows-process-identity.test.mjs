import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

test("Windows PowerShell 5.1：进程核验、PID 归属和失败回滚均使用受控对象", { skip: process.platform !== "win32" }, async (t) => {
  const prefix = path.resolve(tmpdir(), "heartflow-process-test-");
  const fixture = await mkdtemp(prefix);
  t.after(async () => {
    assert.ok(path.resolve(fixture).startsWith(prefix) && path.dirname(fixture) === path.resolve(tmpdir()));
    await rm(fixture, { recursive: true, force: true });
  });
  const quote = (value) => `'${value.replace(/'/g, "''")}'`;
  const helpers = fileURLToPath(new URL("../scripts/process-identity.ps1", import.meta.url));
  const launcher = fileURLToPath(new URL("../scripts/launch-heartflow.ps1", import.meta.url));
  const stopper = fileURLToPath(new URL("../scripts/stop-heartflow.ps1", import.meta.url));
  const script = String.raw`
    $ErrorActionPreference = 'Stop'
    . ([scriptblock]::Create([IO.File]::ReadAllText(${quote(helpers)})))
    function Assert-Check($value, $label) { if (-not $value) { throw $label } }
    $project = 'E:\test project'
    $correct = [pscustomobject]@{ ExecutablePath = 'C:\node\node.exe'; CommandLine = '"C:\node\node.exe" "E:\test project\server\index.js"' }
    Assert-Check (Test-HeartFlowProcessIdentity $correct $project) 'correct identity rejected'
    foreach ($command in @('node.exe server/index.js', 'node.exe E:\other\server\index.js', 'node.exe -e anything')) {
      $wrong = [pscustomobject]@{ ExecutablePath = 'C:\node\node.exe'; CommandLine = $command }
      Assert-Check (-not (Test-HeartFlowProcessIdentity $wrong $project)) 'foreign identity accepted'
    }
    Assert-Check (Test-HeartFlowServiceResponse ([pscustomobject]@{ok=$true;service='heartflow'})) 'service rejected'
    Assert-Check (-not (Test-HeartFlowServiceResponse ([pscustomobject]@{ok=$true;service='other'}))) 'foreign service accepted'
    $pidFile = Join-Path ${quote(fixture)} '.heartflow.pid'
    Set-Content -LiteralPath $pidFile -Value '222' -Encoding ASCII
    Remove-HeartFlowPidFileIfOwned $pidFile 111
    Assert-Check (Test-Path -LiteralPath $pidFile) 'foreign PID file removed'
    $taskTokens = $null; $taskErrors = $null
    $launchAst = [Management.Automation.Language.Parser]::ParseFile(${quote(launcher)}, [ref]$taskTokens, [ref]$taskErrors)
    Assert-Check ($taskErrors.Count -eq 0) 'launcher syntax'
    $rollback = $launchAst.Find({ param($node) $node -is [Management.Automation.Language.IfStatementAst] -and $node.Extent.Text.StartsWith('if (-not $ready)') }, $true)
    $script:killCalls = 0
    $proc = [pscustomobject]@{ Id = 111; HasExited = $false }
    $proc | Add-Member ScriptMethod Kill { $script:killCalls++; $this.HasExited = $true }
    $proc | Add-Member ScriptMethod WaitForExit { param($waitMs) return $true }
    $ready = $false; $errLog = 'synthetic log'
    try { . ([scriptblock]::Create($rollback.Extent.Text)) } catch {
      Assert-Check ($_.Exception.Message -match '启动超时') 'unexpected rollback error'
    }
    Assert-Check ($script:killCalls -eq 1) 'rollback did not target original process'
    Assert-Check (Test-Path -LiteralPath $pidFile) 'rollback deleted newer PID file'
    Remove-HeartFlowPidFileIfOwned $pidFile 222
    Assert-Check (-not (Test-Path -LiteralPath $pidFile)) 'owned PID file retained'
    [Management.Automation.Language.Parser]::ParseFile(${quote(stopper)}, [ref]$taskTokens, [ref]$taskErrors) | Out-Null
    Assert-Check ($taskErrors.Count -eq 0) 'stopper syntax'
    'process guard and rollback: PASS'
  `;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 20000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /process guard and rollback: PASS/);
});
