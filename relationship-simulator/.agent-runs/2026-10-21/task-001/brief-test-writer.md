# 任务书：测试工程师 Tess

- role_name: 测试工程师 Tess
- mission: 为新落地的约定检查器与两处修复补测试，并证明检查器能真正抓到违规（反向用例）
- allowed_edit_scope: **仅 `test/**` 目录**，一律不改 `public/`、`server/`、`scripts/`
- output_path: `.agent-runs/2026-10-21/task-001/test-report.md`
- 项目根目录: `E:/一门给年轻人的恋爱成长课/relationship-simulator`

## 背景（必读）

本轮已落地：
- `scripts/check-conventions.mjs`：零依赖约定检查器，5 条规则 R1/R2/R3/R4/R6。CLI：`node scripts/check-conventions.mjs [--root <dir>] [--json]`，退出码 0=无违规 / 1=有违规 / 2=参数错误。stdout 每条违规一行 `相对路径:行号 规则ID 说明`，确定性排序；`--json` 输出机器可读结果。
- `public/modules/core/date.js`：全库唯一日期键口径（Asia/Shanghai），导出 `shanghaiDate()`。
- `public/modules/core/state.js`：`loadState()` 解析失败时把原始字符串写入 `STORAGE_KEYS.stateQuarantine`（= `"heartflow-state-quarantine"`）后再重置，并导出 `getStateLoadIssue()`。
- `public/modules/render/compliance-banner.js`：存储不可用时改为 **fail-closed**（显示横幅）。

当前基线：`node --test` **801/801 全绿**；`node scripts/check-conventions.mjs` **exit 0**；`node scripts/check-circular.mjs` 0 环。

**关键风险**：检查器现在对整个代码库报 0 违规。这可能是"规则有效且代码合规"，也可能是"规则空转、什么都抓不到"。**你的第一任务就是区分这两种情况。**

## 必做任务

### TEST-1 检查器反向用例（最重要）

新建 `test/check-conventions.test.mjs`。

要求：为 **R1 / R2 / R3 / R4 / R6 每条规则各写至少 1 个"必须被抓到"的用例**，外加 1 个"干净 fixture 必须通过"的用例。

做法：
1. 在 `test/` 下建 fixture 目录（建议 `test/fixtures/conventions/<case-name>/`），每个 case 里放**故意违规**的最小 JS 文件。
2. 用 `node:child_process` 的 `execFileSync` 跑 `node scripts/check-conventions.mjs --root <fixtureDir> --json`，解析输出断言。
3. fixture 必须是**最小可判定**的：只放触发该规则所需的代码，不要放无关噪音。

各规则的违规样例（照此构造即可，可自行简化）：

| 规则 | fixture 应包含 | 期望 |
|---|---|---|
| R1 `html-interpolation-escape` | 一个函数：`el.innerHTML = \`<p>${obj.text}</p>\`;`，且全文件无 `escapeHtml` | 违规，`rule === "html-interpolation-escape"` |
| R2 `state-write-bypass-mutate` | 顶层：`const s = getState(); s.foo = 1;`（**在 `mutate(` 回调之外**） | 违规，`rule === "state-write-bypass-mutate"` |
| R3 `layer-direction` | 一个放在 `public/modules/core/` 子路径下的文件，`import x from "../render/foo.js";` | 违规，`rule === "layer-direction"` |
| R4 `single-escape-html` | 两个文件各含 `function escapeHtml(...){}` | 违规，`rule === "single-escape-html"` |
| R6 `single-date-key` | 一个 `public/` 下文件含 `new Date().toISOString().slice(0, 10)` | 违规，`rule === "single-date-key"` |

**注意 R3 的 fixture 路径**：`--root` 指向 fixture 根，所以 fixture 内要自己建 `public/modules/core/xx.js` 这样的相对结构，`relPath` 才会命中 `core/` 前缀。

**必须额外验证的反例**（证明误报控制有效，每条至少 1 个）：
- R1：`const label = ...; el.innerHTML = escapeHtml(label);` → **不**报违规（"先取变量再转义"白名单）
- R2：`mutate((state) => { state.foo = 1; });` → **不**报违规（mutate 回调内直写是合规的）
- R6：fixture 中 `public/modules/core/date.js` 路径的文件含 `toISOString().slice(0, 10)` → **不**报违规（文件级豁免）

这些"不报"的用例与"必须报"的用例同等重要——它们证明规则不是靠过度报警刷存在感。

### TEST-2 日期口径统一

新建 `test/date-keys.test.mjs`：

1. `shanghaiDate(new Date("2026-10-20T16:30:00Z"))` 必须等于 `"2026-10-21"`（北京时间次日 00:30）。
2. `shanghaiDate(new Date("2026-10-20T15:59:00Z"))` 必须等于 `"2026-10-20"`（北京时间 23:59）。
3. `shanghaiDate` 对非法输入（`new Date("not-a-date")`）应抛 `TypeError`。
4. `public/modules/training/micro-training.js` 的 `dateKey()` 若可导出则直接测；若未导出，用 `getTrainingStreak` 之类的公开入口构造跨零点场景，证明不再按设备本地日期偏移。**若该函数未导出且无等价入口，在报告中写明"未能覆盖"并说明原因，不要伪造断言。**

### TEST-3 状态损坏隔离

新建 `test/state-quarantine.test.mjs`：

1. 让 `localStorage.getItem(STORAGE_KEYS.state)` 返回非法 JSON（如 `"{bad"`）。
2. 调用 `loadState()`。
3. 断言：不抛错；返回值是合法默认态；`localStorage.getItem(STORAGE_KEYS.stateQuarantine)` 等于原非法字符串；`getStateLoadIssue()` 非 null。
4. 正常路径：合法 JSON 时 `getStateLoadIssue()` 为 `null`，隔离 key 不被写入。

（`core/state.js` 通过 `globalThis.localStorage` 读写，测试里替换 `globalThis.localStorage` 即可，参照 `test/memory-panel.test.mjs` 的做法。）

### TEST-4 修正两条假断言（负价值测试）

`test/mistakes.test.mjs:264-265` 与 `test/session-report.test.mjs:356-357` 的测试名为"全部插值过 escapeHtml"，断言却是 `assert.match(source, /escapeHtml/)`——文件里只要出现过一次 `escapeHtml` 就通过，防护力为 0。

处理方式二选一，**并在报告中说明选了哪个及理由**：
- **(a) 推荐**：改成真正有意义的断言——例如断言该渲染函数在含 `<` `>` `&` 的输入下输出被转义（把构造的输入喂给被测函数，比对输出）。
- **(b)** 若函数耦合 DOM 无法直接调用，把这两条断言**删除**，并在测试报告中记录"已移除负价值断言"。

**不得**保留现状。

## 硬约束

1. 只写 `test/**`。改 `public/` / `scripts/` / `package.json` 一律违规。
2. 不引入任何依赖，只用 `node:test` + `node:assert/strict`。
3. 新增用例总数 **不少于 15 条**。
4. 全部完成后跑 `node --test`，**总数必须 ≥ 801 + 新增数**，且 **0 fail**。把尾部汇总贴进报告。
5. 若发现 checker 本身有 bug（fixture 触发了但规则没抓到），**不要改 checker**，在报告中列出"缺陷清单 + 最小复现 fixture 路径"，交回队长。

## 报告格式（写入 output_path）

```markdown
# 测试报告

## 新增用例
| 文件 | 用例数 | 覆盖 |
（逐文件）

## 反向验证结论
| 规则 | 违规样例被抓到 | 合规样例不误报 | 结论 |
（R1/R2/R3/R4/R6 逐条）

## TEST-4 处理方式
（选 (a) 还是 (b)，理由）

## 全量测试输出
（贴 node --test 尾部汇总）

## 检查器缺陷清单
（如有）
```

## 返回给队长的状态块

```
STATUS: DONE | BLOCKED
OUTPUT: <output_path>
NEW_TESTS: <n>
TOTAL_TESTS: pass=<n> fail=<n>
RULES_PROVEN: <R1/R2/R3/R4/R6 中已证明能抓到的>
DEFECTS: <n>
NEXT: 等待队长调度
```
