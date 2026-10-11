import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

// 执行真实入口，仅将平台、文件和进程接口替换为受控对象，不启动服务。
const source = (await readFile(new URL("../scripts/start-bg.mjs", import.meta.url), "utf8"))
  .replace(/^import .*;\r?$/gm, "")
  .replaceAll("import.meta.url", '"file:///fixture/start-bg.mjs"');

function fixture({ pidContents = "111", probeError = null } = {}) {
  const scriptsDir = "E:\\fixture project\\scripts";
  const pidFile = path.win32.join(scriptsDir, ".heartflow.pid");
  const outLog = path.win32.join(scriptsDir, "heartflow.out.log");
  const errLog = path.win32.join(scriptsDir, "heartflow.err.log");
  const files = new Map([[outLog, "original output"], [errLog, "original error"]]);
  if (pidContents !== null) files.set(pidFile, pidContents);
  const probes = [], opened = [], closed = [], spawned = [], output = [];
  let unrefCalls = 0;
  const env = {
    path: path.win32,
    fileURLToPath: () => path.win32.join(scriptsDir, "start-bg.mjs"),
    existsSync: (name) => files.has(name),
    readFileSync: (name) => files.get(name),
    writeFileSync: (name, value) => files.set(name, value),
    openSync: (name, mode) => { opened.push({ name, mode }); files.set(name, ""); return opened.length; },
    closeSync: (fd) => closed.push(fd),
    spawn: (...args) => {
      spawned.push(args);
      return { pid: 222, on() {}, unref() { unrefCalls++; } };
    },
    process: {
      execPath: "C:\\node\\node.exe",
      kill: (pid, signal) => { probes.push({ pid, signal }); if (probeError) throw probeError; }
    },
    console: { warn: (value) => output.push(value), error: (value) => output.push(value), log: (value) => output.push(value) }
  };
  return { files, pidFile, outLog, errLog, probes, opened, closed, spawned, output,
    run: () => vm.runInNewContext(source, env), unrefCalls: () => unrefCalls };
}

function assertPreserved(subject, pidContents) {
  assert.equal(subject.files.get(subject.pidFile), pidContents);
  assert.equal(subject.files.get(subject.outLog), "original output");
  assert.equal(subject.files.get(subject.errLog), "original error");
  assert.equal(subject.opened.length, 0);
  assert.equal(subject.spawned.length, 0);
  assert.equal(subject.output.length, 0, "拒绝启动不能输出成功提示");
}

test("后台入口拒绝重复启动，保留活 PID 和既有日志且不 spawn", () => {
  const subject = fixture();
  assert.throws(subject.run, /仍在运行.*拒绝重复启动/);
  assert.deepEqual(subject.probes, [{ pid: 111, signal: 0 }]);
  assertPreserved(subject, "111");
});

test("仅 ESRCH 表示旧 PID 已退出，后台入口可以正常启动受控子进程", () => {
  const subject = fixture({ probeError: Object.assign(new Error("missing"), { code: "ESRCH" }) });
  subject.run();
  assert.deepEqual(subject.probes, [{ pid: 111, signal: 0 }]);
  assert.equal(subject.spawned.length, 1);
  assert.equal(subject.spawned[0][0], "C:\\node\\node.exe");
  assert.equal(subject.spawned[0][1][0], "E:\\fixture project\\server\\index.js");
  assert.equal(subject.spawned[0][2].windowsHide, true);
  assert.equal(subject.files.get(subject.pidFile), "222");
  assert.equal(subject.opened.length, 2);
  assert.equal(subject.closed.length, 2);
  assert.equal(subject.unrefCalls(), 1);
  assert.match(subject.output.join("\n"), /已在后台启动/);
});

test("权限错误和未知探测错误均拒绝启动并说明无法确认，保留 PID 和日志", () => {
  for (const code of ["EPERM", "EACCES", undefined]) {
    const subject = fixture({ probeError: Object.assign(new Error("synthetic failure"), { code }) });
    assert.throws(subject.run, /无法确认已有 PID 是否存活.*拒绝启动/);
    assertPreserved(subject, "111");
  }
});

test("无效 PID 不传给进程探测，拒绝启动并保留原文件", () => {
  for (const pidContents of ["", "abc", "0", "-1", "2147483648", "99999999999999999999"]) {
    const subject = fixture({ pidContents });
    assert.throws(subject.run, /PID 文件内容无效.*拒绝启动/);
    assert.equal(subject.probes.length, 0);
    assertPreserved(subject, pidContents);
  }
});

test("无 PID 文件时后台入口保留正常启动路径，仅使用受控子进程", () => {
  const subject = fixture({ pidContents: null });
  subject.run();
  assert.equal(subject.probes.length, 0);
  assert.equal(subject.spawned.length, 1);
  assert.equal(subject.files.get(subject.pidFile), "222");
  assert.equal(subject.unrefCalls(), 1);
});
