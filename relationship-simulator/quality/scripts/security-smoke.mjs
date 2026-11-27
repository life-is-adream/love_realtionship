// S6 本地安全冒烟：不联网、不读取或打印 .env 值。
// 默认打生产 C 服务 heartflow-c/hf.exe（npm start 用的那一个）；
// HF_SECURITY_TARGET=node 时改打 Node 参照服务作对照。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const target = process.env.HF_SECURITY_TARGET || "c";
const port = Number(process.env.HF_SECURITY_PORT || 3397);
const base = `http://127.0.0.1:${port}`;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); };

if (target !== "c" && target !== "node") {
  console.error(`HF_SECURITY_TARGET 只能是 c 或 node，收到：${target}`);
  process.exit(2);
}
const label = target === "c" ? "C 服务 hf.exe" : "Node 参照服务";
const exe = path.join(root, "heartflow-c", "hf.exe");
if (target === "c" && !existsSync(exe)) {
  console.error(`找不到 ${path.relative(root, exe)}：先在 heartflow-c 下运行 sh build.sh`);
  process.exit(2);
}
const child = target === "c"
  ? spawn(exe, ["serve", "--port", String(port), "--root", "."], { cwd: root, stdio: "ignore" })
  : spawn("node", ["server/index.js"], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
let spawnError = "";
child.on("error", (error) => { spawnError = error.message; });

let ready = false;
for (let i = 0; i < 50 && !spawnError; i++) { await new Promise((r) => setTimeout(r, 100)); try { if ((await fetch(base + "/api/health")).ok) { ready = true; break; } } catch {} }

async function req(pathname, options) { return fetch(base + pathname, options); }
try {
  if (!ready) {
    check(`${label}在 ${base} 启动`, false, spawnError || "5 秒内 /api/health 未就绪（端口被占用？）");
  } else {
  let r = await req("/.env"); const text = await r.text();
  check(".env 不可下载", r.status === 404 || r.status === 403, `status=${r.status}`);
  check(".env 响应不含密钥", !/LLM_API_KEY|Bearer\s+[A-Za-z0-9_-]{20,}/.test(text), "");
  r = await req("/%2e%2e%2f.env"); check("编码路径穿越被拒绝", r.status !== 200, `status=${r.status}`);
  r = await req("/.git/config"); check(".git 不可下载", r.status !== 200, `status=${r.status}`);
  r = await req("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{bad json" });
  check("非法 JSON 返回 400", r.status === 400, `status=${r.status}`);
  r = await req("/api/v2/analyses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: Array.from({ length: 81 }, () => ({ speaker: "user", text: "x" })) }) });
  check("消息数上限", r.status === 400, `status=${r.status}`);
  r = await req("/api/v2/learning/recommendations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "边界", limit: 11 }) });
  check("检索 limit 上限", r.status === 400, `status=${r.status}`);
  r = await req("/api/v2/imports/screenshot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ self_side: "left", image_data_url: "data:image/png;base64,AAAA" }) });
  const consent = await r.json().catch(() => ({}));
  check("截图无授权不调用模型", r.status === 400 && consent.error === "consent_required", `status=${r.status} error=${consent.error}`);
  r = await req("/api/health", { headers: { Origin: "https://evil.example" } });
  check("CORS 不回显陌生 Origin", r.headers.get("access-control-allow-origin") !== "https://evil.example", `acao=${r.headers.get("access-control-allow-origin")}`);
  let saw429 = false;
  for (let i = 0; i < 30; i++) { const x = await req("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{bad" }); if (x.status === 429) { saw429 = true; break; } }
  check("聊天限流触发 429", saw429, "24/分钟");
  }
} finally { child.kill(); }

const failed = results.filter((x) => !x.ok);
for (const item of results) console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}${item.detail ? " (" + item.detail + ")" : ""}`);
console.log(`security smoke (${label}): ${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
await new Promise((resolve) => setTimeout(resolve, 300));
