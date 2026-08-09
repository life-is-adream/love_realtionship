import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.join(process.cwd(), "long-simulation");
const files = (await readdir(root))
  .filter(name => /^0[3-9]_.*\.md$/.test(name) || /^1[0-2]_.*\.md$/.test(name))
  .sort((a, b) => a.localeCompare(b, "zh-CN"));

function extractDialogue(text) {
  const blocks = [];
  const lines = String(text).split(/\r?\n/);
  const labelPattern = /^(?:\*\*)?(我|周叙|男方|夏紫桐)(?:\[?\d+\]?)?：(?:\*\*)?\s*(.*)$/;
  let current = null;
  for (const line of lines) {
    const match = line.trim().match(labelPattern);
    if (match) {
      if (current?.text.trim()) blocks.push({ ...current, text: current.text.trim() });
      current = { speaker: match[1], text: match[2] || "" };
      continue;
    }
    if (!current) continue;
    if (/^(?:#{1,4}\s|---|\*\*【?恋爱大师|\*\*教练|>)/.test(line.trim())) {
      if (current.text.trim()) blocks.push({ ...current, text: current.text.trim() });
      current = null;
      continue;
    }
    if (line.trim()) current.text += `${current.text ? "\n" : ""}${line.trim()}`;
  }
  if (current?.text.trim()) blocks.push({ ...current, text: current.text.trim() });
  return blocks;
}

const rows = [];
const allDialogue = [];
for (const file of files) {
  const text = await readFile(path.join(root, file), "utf8");
  const dialogue = extractDialogue(text);
  const dialogueCharacters = dialogue.reduce((n, item) => n + item.text.replace(/\s/g, "").length, 0);
  const dialogueHanCharacters = dialogue.reduce((n, item) => n + (item.text.match(/\p{Script=Han}/gu) || []).length, 0);
  const normalized = dialogue.map(item => `${item.speaker}:${item.text.replace(/\s/g, "")}`);
  const duplicateRatio = normalized.length ? 1 - new Set(normalized).size / normalized.length : 1;
  const mojibakeHits = (text.match(/[ÃÂ]|(?:ç¬|ä¸|å¤|æ|é|è¿)/g) || []).length;
  const row = {
    file,
    totalCharacters: text.length,
    dialogueCharacters,
    dialogueHanCharacters,
    dialogueMessages: dialogue.length,
    maleMessages: dialogue.filter(item => item.speaker !== "夏紫桐").length,
    xiaMessages: dialogue.filter(item => item.speaker === "夏紫桐").length,
    duplicateRatio: Number(duplicateRatio.toFixed(4)),
    mojibakeHits
  };
  rows.push(row);
  allDialogue.push(...normalized);
}

const summary = {
  generatedAt: new Date().toISOString(),
  files: rows.length,
  totalCharacters: rows.reduce((n, row) => n + row.totalCharacters, 0),
  dialogueCharacters: rows.reduce((n, row) => n + row.dialogueCharacters, 0),
  dialogueHanCharacters: rows.reduce((n, row) => n + row.dialogueHanCharacters, 0),
  dialogueMessages: rows.reduce((n, row) => n + row.dialogueMessages, 0),
  duplicateRatio: allDialogue.length ? Number((1 - new Set(allDialogue).size / allDialogue.length).toFixed(4)) : 1,
  mojibakeHits: rows.reduce((n, row) => n + row.mojibakeHits, 0),
  requirementMet: rows.reduce((n, row) => n + row.dialogueHanCharacters, 0) >= 100_000
};

const result = { summary, chapters: rows };
await writeFile(path.join(root, "validation-summary.json"), JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify(result, null, 2));
if (!summary.requirementMet) process.exitCode = 2;
