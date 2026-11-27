// C/Node 语义契约逐条对照。比较枚举、abstain、证据 span 与安全标志，不比较自由文本。
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = Number(process.env.HF_PARITY_PORT || 3299);
const exe = path.join(root, "heartflow-c", "hf.exe");
const { analyzeV2 } = await import(new URL("../../server/v2.js", import.meta.url));
const child = spawn(exe, ["serve", "--port", String(port), "--root", root], { cwd: root, stdio: "ignore" });
const stop = () => { try { child.kill(); } catch {} };
process.on("exit", stop);
let ready = false;
for (let i = 0; i < 50 && !ready; i++) {
  await new Promise((r) => setTimeout(r, 100));
  try { const r = await fetch(`http://127.0.0.1:${port}/api/v2/practice/scenarios`); ready = r.ok; } catch {}
}
if (!ready) { console.error("C 服务未启动"); stop(); process.exit(2); }

const rows = [];
for (const split of ["dev", "test"]) {
  const data = JSON.parse(await readFile(path.join(root, "quality", "datasets", "semantic", split + ".json"), "utf8"));
  for (const item of data.cases) {
    const messages = [{ id: "msg_001", speaker: "user", text: item.user }, { id: "msg_002", speaker: "other", text: item.other }];
    const node = analyzeV2(messages).decision;
    const response = await fetch(`http://127.0.0.1:${port}/api/v2/analyses`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages }) });
    const c = (await response.json()).decision;
    const nEv = node.evidence?.[0] || null, cEv = c.evidence?.[0] || null;
    const mismatch = [];
    if (node.category !== c.category) mismatch.push(`category ${node.category}/${c.category}`);
    if (node.abstain !== c.abstain) mismatch.push(`abstain ${node.abstain}/${c.abstain}`);
    if (node.evidence_status !== c.evidence_status) mismatch.push(`evidence_status ${node.evidence_status}/${c.evidence_status}`);
    if (!!node.safety?.threat_detected !== !!c.safety?.threat_detected) mismatch.push("threat");
    if (JSON.stringify(nEv && { message_id: nEv.message_id, start: nEv.start, end: nEv.end, text: nEv.text }) !== JSON.stringify(cEv && { message_id: cEv.message_id, start: cEv.start, end: cEv.end, text: cEv.text })) mismatch.push(`evidence ${JSON.stringify(nEv)} / ${JSON.stringify(cEv)}`);
    rows.push({ id: item.id, mismatch });
  }
}
const bad = rows.filter((r) => r.mismatch.length);
stop();
console.log(`semantic parity: ${rows.length - bad.length}/${rows.length} matched`);
for (const row of bad.slice(0, 20)) console.log(`- ${row.id}: ${row.mismatch.join("; ")}`);
process.exit(bad.length ? 1 : 0);
