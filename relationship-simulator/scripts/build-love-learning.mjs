// 生成「恋爱学习」页的数据：扫描已有课程、原样复制并归类，可选拷贝书籍。
// 运行：node scripts/build-love-learning.mjs  （在 relationship-simulator 目录下）
// 仅更新课程并保留全部书籍元数据/文件：node scripts/build-love-learning.mjs --courses-only
import { readFile, readdir, writeFile, mkdir, copyFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const simDir = path.join(__dirname, "..");
const projectRoot = path.join(simDir, "..");
const pubDir = path.join(simDir, "public");
const loveLearningDir = path.join(pubDir, "love-learning");
const coursesDir = path.join(projectRoot, "恋爱15分钟学习", "每日课程");

// 纵轴：恋爱 → 结婚 的七个阶段
const STAGES = [
  { id: "attraction", name: "认识吸引", order: 1 },
  { id: "connection", name: "建立联系", order: 2 },
  { id: "dating", name: "约会相处", order: 3 },
  { id: "commitment", name: "确立关系", order: 4 },
  { id: "stability", name: "经营稳定", order: 5 },
  { id: "repair", name: "危机修复", order: 6 },
  { id: "marriage", name: "婚姻家庭", order: 7 },
];

// 横轴：能力维度（参考《男人来自火星，女人来自金星》的关系分域）
const DIMS = [
  { id: "advance", name: "关系推进", order: 1 },
  { id: "communicate", name: "沟通与情绪", order: 2 },
  { id: "intimacy", name: "亲密与性", order: 3 },
  { id: "life", name: "生活与家庭", order: 4 },
  { id: "self", name: "自我与择偶", order: 5 },
];

const STAGE_KEYWORDS = {
  marriage: ["婚姻", "结婚", "婚礼", "求婚", "订婚", "同居", "育儿", "孩子", "生育", "孕期", "产后", "家务", "照护", "养老", "遗产", "退休", "白头", "夫妻", "配偶", "家庭", "离世", "丧失", "住房", "晚年", "中年", "老年"],
  repair: ["出轨", "背叛", "冷暴力", "家庭暴力", "分手", "挽回", "离婚", "分居", "不忠", "外遇", "成瘾", "失信", "控制", "信任重建", "原谅", "裂痕"],
  dating: ["约会", "表白", "友谊区", "邀约"],
};

const DIM_KEYWORDS = {
  advance: ["认识", "搭讪", "聊天", "邀约", "约会", "表白", "推进", "吸引", "新鲜感", "友谊区", "线上", "微信", "加微信", "见面", "开场", "追求", "把妹", "消息", "回复", "信号", "群体", "朋友圈"],
  communicate: ["沟通", "表达", "倾听", "共情", "冲突", "吵架", "情绪", "非暴力", "反馈", "道歉", "修复", "请求", "意见", "深度对话", "幽默", "说服", "协商", "欣赏", "感谢", "争吵"],
  intimacy: ["亲密", "身体", "明确同意", "同意可以", "避孕", "欲望", "性爱", "性生活", "性健康", "性压力", "房中", "谈性", "身体形象", "身体距离", "色情", "浪漫脚本"],
  life: ["金钱", "谈钱", "财务", "家务", "家庭", "异地", "育儿", "孩子", "生育", "父母", "老人", "住房", "生活", "频率", "隐私", "婚礼", "照护", "职业", "城市", "工作", "遗产", "退休", "同居", "钱"],
  self: ["自我", "择偶", "价值", "恋爱观", "颜值", "需求感", "需要感", "索取", "讨好", "恋爱脑", "吸渣", "原则", "理性", "准备", "单身", "成长", "独立", "依赖", "依恋", "边界", "心态", "标准", "形象", "社交", "操控", "博弈"],
};

// 161–179 是主题补充课，不能按课程序号误归到「婚姻家庭」。
const SUPPLEMENT_CLASSIFICATION = {
  161: ["attraction", "self"],
  162: ["attraction", "advance"],
  163: ["connection", "advance"],
  164: ["dating", "advance"],
  165: ["attraction", "self"],
  166: ["attraction", "self"],
  167: ["connection", "communicate"],
  168: ["repair", "self"],
  169: ["attraction", "self"],
  170: ["commitment", "self"],
  171: ["dating", "intimacy"],
  172: ["dating", "intimacy"],
  173: ["dating", "intimacy"],
  174: ["dating", "intimacy"],
  175: ["repair", "intimacy"],
  176: ["repair", "self"],
  177: ["repair", "self"],
  178: ["repair", "self"],
  179: ["connection", "communicate"],
};

function countHits(title, keywords) {
  let n = 0;
  for (const k of keywords) if (title.includes(k)) n++;
  return n;
}

function classifyStage(title, no) {
  // 强主题词（婚姻/危机/约会）优先纠正，其余按课程序号分带，形成稳定的「恋爱→结婚」阶梯
  if (countHits(title, STAGE_KEYWORDS.marriage) >= 1) return "marriage";
  if (countHits(title, STAGE_KEYWORDS.repair) >= 1) return "repair";
  if (countHits(title, STAGE_KEYWORDS.dating) >= 1) return "dating";
  if (no <= 13) return "attraction";
  if (no <= 20) return "dating";
  if (no <= 31) return "commitment";
  if (no <= 50) return "connection";
  if (no <= 85) return "stability";
  if (no <= 100) return "stability";
  return "marriage";
}

function classifyDim(title) {
  const fallback = countHits(title, DIM_KEYWORDS.self) >= 1 ? "self" : "advance";
  let best = fallback;
  let bestScore = -1;
  for (const [id, keywords] of Object.entries(DIM_KEYWORDS)) {
    const s = countHits(title, keywords);
    if (s > bestScore) { bestScore = s; best = id; }
  }
  return bestScore > 0 ? best : fallback;
}

// 课程文件名形如：2026-07-18-第01课-先别急着追人.md
const RE_COURSE = /^\d{4}-\d{2}-\d{2}-第(\d{1,3})课-(.+)\.md$/;

async function readGoal(filePath) {
  const text = await readFile(filePath, "utf8");
  const m = text.match(/##\s*今天的目标\s*\n+([^\n]+)/);
  if (m) return m[1].trim();
  const first = text.split("\n").find((l) => l.trim() && !l.trim().startsWith("#"));
  return first ? first.trim().slice(0, 60) : "";
}

// 19 本书（外道目录中的 [sxsy.org] txt）。kind: 科普/历史/注意/争议/高危
const BOOKS = [
  { id: "bundled-desire", src: "[sxsy.org]被捆绑的欲望.txt", title: "被捆绑的欲望", author: "佚名", dim: "intimacy", kind: "争议", note: "关于欲望与控制的通俗文本，含操控性内容，建议批判阅读。" },
  { id: "adult-training", src: "[sxsy.org]成年人修炼手册（4本合订版）.txt", title: "成年人修炼手册（4本合订版）", author: "佚名", dim: "self", kind: "注意", note: "自我成长类合订，观点混杂，需自行甄别。" },
  { id: "chat-up-art", src: "[sxsy.org]搭讪的最高境界.txt", title: "搭讪的最高境界", author: "佚名", dim: "advance", kind: "争议", note: "搭讪方法论，易滑向套路化，注意边界与尊重。" },
  { id: "sex-1000-qa", src: "[sxsy.org]夫妻性生活1000问—陈亦洋.txt", title: "夫妻性生活1000问", author: "陈亦洋", dim: "intimacy", kind: "科普", note: "性知识与性健康问答，可作参考，医疗问题以现行指南为准。" },
  { id: "guoke-sex-posts", src: "[sxsy.org]果壳性情精华帖汇总.txt", title: "果壳性情精华帖汇总", author: "果壳网", dim: "intimacy", kind: "科普", note: "科普向性话题合集，相对理性。" },
  { id: "red-pill-awakening", src: "[sxsy.org]红丸觉醒（B版）.txt", title: "红丸觉醒（B版）", author: "佚名", dim: "self", kind: "争议", note: "红丸（red pill）文本，含性别本质化倾向，勿当事实。" },
  { id: "rational-male-positive", src: "[sxsy.org]理智的男性：积极的男性气质—Rollo Tomassi.txt", title: "理智的男性：积极的男性气质", author: "Rollo Tomassi", dim: "self", kind: "争议", note: "红丸理论文本，观点有争议。" },
  { id: "rational-male-player", src: "[sxsy.org]理智的男性：玩家手册—Rollo Tomassi.txt", title: "理智的男性：玩家手册", author: "Rollo Tomassi", dim: "advance", kind: "争议", note: "红丸/玩家策略，含操控倾向。" },
  { id: "rational-male-preventive", src: "[sxsy.org]理智的男性：预防医学—Rollo Tomassi.txt", title: "理智的男性：预防医学", author: "Rollo Tomassi", dim: "self", kind: "争议", note: "红丸理论文本。" },
  { id: "rational-male-1", src: "[sxsy.org]理智的男性（第1本）.txt", title: "理智的男性（第1本）", author: "Rollo Tomassi", dim: "advance", kind: "争议", note: "红丸核心文本。" },
  { id: "rational-male-4-religion", src: "[sxsy.org]理智的男性（第4本：宗教）.txt", title: "理智的男性（第4本：宗教）", author: "Rollo Tomassi", dim: "self", kind: "争议", note: "红丸理论延伸。" },
  { id: "naked-woman", src: "[sxsy.org]裸女：女性身体的美丽与哀愁—戴斯蒙德·莫里斯.txt", title: "裸女：女性身体的美丽与哀愁", author: "戴斯蒙德·莫里斯", dim: "intimacy", kind: "科普", note: "人类学视角的身体文化解读，非情色用途。" },
  { id: "mystery-method", src: "[sxsy.org]谜男方法—Mystery.txt", title: "谜男方法", author: "Mystery", dim: "advance", kind: "高危", note: "PUA 经典，套路/操控密集，仅建议作为识别参考。" },
  { id: "emotion-secret", src: "[sxsy.org]情感秘籍.txt", title: "情感秘籍", author: "佚名", dim: "advance", kind: "争议", note: "话术合集，需边界意识。" },
  { id: "su-nujing", src: "[sxsy.org]素女经—无名氏.txt", title: "素女经", author: "佚名（古籍）", dim: "intimacy", kind: "历史", note: "中国古代房中/养生古籍，作史料看待。" },
  { id: "five-step-trap", src: "[sxsy.org]五步陷阱—死囚漫步.txt", title: "五步陷阱", author: "死囚漫步", dim: "advance", kind: "高危", note: "PUA 操控模型，仅作警惕与识别参考。" },
  { id: "five-step-trap-analysis", src: "[sxsy.org]五步陷阱技术深度解剖.txt", title: "五步陷阱技术深度解剖", author: "佚名", dim: "advance", kind: "高危", note: "对五步陷阱的解剖，含操控技术，务必警惕。" },
  { id: "snow-queen-no-contact", src: "[sxsy.org]雪地女王断联理论大全.txt", title: "雪地女王断联理论大全", author: "雪地女王", dim: "communicate", kind: "注意", note: "断联/分手策略，易滑向冷处理，请慎用。" },
  { id: "qdi-collection", src: "[sxsy.org]Q帝把妹文集（完美版）.txt", title: "Q帝把妹文集（完美版）", author: "Q帝", dim: "advance", kind: "争议", note: "把妹文集，套路化明显。" },
];

async function fileStat(filename) {
  try {
    const info = await stat(filename);
    return info.isFile() ? info : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function prepareBooks(previousBooks, bookSourceDirectory, outputDirectory) {
  const definitions = [...BOOKS, ...previousBooks.filter((book) => !BOOKS.some((item) => item.id === book.id))];
  const prepared = [];
  const missing = [];
  const warnings = [];
  for (const definition of definitions) {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(String(definition.id))) {
      throw new Error("书籍 ID 不合法；未更新文件。");
    }
    const previous = previousBooks.find((book) => book.id === definition.id);
    const book = { ...definition, ...previous };
    const src = definition.src ? path.resolve(bookSourceDirectory, definition.src) : null;
    const sourceContained = src?.startsWith(path.resolve(bookSourceDirectory) + path.sep);
    const sourceStat = sourceContained ? await fileStat(src) : null;
    const defaultFile = `love-learning/books/${definition.id}.txt`;
    if (sourceStat) {
      book.file = defaultFile;
      book.bytes = sourceStat.size;
      prepared.push({ book, source: src, destination: path.join(outputDirectory, "books", `${definition.id}.txt`) });
      continue;
    }
    const file = previous?.file || defaultFile;
    const published = path.resolve(outputDirectory, "..", file);
    const contained = published.startsWith(path.resolve(outputDirectory) + path.sep);
    const publishedStat = contained ? await fileStat(published) : null;
    if (!publishedStat) {
      missing.push(definition.id);
      continue;
    }
    book.file = file;
    book.bytes = publishedStat.size;
    prepared.push({ book, source: null });
    warnings.push(`来源缺失，保留已有公开书籍及元数据：${definition.id}`);
  }
  if (missing.length) throw new Error(`书籍来源与公开副本均不可用：${missing.join(", ")}；未更新课程或 manifest。`);
  return { prepared, warnings };
}

export async function buildLoveLearning({
  sourceDirectory = coursesDir,
  outputDirectory = loveLearningDir,
  bookSourceDirectory = path.join(projectRoot, "外道"),
  coursesOnly = false,
  onWarning = (message) => console.warn(message),
} = {}) {
  const manifestPath = path.join(outputDirectory, "manifest.json");
  const previousManifest = existsSync(manifestPath)
    ? JSON.parse(await readFile(manifestPath, "utf8"))
    : {};
  if (previousManifest.books !== undefined && !Array.isArray(previousManifest.books)) {
    throw new Error("已有 manifest 的 books 必须是数组；未更新文件。");
  }
  const entries = (await readdir(sourceDirectory)).sort();
  const courses = [];
  const copies = [];
  for (const name of entries) {
    const m = name.match(RE_COURSE);
    if (!m) continue;
    const no = parseInt(m[1], 10);
    const title = m[2].trim();
    const source = path.join(sourceDirectory, name);
    const goal = await readGoal(source);
    const classification = SUPPLEMENT_CLASSIFICATION[no];
    const filename = `${String(no).padStart(3, "0")}.md`;
    courses.push({
      no,
      title,
      goal,
      stage: classification?.[0] || classifyStage(title, no),
      dim: classification?.[1] || classifyDim(title),
      date: name.slice(0, 10),
      file: `love-learning/courses/${filename}`,
    });
    copies.push({ source, filename });
  }
  courses.sort((a, b) => a.no - b.no);
  if (!courses.length || courses.some((course, index) => course.no !== index + 1)) {
    throw new Error("课程编号必须从 1 开始连续且唯一；未更新 manifest。");
  }

  // 在写入任何课程、书籍或 manifest 前验证书籍可用性。
  const bookPlan = coursesOnly ? null : await prepareBooks(previousManifest.books || [], bookSourceDirectory, outputDirectory);
  const books = coursesOnly ? previousManifest.books || [] : bookPlan.prepared.map((item) => item.book);
  for (const warning of bookPlan?.warnings || []) onWarning(warning);

  const courseOutputDirectory = path.join(outputDirectory, "courses");
  await mkdir(courseOutputDirectory, { recursive: true });
  for (const { source, filename } of copies) {
    await copyFile(source, path.join(courseOutputDirectory, filename));
  }

  // 缺少来源时只保留已有公开资产，不改写其内容。
  const outputBooksDirectory = path.join(outputDirectory, "books");
  if (!coursesOnly) await mkdir(outputBooksDirectory, { recursive: true });
  for (const item of bookPlan?.prepared || []) {
    if (item.source) await copyFile(item.source, item.destination);
  }

  const manifest = {
    ...previousManifest,
    generated_at: new Date().toISOString(),
    stages: STAGES,
    dims: DIMS,
    course_count: courses.length,
    book_count: coursesOnly ? previousManifest.book_count ?? books.filter((b) => b.file).length : books.filter((b) => b.file).length,
    courses,
    books,
  };

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

async function main() {
  const options = process.argv.slice(2);
  if (options.some((option) => option !== "--courses-only")) {
    throw new Error("只支持可选参数 --courses-only。");
  }
  const coursesOnly = options.includes("--courses-only");
  const { courses, books } = await buildLoveLearning({ coursesOnly });
  console.log(`courses: ${courses.length}`);
  console.log(`${coursesOnly ? "books preserved" : "books copied"}: ${books.filter((b) => b.file).length}/${books.length}`);
  console.log(`manifest -> public/love-learning/manifest.json`);
  if (!coursesOnly) for (const b of books) if (!b.file) console.log(`  MISSING: ${b.src}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) main().catch((e) => {
  console.error(e);
  process.exit(1);
});
