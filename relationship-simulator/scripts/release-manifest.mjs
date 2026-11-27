#!/usr/bin/env node
// HeartFlow 发布清单：记下「当前生产二进制 = 哪份源码 + 怎么构建」，并在门禁里校验它没有漂移。
//   npm run release:manifest   重新生成 heartflow-c/RELEASE_MANIFEST.json（构建 → npm run gate 全绿 → 提交源码之后）
//   npm run release:check      校验磁盘上的 hf.exe、源码与清单是否一致（npm run gate 的最后一步）
//
// 为什么需要它：hf.exe 不入库（见 heartflow-c/.gitignore），而 2.1 / 2.2 两轮都出现过
// 「测的二进制不是跑的二进制」「验收文档记的哈希对不上磁盘文件」。这份清单是「被验收的那个 hf.exe」
// 在仓库里的唯一凭据。docs/heartflow-2.1/RELEASE_MANIFEST.json 是 2.1 发布时的历史快照，不再更新。
//
// 可复现性（2026-11-27 实测）：同目录、同输出名连续构建两次逐字节相同；换输出目录或文件名，
// 整文件哈希会变，但差异只有 30 多个字节，全在调试目录（PE 头与 .buildid 段：调试时间戳、
// PDB GUID、PDB 文件名），代码段与数据段逐字节不变。所以要复现发布哈希，只能在 heartflow-c/
// 下按默认输出名 `sh build.sh`。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = "heartflow-c/RELEASE_MANIFEST.json";
const BINARY = "heartflow-c/hf.exe";
const BUILD_SCRIPT = "heartflow-c/build.sh";
const SOURCE_DIR = "heartflow-c/src";
const ROLLBACK = ["heartflow-c/hf.pre-v2-20261113.exe"];
const SCHEMA = "heartflow-release-manifest/1";

const abs = (rel) => path.join(root, rel);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex").toUpperCase();
const short = (hash) => String(hash).slice(0, 12) + "…";
const iso = (ms) => new Date(ms).toISOString();
const die = (message) => { console.error(message); process.exit(2); };

/* ---------- 源码指纹 ---------- */

// 参与编译的全部输入：heartflow-c/src 下的 .c/.h，加上决定编译参数的 build.sh。
function sourceFiles() {
    const out = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith(".")) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.(c|h)$/.test(entry.name)) out.push(path.relative(root, full).split(path.sep).join("/"));
        }
    };
    walk(abs(SOURCE_DIR));
    out.push(BUILD_SCRIPT);
    return out.sort();
}

// 指纹与换行符无关（CRLF 先归一成 LF），这样 Windows 检出与 LF 检出得到同一个值。
function sourceDigest() {
    const files = sourceFiles();
    const total = createHash("sha256");
    for (const rel of files) {
        const lf = Buffer.from(readFileSync(abs(rel)).toString("latin1").replace(/\r\n/g, "\n"), "latin1");
        total.update(rel + "\0" + createHash("sha256").update(lf).digest("hex") + "\n");
    }
    return { files: files.length, digest: total.digest("hex").toUpperCase() };
}

/* ---------- git ---------- */

function git(args) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
    return result.error || result.status !== 0 ? null : result.stdout;
}

// 返回未提交的 C 引擎源码路径；git 不可用时返回 null（无法判断，不阻断）。
function uncommittedSource() {
    const out = git(["status", "--porcelain", "--", SOURCE_DIR, BUILD_SCRIPT]);
    return out === null ? null : out.split(/\r?\n/).filter(Boolean);
}

/* ---------- 工具链 ---------- */

function toolchain() {
    const candidates = process.env.ZIG_PY
        ? [process.env.ZIG_PY]
        : ["python", "python3", "py", path.join(os.homedir(), "AppData", "Local", "Programs", "Python", "Python310", "python.exe")];
    for (const python of candidates) {
        if (path.isAbsolute(python) && !existsSync(python)) continue;
        const result = spawnSync(python, ["-m", "ziglang", "version"], { encoding: "utf8", windowsHide: true, timeout: 20000 });
        const version = (result.stdout || "").trim();
        if (!result.error && result.status === 0 && /^\d+\.\d+\.\d+/.test(version)) return { ziglang: version, python };
    }
    return null;
}

/* ---------- 生成 ---------- */

function rollbackFiles() {
    const extra = [];
    const dir = abs("heartflow-c/backups");
    if (existsSync(dir)) {
        for (const name of readdirSync(dir)) if (name.toLowerCase().endsWith(".exe")) extra.push("heartflow-c/backups/" + name);
    }
    return [...ROLLBACK, ...extra.sort()];
}

function record(rel) {
    return { path: rel, bytes: statSync(abs(rel)).size, sha256: sha256(readFileSync(abs(rel))) };
}

function generate() {
    if (!existsSync(abs(BINARY))) die(`找不到 ${BINARY}：先在 heartflow-c 下运行 sh build.sh`);
    const builtAt = statSync(abs(BINARY)).mtimeMs;

    // 清单不能给「比源码旧」的二进制背书。
    const newer = sourceFiles().filter((rel) => statSync(abs(rel)).mtimeMs > builtAt + 1000);
    if (newer.length) {
        die(`hf.exe（${iso(builtAt)}）比以下源码旧，先在 heartflow-c 下重新运行 sh build.sh：\n  ${newer.join("\n  ")}`);
    }

    const uncommitted = uncommittedSource();
    const zig = toolchain();
    const digest = sourceDigest();
    const manifest = {
        schema: SCHEMA,
        generated_at: new Date().toISOString(),
        note: "当前生效的发布清单；docs/heartflow-2.1/RELEASE_MANIFEST.json 是 2.1 发布时的历史快照，不再更新。",
        build: {
            recipe: "cd heartflow-c && sh build.sh",
            output_name: "hf.exe",
            toolchain: zig ? `ziglang ${zig.ziglang}（${zig.python} -m ziglang cc）` : "未探测到 ziglang",
            reproducible: "同目录同输出名重建逐字节相同；换输出目录或文件名会改变整文件哈希（仅调试元数据），代码段不变。"
        },
        binary: { path: BINARY, bytes: statSync(abs(BINARY)).size, sha256: sha256(readFileSync(abs(BINARY))), modified: iso(builtAt) },
        source: {
            files: digest.files,
            digest_sha256: digest.digest,
            algorithm: "对 heartflow-c/src/**/*.{c,h} 与 heartflow-c/build.sh 按路径排序，逐项累加 '<路径>\\0<内容 SHA-256>\\n'；内容先把 CRLF 归一成 LF。"
        },
        git_head: (git(["rev-parse", "HEAD"]) || "").trim() || null,
        source_committed: uncommitted === null ? null : uncommitted.length === 0,
        rollback: rollbackFiles().filter((rel) => existsSync(abs(rel))).map(record)
    };
    writeFileSync(abs(MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
    console.log(`已生成 ${MANIFEST}`);
    console.log(`  hf.exe  ${manifest.binary.bytes} 字节  SHA-256 ${manifest.binary.sha256}`);
    console.log(`  源码指纹 ${manifest.source.digest_sha256.slice(0, 16)}…（${manifest.source.files} 个文件）  ${manifest.build.toolchain}`);
    console.log(`  回滚文件 ${manifest.rollback.length} 个`);
    if (uncommitted && uncommitted.length) {
        console.log(`\n警告：C 引擎源码有 ${uncommitted.length} 项未提交。提交之前，npm run gate 的「发布清单」一步会保持失败。`);
    }
}

/* ---------- 校验 ---------- */

function check() {
    const problems = [];
    const warnings = [];
    const pass = (name) => console.log(`PASS ${name}`);
    const fail = (name, detail) => { problems.push(name); console.log(`FAIL ${name}${detail ? "（" + detail + "）" : ""}`); };
    const warn = (name) => { warnings.push(name); console.log(`WARN ${name}`); };

    if (!existsSync(abs(MANIFEST))) {
        console.log(`FAIL 缺少 ${MANIFEST}（先运行 npm run release:manifest）`);
        process.exit(1);
    }
    let manifest;
    try { manifest = JSON.parse(readFileSync(abs(MANIFEST), "utf8")); } catch { manifest = null; }
    if (!manifest || manifest.schema !== SCHEMA) {
        console.log(`FAIL ${MANIFEST} 无法读取或版本不认识（需要 ${SCHEMA}）：运行 npm run release:manifest 重新生成`);
        process.exit(1);
    }

    if (!existsSync(abs(BINARY))) fail("生产二进制存在", `找不到 ${BINARY}，先在 heartflow-c 下运行 sh build.sh`);
    else {
        const actual = sha256(readFileSync(abs(BINARY)));
        if (actual !== String(manifest.binary.sha256).toUpperCase()) {
            fail("hf.exe 与清单一致", `磁盘 ${short(actual)}，清单 ${short(manifest.binary.sha256)}；二进制被重新构建过`);
        } else pass(`hf.exe 与清单一致（${short(actual)}，${manifest.binary.bytes} 字节）`);
    }

    try {
        const actual = sourceDigest();
        if (actual.digest !== String(manifest.source?.digest_sha256 || "").toUpperCase()) {
            fail("C 引擎源码与清单一致", `磁盘 ${short(actual.digest)}，清单 ${short(manifest.source?.digest_sha256)}；源码在清单生成后改过`);
        } else pass(`C 引擎源码与清单一致（${actual.files} 个文件）`);
    } catch (error) {
        fail("C 引擎源码指纹可计算", error.message);
    }

    const uncommitted = uncommittedSource();
    if (uncommitted === null) warn("git 不可用，无法确认 C 引擎源码已提交");
    else if (uncommitted.length === 0) pass("C 引擎源码已全部提交");
    else fail("C 引擎源码已全部提交", `${uncommitted.length} 项未提交：${uncommitted.slice(0, 3).join("、")}${uncommitted.length > 3 ? " 等" : ""}`);

    for (const entry of manifest.rollback || []) {
        if (!existsSync(abs(entry.path))) warnings.push(entry.path);
        else if (sha256(readFileSync(abs(entry.path))) !== String(entry.sha256).toUpperCase()) fail(`回滚文件完好 ${entry.path}`, "内容与清单不符");
    }
    if (warnings.length) console.log(`WARN 回滚文件不在本机（${warnings.length} 个，未入库属正常）：${warnings.slice(0, 3).join("、")}${warnings.length > 3 ? " 等" : ""}`);

    const zig = toolchain();
    if (zig && !manifest.build.toolchain.includes(zig.ziglang)) {
        console.log(`WARN 本机 ziglang ${zig.ziglang} 与清单记录的不一致，重建出的哈希可能与清单不同`);
    }

    if (problems.length) {
        console.log(`release manifest: ${problems.length} 项不一致 —— ${problems.join("；")}`);
        console.log("处理顺序：改了源码就重新构建并跑 npm run gate；全绿后提交源码，再 npm run release:manifest 更新清单。");
        process.exit(1);
    }
    console.log("release manifest: 清单、二进制、源码三者一致");
}

if (process.argv.includes("--check")) check();
else generate();
