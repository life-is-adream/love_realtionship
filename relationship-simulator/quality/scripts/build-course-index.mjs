// 构建 179 课结构化分块索引，供审计、引用与离线语义检索使用。
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(await readFile(path.join(root, "public", "love-learning", "manifest.json"), "utf8"));
const courses = [];
for (const item of manifest.courses.slice(0, 179)) {
  const rel = item.file;
  const body = await readFile(path.join(root, "public", rel), "utf8");
  const lines = body.split(/\r?\n/);
  const chunks = [];
  let heading = "正文", start = 1, buffer = [];
  const flush = (end) => {
    const text = buffer.join("\n").trim();
    if (!text) { buffer = []; return; }
    const points = Array.from(text);
    for (let i = 0; i < points.length; i += 280) {
      const piece = points.slice(i, i + 280).join("");
      if (Array.from(piece).length < 20) continue;
      chunks.push({ id: `${item.no}#${chunks.length}`, section: heading, line_start: start, line_end: end, text: piece, length: Array.from(piece).length });
    }
    buffer = [];
  };
  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i])) { flush(i); heading = lines[i].replace(/^#{1,6}\s+/, "").trim() || "正文"; start = i + 1; }
    else buffer.push(lines[i]);
  }
  flush(lines.length);
  courses.push({ no: Number(item.no), title: item.title, goal: String(item.goal || ""), file: rel, body_sha256: createHash("sha256").update(body).digest("hex"), chunks });
}
const index = { version: "course-index-2.1.0", generated_at: new Date().toISOString(), courses: courses.length, chunks: courses.reduce((s, c) => s + c.chunks.length, 0), data: courses };
const out = path.join(root, "public", "love-learning", "semantic-index", "index.json");
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(index) + "\n", "utf8");
console.log(`index: ${index.courses} courses, ${index.chunks} chunks`);
