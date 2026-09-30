/**
 * 长篇章节索引构建脚本
 *
 * 解析 long-simulation/ 目录下的 10 章 markdown 原文，
 * 按章拆分生成（P2-13 A 方案）：
 *   - public/modules/content/long-content-manifest.js  章节元信息 + chunk 映射（首屏加载）
 *   - public/modules/content/long-content/chapter-XX.js  单章完整数据（懒加载 chunk）
 *
 * 消费方通过 public/modules/content/long-content-loader.js 取数，
 * 不要直接 import 生成的 manifest / chunk 文件。
 *
 * 解析规则与 validate-long-simulation.mjs 的 extractDialogue 保持一致。
 * 不引入任何 npm 依赖，仅使用 node:fs / node:path 原生模块。
 *
 * 注意：10 章 markdown 的格式各不相同（章节标题分隔符、小节编号方式、
 * 复盘标题格式、对话行 bold 标记等），本脚本使用宽泛的正则匹配，
 * 兼容所有变体格式。
 *
 * 运行方式：node scripts/build-long-index.mjs
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const longSimulationDir = path.join(projectRoot, "long-simulation");
const contentDir = path.join(projectRoot, "public", "modules", "content");
const manifestPath = path.join(contentDir, "long-content-manifest.js");
const chunkDir = path.join(contentDir, "long-content");

// ── 正则规则 ─────────────────────────────────────────────────────────────────

/**
 * 章节标题：# 第N章[：:｜|]标题
 * 兼容中文数字和阿拉伯数字，兼容：、｜、| 分隔符
 */
const RE_CHAPTER_TITLE = /^#\s*第[一二三四五六七八九十百\d]+章[：:｜|]\s*(.+)$/;

/**
 * 复盘/分析标题：## 或 ### 或 #### 开头，包含"恋爱大师"且包含"复盘"/"分析"/"拆解"
 * 兼容各种格式变体：
 *   ### 恋爱大师复盘 1
 *   ### 恋爱大师分析 6
 *   ### 恋爱大师最终分析
 *   ### 第4回合｜...，恋爱大师分析一
 *   #### 恋爱大师分析一｜...
 *   ## 恋爱大师拆解一：...
 *   ### 恋爱大师分析
 *   #### 恋爱大师分析
 */
const RE_REVIEW_HEADER = /^#{2,4}\s+.*恋爱大师.*(复盘|分析|拆解)/;

/**
 * 小节标题：## 开头，不包含"恋爱大师"
 * 兼容各种格式：
 *   ## 1. 加回联系方式
 *   ## 一、第一周：...
 *   ## 场景一：...
 *   ## 第1场：...
 */
const RE_SECTION_HEADER = /^##\s+(?!.*恋爱大师)(.+)$/;

/** 四要素（仅第1章部分复盘使用此格式） */
const RE_INTENT = /^-\s*\*\*意图\*\*[：:]\s*(.*)$/;
const RE_BENEFIT = /^-\s*\*\*好处\*\*[：:]\s*(.*)$/;
const RE_RISK = /^-\s*\*\*风险\*\*[：:]\s*(.*)$/;
const RE_CORRECTION = /^-\s*\*\*修正\*\*[：:]\s*(.*)$/;

/**
 * 对话行（与 validate-long-simulation.mjs 的 extractDialogue 保持一致）
 * 兼容：
 *   **我：** text
 *   **周叙：** text
 *   周叙：text
 *   夏紫桐：text
 *   **夏紫桐：** text
 */
const RE_DIALOGUE = /^(?:\*\*)?(我|周叙|男方|夏紫桐)(?:\[?\d+\]?)?[：:](?:\*\*)?\s*(.*)$/;

// ── 章节摘要 ─────────────────────────────────────────────────────────────────

const CHAPTER_SUMMARIES = {
  1: "从加回联系方式到重新形成聊天习惯。",
  2: "稳定联系与日常靠近，在普通生活里建立共同话题。",
  3: "低谷边界与信任考验，学习在对方说\u201c不\u201d时稳定存在。",
  4: "喜欢出现但不急着命名，允许感情自然生长。",
  5: "确认关系与第一轮磨合，在亲密中保持个体边界。",
  6: "亲密之后的普通日子，如何在日常中维持连接。",
  7: "现实冲突与关系修复，处理分歧而非回避。",
  8: "家庭朋友与外部目光，在外部压力下保持关系内核。",
  9: "金钱时间与未来选择，面对现实议题的沟通。",
  10: "继续练习而不是童话结尾，把沟通变成持续的习惯。"
};

// ── 解析逻辑 ─────────────────────────────────────────────────────────────────

/**
 * 从文件名提取章节序号
 * @param {string} fileName - 如 "03_第1章_重新联系与重新认识.md"
 * @returns {number|null}
 */
function extractChapterId(fileName) {
  const match = fileName.match(/第(\d+)章/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * 从文件名提取章节标题（去掉"第N章_"前缀和".md"后缀）
 * @param {string} fileName
 * @returns {string}
 */
function extractTitleFromFileName(fileName) {
  const base = fileName.replace(/\.md$/, "");
  const match = base.match(/第\d+章[_\s]*(.+)/);
  return match ? match[1].trim() : base;
}

/**
 * 判断对话行是否为男方
 * @param {string} speaker - 对话行中的说话者
 * @returns {boolean}
 */
function isMale(speaker) {
  return speaker === "我" || speaker === "周叙" || speaker === "男方";
}

/**
 * 解析单章 markdown 原文，提取结构化数据
 * @param {string} rawText - markdown 原文
 * @param {number} chapterId - 章节序号
 * @param {string} fileName - 源文件名
 * @returns {Object} ChapterMeta
 */
function parseChapter(rawText, chapterId, fileName) {
  const lines = rawText.split(/\r?\n/);
  const title = extractTitleFromFileName(fileName);
  const summary = CHAPTER_SUMMARIES[chapterId] || "";

  const sections = [];
  const reviewPoints = [];

  let currentSection = null;
  let currentReview = null;
  let lastMaleDialogue = "";
  let lastFemaleFollowup = "";
  let reviewCounter = 0;
  let sectionDialogueCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const trimmed = line.trim();

    // 章节标题（跳过）
    if (RE_CHAPTER_TITLE.test(line)) {
      continue;
    }

    // 复盘/分析标题（优先于小节标题检测）
    if (RE_REVIEW_HEADER.test(line)) {
      // 关闭上一个复盘
      if (currentReview) {
        finalizeReview(currentReview, reviewPoints);
      }
      reviewCounter += 1;
      // 从行中提取标题文本
      const headerText = trimmed.replace(/^#{2,4}\s*/, "");
      currentReview = {
        id: `${chapterId}-r${reviewCounter}`,
        sectionId: currentSection ? currentSection.id : "",
        title: headerText,
        intent: "",
        benefit: "",
        risk: "",
        correction: "",
        note: "",
        originalMaleReply: lastMaleDialogue,
        originalFemaleFollowup: lastFemaleFollowup,
        _paragraphLines: []
      };
      continue;
    }

    // 小节标题（## 开头且不包含"恋爱大师"）
    const sectionMatch = line.match(RE_SECTION_HEADER);
    if (sectionMatch) {
      // 关闭上一个小节
      if (currentSection) {
        currentSection.lineEnd = lineNum - 1;
        currentSection.dialogueCount = sectionDialogueCount;
        sections.push(currentSection);
      }
      currentSection = {
        id: `${chapterId}-${sections.length + 1}`,
        title: sectionMatch[1].trim(),
        lineStart: lineNum,
        lineEnd: lineNum,
        dialogueCount: 0
      };
      sectionDialogueCount = 0;
      continue;
    }

    // 四要素检测（仅在复盘上下文中）
    if (currentReview) {
      const intentMatch = line.match(RE_INTENT);
      if (intentMatch) {
        currentReview.intent = intentMatch[1].trim();
        continue;
      }
      const benefitMatch = line.match(RE_BENEFIT);
      if (benefitMatch) {
        currentReview.benefit = benefitMatch[1].trim();
        continue;
      }
      const riskMatch = line.match(RE_RISK);
      if (riskMatch) {
        currentReview.risk = riskMatch[1].trim();
        continue;
      }
      const correctionMatch = line.match(RE_CORRECTION);
      if (correctionMatch) {
        currentReview.correction = correctionMatch[1].trim();
        continue;
      }
    }

    // 对话行检测（兼容 bold 和非 bold 格式）
    const dialogueMatch = trimmed.match(RE_DIALOGUE);
    if (dialogueMatch) {
      const speaker = dialogueMatch[1];
      const text = (dialogueMatch[2] || "").trim();
      if (text) {
        if (isMale(speaker)) {
          lastMaleDialogue = text;
          lastFemaleFollowup = "";
        } else {
          // 女方对话：如果上一条是男方对话，则这是女方的后续反应
          if (lastMaleDialogue) {
            lastFemaleFollowup = text;
          }
        }
        if (currentSection) sectionDialogueCount++;
      }
      continue;
    }

    // 段落文本（复盘的描述性文字，非空、非标题、非引用块）
    if (currentReview && trimmed && !trimmed.startsWith("#") && !trimmed.startsWith(">")) {
      currentReview._paragraphLines.push(trimmed);
    }
  }

  // 关闭最后一个小节
  if (currentSection) {
    currentSection.lineEnd = lines.length;
    currentSection.dialogueCount = sectionDialogueCount;
    sections.push(currentSection);
  }

  // 关闭最后一个复盘
  if (currentReview) {
    finalizeReview(currentReview, reviewPoints);
  }

  return {
    id: chapterId,
    title,
    file: fileName,
    summary,
    sections,
    reviewPoints
  };
}

/**
 * 完成复盘点的处理：如果没有四要素，将段落文本存入 note 字段
 * @param {Object} review - 复盘点对象
 * @param {Array} reviewPoints - 复盘点数组
 */
function finalizeReview(review, reviewPoints) {
  const hasFourElements = review.intent || review.benefit || review.risk || review.correction;
  if (!hasFourElements && review._paragraphLines.length > 0) {
    review.note = review._paragraphLines.join(" ");
  }
  const sourceText = [
    review.title,
    review.intent,
    review.benefit,
    review.risk,
    review.correction,
    review.note,
    review.originalMaleReply,
    review.originalFemaleFollowup
  ].filter(Boolean).join(" ");
  review.searchText = normalizeSearchText(sourceText).slice(0, 1600);
  review.searchTerms = buildSearchTerms(sourceText);
  review.tags = inferSearchTags(sourceText);
  review.searchExcerpt = normalizeSearchText(
    review.correction || review.note || review.benefit || review.risk || review.intent || review.title
  ).slice(0, 360);
  delete review._paragraphLines;
  reviewPoints.push(review);
}

function normalizeSearchText(value) {
  return String(value || "")
    .replace(/[*_`>#\[\]（）()]/g, " ")
    .replace(/[“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchTerms(value) {
  const text = normalizeSearchText(value).toLowerCase();
  const terms = new Set(text.split(/[^\p{L}\p{N}\u3400-\u9fff]+/u).filter((term) => term.length > 1));
  const compact = text.replace(/\s+/g, "");
  for (let size = 2; size <= 4; size += 1) {
    for (let i = 0; i <= compact.length - size; i += 1) {
      const gram = compact.slice(i, i + size);
      if (/^[\u3400-\u9fff]+$/.test(gram)) terms.add(gram);
    }
  }
  const aliases = [
    ["邀约", "约见"], ["被拒", "拒绝"], ["冷却", "降温"],
    ["追问", "连续发问"], ["边界", "空间"], ["误读", "过度解读"]
  ];
  for (const [a, b] of aliases) {
    if (compact.includes(a)) terms.add(b);
    if (compact.includes(b)) terms.add(a);
  }
  return [...terms].slice(0, 240);
}

function inferSearchTags(value) {
  const text = normalizeSearchText(value);
  const rules = [
    ["邀约", /邀约|约见|见面|出来|一起/],
    ["边界", /边界|空间|拒绝|不方便|不想|改天/],
    ["冷却", /冷却|降温|忙|累|没回|不回|晚安|休息/],
    ["追问", /追问|连续|查户口|问题太多/],
    ["误读", /误读|过度解读|猜测|推理/],
    ["推进", /推进|主动|下一步|关系/]
  ];
  return ["复盘", ...rules.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag)];
}

// ── 输出：manifest + 按章 chunk ──────────────────────────────────────────────

/**
 * 章节序号 → 两位文件名编号（1 → "01"）
 * @param {number} chapterId
 * @returns {string}
 */
function chunkNumber(chapterId) {
  return String(chapterId).padStart(2, "0");
}

async function writeOutputs(chapters) {
  // 生成前清空 chunk 目录，避免旧章节文件残留
  await rm(chunkDir, { recursive: true, force: true });
  await mkdir(chunkDir, { recursive: true });

  const header = "// 此文件由 scripts/build-long-index.mjs 自动生成，请勿手动编辑。\n// 运行 npm run build:index 重新生成。消费方请使用 long-content-loader.js。\n\n";

  // 每章一个 chunk（compact JSON，无缩进）
  for (const chapter of chapters) {
    const chunkFile = path.join(chunkDir, `chapter-${chunkNumber(chapter.id)}.js`);
    await writeFile(chunkFile, `${header}export const chapter = ${JSON.stringify(chapter)};\n`, "utf8");
  }

  // manifest：仅章元信息 + chunk 映射（首屏唯一加载的长篇数据）
  const manifest = {
    generatedAt: new Date().toISOString().slice(0, 10),
    source: "scripts/build-long-index.mjs",
    totalChapters: chapters.length,
    chapters: chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      file: chapter.file,
      summary: chapter.summary,
      reviewCount: chapter.reviewPoints.length,
      sectionCount: chapter.sections.length,
      chunk: `long-content/chapter-${chunkNumber(chapter.id)}.js`
    }))
  };
  await writeFile(manifestPath, `${header}export const longContentManifest = ${JSON.stringify(manifest)};\n`, "utf8");
}

// ── 主流程 ───────────────────────────────────────────────────────────────────

async function main() {
  const files = (await readdir(longSimulationDir))
    .filter((name) => /^0[3-9]_.*\.md$/.test(name) || /^1[0-2]_.*\.md$/.test(name))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));

  console.log(`找到 ${files.length} 个章节文件：`);
  files.forEach((f) => console.log(`  ${f}`));

  const chapters = [];
  for (const fileName of files) {
    const chapterId = extractChapterId(fileName);
    if (!chapterId) {
      console.warn(`  跳过：无法从文件名提取章节序号 - ${fileName}`);
      continue;
    }
    const rawText = await readFile(path.join(longSimulationDir, fileName), "utf8");
    const chapter = parseChapter(rawText, chapterId, fileName);
    chapters.push(chapter);
    console.log(`  第${chapterId}章 "${chapter.title}"：${chapter.reviewPoints.length} 个复盘点，${chapter.sections.length} 个小节`);
  }

  await writeOutputs(chapters);
  console.log(`\n索引已生成：${manifestPath}`);
  console.log(`共 ${chapters.length} 章 chunk（${chunkDir}），${chapters.reduce((n, c) => n + c.reviewPoints.length, 0)} 个复盘点。`);
}

main().catch((err) => {
  console.error("构建失败：", err);
  process.exit(1);
});
