// 为语义数据集填充 Unicode code point 证据偏移。仅在创作数据后运行一次。
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
for (const split of ["dev", "test"]) {
  const file = path.join(root, "quality", "datasets", "semantic", split + ".json");
  const data = JSON.parse(await readFile(file, "utf8"));
  for (const item of data.cases) {
    const source = item.other;
    const points = Array.from(source);
    const evidence = Array.from(item.evidence_text);
    let start = -1;
    for (let i = 0; i + evidence.length <= points.length; i++) {
      if (points.slice(i, i + evidence.length).join("") === evidence.join("")) { start = i; break; }
    }
    if (start < 0) throw new Error(`${item.id}: evidence_text 不在 other 中`);
    item.evidence_spans = [{ start, end: start + evidence.length, unit: "unicode_code_point" }];
  }
  await writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`${split}: ${data.cases.length} cases, spans normalized`);
}
