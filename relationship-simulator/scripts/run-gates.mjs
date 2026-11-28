#!/usr/bin/env node
// HeartFlow 统一门禁：发布前必须全绿的检查，一条命令跑完。
//   npm run gate                 全部步骤（顺序执行，避免端口与 CPU 争用）
//   npm run gate -- --list       只列出步骤
//   npm run gate -- --only a,b   只跑指定步骤（id 用逗号分隔）
//
// 全部步骤只用本地假上游 / 假推理后端 / 合成数据：不读真实聊天，不调用真实模型，不消耗额度。
// 需要真实模型或真实浏览器的验证（heartflow-c/tests/real-e2e.py、npm run e2e:browser --live）
// 是手动步骤，不在这里。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const PYTHON = process.env.PYTHON || "python";
const STEP_TIMEOUT_MS = Number(process.env.HF_GATE_TIMEOUT_MS || 20 * 60 * 1000);
const EXE = path.join(root, "heartflow-c", "hf.exe");

/* ---------- 工具定位 ---------- */

// Windows 上 sh 不一定在 PATH 里（Git for Windows 默认只把 cmd/ 加进去），逐个试。
function findSh() {
    if (process.env.HF_SH) return process.env.HF_SH;
    const names = process.platform === "win32" ? ["sh.exe", "sh"] : ["sh"];
    for (const dir of (process.env.PATH || "").split(path.delimiter)) {
        for (const name of names) {
            const candidate = path.join(dir.replace(/^"|"$/g, ""), name);
            if (existsSync(candidate)) return candidate;
        }
    }
    for (const base of ["D:\\Git", "C:\\Program Files\\Git", "C:\\Program Files (x86)\\Git", "C:\\Git"]) {
        for (const sub of ["bin\\sh.exe", "usr\\bin\\sh.exe"]) {
            const candidate = path.join(base, sub);
            if (existsSync(candidate)) return candidate;
        }
    }
    return null;
}

const SH = findSh();
const needExe = () => (existsSync(EXE) ? null : "找不到 heartflow-c/hf.exe：先在 heartflow-c 下运行 sh build.sh");
const needSh = () => (SH ? null : "未找到 sh：安装 Git for Windows，或设置 HF_SH=<sh.exe 路径>");

/* ---------- 执行 ---------- */

let current = null;
process.on("SIGINT", () => { try { current?.kill(); } catch {} process.exit(130); });

function exec(command, args, cwd = root) {
    return new Promise((resolve) => {
        const started = Date.now();
        const lines = [];
        let child;
        try {
            child = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
        } catch (error) {
            resolve({ ok: false, error: error.message, lines: [], ms: 0 });
            return;
        }
        current = child;
        // 只留末尾若干行：全量输出很长，定位失败看尾部就够。
        const keep = (chunk) => {
            for (const line of chunk.toString().split(/\r?\n/)) {
                const clean = line.replace(/\x1b\[[0-9;]*m/g, "").trim();
                if (!clean) continue;
                lines.push(clean.length > 220 ? clean.slice(0, 220) + "…" : clean);
                if (lines.length > 800) lines.shift();
            }
        };
        child.stdout.on("data", keep);
        child.stderr.on("data", keep);
        let done = false;
        const timer = setTimeout(() => {
            child.kill();
            finish({ ok: false, error: `超过 ${Math.round(STEP_TIMEOUT_MS / 60000)} 分钟未结束，已终止` });
        }, STEP_TIMEOUT_MS);
        const finish = (result) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            current = null;
            resolve({ ...result, lines, ms: Date.now() - started });
        };
        child.on("error", (error) => finish({
            ok: false,
            error: error.code === "ENOENT"
                ? `找不到可执行文件 ${command}（要运行 ${args[0]}）`
                : `无法运行 ${command}：${error.message}`
        }));
        child.on("close", (code) => finish({ ok: code === 0 }));
    });
}

async function sequence(commands) {
    let ok = true;
    let ms = 0;
    const lines = [];
    for (const [command, args] of commands) {
        const result = await exec(command, args);
        ok = ok && result.ok;
        ms += result.ms;
        lines.push(...result.lines);
        if (result.error) lines.push(result.error);
        if (!result.ok) break;
    }
    return { ok, ms, lines };
}

/* ---------- 步骤 ---------- */

const steps = [
    {
        id: "c-regression", title: "C 回归 7 组（CLI / 服务端 / Node 对照 / chat 代理 / TTS / 循环依赖）",
        need: () => needSh() || needExe(), run: () => exec(SH, ["tests/run-all.sh"], path.join(root, "heartflow-c"))
    },
    { id: "v2-contract", title: "v2 契约与隐私（打生产 hf.exe）", need: needExe, run: () => exec(PYTHON, ["heartflow-c/tests/v2-smoke.py", "heartflow-c/hf.exe"]) },
    { id: "retrieval-parity", title: "C/Node 课程检索一致性", need: needExe, run: () => exec(node, ["quality/scripts/check-retrieval-parity.mjs"]) },
    { id: "semantic-parity", title: "C/Node 语义一致性", need: needExe, run: () => exec(node, ["quality/scripts/check-semantic-parity.mjs"]) },
    { id: "rules-parity", title: "C/浏览器 JS 规则一致性（教练/时机/回放）", need: needExe, run: () => exec(node, ["quality/scripts/check-rules-parity.mjs"]) },
    { id: "datasets", title: "数据集结构与泄漏校验", run: () => exec(node, ["quality/scripts/validate-datasets.mjs"]) },
    { id: "js-unit", title: "Node 单元测试", run: () => exec(node, ["--test"]) },
    {
        id: "structure", title: "循环依赖与编码约定（JS + C）", need: needExe,
        run: () => sequence([
            [node, ["scripts/check-circular.mjs"]],
            [node, ["scripts/check-conventions.mjs"]],
            [EXE, ["check", "circular"]]
        ])
    },
    { id: "security", title: "安全冒烟（打生产 C 服务）", need: needExe, run: () => exec(node, ["quality/scripts/security-smoke.mjs"]) },
    { id: "release", title: "发布清单（二进制 = 源码 = 已提交）", run: () => exec(node, ["scripts/release-manifest.mjs", "--check"]) }
];

// 各步骤固定占用的端口：被占用说明上次门禁残留了服务，先提示再跑，免得对着失败日志猜。
const PORTS = {
    "c-regression": [3101, 3102, 3201, 3110, 3111, 3112, 3310, 3120, 3320],
    "retrieval-parity": [Number(process.env.HF_RETRIEVAL_PARITY_PORT || 3298)],
    "semantic-parity": [Number(process.env.HF_PARITY_PORT || 3299)],
    "rules-parity": [Number(process.env.HF_RULES_PORT || 3296)],
    security: [Number(process.env.HF_SECURITY_PORT || 3397)]
};
const listening = (port) => new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.setTimeout(700, () => { socket.destroy(); resolve(false); });
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("error", () => resolve(false));
});
async function busyPorts(ids) {
    const jobs = [];
    for (const id of ids) for (const port of PORTS[id] || []) jobs.push(listening(port).then((busy) => (busy ? port : null)));
    return (await Promise.all(jobs)).filter(Boolean);
}

async function runStep(step) {
    console.log(`\n▶ ${step.id}  ${step.title}`);
    const blocker = step.need ? step.need() : null;
    const result = blocker ? { ok: false, error: blocker, lines: [], ms: 0 } : await step.run();
    console.log(`${result.ok ? "PASS" : "FAIL"}  ${step.id}  ${(result.ms / 1000).toFixed(1)}s`);
    for (const line of result.lines.slice(result.ok ? -6 : -40)) console.log("      " + line);
    if (result.error) console.log("      " + result.error);
    return { id: step.id, ok: result.ok, ms: result.ms };
}

/* ---------- 入口 ---------- */

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
    console.log("用法：npm run gate [-- --only <id,id,...> | --list]\n环境变量：PYTHON=<python 路径>  HF_SH=<sh.exe 路径>  HF_GATE_TIMEOUT_MS=<单步超时>");
    process.exit(0);
}
if (argv.includes("--list")) {
    for (const step of steps) console.log(`${step.id.padEnd(18)} ${step.title}`);
    process.exit(0);
}

const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
let selected = steps;
if (only !== null && only !== undefined) {
    const wanted = String(only).split(",").map((id) => id.trim()).filter(Boolean);
    const unknown = wanted.filter((id) => !steps.some((step) => step.id === id));
    if (unknown.length || !wanted.length) {
        console.error(`未知步骤：${unknown.join(", ") || "(空)"}\n可用步骤：${steps.map((step) => step.id).join(", ")}`);
        process.exit(2);
    }
    selected = steps.filter((step) => wanted.includes(step.id));
}

const busy = await busyPorts(selected.map((step) => step.id));
if (busy.length) console.log(`⚠ 以下门禁端口已被占用（上次残留的服务？），对应步骤可能失败：${busy.join("、")}`);

const started = Date.now();
const results = [];
for (const step of selected) results.push(await runStep(step));

const seconds = (ms) => (ms / 1000).toFixed(1).padStart(7) + "s";
console.log("\n================ 门禁汇总 ================");
for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.id.padEnd(18)} ${seconds(result.ms)}`);
const passed = results.filter((result) => result.ok).length;
console.log(`${passed}/${results.length} 步通过，合计 ${((Date.now() - started) / 1000).toFixed(0)} 秒${passed === results.length ? "" : " —— 修复后重跑 npm run gate"}`);
process.exitCode = passed === results.length ? 0 : 1;
