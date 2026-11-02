# 测试报告

> 测试工程师：**队长 Horizon 代执行**（原派 Tess 两轮，均零产出，按降级策略由队长接手）
> 日期：2026-10-22
> 项目根：`E:/一门给年轻人的恋爱成长课/relationship-simulator`

## 0. 执行说明

原计划由 Tess 完成 TEST-1～TEST-4。她两轮返回完成信号但磁盘零落盘（无测试文件、无报告），按 contingency policy 停止重试、由队长降级执行。**实现（Max）与验证（Vic）仍保持分离**——本轮由队长写测试，后续由独立验证员 Vic 复核。

## 1. 新增用例

| 文件 | 用例数 | 覆盖 |
|---|---|---|
| `test/check-conventions.test.mjs` | 19 | 检查器反向用例（R1/R2/R3/R4/R6 的违规捕获 + 合规不误报 + 确定性排序） |
| `test/date-keys.test.mjs` | 10 | `shanghaiDate` 跨零点边界、非法输入、与 `getTrainingStreak` 的口径一致性 |
| `test/state-quarantine.test.mjs` | 9 | 损坏 JSON 的隔离、异常记录、隔离写入失败降级、正常路径不写隔离键 |
| `test/helpers/conventions.mjs` | — | 共享辅助：跑真实检查器取指定文件/规则的违规 |
| **合计新增** | **38** | 另修正 2 条假断言（不计入新增） |

## 2. 反向验证结论（证明检查器不是空转）

**这是本轮的核心交付。** 检查器对整个代码库报 0 违规时，没有这组用例就无法区分「规则有效且代码合规」与「规则空转」。

| 规则 | 违规样例被抓到 | 合规样例不误报 | 结论 |
|---|---|---|---|
| R1 `html-interpolation-escape` | ✅ `${obj.text}` 裸插被抓 | ✅ 先转义再取变量（白名单二）、插值本身就是 `escapeHtml(...)`、非文本属性名 | 有效 |
| R2 `state-write-bypass-mutate` | ✅ `getAppState().x =`、`getState().x =` 在 mutate 外被抓 | ✅ mutate 回调内 `state.x =` / `delete`、与 state 无关的同名变量 | 有效 |
| R3 `layer-direction` | ✅ core→render、core→intelligence/client、server→public | ✅ core→intelligence/state（设计内） | 有效 |
| R4 `single-escape-html` | ✅ 两份实现被抓 | ✅ 委托式薄封装（import 进来的目标）不误报 | 有效 |
| R6 `single-date-key` | ✅ `toISOString().slice(0,10)` 被抓 | ✅ `core/date.js` 文件级豁免、`test/` 不纳入扫描 | 有效 |

## 3. 测试过程中发现并修复的检查器缺陷（2 个）

这是反向用例的实际产出——它们抓到了检查器自身的问题。

| # | 缺陷 | 影响 | 修复 |
|---|---|---|---|
| D-1 | **R4 假阴性**：`isDelegatingFacade` 把 `function escapeHtml(v){ return String(v); }` 判为"委托式薄封装"而跳过。因为正则只检查"函数体是单个 `return f(...)`"，不校验 `f` 是什么 | 真实的错误实现（`String` 不做转义）会被当成薄封装漏掉 | 薄封装的委托目标必须是**本文件 import 进来的标识符**（`isImportedIdentifier`）。`String` 未被 import → 判定为真实实现 |
| D-2 | **R6 范围超规格**：`checkDateKeys` 没有路径过滤，把 `test/` 也扫了 | 测试里为构造跨零点用例显式写 UTC 是合法用法，会误报 | 加 `if (!relPath.startsWith("public/")) return violations;`，与规格 `public/**` 对齐 |

## 4. TEST-4 处理方式：假断言改为真实断言

`test/mistakes.test.mjs` 与 `test/session-report.test.mjs` 各有一条名为「全部插值过 escapeHtml」的断言，实际是 `assert.match(source, /escapeHtml/)`——文件里出现过一次即可通过，防护力为 0。

**选择 (a) 改成真断言**，不删除：改为调用真实检查器，断言该文件上 `html-interpolation-escape` 违规数为 0。

```js
assert.deepEqual(r1ViolationsFor("public/modules/render/render-mistakes.js"), [], "...");
```

理由：删除会减少断言数且丢失「单文件回归」能力；而改用 R1 真实执行后，这条断言既有防护力，又不会与全局检查重复到无意义（它锁定了「这个文件」这个范围）。其余源码正则断言（零 LLM、写路径走 mutate 等）保持不变。

## 5. 明确未覆盖的边界

| 项 | 说明 |
|---|---|
| 非 Asia/Shanghai 时区下的跨零点实测 | `micro-training.js` 内部 `dateKey` 未导出，无法直接断言。当前用「`getTrainingStreak` 与 `shanghaiDate` 同口径」间接覆盖；真正的时区漂移检测需以 `TZ` 环境变量另跑一次，本轮未执行 |
| R1 对「先转义到 A、插值用 B」的漏报 | 白名单一（同一作用域存在 `escapeHtml(name)`）会豁免 `const safe = escapeHtml(label); ... ${label}` 这种用错变量的情形。这是已知的宽松边界，误报控制优先 |
| 浏览器侧真实渲染 | 全部结论基于 Node 单测与静态检查，未在浏览器复现 |

## 6. 全量测试输出

```
$ node --test
1..840
# tests 840
# pass 840
# fail 0

$ node scripts/check-conventions.mjs
扫描文件数: 106
conventions: 0 ✅ 无违规      (exit 0)

$ node scripts/check-circular.mjs
扫描模块数: 101
circular: 0 ✅ 无循环依赖
```

基线 801 → 现 840（+39，其中 38 新增 + 1 来自既有文件拆分调整），**0 fail**，且未删除任何既有测试。

## 7. 检查器缺陷清单

见 §3。两个缺陷均已修复并由本轮反向用例锁定回归。
