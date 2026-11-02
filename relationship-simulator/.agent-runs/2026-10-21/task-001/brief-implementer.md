# 任务书：实现工程师 Max

- role_name: 实现工程师 Max
- mission: 修复调查确认的 2 个 P0 与 3 处状态直写，统一日期口径，并落地一个零依赖的约定检查器
- allowed_edit_scope: **仅以下文件**，不得越界
- output_path: `.agent-runs/2026-10-21/task-001/implementer-report.md`
- 前置阅读：`.agent-runs/2026-10-21/task-001/investigation-report.md`（只需读 P0/P1 表与 R1–R7 表）

## 硬约束

1. **零新增依赖**。不装 ESLint/Prettier，不改 `package.json` 的 `dependencies`/`devDependencies`（只允许加 `scripts` 条目）。
2. **最小 diff**。不重排格式、不改无关行、不"顺手优化"。
3. 每完成一项**立即**跑一次 `node --check <file>`。
4. 全部完成后必须跑：`node --test`（基线 801 全绿）、`node scripts/check-circular.mjs`（必须 0 环）、`node scripts/check-conventions.mjs`（必须 exit 0）。
5. 若某项实现与下述规格冲突（例如会引入循环依赖），**停下该项并在报告中说明**，不要自行改设计。

## allowed_edit_scope（白名单）

```
public/modules/render/compliance-banner.js
public/modules/core/state.js
public/modules/core/config.js
public/modules/core/date.js              （新建）
public/modules/core/memory.js
public/modules/intelligence/controller.js
public/modules/training/training-mode-controller.js
public/modules/training/real-practice.js
public/modules/training/growth.js
public/modules/render/render-lifestyle.js
public/modules/render/coach-float.js
public/modules/render/stage-progress.js
public/app.js
scripts/check-conventions.mjs            （新建）
package.json                             （仅 scripts）
```

白名单外的文件一律不改。测试文件**不要动**（由 Tess 负责）。

---

## FIX-1（P0-1）合规声明 fail-open

文件：`public/modules/render/compliance-banner.js`

现状 `:11-17`：

```js
export function hasAcknowledgedCompliance(storage = globalThis.localStorage) {
  try {
    return storage.getItem(STORAGE_KEYS.complianceAck) === "true";
  } catch {
    return true;      // ← 存储不可用时视为"已知悉"，横幅永不显示
  }
}
```

改为 `catch { return false; }`，并把 `:10` 的注释同步改成 fail-closed 的解释（存储不可用时**显示**横幅，保证合规声明不被静默跳过）。

注意：`dismiss()`（`:27-35`）的 catch 保持不动——那里写入失败仍应关闭横幅，只是不持久化。这是有意的"本次会话内关闭"。

---

## FIX-2（P0-2）状态损坏静默重置并覆盖原件

文件：`public/modules/core/state.js:115-123`、`public/modules/core/config.js`（STORAGE_KEYS）

现状：`loadState()` 的 `catch` 直接 `currentState = normalizeState(clone(defaultState))`，随后任意一次写入会把默认态覆盖到同一个 key，用户的原始档案永久丢失。

要求：

1. 在 `core/config.js` 的 `STORAGE_KEYS` 增加 `stateQuarantine: "heartflow-state-quarantine"`（命名遵循现有惯例）。
2. `loadState()` 的 catch 中，**先把原始字符串**（`localStorage.getItem(STORAGE_KEYS.state)`）写入隔离 key，再重置。隔离写入自身必须 try/catch 包裹，失败不得影响重置。
3. 新增模块级变量 `lastLoadIssue`，catch 时赋值 `{ at: ISO 字符串, reason: "state-parse-failed" }`，并导出 `export function getStateLoadIssue()` 返回它（无异常时返回 `null`）。重置后不要清空它——它描述的是"本次加载发生过什么"。
4. `normalizeState` 成功但发现陈旧 schema 的情况**不**进此逻辑，只处理解析/读取失败。
5. 可选（若插入点明确且改动 ≤3 行）：在 `app.js` 已有的初始化路径里把 `getStateLoadIssue()` 结果写到 `apiStatus`，文案自拟但要说明"已保留原始副本"。做不到就在报告里写"未接线"。

验收（Tess 会另有测试，但你自测一次）：把 `heartflow-state` 写成 `"{bad json"` 后调用 `loadState()`，`heartflow-state-quarantine` 应等于原字符串且不抛错。

---

## FIX-3（P1-1a）关系分析控制器绕过 mutate

文件：`public/modules/intelligence/controller.js:25-31` + `public/app.js:85-90`

现状：`replace()` 直接 `appState.relationshipIntelligence = next`，`persist: true` 时只调 `saveAppState()`（= `saveState` → `persistState`），**不触发** `onStateChange` → `renderAll` 不跑 → 授权开关后「关系档案」面板仍显示"未授权"。

要求：

1. 控制器签名新增可选参数 `updateAppState = null`（一个接收 `(draft) => void` 的函数，即 `mutate`）。
2. `replace()` 改为：
   - 当 `persist === true` 且 `updateAppState` 是函数：调用 `updateAppState((draft) => { draft.relationshipIntelligence = next; })`，**不再**调用 `saveAppState()`（`mutate` 自带持久化与广播）。
   - 否则保持原行为（直写 + 可选 `saveAppState()`）。
3. `public/app.js:85-90` 的 `createRelationshipIntelligenceController({...})` 增加 `updateAppState: mutate`（`mutate` 已在 `app.js:24` 区域导入）。

注意：`persist: false` 的路径（loading/error 态）**不要**改成 mutate——那会把每次中间态都落盘，属行为变更。

---

## FIX-4（P1-1b）撤销授权时直删 live 对象

文件：`public/app.js:684-693`（`setRelationshipIntelligenceConsentFromUi`）

现状：

```js
if (!granted) {
  for (const memory of Object.values(state.personaMemory || {})) {
    if (memory && typeof memory === "object") delete memory._enhanced;
  }
}
```

改为走 `mutate`：

```js
if (!granted) {
  mutate((draft) => {
    for (const memory of Object.values(draft.personaMemory || {})) {
      if (memory && typeof memory === "object") delete memory._enhanced;
    }
  });
}
```

顺序要求：删除必须发生在 `intelligenceController.setConsent(granted)` **之前**（保持现有语义：先清记忆再落授权状态）。

---

## FIX-5（P1-1c）训练模式切换绕过 mutate

文件：`public/modules/training/training-mode-controller.js:41-55` + `public/app.js:92-97`

现状：`:49-50` `state.trainingMode = next; saveAppState();`——无草稿隔离、不广播；`persistState` 中途抛错会留下"内存已改、磁盘未改"的半更新态。

要求：

1. 控制器签名新增可选参数 `updateAppState = null`。
2. `setMode()` 中改为：若 `updateAppState` 是函数 → `updateAppState((draft) => { draft.trainingMode = next; })`；否则保留原两行。其余逻辑（`render()`、`setStatus`）不变。
3. `public/app.js:92-97` 增加 `updateAppState: mutate`。

---

## FIX-6（P1-2）三种"今天"口径并存

**根因**：`training/real-practice.js:68` 的 `shanghaiDate()`（Asia/Shanghai）、`render/render-lifestyle.js:260`（设备本地）、`training/growth.js:514`（UTC）、`core/memory.js:250`（UTC）四份实现。

要求：

1. **新建** `public/modules/core/date.js`：把 `real-practice.js:68-74` 的 `shanghaiDate` 实现**原样迁入**（零 import，纯函数），并在文件头注明"全库唯一日期键口径：Asia/Shanghai"。
2. `training/real-practice.js` 改为 `export { shanghaiDate } from "../core/date.js";`，删除本地实现。**保持导出名不变**，避免影响现有调用方（`render-learning.js` 等）。
3. `training/growth.js:514-516` 的 `toDateKey(time)` 改为 `return shanghaiDate(time);`，并 `import { shanghaiDate } from "../core/date.js";`。注意 `toDateKey` 的入参是**毫秒时间戳**，`shanghaiDate` 接受 Date/number/string，无需转换。
4. `render/render-lifestyle.js:259-263` 的 `todayKey()` 改为 `return shanghaiDate();`，删除本地拼接；保留函数名（有调用方）。
5. `core/memory.js:250` 的 `date: new Date().toISOString().slice(0, 10)` 改为 `date: shanghaiDate()`，并 import。

**不做**：不动 `real-practice.js:76-80` 的 `validDate()`（它用 UTC 解析做 `YYYY-MM-DD` 合法性校验，与"今天"口径无关）。

**必须自检**：改完跑 `node scripts/check-circular.mjs`，确认 0 环。`core/date.js` 不得 import 任何模块。

---

## FIX-7（P2-1）`escapeHtml` 三套写法

1. `public/modules/render/coach-float.js:63-65`：删除本地 `function escapeHtml`，改为从 `../core/dom.js` import（该文件 `:8` 已 import `clampScore`，确认是否有同名冲突）。
   - 差异仅单引号实体 `&#39;` vs `&#039;`，两者等价；改为 dom 版后若有测试断言 `&#39;` 需在报告中列出（测试由 Tess 处理，你只报告）。
2. `public/modules/render/stage-progress.js:40,43`：把 `stage.replace(/[<>&"']/g, "")` 改为 `escapeHtml(stage)`，import 自 `../core/dom.js`。这是**数据损坏**（`O'Brien` → `OBrien`）而非转义，必须改。

---

## FIX-8（核心交付）约定检查器

新建 `scripts/check-conventions.mjs`，零依赖，风格对齐现有 `scripts/check-circular.mjs`（108 行）。

**CLI 契约**：

```
node scripts/check-conventions.mjs [--root <dir>] [--json]
```

- 默认 root = 仓库根（脚本自身 `../`）
- 退出码：0 = 无违规；1 = 有违规
- 输出：每条违规一行 `文件:行 规则ID 说明`
- `--json` 输出机器可读结果（供测试使用）
- `--root` 必须支持，供 Tess 用 fixture 目录做反向测试

**规则（只实现这 5 条）**：

### R1 `html-interpolation-escape`
遍历所有 HTML sink（`.innerHTML =`、`.innerHTML +=`、`.outerHTML =`、`insertAdjacentHTML(`）所赋的模板字符串，提取 `${...}` 插值。若插值的**顶层属性名**命中文本类白名单（`text|title|label|summary|message|name|content|reason|note|reply|description|detail|hint|snippet|effect|prompt|question|answer|quote`）且：
- 未被 `escapeHtml(...)` / `Number(...)` 包裹，且
- 同一函数作用域内**不存在** `escapeHtml(该表达式)` 或 `escapeHtml(该变量名)` 的调用

→ 报违规。

**误报控制**：允许"先取变量再转义"（`const label = ...; ...escapeHtml(label)`）。实现方式：对每个可疑变量名，在所在函数文本内搜索 `escapeHtml(\s*<name>\s*)`，命中即豁免。这条白名单是规格的一部分，不得省略。

### R2 `state-write-bypass-mutate`
识别所有 `mutate(` 调用，**用括号配对**求出回调体的字符区间集合。在区间**之外**出现下列形态即违规：
- `getState().<prop> =`
- `getAppState().<prop> =`
- `state.<prop> =` / `delete state.<prop>`（仅当 `state` 在同一函数内由 `getAppState()` / `getState()` 赋值）
- `appState.<prop> =` / `delete appState.<prop>`（同上）

**绝对不能用全文正则**：本项目 37 处 `state.x =` 位于 `mutate((state) => ...)` 回调内，纯文本匹配假阳性 92.5%。必须做区间排除。

### R3 `layer-direction`
- `public/modules/core/**` 不得 `import` `../render/`、`../intelligence/`、`../voice/`
- `server/**` 不得 `import` `../public/` 或 `public/`

**不要**禁止 `core → coach` / `core → training`（那是设计内依赖，会造成 5 条误报）。

### R4 `single-escape-html`
`public/` 内 `function escapeHtml` / `const escapeHtml` / `let escapeHtml` 出现次数 > 1 → 违规。

### R6 `single-date-key`
`public/**` 内出现 `toISOString().slice(0, 10)` 或 `getFullYear()` 拼 `YYYY-MM-DD` 的模式 → 违规。
**文件级豁免**：`public/modules/core/date.js`、`public/modules/training/real-practice.js`（`validDate` 用同表达式做校验）。
**测试文件豁免**：只扫 `public/` 与 `server/`，不扫 `test/`。

**实现要求**：

- 用 `node:fs` 递归读文件（跳过 `node_modules`、`.git`、`.agent-runs`、`voice/`、`long-simulation/`）
- 输出必须**确定性排序**（按路径、行号），否则测试无法稳定断言
- 每条违规附规则 ID，便于 Tess 写精确断言
- 文件头注释写明"这些是项目口头约定的可执行版本，不是通用 linter"

---

## package.json

只加一条 script：

```json
"check:conventions": "node scripts/check-conventions.mjs"
```

---

## 报告要求（写入 output_path）

```markdown
# 实现报告

## 改动清单
| # | 任务 | 文件 | 行数变化 | 状态 |
（FIX-1 … FIX-8 逐条）

## 与规格的偏差
（如有，逐条说明原因；无则写"无"）

## 自测输出
### node --test
（贴尾部汇总：tests/pass/fail）
### node scripts/check-circular.mjs
（贴输出）
### node scripts/check-conventions.mjs
（贴输出 + 退出码）
### node --check（逐文件）
（贴结果）

## 遗留风险
（例如：改了 escapeHtml 后可能出现 `&#39;` 断言失效，需 Tess 处理的具体位置）
```

## 返回给队长的状态块（只回这个）

```
STATUS: DONE | BLOCKED
OUTPUT: <output_path>
FIXED: <完成项编号列表>
DEVIATIONS: <n>
TESTS: pass=<> fail=<>
CONVENTIONS_EXIT: <0|1>
NEXT: 等待队长调度
```
