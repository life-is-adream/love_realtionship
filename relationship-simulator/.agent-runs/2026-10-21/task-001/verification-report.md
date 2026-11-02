# 验证报告

> 验证员：**Vic**（独立验证，不引用实现者/测试者结论）
> 日期：2026-10-22
> 项目根：`E:/一门给年轻人的恋爱成长课/relationship-simulator`
> 临时样例目录：`C:/Users/lenovo/AppData/Local/Temp/vic-fixtures-20261022/`（项目内零写入）
> **本文含两轮：初验（FAIL）与复验（PASS）。复验结论为最终结论，前后对比见文末「复验记录」。**

## 结论（复验，最终）
PASS

初验判 FAIL（V6：检查器 R2 对 `delete state.<prop>` / `delete appState.<prop>` 形态漏报，根因为 `scripts/check-conventions.mjs:371` 捕获组取反）。队长已修复该点并连带修复 P2（复合赋值漏报），新增 4 条回归用例。**复验以同一批临时样例前后对比，全部证伪点已闭合**（见文末「复验记录」）。本结论为"复验"。

## 结论（初验，历史存档）
FAIL

失败点：**V6**——检查器 R2 对规格明确列出的 `delete state.<prop>` / `delete appState.<prop>` 形态**漏报**（mutate 外删除 live state 字段抓不到）。规则规格（investigation-report R2 行）明确把 `delete X.prop` 列为违规形态，检查器实现里该分支的正则捕获组取反，导致永远匹配不到别名而静默跳过。测试全绿（840/840）不能覆盖此洞：`test/check-conventions.test.mjs` 只测了 mutate 内 delete 的合规面，没有 delete 违规面用例。

---

## 验收矩阵

| # | 项 | 期望 | 实测 | 判定 |
|---|---|---|---|---|
| V1 | 全量测试 | pass / 0 fail，总数 ≥ 801 | 初验 840 / 840 pass；复验 844 / 844 pass（+4 条回归用例，0 fail） | PASS |
| V2 | 循环依赖 | 0 环 | 0 环（101 模块） | PASS |
| V3 | 约定检查器 | exit 0，0 违规 | exit 0，0 违规（106 文件）——但见 V6，"0 违规"对 delete 形态不可信 | PASS |
| V4 | 语法 | 改动 .js 全过 `node --check` | 23/23 通过 | PASS |
| V5 | package.json | 有 `check:conventions`，无新增依赖 | 有；无 dependencies/devDependencies 字段 | PASS |
| V6 | 检查器空转验证 | R1/R2/R6 违违规样例必被抓 | 初验：`delete` 形态漏报 → FAIL；复验：5/5 全抓（含 delete、复合赋值），见复验记录 | PASS（复验） |
| V7 | 检查器误报验证 | 合规样例不报 | 初验 2 类 + 复验 3 类（含 `>=`/`<=`/`==`）均 0 违规 | PASS |
| V8 | P0-1 fail-closed | getItem 抛错必须 `false` | 返回 `false` | PASS |
| V9 | P0-2 quarantine | 不抛、隔离键保留原串、issue 非 null | 三项全符合 | PASS |
| V10 | 日期跨零点 | `shanghaiDate("2026-10-20T16:30:00Z")` = `"2026-10-21"` | `"2026-10-21"` | PASS |
| V11 | mutate 广播 | replace() persist 时走 updateAppState | 代码行 + 运行时双证，走 updateAppState | PASS |
| V12 | diff 范围 | 改动均属预期，越界单独列出 | 流水线交付 26 文件全在范围内；3 个语音工作线文件 + 1 处混入 hunk 单独列出（见下） | PASS |
| V13 | 无测试删除 | 测试文件无删除、无整块注释 | git 无 D 条目；grep 无注释掉的 test()；test() 调用 832 处 | PASS |

### V1 原始输出（尾部）

```
$ node --test
1..840
# tests 840
# suites 0
# pass 840
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 8396.3862
Exit Code: 0
```

840 ≥ 801，未靠删测试变绿（V13 交叉印证）。

### V2 原始输出

```
$ node scripts/check-circular.mjs
扫描模块数: 101
circular: 0 ✅ 无循环依赖
EXIT=0
```

### V3 原始输出

```
$ node scripts/check-conventions.mjs
扫描文件数: 106
conventions: 0 ✅ 无违规
EXIT=0
```

### V4 原始输出（逐文件）

```
OK public/app.js
OK public/modules/core/config.js
OK public/modules/core/date.js
OK public/modules/core/memory.js
OK public/modules/core/state.js
OK public/modules/intelligence/controller.js
OK public/modules/render/coach-float.js
OK public/modules/render/compliance-banner.js
OK public/modules/render/render-lifestyle.js
OK public/modules/render/stage-progress.js
OK public/modules/training/growth.js
OK public/modules/training/micro-training.js
OK public/modules/training/real-practice.js
OK public/modules/training/training-mode-controller.js
OK public/modules/voice/tts-client.js
OK scripts/check-conventions.mjs
OK test/check-conventions.test.mjs
OK test/compliance-banner.test.mjs
OK test/date-keys.test.mjs
OK test/helpers/conventions.mjs
OK test/mistakes.test.mjs
OK test/session-report.test.mjs
OK test/state-quarantine.test.mjs
```

### V5 原始依据

`package.json` 全文 19 行：`scripts` 含 `"check:conventions": "node scripts/check-conventions.mjs"`（:11）；`dependencies` / `devDependencies` 键**不存在**（全文只有 name/version/private/type/scripts/engines）。

---

## 独立证伪记录

### V6 检查器空转验证（样例自构，临时目录）

**样例 1 — R1 未转义插值** `v6/public/r1-escape.js`：

```js
export function renderRow(item) {
  const el = document.createElement("div");
  el.innerHTML = `<div class="row"><span>${item.text}</span></div>`;
  return el;
}
```

**样例 2 — R2 mutate 外直写（含 `=` 与 `delete` 两种形态）** `v6/public/r2-mutate.js`：

```js
export function badWriteOne(getAppState) {
  getAppState().trainingMode = "pua";
}

export function badWriteTwo(getAppState, mutate) {
  const state = getAppState();
  state.mistakes = [];
  delete state.lastAnalysis;
}
```

**样例 3 — R6 自拼日期** `v6/public/r6-date.js`：

```js
export function todayKeyUtc() {
  return new Date().toISOString().slice(0, 10);
}
export function todayKeyLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
```

```
$ node scripts/check-conventions.mjs --root C:/Users/lenovo/AppData/Local/Temp/vic-fixtures-20261022/v6 --json
{
  "fileCount": 3,
  "ok": false,
  "violations": [
    { "file": "public/r1-escape.js", "line": 3, "rule": "html-interpolation-escape",
      "message": "HTML 插值 ${item.text} 是文本类属性名 \"text\"，未经 escapeHtml 转义" },
    { "file": "public/r2-mutate.js", "line": 2, "rule": "state-write-bypass-mutate",
      "message": "直接写 getState().trainingMode，绕过 mutate" },
    { "file": "public/r2-mutate.js", "line": 7, "rule": "state-write-bypass-mutate",
      "message": "直接写 state.mistakes，绕过 mutate" },
    { "file": "public/r6-date.js", "line": 2, "rule": "single-date-key",
      "message": "用 toISOString().slice(0,10) 自拼日期键（UTC 口径），应调用 core/date.js shanghaiDate()" }
  ],
  "readErrors": []
}
EXIT=1
```

**缺失的第 5 条**：`r2-mutate.js:8` 的 `delete state.lastAnalysis;` **没有出现在违规列表**。单独最小化复现（`probe2/public/probe-delete.js`）：

```js
export function deleteOnly(getAppState) {
  const state = getAppState();
  delete state.lastAnalysis;
}
export function deleteAppAlias(getAppState) {
  const appState = getAppState();
  delete appState.lastAnalysis;
}
```

```
$ node scripts/check-conventions.mjs --root C:/Users/lenovo/AppData/Local/Temp/vic-fixtures-20261022/probe2 --json
{
  "fileCount": 1,
  "ok": true,
  "violations": [],        ← 两处 mutate 外 delete 全部漏报
  "readErrors": []
}
EXIT=0
```

**根因**（`scripts/check-conventions.mjs:371`）：

```js
const receiver = isDelete ? match[2] : match[1];
```

两个正则的**组 1 都是接收者**（`STATE_WRITE_NAMED_RE:350` / `STATE_DELETE_NAMED_RE:351` 均为 `(state|appState)\s*\.\s*([\w$]+)`，组 2 是属性名）。delete 分支取 `match[2]`（属性名）当接收者，随后 `STATE_ALIAS_RE(receiver)`（:374）去找 `const lastAnalysis = getAppState()` 这种不存在的别名 → `continue` 静默跳过。消息行 :378 `${receiver}.${match[2]}` 同源错位（若触发会打印 `lastAnalysis.lastAnalysis`）。

**附带发现**（探针 `probe/public/probe-r2-plus.js:2`）：`getAppState().sessionCount += 1;` 也不报——`STATE_WRITE_CALL_RE:349` 只认 `=(?![=>])`，复合赋值（`+=`/`-=`/`|=`）漏网。规格字面写的是 `X.prop =`，但语义同类，列为 P2。

其余规则探针正常：

```
$ node scripts/check-conventions.mjs --root .../probe --json
violations: [
  { "file": "public/escape-b.js", "line": 1, "rule": "single-escape-html", ... },   ← R4 第二份实现被抓
  { "file": "public/modules/core/bad-import.js", "line": 1, "rule": "layer-direction",
    "message": "core 不得反向 import ../render/thing.js" }                            ← R3 被抓
]
（probe 内 okLocalVar 的 state.draft 写入未误报）
```

### V7 检查器误报验证（样例自构）

`v7/public/ok-mutate.js`（mutate 回调内直写 + delete）：

```js
export function goodWrite(mutate, next) {
  mutate((state) => {
    state.trainingMode = next;
    delete state.lastAnalysis;
    state.messages = [];
  });
}
export function goodWriteApp(mutate, next) {
  mutate((draft) => { draft.mistakes = next; });
}
```

`v7/public/ok-escape.js`（先转义再取变量 + 内联 escapeHtml + 非文本名）：

```js
export function renderPreEscaped(v) {
  const label = escapeHtml(v);
  el.innerHTML = `<b>${label}</b>`;          // 白名单二
}
export function renderWrapped(obj) {
  el.innerHTML = `<i>${escapeHtml(obj.text)}</i><u>${Number(obj.rank)}</u>`;
}
export function renderAliasedVar(x) {
  el.innerHTML = `<p>${x}</p>`;              // x 非文本类属性名
}
```

```
$ node scripts/check-conventions.mjs --root .../v7 --json
{
  "fileCount": 2,
  "ok": true,
  "violations": [],
  "readErrors": []
}
EXIT=0
```

结论：两类合规样例零误报。

### V8 P0-1 行为验证（fail-closed）

复现：Node 导入 `public/modules/render/compliance-banner.js`，传入 `getItem()` 抛错的 storage。

```js
const throwingStorage = {
  getItem() { throw new Error("SecurityError: storage denied"); },
  setItem() { throw new Error("SecurityError: storage denied"); }
};
banner.hasAcknowledgedCompliance(throwingStorage);
```

```json
{
  "v8": {
    "throwing": false,     ← 抛错必须 false（fail-closed），实测 false ✓
    "nullish": false,
    "ackTrue": true,
    "ackFalse": false
  }
}
```

对应源码 `public/modules/render/compliance-banner.js:17-19`：`catch { return false; }`。`dismiss()` 的 catch 保持"会话内关闭"语义（:33-35），与规格一致。

### V9 P0-2 行为验证（quarantine）

复现：`localStorage` stub 写入 `heartflow-state = "{bad json"`，调 `loadState()`。

```json
{
  "v9": {
    "threw": null,                    ← 不抛错 ✓
    "loadedOk": true,
    "quarantine": "{bad json",        ← 隔离键保留原串 ✓
    "quarantineKeepsRaw": true,
    "issue": { "at": "2026-10-22T08:16:22.974Z", "reason": "state-parse-failed" },
    "issueNotNull": true              ← getStateLoadIssue() 非 null ✓
  },
  "v9b": {
    "quarantineAfterGoodLoad": null,  ← 正常加载不写隔离键 ✓
    "issueAfterGoodLoad": null        ← 无异常时 issue 为 null ✓
  }
}
```

### V10 日期跨零点

```json
{
  "v10": {
    "value": "2026-10-21",            ← 期望 "2026-10-21" ✓
    "pass": true,
    "boundaryBefore": "2026-10-20",   ← 15:59:59Z 仍是前一天，边界正确
    "tsInput": "2026-10-21"           ← 毫秒时间戳入参同口径
  }
}
```

源码依据：`public/modules/core/date.js:14-20`（`timeZone: "Asia/Shanghai"` 显式声明，与运行机时区无关）。

### V11 mutate 广播

代码依据——`public/modules/intelligence/controller.js:26-36`：

```js
function replace(next, { persist = false } = {}) {
  if (persist && typeof updateAppState === "function") {
    updateAppState((draft) => { draft.relationshipIntelligence = next; });   // :30
  } else {
    const target = getAppState();
    target.relationshipIntelligence = next;
    if (persist) saveAppState();
  }
  ...
```

`public/app.js:86-90`：`createRelationshipIntelligenceController({ ..., updateAppState: mutate })`；`mutate` 自带持久化与 `onStateChange` 广播（`app.js:906` 注入 `renderAll`）。

运行时验证（构造控制器，注入计数 stub）：

```json
{ "calls": ["updateAppState"], "hasIntelligence": true }   ← persist:true 走 updateAppState，未调 saveAppState
{ "fallbackCalls": ["saveAppState"] }                       ← 未注入时保持旧路径（规格要求）
```

---

## 发现的问题

1. **[P1→已修复] R2 对 `delete` 形态系统性漏报（初验核心缺陷）**
   `E:/一门给年轻人的恋爱成长课/relationship-simulator/scripts/check-conventions.mjs:371`（消息错位同源：`:378`）。
   `const receiver = isDelete ? match[2] : match[1]` 取反了捕获组——两个正则组 1 才是接收者。mutate 外 `delete state.x` / `delete appState.x` 永远不报。复现输出见 V6（probe2 `ok:true`）。当前全库恰好无存量违规（`grep` 普查仅 `render-persona.js:144,195` 两处 delete，均在 mutate 回调内），但守门器对该形态是空的。连带后果：`test/check-conventions.test.mjs:131-144` 只有 delete 合规面、无违规面用例，回归网漏这一格。
   **修复确认（复验）**：`receiver = match[1]` 恒取组 1 并加注释固化约定；新增违规面回归用例（message 正则锁定）。

2. **[P2→已修复] R2 对复合赋值漏报**
   `E:/一门给年轻人的恋爱成长课/relationship-simulator/scripts/check-conventions.mjs:349-350`：正则只匹配 `=(?![=>])`，`getState().x += 1` 一类写法不报（探针实测）。规格字面是 `X.prop =`，但语义同类，建议与问题 1 一并修。
   **修复确认（复验）**：`ASSIGN_TAIL_RE = \s*(?:[-+*/%|&^]|<<|>>>?|\*\*)?=(?![=>])`，`+=`/`-=`/`|=` 等与 `=` 同等拦截；`>=`/`<=`/`==` 实测不误报。

3. **[P3] 测试文件在实现窗口被改动（已归因，非越界）**
   `E:/一门给年轻人的恋爱成长课/relationship-simulator/test/compliance-banner.test.mjs` mtime 2026-10-21 23:47。**归因（队长确认）**：此改动是队长在 Max 限流中断后做的 FIX-1 配套断言翻转（`assert.equal(..., true)` → `false`，新增 `banner.innerHTML` 断言与 dismiss 行为断言），**不是 Max 越界改测试**。内容方向正确、全量测试依赖它变绿。保留此条仅为闭环归因记录。

4. **[P3→已修复] 测试标题与断言体不符（误导性）**
   `E:/一门给年轻人的恋爱成长课/relationship-simulator/test/session-report.test.mjs:408` 标题原称"插值过 escapeHtml"，但该用例体（:409-412）只有渲染接线断言；真断言在 :357-359 的另一条用例。**修复确认（复验）**：标题已改为"报告卡渲染对方视角回放区块、题眼句收尾"。

---

## 未能验证的项

1. **config.js 混入 hunk 的归属**：`public/modules/core/config.js` 的 `relationshipTier`（:129-131）与 `voicePrefs`（:217-218）超出 FIX-2 规格（规格只要求加 `stateQuarantine`）。旁证指向并行工作线而非本轮：`core/investment.js` 与 `test/investment.test.mjs` 的 mtime 为 22:47–22:51（早于任务启动 23:02），`tts-client.js` 关联 voicePrefs；但单文件 mtime 只记录最后一次写入，**无法严格证明**这两个 hunk 是谁、何时写入。
2. **浏览器侧真实渲染**：全部结论基于 Node 单测 + 静态检查 + 临时样例，未在浏览器复现（尤其 `initComplianceBanner` 的 DOM 行为走的是 jsdom/桩）。
3. **非 Asia/Shanghai 机器时区下的实测**：`shanghaiDate` 显式声明 `timeZone`，理论与运行机时区无关，但本轮未换 `TZ` 环境变量复跑。
4. **R1 白名单一的宽松边界**（规格自定、测试报告亦自陈）：同一作用域出现过 `escapeHtml(name)` 时，`const safe = escapeHtml(name); ${name}`（用错变量）会被豁免。属规格明文要求的误报控制取舍，非缺陷，但意味着 R1 存在已知漏报面。
5. **语音工作线文件内容**：`voice/tts_server.py`、`voice/README.md`、`public/modules/voice/tts-client.js` 在时间窗内有改动，但属语音 TTS 独立工作线（`voice/fetch_wheels.mjs`、`voice/wheels/` 等 20:12–20:38 已存在），本轮未审其内容正确性，只做范围归属判定。

---

## 复验记录（第二轮，最终）

初验 FAIL 后队长修复 `scripts/check-conventions.mjs` R2 与 `test/check-conventions.test.mjs`（+4 回归，19→23），并修正 `test/session-report.test.mjs:408` 标题。以下用**初验同一批临时样例**重跑做前后对比。

### V6-重：probe2 的 delete 形态（初验漏报 → 必须抓到且不错位）

```
$ node scripts/check-conventions.mjs --root .../probe2 --json
{
  "fileCount": 1,
  "ok": false,
  "violations": [
    { "file": "public/probe-delete.js", "line": 3, "rule": "state-write-bypass-mutate",
      "message": "delete state.lastAnalysis，绕过 mutate" },
    { "file": "public/probe-delete.js", "line": 8, "rule": "state-write-bypass-mutate",
      "message": "delete appState.lastAnalysis，绕过 mutate" }
  ],
  "readErrors": []
}
EXIT=1
```

前后对比：初验 `ok:true / violations:[]`（漏报）→ 复验 2 条全报，message 为 `delete state.lastAnalysis` / `delete appState.lastAnalysis`，**不是** `lastAnalysis.lastAnalysis` 错位。✓

### V6-重2：probe 的复合赋值（初验漏报 → 必须抓到）

```
$ node scripts/check-conventions.mjs --root .../probe --json
violations: [
  { "file": "public/escape-b.js", "line": 1, "rule": "single-escape-html", ... },        ← R4 仍抓
  { "file": "public/modules/core/bad-import.js", "line": 1, "rule": "layer-direction", ... }, ← R3 仍抓
  { "file": "public/probe-r2-plus.js", "line": 2, "rule": "state-write-bypass-mutate",
    "message": "直接写 getState().sessionCount，绕过 mutate" }                            ← += 现在抓到
]
EXIT=1
```

前后对比：初验 `probe-r2-plus.js:2` 不在列表（`+=` 漏）→ 复验被抓。同文件 `okLocalVar`（普通对象 `state.draft =`）仍不误报。✓

### V6 全量重跑（v6 目录 5 条违规全齐）

```
violations: [
  r1-escape.js:3  html-interpolation-escape        ✓ 初验已有
  r2-mutate.js:2  state-write-bypass-mutate        ✓ 初验已有
  r2-mutate.js:7  state-write-bypass-mutate        ✓ 初验已有
  r2-mutate.js:8  state-write-bypass-mutate (delete state.lastAnalysis)  ← 初验缺失，现补上
  r6-date.js:2    single-date-key                   ✓ 初验已有
]
EXIT=1
```

### V7-重：合规样例加严不误报（含运算符区分）

新增 `v7/public/ok-operators.js`：`state.count >= / <= / ==` 比较（state 已是 getAppState 别名）——初验时这类会被旧正则当赋值（若写 `=`）或漏过（比较符），复验须 0 违规。

```
$ node scripts/check-conventions.mjs --root .../v7 --json
{
  "fileCount": 3,        ← ok-mutate.js / ok-escape.js / ok-operators.js
  "ok": true,
  "violations": [],
  "readErrors": []
}
EXIT=0
```

mutate 回调内 `delete state.lastAnalysis`、白名单二 `const label = escapeHtml(v)`、比较运算符——全部 0 误报。✓

### V1-重：全量测试

```
$ node --test
1..844
# tests 844
# pass 844
# fail 0
# duration_ms 9964.8877
Exit Code: 0
```

840 → 844（+4 条回归用例，0 删减），0 fail。✓

### 回归用例真实性核对（防"假回归"）

`test/check-conventions.test.mjs` 新增 4 条逐条核对（非标题党）：

- :131-146「mutate 回调外 delete state.prop 必须被抓到」——断言 `r2.length === 2` 且 message 正则 `/delete state\.lastAnalysis/`、`/delete appState\.lastAnalysis/` 锁定（直击初验 P1 的错位形态）
- :148-163「复合赋值（+= 等）」——断言 `r2.length === 2`（`getState().sessionCount += 1` 与 `appState.sessionCount -= 1`）
- :165-180「比较运算与箭头函数不误报」——`>=`/`<=`/`==`/`() => state.draft` 期望 `report.ok === true`
- :182-192「mutate 回调内的 delete 不得误报」——`delete state.personaMemory` 在 mutate 内期望 0 违规

修复代码核对：`scripts/check-conventions.mjs:371` 现为 `const receiver = match[1];` 并带注释"组 1 恒为接收者"；`:349-353` 新增 `ASSIGN_TAIL_RE` 覆盖复合赋值，`(?![=>])` 保留对 `=>`/`==` 的排除。全库 `check-conventions` exit 0、`check-circular` 0 环复验通过。

### 复验矩阵（仅列复验项）

| # | 项 | 初验 | 复验 | 判定 |
|---|---|---|---|---|
| V6-重 | probe2 delete 形态 | 漏报（ok:true） | 2 条全报、message 正确 | PASS |
| V6-重2 | 复合赋值 += | 漏报 | 已报 | PASS |
| V6 全量 | v6 目录 5 违规 | 4/5 | 5/5 | PASS |
| V7-重 | 合规 3 类样例 | 2 类 0 误报 | 3 类 0 误报（含比较符） | PASS |
| V1-重 | 全量测试 | 840/840 | 844/844 | PASS |

**复验结论：PASS**（初验 4 个问题中 P1/P2/P3-4 已修复并经同批样例前后对比证实；P3-3 归因为队长行为，非 Max 越界）。
