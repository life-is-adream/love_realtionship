import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COURSE_ROOT = path.join(PROJECT_ROOT, "恋爱15分钟学习");
const DAILY_ROOT = path.join(COURSE_ROOT, "每日课程");
const OUTLINE_PATH = path.join(COURSE_ROOT, "课程总纲.md");
const AUTOMATION_ROOT = path.join(homedir(), ".codex", "automations", "15");
const AUTOMATION_CONFIG_PATH = path.join(AUTOMATION_ROOT, "automation.toml");
const AUTOMATION_MEMORY_PATH = path.join(AUTOMATION_ROOT, "memory.md");
const EXPECTED_COUNT = 179;
const EXPECTED_START = "2026-07-18";
const EXPECTED_END = "2027-01-12";
const COURSE_NAME_RE = /^(?<date>\d{4}-\d{2}-\d{2})-第(?<lesson>\d{2,3})课-(?<title>.+)\.md$/u;

function fail(message) {
  const error = new Error(message);
  error.code = "AUDIT_INPUT_ERROR";
  throw error;
}

function parseArgs(argv) {
  const args = { json: false, date: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") {
      args.json = true;
      continue;
    }
    if (value === "--date") {
      args.date = argv[index + 1];
      index += 1;
      continue;
    }
    fail(`未知参数：${value}`);
  }
  return args;
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function currentShanghaiDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateText, amount) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function uniqueCount(records, key) {
  return new Set(records.map((record) => record[key])).size;
}

function parseTomlString(text, key) {
  const match = text.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "mu"));
  return match?.[1] || null;
}

function requiredHeadings(text, lesson) {
  return {
    goal: /^##\s+今天的目标/mu.test(text),
    concept: /^##\s+3 分钟核心概念/mu.test(text),
    scenario: /^##\s+5 分钟场景示例/mu.test(text),
    exercise: /^##\s+3 分钟练习/mu.test(text),
    action: /^##\s+2 分钟现实行动/mu.test(text),
    review: /^##\s+(?:2 分钟\s*)?复盘与边界提醒/mu.test(text),
    basis: lesson === 1 || /^##\s+依据/mu.test(text)
  };
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function auditCourses(targetDate) {
  const names = (await readdir(DAILY_ROOT)).filter((name) => name.endsWith(".md")).sort();
  const records = [];
  const invalidNames = [];

  for (const name of names) {
    const match = name.match(COURSE_NAME_RE);
    if (!match) {
      invalidNames.push(name);
      continue;
    }
    const text = await readFile(path.join(DAILY_ROOT, name), "utf8");
    const lesson = Number(match.groups.lesson);
    records.push({
      name,
      date: match.groups.date,
      lesson,
      title: match.groups.title,
      sha256: createHash("sha256").update(text).digest("hex"),
      headings: requiredHeadings(text, lesson)
    });
  }

  const byLesson = [...records].sort((left, right) => left.lesson - right.lesson);
  const expectedLessons = Array.from({ length: EXPECTED_COUNT }, (_, index) => index + 1);
  const lessonSequence = byLesson.map((record) => record.lesson);
  const dateSequence = byLesson.map((record) => record.date);
  const expectedDates = Array.from({ length: EXPECTED_COUNT }, (_, index) => addDays(EXPECTED_START, index));
  const headingFailures = records
    .filter((record) => Object.values(record.headings).some((value) => !value))
    .map((record) => ({ name: record.name, headings: record.headings }));
  const todayMatches = records.filter((record) => record.date === targetDate);

  return {
    directoryExists: true,
    count: records.length,
    expectedCount: EXPECTED_COUNT,
    invalidNames,
    lessonSequence: {
      continuous: JSON.stringify(lessonSequence) === JSON.stringify(expectedLessons),
      first: lessonSequence[0] ?? null,
      last: lessonSequence.at(-1) ?? null
    },
    dateSequence: {
      continuous: JSON.stringify(dateSequence) === JSON.stringify(expectedDates),
      first: dateSequence[0] ?? null,
      last: dateSequence.at(-1) ?? null,
      expectedFirst: EXPECTED_START,
      expectedLast: EXPECTED_END
    },
    duplicates: {
      lesson: records.length - uniqueCount(records, "lesson"),
      date: records.length - uniqueCount(records, "date"),
      title: records.length - uniqueCount(records, "title"),
      sha256: records.length - uniqueCount(records, "sha256")
    },
    headingFailures,
    targetDate,
    todayMatches: todayMatches.map(({ name, lesson, title, sha256 }) => ({ name, lesson, title, sha256 }))
  };
}

async function auditAutomation(targetDate) {
  const configText = await readOptional(AUTOMATION_CONFIG_PATH);
  const memoryText = await readOptional(AUTOMATION_MEMORY_PATH);
  const configChecks = configText
    ? {
        active: parseTomlString(configText, "status") === "ACTIVE",
        dailyAt1100: parseTomlString(configText, "rrule") === "RRULE:FREQ=DAILY;BYHOUR=11;BYMINUTE=0",
        shanghaiMentioned: configText.includes("Asia/Shanghai"),
        fileDriven: configText.includes("不要生成新课程") && configText.includes("只读取并发送"),
        completeDeliveryContract: configText.includes("完整读取并发送") && configText.includes("今日15分钟课程")
      }
    : null;

  const memoryLines = memoryText
    ? memoryText.split(/\r?\n/u).filter((line) => line.includes(`${targetDate} Asia/Shanghai`))
    : [];
  const completeMemoryLines = memoryLines.filter((line) => line.includes("唯一匹配文件") && line.includes("已完整读取并发送"));
  let deliveryStatus = "missing_or_ambiguous";
  if (completeMemoryLines.length === 1 && memoryLines.length === 1) deliveryStatus = "verified_in_memory";
  else if (memoryLines.length === 0) deliveryStatus = "no_memory_evidence";
  else if (memoryLines.length > 1) deliveryStatus = "duplicate_or_ambiguous_memory_entries";
  else if (completeMemoryLines.length === 0) deliveryStatus = "incomplete_memory_evidence";

  return {
    configPath: AUTOMATION_CONFIG_PATH,
    memoryPath: AUTOMATION_MEMORY_PATH,
    configExists: Boolean(configText),
    configChecks,
    deliveryEvidence: {
      targetDate,
      memoryMatchCount: memoryLines.length,
      completeMemoryMatchCount: completeMemoryLines.length,
      status: deliveryStatus,
      note: "发送记忆不是唯一证据；缺少记忆只表示缺少可验证记录，不等于确定未发送。"
    }
  };
}

function summarizeStatus(courseAudit, automationAudit) {
  const coursePass = courseAudit.count === EXPECTED_COUNT
    && courseAudit.invalidNames.length === 0
    && courseAudit.lessonSequence.continuous
    && courseAudit.dateSequence.continuous
    && Object.values(courseAudit.duplicates).every((value) => value === 0)
    && courseAudit.headingFailures.length === 0
    && courseAudit.todayMatches.length === 1;
  const automationPass = Boolean(automationAudit.configExists)
    && Object.values(automationAudit.configChecks || {}).every(Boolean);
  if (!coursePass || !automationPass) return "FAIL";
  if (automationAudit.deliveryEvidence.status !== "verified_in_memory") return "PASS_WITH_WARNINGS";
  return "PASS";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetDate = args.date || currentShanghaiDate();
  if (!isIsoDate(targetDate)) fail(`日期必须是有效的 YYYY-MM-DD：${targetDate}`);

  const outline = await readOptional(OUTLINE_PATH);
  if (!outline?.trim()) fail(`课程总纲缺失或为空：${OUTLINE_PATH}`);
  const courseAudit = await auditCourses(targetDate);
  const automationAudit = await auditAutomation(targetDate);
  const report = {
    generatedAt: new Date().toISOString(),
    targetDate,
    status: summarizeStatus(courseAudit, automationAudit),
    courseAudit,
    automationAudit
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Automation 15 现场审计：${report.status}`);
    console.log(`课程：${courseAudit.count}/${EXPECTED_COUNT}，课次连续=${courseAudit.lessonSequence.continuous}，日期连续=${courseAudit.dateSequence.continuous}`);
    console.log(`目标日期：${targetDate}，唯一匹配数=${courseAudit.todayMatches.length}`);
    console.log(`自动化配置：存在=${automationAudit.configExists}，ACTIVE=${automationAudit.configChecks?.active ?? false}，每日11:00=${automationAudit.configChecks?.dailyAt1100 ?? false}`);
    console.log(`发送证据：${automationAudit.deliveryEvidence.status}，记忆匹配数=${automationAudit.deliveryEvidence.memoryMatchCount}`);
    if (report.status === "PASS_WITH_WARNINGS") console.log(automationAudit.deliveryEvidence.note);
  }
  process.exitCode = report.status === "FAIL" ? 1 : 0;
}

main().catch((error) => {
  console.error(`Automation 15 现场审计失败：${error.message}`);
  process.exitCode = 1;
});
