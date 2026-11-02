// 零依赖约定检查器：把项目口头约定写成可执行版本，不是通用 linter。
// 只实现 5 条与这个仓库强相关的规则，风格对齐 scripts/check-circular.mjs。
//
// 用法：node scripts/check-conventions.mjs [--root <dir>] [--json]
//   默认 root = 仓库根（脚本自身 ../）；--root 供测试用 fixture 目录做反向验证。
// 退出码：0 = 无违规；1 = 有违规；2 = 参数/读取错误。
// 输出：stdout 每条违规一行 `相对路径:行号 规则ID 说明`（确定性排序：路径 → 行号 → 规则 → 说明）；
//       --json 时输出机器可读结果；摘要信息走 stderr，不污染逐行输出。
//
// 规则：
//   R1 html-interpolation-escape  HTML sink 的模板插值若是文本类属性名且未过 escapeHtml → 违规
//   R2 state-write-bypass-mutate   mutate( 回调区间之外的 live state 直写 → 违规
//   R3 layer-direction            core 不得反向 import render/intelligence/voice；server 不得 import public
//   R4 single-escape-html         escapeHtml 只能有一份实现（委托式薄封装不算实现）
//   R5 single-clamp-score         0–100 取整只能有一处定义（core/number.js），豁免清单见 CLAMP_ALLOWED
//   R6 single-date-key            public/ 内不得自拼 YYYY-MM-DD 日期键（统一走 core/date.js）
//   R7 render-module-test-coverage render 模块必须被 test/*.mjs import（存量豁免见 RENDER_COVERAGE_ALLOWED）
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

/** 递归时跳过的目录（内容数据 / 运行时产物 / 体积过大且与约定无关） */
const SKIP_DIRS = new Set(["node_modules", ".git", ".agent-runs", "voice", "long-simulation"]);

/** R1：文本类属性名白名单——这些名字插进 HTML 就必须转义 */
const TEXT_NAMES = new Set([
  "text", "title", "label", "summary", "message", "name", "content", "reason", "note",
  "reply", "description", "detail", "hint", "snippet", "effect", "prompt", "question",
  "answer", "quote"
]);

/** R6：文件级豁免——date.js 是唯一口径定义处；real-practice 的 validDate 用同表达式做校验 */
const DATE_KEY_EXEMPT = new Set([
  "public/modules/core/date.js",
  "public/modules/training/real-practice.js"
]);

/**
 * R7：`public/modules/render/*.js` 必须被至少一个 `test/*.mjs` **import**。
 * （`readFile` + 源码正则断言不算行为测试。）
 *
 * 下面是**存量豁免**，冻结不再扩大——新增 render 模块必须自带测试。
 * 一旦某个模块补上行为测试，就应从本表移除。
 */
const RENDER_COVERAGE_ALLOWED = new Map([
  ["public/modules/render/dropdown.js", "DOM 事件装配，手工验收型；无独立可测契约"],
  ["public/modules/render/mobile-tabs.js", "移动端标签栏切换，手工验收型"],
  ["public/modules/render/render-intake.js", "仅源码级断言覆盖（readFile + 正则），无行为测试"],
  ["public/modules/render/render-intervention.js", "仅源码级断言覆盖，无行为测试"],
  ["public/modules/render/render-lifestyle.js", "仅源码级断言覆盖，无行为测试"],
  ["public/modules/render/render-longContent.js", "长篇阅读器，依赖整章 chunk 加载，手工验收型"],
  ["public/modules/render/render-mistakes.js", "仅源码级断言覆盖（另有 R1 真实检查器断言）"],
  ["public/modules/render/render-session-report.js", "仅源码级断言覆盖（另有 R1 真实检查器断言）"]
]);
/**
 * R5：0–100 取整只能有一处定义（core/number.js）。
 * 下面 4 个是**刻意不同语义**的实现，冻结为豁免，各自注明原因——
 * 一旦它们的语义变成"评分取整"，就应迁回 core/number.js 并从本表移除。
 */
const CLAMP_ALLOWED = new Map([
  ["public/modules/core/number.js", "收口定义处（clampScore / clampScoreOrNull）"],
  ["public/modules/coach/coach.js", "非有限值回退 70（刻意的默认分），与 clampScore 的 0 回退语义不同"],
  ["public/modules/core/state.js", "clampAvatarPosition 是头像位置百分比，不是评分"],
  ["public/modules/render/render-session-report.js", "条形宽度是可视化尺寸，不取整"],
  ["public/modules/training/date-journey.js", "attempts 是次数计数（Math.trunc），不是评分"]
]);

const RULES = Object.freeze({
  R1: "html-interpolation-escape",
  R2: "state-write-bypass-mutate",
  R3: "layer-direction",
  R4: "single-escape-html",
  R5: "single-clamp-score",
  R6: "single-date-key",
  R7: "render-module-test-coverage"
});

// ── 参数 ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const options = { root: REPO_ROOT, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--root") {
      const value = argv[i + 1];
      if (!value) throw new Error("--root 需要一个目录参数");
      options.root = path.resolve(value);
      i += 1;
    } else if (arg.startsWith("--root=")) {
      options.root = path.resolve(arg.slice("--root=".length));
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return options;
}

// ── 文件遍历 ──────────────────────────────────────────────────────────────────

function listJsFiles(dir, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listJsFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

function collectTargets(root) {
  const scopes = ["public", "server"].map((name) => path.join(root, name)).filter((dir) => existsSync(dir) && statSync(dir).isDirectory());
  // fixture 目录可能只有平铺的 .js 文件：没有 public/ 与 server/ 时退回扫描 root 本身。
  const bases = scopes.length ? scopes : [root];
  const files = [];
  for (const base of bases) listJsFiles(base, files);
  return files;
}

/**
 * 只收集测试文件，供 R7 判定"某个 render 模块是否被行为测试 import"。
 * 刻意不并入 collectTargets：R1/R2/R4/R5/R6 的扫描范围是 public/ 与 server/，
 * 测试文件里的违规样例字符串不应被当作真实代码报警。
 */
function collectTestFiles(root) {
  const base = path.join(root, "test");
  if (!existsSync(base) || !statSync(base).isDirectory()) return [];
  const files = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.(js|mjs)$/.test(entry.name)) files.push(full);
    }
  };
  walk(base);
  return files;
}

const toPosix = (value) => value.split(path.sep).join("/");

// ── 词法扫描：把注释/字符串/模板替换为空白，保留长度与换行（行号不变） ──────────
// 同时收集模板字符串及其 ${...} 插值，供 R1 使用。

function scanSource(text) {
  const chars = text.split("");
  const visibleChars = text.split("");
  const templates = [];
  const blank = (from, to) => {
    for (let k = from; k < to; k += 1) {
      if (text[k] === "\n") continue;
      chars[k] = " ";
      visibleChars[k] = " ";
    }
  };
  const hide = (from, to) => {
    for (let k = from; k < to; k += 1) if (text[k] !== "\n") visibleChars[k] = " ";
  };

  function skipQuoted(start, quote) {
    let j = start + 1;
    while (j < text.length) {
      if (text[j] === "\\") { j += 2; continue; }
      if (text[j] === quote) return j + 1;
      if (text[j] === "\n") return j; // 未闭合，按行尾收束，避免整文件失效
      j += 1;
    }
    return text.length;
  }

  function skipInterpolation(start) {
    let depth = 1;
    let j = start;
    while (j < text.length) {
      const ch = text[j];
      if (ch === "\\") { j += 2; continue; }
      if (ch === '"' || ch === "'") { j = skipQuoted(j, ch); continue; }
      if (ch === "`") { j = scanTemplate(j); continue; }
      if (ch === "{") { depth += 1; j += 1; continue; }
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) return j;
        j += 1;
        continue;
      }
      j += 1;
    }
    return text.length;
  }

  function scanTemplate(start) {
    const record = { start, end: text.length, interpolations: [] };
    let j = start + 1;
    while (j < text.length) {
      const ch = text[j];
      if (ch === "\\") { j += 2; continue; }
      if (ch === "`") { record.end = j + 1; break; }
      if (ch === "$" && text[j + 1] === "{") {
        const bodyStart = j + 2;
        const close = skipInterpolation(bodyStart);
        record.interpolations.push({ start: bodyStart, end: close, expr: text.slice(bodyStart, close).trim() });
        j = close + 1;
        continue;
      }
      j += 1;
    }
    templates.push(record);
    return record.end;
  }

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "/" && text[i + 1] === "/") {
      let j = i;
      while (j < text.length && text[j] !== "\n") j += 1;
      blank(i, j);
      i = j;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      const stop = close < 0 ? text.length : close + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const stop = skipQuoted(i, ch);
      blank(i, stop);
      i = stop;
      continue;
    }
    if (ch === "`") {
      const stop = scanTemplate(i);
      // 结构掩码抹掉整个模板；可见视图保留模板原文（插值里的代码要参与"是否已转义"的搜索）。
      for (let k = i; k < stop; k += 1) if (text[k] !== "\n") chars[k] = " ";
      i = stop;
      continue;
    }
    i += 1;
  }
  return { mask: chars.join(""), visible: visibleChars.join(""), templates };
}

// ── 通用工具 ──────────────────────────────────────────────────────────────────

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") starts.push(i + 1);
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}

/** 从 open 处（指向 `(` 或 `{`）配对到对应的闭合字符，返回闭合下标 */
function matchBracket(mask, open) {
  const pairs = { "(": ")", "{": "}", "[": "]" };
  const target = pairs[mask[open]];
  if (!target) return -1;
  let depth = 0;
  for (let i = open; i < mask.length; i += 1) {
    const ch = mask[i];
    if (ch === mask[open]) depth += 1;
    else if (ch === target) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const FUNCTION_START_RE = /(?:export\s+)?(?:async\s+)?function\s*[\w$]*\s*\([^)]*\)\s*\{|(?:const|let|var)\s+[\w$]+\s*=\s*(?:async\s+)?(?:function\s*[\w$]*\s*\([^)]*\)|\([^)]*\))\s*=>\s*\{/g;

/** 返回包含 offset 的最内层函数体 [start, end]；找不到时返回整文件区间 */
function enclosingScope(context, offset) {
  const { mask } = context;
  let best = { start: 0, end: mask.length };
  FUNCTION_START_RE.lastIndex = 0;
  let match;
  while ((match = FUNCTION_START_RE.exec(mask))) {
    const openBrace = match.index + match[0].length - 1;
    if (openBrace > offset) break;
    const closeBrace = matchBracket(mask, openBrace);
    if (closeBrace < 0 || closeBrace < offset) continue;
    if (openBrace + 1 <= offset && offset <= closeBrace) best = { start: openBrace, end: closeBrace };
  }
  return best;
}

const normalizeSpace = (value) => value.replace(/\s+/g, "");

// ── R1：HTML sink 插值必须转义 ────────────────────────────────────────────────

const SINK_RE = /\.(?:innerHTML|outerHTML)\s*(?:\+=|=(?!=))|\binsertAdjacentHTML\s*\(/g;

function sinkRegion(context, match) {
  const { mask } = context;
  const start = match.index + match[0].length;
  if (/insertAdjacentHTML/.test(match[0])) {
    const close = matchBracket(mask, start - 1);
    return { start, end: close < 0 ? mask.length : close };
  }
  // 赋值右侧：模板内部与回调体内部的 ; 都不能算语句结束，只认同层深度的 ;。
  let depth = 0;
  for (let i = start; i < mask.length; i += 1) {
    const ch = mask[i];
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") {
      if (depth === 0) return { start, end: i };
      depth -= 1;
    } else if (ch === ";" && depth === 0) return { start, end: i };
  }
  return { start, end: mask.length };
}

function topLevelName(expr) {
  const value = expr.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(value)) return value;
  if (/^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)+$/.test(value)) {
    return value.split(".").map((part) => part.trim()).filter(Boolean).pop();
  }
  // 复杂表达式（三元/调用/运算）不做名字判定：这是规则的有意保守边界，宁可漏报不误报。
  return null;
}

function checkHtmlInterpolation(context) {
  const violations = [];
  const { text, mask, visible, templates, lineOf } = context;
  SINK_RE.lastIndex = 0;
  let match;
  while ((match = SINK_RE.exec(mask))) {
    const region = sinkRegion(context, match);
    for (const template of templates) {
      if (template.start < region.start || template.start > region.end) continue;
      for (const interpolation of template.interpolations) {
        const expr = interpolation.expr;
        if (/^escapeHtml\s*\(/.test(expr) || /^Number\s*\(/.test(expr)) continue;
        const name = topLevelName(expr);
        if (!name || !TEXT_NAMES.has(name)) continue;
        const scope = enclosingScope(context, interpolation.start);
        const scopeText = normalizeSpace(mask.slice(scope.start, scope.end));
        // "是否已转义"的搜索要看模板插值里的代码，故用保留模板原文的可见视图。
        const visibleScope = normalizeSpace(visible.slice(scope.start, scope.end));
        // 白名单一：同一函数内已对表达式本身或该变量名转义过（"先取变量再转义"）。
        if (visibleScope.includes(`escapeHtml(${normalizeSpace(expr)})`)) continue;
        if (visibleScope.includes(`escapeHtml(${name})`)) continue;
        // 白名单二：变量本身就是 escapeHtml 的产物（"先转义再取变量"）。
        if (new RegExp(`(?:const|let|var)?${name}=escapeHtml\\(`).test(visibleScope)) continue;
        // 白名单三：变量是预渲染的 HTML 片段（赋值里带 "<"，如 ${rows} / ${cards} 一族）。
        // 需要看字符串内容，故用原文而非掩码。
        if (new RegExp(`(?:const|let|var)?${name}=[^;]*<`).test(normalizeSpace(text.slice(scope.start, scope.end)))) continue;
        // 白名单四：该插值所在的模板是"先取变量再转义"的中间产物
        // （`const label = <模板>; ... escapeHtml(label)`），变量指承载模板的那个变量。
        const holder = mask.slice(Math.max(scope.start, template.start - 120), template.start).match(/([A-Za-z_$][\w$]*)\s*=\s*(?:[^;{}]*)$/)?.[1];
        if (holder && visibleScope.includes(`escapeHtml(${holder})`)) continue;
        violations.push({
          line: lineOf(interpolation.start),
          rule: RULES.R1,
          message: `HTML 插值 \${${expr}} 是文本类属性名 "${name}"，未经 escapeHtml 转义`
        });
      }
    }
  }
  return violations;
}

// ── R2：状态写入必须落在 mutate 回调内 ───────────────────────────────────────

const MUTATE_RE = /(?<![\w$.])mutate\s*\(/g;
const MUTATE_CALLBACK_RE = /^[({\s]*(?:\(\s*([\w$]+)\s*\)|([\w$]+))\s*=>/;

function mutateRanges(context) {
  const ranges = [];
  const { mask } = context;
  MUTATE_RE.lastIndex = 0;
  let match;
  while ((match = MUTATE_RE.exec(mask))) {
    const open = match.index + match[0].length - 1;
    const close = matchBracket(mask, open);
    if (close > open) ranges.push({ start: open, end: close, callbackParam: MUTATE_CALLBACK_RE.exec(mask.slice(open + 1, open + 40))?.[1] || null });
  }
  return ranges;
}

// 赋值形态：普通 `=` 与复合赋值 `+=` `-=` `|=` 等同属写状态，必须一并拦截；
// `(?![=>])` 排除 `=>` 与 `==`，`(?:...)?` 为空时即普通赋值。
const ASSIGN_TAIL_RE = String.raw`\s*(?:[-+*/%|&^]|<<|>>>?|\*\*)?=(?![=>])`;
// 捕获组约定：组 1 = 接收者（state|appState），组 2 = 属性名。两个正则一致。
const STATE_WRITE_CALL_RE = new RegExp(String.raw`(?<![\w$.])(?:getState|getAppState)\s*\(\s*\)\s*\.\s*([\w$]+)` + ASSIGN_TAIL_RE, "g");
const STATE_WRITE_NAMED_RE = new RegExp(String.raw`(?<![\w$.])(state|appState)\s*\.\s*([\w$]+)` + ASSIGN_TAIL_RE, "g");
const STATE_DELETE_NAMED_RE = /(?<![\w$.])delete\s+(state|appState)\s*\.\s*([\w$]+)/g;
const STATE_ALIAS_RE = (name) => new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*get(?:App)?State\\s*\\(\\s*\\)|(?<![\\w$.])${name}\\s*=\\s*get(?:App)?State\\s*\\(\\s*\\)`);

function checkStateWrites(context) {
  const violations = [];
  const { mask, lineOf } = context;
  const ranges = mutateRanges(context);
  const insideMutate = (offset) => ranges.some((range) => offset >= range.start && offset <= range.end);

  STATE_WRITE_CALL_RE.lastIndex = 0;
  let match;
  while ((match = STATE_WRITE_CALL_RE.exec(mask))) {
    if (insideMutate(match.index)) continue;
    violations.push({ line: lineOf(match.index), rule: RULES.R2, message: `直接写 getState().${match[1]}，绕过 mutate` });
  }

  for (const [pattern, isDelete] of [[STATE_WRITE_NAMED_RE, false], [STATE_DELETE_NAMED_RE, true]]) {
    pattern.lastIndex = 0;
    while ((match = pattern.exec(mask))) {
      if (insideMutate(match.index)) continue;
      // 组 1 恒为接收者（state|appState），组 2 恒为属性名——delete 与写入两个正则一致。
      const receiver = match[1];
      // 只判定确实取到 live state 的别名，且限定在同一个函数作用域内（外层同名变量不算）。
      const scope = enclosingScope(context, match.index);
      if (!STATE_ALIAS_RE(receiver).test(mask.slice(scope.start, scope.end))) continue;
      violations.push({
        line: lineOf(match.index),
        rule: RULES.R2,
        message: `${isDelete ? "delete " : "直接写 "}${receiver}.${match[2]}，绕过 mutate`
      });
    }
  }
  return violations;
}

// ── R3：分层方向 ─────────────────────────────────────────────────────────────

const FROM_RE = /(?:\bfrom\s*["']([^"']+)["'])|(?:\bimport\s*\(\s*["']([^"']+)["']\s*\))|(?:^\s*import\s+["']([^"']+)["'])/gm;

function importSpecs(text) {
  const specs = [];
  FROM_RE.lastIndex = 0;
  let match;
  while ((match = FROM_RE.exec(text))) specs.push({ spec: match[1] || match[2] || match[3], index: match.index });
  return specs;
}

function checkLayerDirection(context) {
  const { text, relPath, lineOf } = context;
  const violations = [];
  const inCore = relPath.startsWith("public/modules/core/");
  const inServer = relPath.startsWith("server/");
  if (!inCore && !inServer) return violations;
  const CORE_FORBIDDEN_A = /^\.\.\/(render|voice)\//;
  // intelligence/state.js 是纯状态归一化（无 DOM、无网络），core 依赖它属设计内；
  // controller.js / client.js 含 I/O，core 不得依赖。
  const CORE_FORBIDDEN_B = /^\.\.\/intelligence\/(?!state\.js$)/;
  for (const { spec, index } of importSpecs(text)) {
    if (inCore && (CORE_FORBIDDEN_A.test(spec) || CORE_FORBIDDEN_B.test(spec))) {
      violations.push({ line: lineOf(index), rule: RULES.R3, message: `core 不得反向 import ${spec}` });
    }
    if (inServer && /(^|\/)public\//.test(spec)) {
      violations.push({ line: lineOf(index), rule: RULES.R3, message: `server 不得 import 前端模块 ${spec}` });
    }
  }
  return violations;
}

// ── R4：escapeHtml 单实现 ────────────────────────────────────────────────────

const ESCAPE_DECL_RE = /(?:^|\n)[ \t]*(?:export\s+)?(?:function|const|let|var)\s+escapeHtml\b/g;

/** 委托目标必须是本文件 import 进来的标识符（如 `import { escapeHtml as shared }`）。
 *  否则 `function escapeHtml(v){ return String(v); }` 会被误判成薄封装而漏掉真实实现。 */
function isImportedIdentifier(text, name) {
  const base = String(name).split(".")[0];
  return new RegExp(`\\bimport\\b[^;]*?\\b${base}\\b`).test(text);
}

/** 委托式薄封装（函数体只有一句 return <imported>(...)）不算第二份实现 */
function isDelegatingFacade(text, mask, matchEnd) {
  const brace = mask.indexOf("{", matchEnd);
  const semicolon = mask.indexOf(";", matchEnd);
  if (brace < 0) return false;
  if (semicolon >= 0 && semicolon < brace) {
    const matched = /^\s*=\s*([A-Za-z_$][\w$.]*)\s*;?$/.exec(text.slice(matchEnd, semicolon));
    return Boolean(matched) && isImportedIdentifier(text, matched[1]);
  }
  const close = matchBracket(mask, brace);
  if (close < 0) return false;
  const matched = /^\{\s*return\s+([A-Za-z_$][\w$.]*)\s*\([^;{}]*\)\s*;?\s*\}$/.exec(text.slice(brace, close + 1));
  return Boolean(matched) && isImportedIdentifier(text, matched[1]);
}

// ── R5：0–100 取整单实现 ─────────────────────────────────────────────────────

const CLAMP_RE = /Math\s*\.\s*max\s*\(\s*0\s*,\s*Math\s*\.\s*min\s*\(\s*100/g;

function checkClampSingle(context) {
  const violations = [];
  const { mask, lineOf, relPath } = context;
  if (!relPath.startsWith("public/")) return violations;
  if (CLAMP_ALLOWED.has(relPath)) return violations;
  CLAMP_RE.lastIndex = 0;
  let match;
  while ((match = CLAMP_RE.exec(mask))) {
    violations.push({
      line: lineOf(match.index),
      rule: RULES.R5,
      message: "0–100 取整必须调用 core/number.js 的 clampScore / clampScoreOrNull，不得自拼"
    });
  }
  return violations;
}

// ── R6：日期键单实现 ────────────────────────────────────────────────────────

const UTC_SLICE_RE = /\.toISOString\s*\(\s*\)\s*\.\s*slice\s*\(\s*0\s*,\s*10\s*\)/g;
const DASHED_DATE_TEMPLATE_RE = /\$\{[^{}]*\}[^`]*-\$\{[^{}]*\}[^`]*-\$\{[^{}]*\}/;

function checkDateKeys(context) {
  const violations = [];
  const { text, mask, templates, lineOf, relPath } = context;
  // 规格范围是 public/**：测试里为构造跨零点用例而显式写 UTC 是合法的，不纳入扫描。
  if (!relPath.startsWith("public/")) return violations;
  if (DATE_KEY_EXEMPT.has(relPath)) return violations;

  UTC_SLICE_RE.lastIndex = 0;
  let match;
  while ((match = UTC_SLICE_RE.exec(mask))) {
    violations.push({ line: lineOf(match.index), rule: RULES.R6, message: "用 toISOString().slice(0,10) 自拼日期键（UTC 口径），应调用 core/date.js shanghaiDate()" });
  }

  // device-local 拼 YYYY-MM-DD：同一函数内同时出现三个本地取数 + 带两个连字符的三段模板。
  FUNCTION_START_RE.lastIndex = 0;
  const scopes = [];
  while ((match = FUNCTION_START_RE.exec(mask))) {
    const openBrace = match.index + match[0].length - 1;
    const closeBrace = matchBracket(mask, openBrace);
    if (closeBrace > openBrace) scopes.push({ start: openBrace, end: closeBrace });
  }
  for (const scope of scopes) {
    const scopeMask = mask.slice(scope.start, scope.end);
    if (!/\.getFullYear\s*\(/.test(scopeMask) || !/\.getMonth\s*\(/.test(scopeMask) || !/\.getDate\s*\(/.test(scopeMask)) continue;
    const dashed = templates.find((template) => template.start > scope.start && template.end < scope.end
      && DASHED_DATE_TEMPLATE_RE.test(text.slice(template.start + 1, template.end - 1)));
    if (!dashed) continue;
    const offset = scope.start + scopeMask.indexOf(".getFullYear");
    violations.push({ line: lineOf(offset), rule: RULES.R6, message: "用 getFullYear/getMonth/getDate 自拼 YYYY-MM-DD（设备本地口径），应调用 core/date.js shanghaiDate()" });
  }
  return violations;
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

function run(options) {
  const { root, json } = options;
  const files = collectTargets(root);
  const violations = [];
  const escapeImplementations = [];
  const readErrors = [];
  const renderModules = new Set();
  const renderCoveredByTests = new Set();

  for (const file of files) {
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      readErrors.push(`${toPosix(path.relative(root, file))}: ${error.code || "read failed"}`);
      continue;
    }
    const scanned = scanSource(text);
    const context = {
      text,
      mask: scanned.mask,
      visible: scanned.visible,
      templates: scanned.templates,
      relPath: toPosix(path.relative(root, file)),
      lineOf: lineIndex(text)
    };

    // R7 收集：记下所有 render 模块。
    if (context.relPath.startsWith("public/modules/render/")) renderModules.add(context.relPath);

    violations.push(...withFile(context.relPath, checkHtmlInterpolation(context)));
    violations.push(...withFile(context.relPath, checkStateWrites(context)));
    violations.push(...withFile(context.relPath, checkLayerDirection(context)));
    violations.push(...withFile(context.relPath, checkClampSingle(context)));
    violations.push(...withFile(context.relPath, checkDateKeys(context)));

    ESCAPE_DECL_RE.lastIndex = 0;
    let decl;
    while ((decl = ESCAPE_DECL_RE.exec(scanned.mask))) {
      const offset = decl.index + decl[0].length;
      if (isDelegatingFacade(text, scanned.mask, offset)) continue;
      escapeImplementations.push({ file: context.relPath, line: context.lineOf(decl.index) });
    }
  }

  escapeImplementations.sort(compareViolation);
  for (const extra of escapeImplementations.slice(1)) {
    violations.push({ file: extra.file, line: extra.line, rule: RULES.R4, message: "escapeHtml 出现第二份实现（唯一实现应在 public/modules/core/dom.js）" });
  }

  // R7：扫一遍测试文件的 import，收集"被行为测试覆盖"的 render 模块。
  for (const testFile of collectTestFiles(root)) {
    let text = "";
    try {
      text = readFileSync(testFile, "utf8");
    } catch {
      continue;
    }
    const relTest = toPosix(path.relative(root, testFile));
    for (const { spec } of importSpecs(text)) {
      if (!spec.startsWith(".")) continue;
      const abs = path.resolve(root, path.dirname(relTest), spec);
      // 只认真实存在的文件：测试里常有 `import ... from "<fixture路径>"` 这类
      // 停留在模板字符串里的假 import，不过滤会把不存在的模块算成"已覆盖"。
      if (!existsSync(abs)) continue;
      const resolved = toPosix(path.relative(root, abs));
      if (resolved.startsWith("public/modules/render/")) renderCoveredByTests.add(resolved);
    }
  }

  // R7：render 模块必须被测试 import；存量豁免冻结，新增一律要求带测试。
  for (const modulePath of [...renderModules].sort()) {
    if (renderCoveredByTests.has(modulePath)) continue;
    if (RENDER_COVERAGE_ALLOWED.has(modulePath)) continue;
    violations.push({
      file: modulePath,
      line: 1,
      rule: RULES.R7,
      message: "render 模块没有被任何 test/*.mjs import（源码正则断言不算行为测试）；请补测试，或在 RENDER_COVERAGE_ALLOWED 中注明理由"
    });
  }

  violations.sort(compareViolation);
  return { root: toPosix(path.relative(process.cwd(), root)) || ".", violations, readErrors, fileCount: files.length };
}

function withFile(file, items) {
  return items.map((item) => ({ file, line: item.line, rule: item.rule, message: item.message }));
}

function compareViolation(a, b) {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.line !== b.line) return a.line - b.line;
  if (a.rule !== b.rule) return a.rule < b.rule ? -1 : 1;
  return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

const result = run(options);

if (options.json) {
  console.log(JSON.stringify({
    root: result.root,
    fileCount: result.fileCount,
    ok: result.violations.length === 0 && result.readErrors.length === 0,
    violations: result.violations,
    readErrors: result.readErrors
  }, null, 2));
} else {
  for (const item of result.violations) console.log(`${item.file}:${item.line} ${item.rule} ${item.message}`);
  for (const error of result.readErrors) console.error(`[error] ${error}`);
  console.error(`扫描文件数: ${result.fileCount}`);
  if (result.violations.length === 0 && result.readErrors.length === 0) console.error("conventions: 0 ✅ 无违规");
  else console.error(`conventions: ${result.violations.length} 处违规 ❌`);
}

process.exit(result.violations.length === 0 && result.readErrors.length === 0 ? 0 : 1);
