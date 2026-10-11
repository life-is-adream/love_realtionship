import { readFile } from "node:fs/promises";
import path from "node:path";
import { longSimulationDir } from "./config.js";
import { sendText } from "./http.js";

export const longContentFiles = {
  1: "03_第1章_重新联系与重新认识.md",
  2: "04_第2章_稳定联系与日常靠近.md",
  3: "05_第3章_低谷边界与信任考验.md",
  4: "06_第4章_喜欢出现但不急着命名.md",
  5: "07_第5章_确认关系与第一轮磨合.md",
  6: "08_第6章_亲密之后的普通日子.md",
  7: "09_第7章_现实冲突与关系修复.md",
  8: "10_第8章_家庭朋友与外部目光.md",
  9: "11_第9章_金钱时间与未来选择.md",
  10: "12_第10章_继续练习而不是童话结尾.md"
};

export async function handleLongContent(pathname, res) {
  const chapterStr = decodeURIComponent(pathname).replace(/^\/api\/long-content\/+/, "").split(/[\/?#]/)[0];
  const chapterNum = parseInt(chapterStr, 10);
  if (!Number.isInteger(chapterNum) || chapterNum < 1 || chapterNum > 10 || String(chapterNum) !== chapterStr) {
    return sendText(res, 400, "Bad Request: chapter must be an integer between 1 and 10");
  }

  const fileName = longContentFiles[chapterNum];
  if (!fileName) return sendText(res, 404, "Not Found: chapter file not registered");

  const filePath = path.normalize(path.join(longSimulationDir, fileName));
  if (!filePath.startsWith(longSimulationDir)) return sendText(res, 403, "Forbidden: path traversal detected");

  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(data);
  } catch {
    return sendText(res, 404, "Not Found: chapter file not found on disk");
  }
}
