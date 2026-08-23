// HeartFlow 后台启动脚本（跨平台，供 npm run start:bg 使用）
// 以 detached 方式启动 server/index.js，日志写入 scripts/heartflow.out.log / heartflow.err.log，
// 并把子进程 PID 写入 scripts/.heartflow.pid，供 scripts/stop-heartflow.ps1 停止。
import { spawn } from "node:child_process";
import { openSync, closeSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scriptsDir = __dirname;
const projectRoot = path.resolve(scriptsDir, "..");

const outLog = path.join(scriptsDir, "heartflow.out.log");
const errLog = path.join(scriptsDir, "heartflow.err.log");
const pidFile = path.join(scriptsDir, ".heartflow.pid");
const serverEntry = path.join(projectRoot, "server", "index.js");

// 从 .env 读取 PORT（与服务端 config.js 一致），缺省 3000，仅用于提示。
function readEnvPort() {
  try {
    const envPath = path.join(projectRoot, ".env");
    if (!existsSync(envPath)) return 3000;
    const content = readFileSync(envPath, "utf8");
    const match = content.match(/^\s*PORT\s*=\s*(\d+)\s*$/m);
    return match ? Number(match[1]) : 3000;
  } catch {
    return 3000;
  }
}

// 若已有 PID 文件指向存活进程，给出提示（不阻塞，随后覆盖写入新 PID）。
if (existsSync(pidFile)) {
  const existing = readFileSync(pidFile, "utf8").trim();
  if (/^\d+$/.test(existing)) {
    try {
      process.kill(Number(existing), 0);
      console.warn(`提示: 检测到 PID 文件指向仍在运行的进程 ${existing}，将覆盖写入新 PID。`);
    } catch {
      // 进程已不存在，忽略
    }
  }
}

const outFd = openSync(outLog, "w");
const errFd = openSync(errLog, "w");

const child = spawn(process.execPath, [serverEntry], {
  cwd: projectRoot,
  detached: true,
  stdio: ["ignore", outFd, errFd],
  windowsHide: true,
});

child.on("error", (err) => {
  console.error(`后台启动失败: ${err.message}`);
  process.exitCode = 1;
});

// 父进程关闭自己的文件句柄，子进程继续持有写入日志。
closeSync(outFd);
closeSync(errFd);

writeFileSync(pidFile, String(child.pid), "utf8");
child.unref();

const port = readEnvPort();
console.log(`HeartFlow 已在后台启动 (PID ${child.pid})`);
console.log(`访问地址: http://localhost:${port}`);
console.log(`日志: ${outLog}`);
console.log(`错误日志: ${errLog}`);
console.log("停止服务: 运行 scripts\\stop-heartflow.ps1");
