# 调查报告：代码质量审计

> 调查员：Vera（只读）
> 项目根：`E:/一门给年轻人的恋爱成长课/relationship-simulator`
> 取证方式：Grep / Read / Bash + 临时脚本（写在 `C:/Users/lenovo/AppData/Local/Temp/audit/`，未写入项目目录）
> 基线复核：`node --test` → 801 pass / 0 fail（实测）；`node scripts/check-circular.mjs` → 扫描 100 模块 / 0 环（实测）

**口径说明**：任务书写"105 个模块"，实测 `public/**/*.js` 为 92 个（其中 `public/modules/` 91 个）、`test/*.mjs` 75 个、check-circular 从两个入口可达 100 个。下文数字均为实测值，口径已标注。

---

## 结论摘要

1. **三条约定全部被遵守，但一条都没有检查器。** 全库 67 处 `.innerHTML =`（58 处非空）、566 处 HTML 模板插值，**没有发现一处用户可控文本未转义**——这是真实的、被 100% 执行的纪律；但它靠人肉维持，仓库里唯一的自动化检查是 `check-circular.mjs`（只判环、不判方向），且现有两处"源码级转义断言"是假断言（见 P1-3）。
2. **"状态写入必须走 mutate"已被突破 3 处，其中 1 处有确定的用户可见后果**：撤销/授予关系分析授权后，「关系档案」面板不会重绘（仍显示"未授权"）。这是假设 b **不成立**。
3. **真正的分层风险不是 core→render（0 边），而是 core↔training 双向耦合**（core→training 5 条 import，training→core 5 条 import）。c 条按字面成立，按意图（"上层不反向依赖"）需重新表述，否则检查器会给出"0 违规"的假安心。
4. **三种"今天"的定义同时存在于运行时**（Asia/Shanghai / 设备本地 / UTC），可复现地让同一次操作在两个面板显示成两个日期。这是本轮唯一的**确定性计算错误**（P1-2），801 条测试覆盖不到。
5. **最高杠杆的改进确实是把约定固化为检查器**，但可行性已被原型量化：位置法规则在今日代码上命中 49 处、误报 48 处、且漏掉唯一的真实偏差；必须改成"文本属性白名单 + sink 绑定"的高精度形态（今日命中 0）。逐条数据见《建议的检查器规则》。

---

## 假设验证

### a) HTML 模板插值必须经 `escapeHtml`

**结论：约定成立，且被 100% 执行；但不可执行、无护栏。**

| 取证项 | 结果 |
|---|---|
| `.innerHTML =` 赋值总数 | 67（其中 58 处非空表达式，9 处置空） |
| HTML sink 覆盖 | `.innerHTML` 67 + `insertAdjacentHTML` 4（`render-coach.js:129/136/141/144`）+ `outerHTML` 0 + `document.write` 0 |
| 含 HTML 模板的文件 / 插值点 | 23 个含 sink 的文件内共 566 处插值（临时脚本统计） |
| 文本类插值是否都在 `escapeHtml(...)` 内 | 是。逐处核查 58 处非空 `.innerHTML` 的插值，无一处用户/模型可控文本裸插 |

**逐条给反例（1 处真实偏差 + 5 处假风险）：**

| # | 位置 | 插值 | 判定 | 依据 |
|---|---|---|---|---|
| a-1 | `E:/一门给年轻人的恋爱成长课/relationship-simulator/public/modules/render/render-longContent.js:37` | `${chapterId}` | **真偏差（当前不可利用）** | 该模板直接 `content.innerHTML =`。`chapterId` 唯一外部入口是 `render-longContent.js:16` 读 `localStorage["heartflow-long-read-progress"].chapterId`；`saveReadProgress`（`render-longContent.js:84`）写入的都是 `Number(item.dataset.chapter)`（`:30`）或 `Number(link.dataset.chapter)`（`render-coach.js:146`）、`Number(button.dataset.chapter)`（`render-learning.js:165`）。即**所有调用链已把值强转为 Number**，故不可注入；本行是"靠调用方自觉"的裸插，违反纪律但无风险 |
| a-2 | `public/modules/render/stage-progress.js:40,43` | `stage.replace(/[<>&"']/g, "")` | **假风险** | 用"删除字符"代替"转义"，来源是 `RELATIONSHIP_STAGES`（`core/stages.js`）常量。安全，但这是第 3 种消毒写法（见 P2-1） |
| a-3 | `public/modules/render/coach-float.js:63-65` | 本地 `escapeHtml` 副本 | **假风险（安全）** | 与 `core/dom.js:3-11` 语义等价，仅单引号实体写法不同（`&#39;` vs `&#039;`）。但它是第二份实现，且此文件**没有** import `core/dom.js`（`:8` 只 import `clampScore`），未来修 dom.js 时不会同步 |
| a-4 | `public/modules/training/training-mode-controller.js:34` | `${config.label}` | **假风险** | `config` 来自 `TRAINING_MODES[mode]`（`core/config.js:167+`）常量表 |
| a-5 | `public/app.js:780,785` | `engine.id/label`、`voice.id/label` | **假风险** | `TTS_ENGINES` 是模块内常量（`public/modules/voice/tts-client.js:8-34`），`voicesFor()`（`:44-46`）只读该常量表 |
| a-6 | `public/modules/render/render-persona.js:19` | `item.name`（自定义角色名，**用户输入**） | **假风险（上游已转义）** | `:20` 对 `escapeHtml(label)` 整体转义，`label` 由 `item.name` 拼接而来 |

**属性值位置的额外确认**：3 处动态 `href` 全部先过 URL 白名单再 `escapeHtml`——`coach-float-search.js:14-24`（`safeReferenceUrl`）与 `render-presentation-knowledge.js:9-14`（`safeSourceUrl`）。无 `javascript:` 逃逸。

**旁证：这个约定是被"人"守住的，不是被工具守住的。** 仓库无 ESLint/Prettier/tsconfig/biome（`ls -a | grep -E "eslint|prettier|tsconfig|editorconfig|jshint|biome"` 为空）；`package.json` 仅有 `check:circular`、`build:index`、`test` 三个脚本。

---

### b) 状态写入必须走 `mutate`

**结论：假设不成立。存在 3 处绕过，其中 1 处有确定的用户可见缺陷。**

`mutate` 的契约（`public/modules/core/state.js:215-248`）：在 `clone(state)` 草稿上执行 → `persistState(draft)` → `Object.assign(state, draft)` 保根对象身份 → 调用 `changeListener`（`:237`）。因此**绕过 mutate 的直接写 = 不广播 `onStateChange` = 不触发 `renderAll`**（`app.js:901` 装配 `onStateChange(renderAll, ...)`）。

| # | 位置 | 写法 | 后果 |
|---|---|---|---|
| b-1 | `E:/一门给年轻人的恋爱成长课/relationship-simulator/public/modules/intelligence/controller.js:25-31` | `const appState = getAppState(); appState.relationshipIntelligence = next;` | **确定缺陷**：`replace()` 是 controller 内所有写路径（`:37/48/52/60/66`），全部直写 live 对象；`persist:true` 时调 `saveAppState()`（= `saveState` → `persistState`，`state.js:131-133`）**不触发 changeListener** |
| b-2 | `public/app.js:686-690` | `for (const memory of Object.values(state.personaMemory \|\| {})) { ... delete memory._enhanced; }` | 撤销授权时直接删 live 对象字段；虽被 `serializeStateForStorage`（`state.js:164-168`）兜住持久化，但内存态在 `setConsent` 之前已被改，且同样不广播 |
| b-3 | `public/modules/training/training-mode-controller.js:49-50` | `state.trainingMode = next; saveAppState();` | 同 b-1 机制（`getAppState: () => state`，`app.js:93`；`saveAppState: saveState`，`app.js:94`）。`render()`（`:51`）只重画 modeBanner，其余依赖 `trainingMode` 的面板不重绘；且无草稿隔离——`persistState` 中途抛错（`localStorage.setItem` 配额满，`state.js:147`）会留下"内存已改、磁盘未改"的半更新态 |

**b-1 的可复现推演（证据链完整）：**
1. 用户在「证据与决策」勾选授权 → `app.js:884` 绑定 `setRelationshipIntelligenceConsentFromUi`。
2. `app.js:691` `intelligenceController.setConsent(granted)` → `controller.js:60` `replace(..., { persist: true })`。
3. `controller.js:25-30` 直写 + `saveAppState()` + `render(next)`；`render` 注入的是 `renderIntelligencePanel`（`app.js:89`）。
4. `renderIntelligencePanel`（`app.js:204-210`）只调 `renderRelationshipIntelligence` / `renderActionPlan` / 同步 checkbox。
5. `renderMemoryPanel` 仅在两处被调用：`app.js:144`（`renderLearningPanels`）与 `app.js:258`（`renderAll`），两者都不在这条链上。
6. **结果**：关系档案面板停留在"未授权 / 去授权"文案（`render-memory-panel.js:84-91` 的 `renderGate()`），直到用户触发下一次全量 `renderAll`。

**反向核对（避免误报）**：全库 `getState().x =` 形态 0 处；`state.x =` 文本形态 40 处，其中 37 处在 `mutate((state) => {...})` 回调内（改写的是 draft，合规）、3 处即上表。**这说明"文本匹配"规则在这个代码库里有 92.5% 假阳性——mutate 回调参数也叫 `state`**，检查器必须做作用域识别，不能纯文本。

---

### c) core 层不得反向 import render 层

**结论：按字面成立（0 边）。但按"上层不反向依赖下层"的意图，不成立——真正的耦合在 core↔training。**

```
$ grep -rn "^import" public/modules/core/*.js | grep -E "\.\./(render|voice)/"
（无输出）
$ grep -rn "^import" public/modules/core/*.js | grep -E "\.\./(coach|training)/"
public/modules/core/api-client.js:1:      import { buildSystemPrompt } from "../coach/prompts.js";
public/modules/core/config.js:164:       export { PUA_TECHNIQUES } from "../training/pua-awareness.js";
public/modules/core/learning-state.js:9: import { normalizeAbilityAssessment } from "../training/ability-assessment.js";
public/modules/core/state.js:8:          import { normalizeLifestyle } from "../training/lifestyle.js";
public/modules/core/state.js:9:          import { normalizePracticeState, toPersistedPracticeState } from "../training/real-practice.js";
public/modules/core/state.js:10:         import { toPersistedAbilityAssessment } from "../training/ability-assessment.js";
```

反向（training → core）同样存在 5 条：`training/mistake-patterns.js:8`（`MISTAKE_DIM_KEYS`）、`training/replay.js:9`（`redactSensitiveText`）、`training/session-report.js:19`（`MISTAKE_COLLECT_RULES`）、`training/timing.js:11`（`STAGE_VALUES`）、`training/training-mode-controller.js:1`（`TRAINING_MODES`）。

- 文件级无环（`check-circular` 实测 0 环），**目录级是双向的**。
- 设计文档 `docs/设计文档-解耦重构.md:180-200` 把 `coach/prompts.js` 放在 L0 叶子层，所以 `api-client.js:1` 是**设计内**依赖，不是违规。这正说明：规则必须写成"目录白名单"而不是"core 不许 import 任何东西"，否则今天就会 6 条误报。
- **server → public：0 条**（`server/*.js` 中只有 `config.js:8` 定义 `publicDir` 路径、`staticServer.js:6,29-45` 以静态文件方式读取，无 `import`）。此条假设成立。

---

## 问题清单（按严重度排序）

### P0 安全/正确性

| # | 问题 | 位置 | 证据 | 影响 | 建议 |
|---|---|---|---|---|---|
| P0-1 | **合规声明 fail-open**：`localStorage` 抛错时被视为"已知悉"，AI 模拟声明永不显示 | `E:/一门给年轻人的恋爱成长课/relationship-simulator/public/modules/render/compliance-banner.js:11-17` | `catch { return true; }`（`:14-16`）；`initComplianceBanner` 在 `:25` 据此 `return { visible: false }` | 首次访问者在隐私模式/存储受限环境下**完全看不到**"本应用角色为 AI 模拟，非真人"。这是产品硬性合规声明，失败方向应当是 fail-closed（显示横幅） | `catch { return false; }`，并让 `dismiss()`（`:27-35`）在写入失败时仍可关闭本次会话（内存标记） |
| P0-2 | **状态损坏静默重置且立即覆盖，无隔离副本** | `E:/一门给年轻人的恋爱成长课/relationship-simulator/public/modules/core/state.js:117-125` + `:135-150`（`persistState`）+ `:146-148`（`setItem`） | `loadState()` 的 `catch`（`:121-123`）直接 `currentState = normalizeState(clone(defaultState))`，无日志、无告警、无原值保留；随后任意一次 `mutate`/`saveState` 会把默认态写回同一个 key（`STORAGE_KEYS.state = "heartflow-state"`，`core/config.js:206`），**原数据的唯一副本被覆盖** | 用户全部本地档案（对话、训练日志、错题本、成长档案）永久丢失，且界面上表现为"像新用户"。`grep -rn "corrupt\|state-backup" public/modules/core/*.js` 无任何隔离/备份代码 | 在 `catch` 里先把原始字符串写入 `heartflow-state-quarantine`（新增 key），再重置，并在 `apiStatus` 明确提示"检测到档案损坏，已保留原始副本" |

**用户可控性判定**：P0-1 = 否（由浏览器存储策略触发，不可被对话内容操控）；P0-2 = 否（需外部工具写坏或存储被截断）。两条都属"低频但不可逆/不可见"，因此定 P0 而不是按频率降级。

### P1 结构性风险

| # | 问题 | 位置 | 证据 | 影响 | 建议 |
|---|---|---|---|---|---|
| P1-1 | 状态直写绕过 `mutate`，无广播、无原子性（详见假设 b） | `public/modules/intelligence/controller.js:25-31`；`public/app.js:686-690`；`public/modules/training/training-mode-controller.js:49-50` | `replace()` 直写 `appState.relationshipIntelligence`；`saveAppState()` → `state.js:131-133` → `persistState`，**不经过** `:237 changeListener?.()` | 授权开关后「关系档案」面板不重绘（复现链见上）；训练模式切换后除 banner 外的面板不重绘；持久化失败留下半更新内存态 | controller 改为注入 `mutate`（或让 `saveAppState` 走 `mutate(() => {})`）；`app.js:688` 的 `delete` 移入 `mutate` 回调 |
| P1-2 | **三种"今天"口径并存**，同一次操作可显示成两个日期 | ① `public/modules/training/real-practice.js:68-80`（`shanghaiDate`，Intl+Asia/Shanghai）② `public/modules/render/render-lifestyle.js:260-263`（`todayKey`，设备本地 `getFullYear`）③ `public/modules/training/growth.js:514-516`（`toDateKey`，`toISOString()` = UTC）④ `public/modules/core/memory.js:250`（`new Date().toISOString().slice(0,10)` = UTC） | 实测 `TZ=Asia/Shanghai`、时刻 `2026-10-21T00:30+08:00`：设备本地 = `2026-10-21`，UTC 键 = `2026-10-20`，Intl 上海 = `10/21/2026`。消费点：`growth.js:321-325` 按 `dimension\|date` 去重（跨零点两次练习被折叠成一次）；`render-memory-panel.js:129` 把 `item.date` 直接显示为档案日期 | 用户在北京时间 00:00–08:00 之间的操作，记忆面板/成长档案会标成"昨天"，连续天数与去重计数偏差 1 天 | 统一到 `real-practice.js:68` 的 `shanghaiDate()`（已有导出，被 3 个模块复用），其余 3 处调用它；`growth.toDateKey(ms)` 改为 `shanghaiDate(ms)` |
| P1-3 | 现有测试名与实际断言不符，提供虚假覆盖信心 | `E:/一门给年轻人的恋爱成长课/relationship-simulator/test/mistakes.test.mjs:264-265`；`test/session-report.test.mjs:356-357` | 测试名为"UI 接线：render-mistakes **全部插值**过 escapeHtml"，断言却是 `assert.match(renderMistakesSource, /escapeHtml/)`——**只要文件里出现过一次 `escapeHtml` 就通过**，无法发现任何一处漏转义 | 这两条测试对 XSS 的防护力为 0，却会让人（和后续 AI）误以为已覆盖 | 换成真正的插值扫描断言（见《建议的检查器规则》R1），或直接把这两条断言删掉，避免负价值 |
| P1-4 | **测试覆盖缺口**：25 个 `public/modules` 模块没有任何测试文件直接 import；其中 10 个 `render-*` 无行为级测试（5 个完全未被提及、5 个只有源码正则断言） | 见《无测试模块清单》 | 逐文件比对 75 个 `test/*.mjs` 的 import 图 + `readFile` 源码断言（临时脚本） | `render-persona`（自定义角色名/头像上传）、`render-scenario`、`tts-client`（localStorage 偏好 + 引擎降级）等**接收用户输入**的模块完全无回归网 | 优先补 `render-persona` / `render-scenario` / `tts-client` 三个（各 3-5 条用例） |

### P2 可维护性

| # | 问题 | 位置 | 证据 | 影响 | 建议 |
|---|---|---|---|---|---|
| P2-1 | `escapeHtml` 三套写法 | `core/dom.js:3-11`（规范）；`render/coach-float.js:63-65`（副本，`&#39;`）；`render/stage-progress.js:40,43`（删除式"消毒"） | 见假设 a-2 / a-3 | 修一处漏两处；`stage-progress` 的删除式写法会把 `O'Brien` 变成 `OBrien`（数据损坏而非转义） | 保留 `core/dom.js` 唯一实现；`coach-float.js` 改为 import；`stage-progress.js` 改用 `escapeHtml` |
| P2-2 | `clamp 0–100 取整` 12 份等价实现 | `coach/coach.js:23-27`（`clampScore`，已导出）；`coach/analysis-result.js:115-119`；`core/investment.js:338-342`；`core/state.js:281-283`（`clampAvatarPosition`，语义不同但实现同形）；`core/learning-state.js:258-262`；`coach/her-voice.js:48-52`；`training/session-report.js:448-452`；`training/mistake-patterns.js:190-194`；`training/growth.js:497-501`；`core/training-scores.js:5-7`；`core/mistakes.js:215`；`training/timing.js:374` | 全部为 `Math.max(0, Math.min(100, Math.round(x)))`，分"非空"与"可空 null"两个族 | 数值边界策略分散；已存在导出（`clampScore`）却仍有 11 份私有副本 | 合并为 2 个：`clampScore(x)`（非空）+ `clampScoreOrNull(x)`；后者可空族 5 处直接替换 |
| P2-3 | 连续天数算法两份（注释自己承认） | `public/modules/training/micro-training.js:575-596`（`getTrainingStreak`）；`public/modules/training/lifestyle.js:481-495`（`computeStreak`） | `lifestyle.js:471` 注释原文："口径与 training/micro-training.js getTrainingStreak 对齐" | 两份算法各自维护日期序号换算（`dateToDayNumber`/`dayNumberToDateKey` vs `dayNumber`），P1-2 的 UTC/本地分歧即由此扩散 | 合并为 `training/date-keys.js`：`dateKey` / `dayNumber` / `computeStreak` |
| P2-4 | 同名同体工具函数两份 | `render/render-mistakes.js:275-279` 与 `render/render-session-report.js:259-263`（`formatTs`，**逐字节相同**）；`render-mistakes.js:281-284` 与 `render-session-report.js:265-268`（`shorten`，仅默认值 60 vs 80） | 逐行 diff 相同 | 两处 bug 修一处漏一处 | 提到 `core/dom.js` 或新建 `render/format.js`，`shorten` 保留 maxLength 参数 |
| P2-5 | 外链白名单两份、规则不一致 | `render/coach-float-search.js:14-24`（`safeReferenceUrl`：限 http/https、拒反斜杠/控制符/含 `@` 的 authority、拒账号密码）；`render/render-presentation-knowledge.js:9-14`（`safeSourceUrl`：仅 https、拒账号密码） | 手写比对 | 前者允许 `http:`，后者不允许；新增第三处调用时无统一口径 | 合并到 `core/url.js`，用严格版（https-only + 无账号密码），搜索引用若必须支持 http 则显式传 `{ allowHttp: true }` |
| P2-6 | 四维中文标签 6 份 + `drive`/`momentum` 双命名 | `coach/coach.js:152-155`（内联 dims）；`coach/coach.js:346-349`（`dimLabels`）；`coach/her-voice.js:22-33`（`DIM_READINGS[*].label`）；`render/coach-float.js:11-16`（`DIMENSION_LABELS`）；`render/render-coach.js:25`（`dimLabel` 字面量）；`training/mistake-patterns.js:11-16`（`MISTAKE_DIM_LABELS`，键为 `drive`） | 六处皆为 `{naturalness:"自然度", empathy:"共情", boundary:"边界感", momentum\|drive:"推进力"}` | `MISTAKE_DIM_LABELS["momentum"] === undefined`——任何新代码把教练维度键直接丢进该表都会静默退化成英文键名（现有代码靠 `session-report.js:80,257`、`render-coach.js:104`、`growth.js` 的手工映射躲过） | 建 `coach/dimensions.js` 导出 `DIM_LABELS` + `toMistakeKey()`；`MISTAKE_DIM_LABELS` 改为由它派生 |
| P2-7 | 模型返回不合格时静默降级，不告知用户（与同类路径不一致） | `public/app.js:508-511`（`normalizeActionPlan` 的 `catch { return fallback; }` 及 `:509` 的结构校验 `return fallback`） | 同一次模型调用的 ABC 路径会明示："MiMo 的 ABC 不合格，已使用本地兜底"（`render/render-coach.js:136`），行动计划路径则无任何提示 | 用户以为看到的是模型生成的长期计划，实际是本地模板 | 复用 `render-coach.js:136` 的模式，在 `planPanel` 顶部加来源说明 |
| P2-8 | 长函数（≥60 行）20 个，其中 4 个值得处理 | 见《超长函数》 | 声明边界扫描 + 人工判读 | 见下 | 只处理 4 个（`analyzeReplay` 拆分；`buildCoachScore` 外提信号表；`detectWeaknessPatterns`/`buildInsights` 外提规则表，优先级低） |
| P2-9 | **2 个模块只被自己的测试引用，无任何生产调用方** | `public/modules/coach/analysis-result.js`；`public/modules/core/character-card.js` | 全仓 `grep -rn "analysis-result\|character-card"` 仅命中自身文件与 `test/*.test.mjs`；两者都不在 `public/app.js` 的依赖图里（`check-circular` 从 `app.js` 出发可达 100 个模块，不含此二者） | `analysis-result.js:5` 自述"for later phases"、`character-card.js` 是规范定义——**很可能是有意的预留**。但文件头没有"未接线"标记，读者会误判它们在生效路径上，改动时容易以为需要保持兼容 | 在文件头加一行"未接线（预留契约，当前无生产调用方）"，或把二者纳入 `docs/初学者开发指南.md` 的目录表；不要删（测试在用） |
| P2-10 | **部署边界未文档化**：`server/` 依赖项目目录之外的 runtime | `server/relationshipIntelligence.js:1-8` → `../../.agents/skills/relationship-coach-cn/runtime/index.mjs`（解析到 `E:/一门给年轻人的恋爱成长课/.agents/...`，比项目根还高一层） | `server/index.js:7` 静态 `import` 该模块，因此这是**启动期硬依赖**；`docs/初学者开发指南.md:12` 记录了这条依赖，但 `docs/部署与构建说明.md` 全文检索 `.agents`/`runtime` 无命中 | 只拷贝 `relationship-simulator/` 目录去部署时，`node server/index.js` 会在 ESM 静态解析阶段直接失败（整个服务起不来，不只是 `/api/intelligence` 不可用） | 在 `docs/部署与构建说明.md` 增加"前置条件：需同时部署同级 `.agents/skills/relationship-coach-cn/runtime/`"，或把 runtime 挪进项目内 |

#### 超长函数（人工判读后分类）

| 行数 | 位置 | 函数 | 判定 |
|---|---|---|---|
| 224 | `public/modules/training/replay.js:307-530` | `analyzeReplay` | **逻辑纠缠需拆**：`307-355` 是纯指标计算，`356-~500` 是 20+ 个互不依赖的 `if (...) observations.push(makeObservation(...))`。建议把后者提为 `REPLAY_OBSERVATION_RULES` 表 + `applyObservationRules(metrics)`；指标部分保留 |
| 157 | `public/modules/render/dropdown.js:10-166` | `enhance` | **不建议拆**：DOM 事件装配（open/close/keydown/blur/ARIA），拆开只会把 8 个共享闭包变量变成参数 |
| 150 | `public/modules/coach/coach.js:38-187` | `buildCoachScore` | **数据表驱动可外提**：`44-101` 是 `signals` 正则表（约 40 行纯数据、零逻辑）。外提为 `SIGNAL_RULES`（导出以便单测每条正则），函数体保留维度计算 |
| 142 | `public/modules/render/render-lifestyle.js:51-192` | `renderLifestyle` | **不建议拆**：主体是单条 HTML 模板，行数来自数据密度（27 处插值），拆开会产生 5 个只被调用一次的 fragment 函数 |
| 96 | `public/modules/render/workspace-nav.js:20-114` | `initWorkspaceNav` | **不建议拆**：与 dropdown 同类 |
| 91 | `public/modules/content/textbook-search.js:100-180` | `buildTextbookSearchIndex` | **不建议拆**：一次性索引构建，顺序强依赖 |
| 88 | `public/modules/render/render-real-practice.js:49-136` | `renderRealPractice` | 不建议拆（同 renderLifestyle） |
| 73 | `public/modules/coach/replies.js:27-99` | `buildReplyOptionsForHer` | 不建议拆 |
| 73 | `public/modules/core/user-profile.js:48-120` | `detectWeaknessPatterns` | 可外提规则表（与 buildCoachScore 同类，优先级低） |
| 68 | `public/modules/core/memory.js:135-202` | `updateMemoryState` | 不建议拆 |
| 68 | `public/modules/core/privacy.js:30-97` | `redactSensitiveText` | 不建议拆（正则表） |
| 68 | `public/modules/training/growth.js:208-275` | `buildGrowthSummary` | 不建议拆 |
| 68 | `public/modules/training/optimizer.js:462-529` | `diffText` | 不建议拆 |
| 67 | `public/modules/coach/prompts.js:80-146` | `buildSystemPrompt` | 不建议拆（拼接逻辑） |
| 65 | `public/modules/intelligence/controller.js:12-76` | `createRelationshipIntelligenceController` | 不建议拆，但需按 P1-1 改注入 |
| 62 | `public/modules/core/memory.js:502-563` | `analyzeLongTermPatterns` | 不建议拆 |
| 62 | `public/modules/training/growth.js:70-131` | `aggregateGrowth` | 不建议拆 |
| 61 | `public/modules/render/render-date-journey.js:71-131` | `renderDateJourney` | 不建议拆 |
| 61 | `public/modules/training/session-report.js:358-418` | `buildInsights` | 可外提规则表（同类，优先级低） |
| 60 | `public/modules/training/optimizer.js:402-461` | `normalizeOptimizationResult` | 不建议拆 |

> 说明：行数为"声明边界"估算（相邻顶层声明之间），含尾随注释/空行，误差 ±3 行。`render-lifestyle.js` 与 `render-real-practice.js` 的主体是单个模板字符串，按"拆函数"口径看似很长，实际控制流极浅，故明确不建议拆。

### 错误处理盲区（问题 6）

90 个 `catch` 块，其中 36 个是完全静默的——但**绝大多数是有意的 localStorage 降级**（`/* localStorage unavailable */` 出现在 `render-stage.js:25,32,51,77,83,92`、`render-longContent.js:88`、`training/real-practice.js:25` 等），且都带注释，判定为**不是问题**。按"调用方能否感知失败"标准，只有 3 处真正遮蔽：P0-1、P0-2、P2-7。

`console.error` 全库仅 2 处（都在 `core/state.js:242,244` 的提交后观察者失败路径，且已注释说明"数据已提交，展示失败不能变成业务提交失败"）——**没有"只打日志不上抛"的模式**。

---

## 可合并的重复实现

| 重复项 | 各处位置 | 行为差异 | 是否可无痛合并 |
|---|---|---|---|
| `escapeHtml` | `public/modules/core/dom.js:3-11`；`public/modules/render/coach-float.js:63-65` | 仅 `'` 实体写法（`&#039;` vs `&#39;`），安全等价 | ✅ 是（`render-persona.js:19-20` 依赖 dom 版） |
| `clampScore` 族 | `public/modules/coach/coach.js:23-27`（导出）；`coach/analysis-result.js:115-119`；`core/investment.js:338-342`；`core/state.js:281-283`；`core/learning-state.js:258-262`；`coach/her-voice.js:48-52`；`training/session-report.js:448-452`；`training/mistake-patterns.js:190-194`；`training/growth.js:497-501`；`core/training-scores.js:5-7`；`core/mistakes.js:215`；`training/timing.js:374` | 分两族：非空返回 number / 可空返回 `null` | ✅ 是（按两族各留一个） |
| 连续天数 | `public/modules/training/micro-training.js:575-596`；`public/modules/training/lifestyle.js:481-495` | 入参形态不同（task 数组 vs date 字符串数组），算法逐句相同 | ✅ 是（抽 `computeStreak(dateKeys, todayKey)`，两侧各自映射） |
| `formatTs` | `public/modules/render/render-mistakes.js:275-279`；`public/modules/render/render-session-report.js:259-263` | 无差异 | ✅ 是 |
| `shorten` | `public/modules/render/render-mistakes.js:281-284`；`public/modules/render/render-session-report.js:265-268` | 默认 `maxLength` 60 vs 80 | ✅ 是（参数化） |
| 日期键 | `training/real-practice.js:68`（上海）；`render/render-lifestyle.js:260`（本地）；`training/growth.js:514`（UTC）；`core/memory.js:250`（UTC） | **不一致**——这是 P1-2 的根因 | ⚠️ 合并须先定口径（建议统一上海） |
| 外链校验 | `render/coach-float-search.js:14-24`；`render/render-presentation-knowledge.js:9-14` | **不一致**（http 允许 vs 仅 https） | ⚠️ 合并须先定口径 |
| 维度中文标签 | 6 处（见 P2-6） | `drive` vs `momentum` 键名不一致 | ⚠️ 需先统一键名再加派生 |

---

## 无测试模块清单

比对方式：解析 75 个 `test/*.mjs` 的 import 语句，解析到磁盘绝对路径。

**A. 没有任何测试文件直接 import（25 个）**

```
public/modules/content/long-content-manifest.js
public/modules/content/long-content/chapter-01.js … chapter-10.js   （10 个）
public/modules/core/dom.js
public/modules/core/types.js
public/modules/core/user-profile.js
public/modules/render/dropdown.js
public/modules/render/mobile-tabs.js
public/modules/render/render-intake.js
public/modules/render/render-intervention.js
public/modules/render/render-lifestyle.js
public/modules/render/render-longContent.js
public/modules/render/render-mistakes.js
public/modules/render/render-persona.js
public/modules/render/render-scenario.js
public/modules/render/render-session-report.js
public/modules/voice/tts-client.js
```

**B. 连间接都不可达（22 个）**：从 A 中去掉 `core/dom.js`（被 21 个模块 import）、`core/user-profile.js`、`content/long-content-manifest.js`（被 `long-content-loader.js:20` 动态 import）。

**B'. 只被"源码正则断言"覆盖、无任何行为测试（5 个）**：`render-intake`、`render-intervention`、`render-lifestyle`、`render-mistakes`、`render-session-report`（测试里只有 `readFile(...)` + `assert.match`，没有 import 函数本体）。叠加 A 中"完全未被提及"的 5 个 render 模块（`dropdown`、`mobile-tabs`、`render-longContent`、`render-persona`、`render-scenario`），**render 层 25 个模块中 10 个没有行为级测试**。

**C. 反向缺口：有测试但无生产调用方（2 个）**——不是"没测"，而是"测了但没接线"：

```
public/modules/coach/analysis-result.js      （仅 test/analysis-result.test.mjs 引用）
public/modules/core/character-card.js        （仅 test/character-card.test.mjs 引用）
```

**判读（避免一刀切"都要补"）：**
- `chapter-01..10.js` 是内容数据（由 `long-content-loader.js:37` 的模板字符串动态 `import(\`./long-content/chapter-${n}.js\`)` 加载，静态扫描必然漏），**不需要单测**。
- `core/types.js` 全文件只有 JSDoc（`:1-6` 自述"不产生任何运行时导出"），**不需要单测**。
- `long-content-manifest.js` 是 manifest 数据，已由 `long-content-parse.test.mjs` 间接覆盖语义。
- **真正该补的 3 个**（有用户输入 / 有分支 / 有降级逻辑）：
  - `public/modules/render/render-persona.js`（自定义角色名、头像上传缩放 `:153-224`、`clampAvatarPosition` 边界）
  - `public/modules/render/render-scenario.js`（剧本切换会重写 `messages`/`lastAnalysis`，`:28-34`）
  - `public/modules/voice/tts-client.js`（偏好读写 `:53-68`、引擎降级 `:167`、健康探测失败 `:206`）
- 其余 7 个缺失行为测试的 `render-*` 属于"手工验收型"，补测性价比低于先加 R1 检查器。

---

## 建议的检查器规则（按性价比排序）

全部规则建议落在 `scripts/check-conventions.mjs`（零依赖、`node scripts/check-conventions.mjs`、退出码 0/1），与现有 `check-circular.mjs` 同风格。**每条都附上"今日代码实测命中数"**（我用临时脚本跑过）。

| # | 规则 | 能抓到什么 | 今日命中 | 误报风险 |
|---|---|---|---|---|
| R1 | **HTML 插值转义**：遍历所有 HTML sink（`innerHTML =` / `innerHTML +=` / `outerHTML =` / `insertAdjacentHTML`）所赋的模板，凡 `${...}` 的**顶层属性名属于文本类名单**（`text/title/label/summary/message/name/content/reason/note/reply/description/detail/hint/snippet/effect/prompt/question/answer/quote`）且未被 `escapeHtml(...)` 包裹 → 报错 | 新增的裸插用户/模型文本。这是唯一会真正造成 XSS 的类别 | **0**（说明现有纪律 100% 有效；规则价值在防回归） | **中**：`const label = ...; escapeHtml(label)` 这类"先拼接后转义"会误报，实测样本 `render-persona.js:19-20`。需允许"同一函数体内出现 `escapeHtml(该变量名)`"作为白名单。<br>**反例警告**：我另试过"文本/属性位置"版规则（`>${x}<` / `="${x}"`），今日命中 49 处，其中 48 处是预渲染子构建器（`rows`/`cards`/`items`）与常量表，**且漏掉了唯一的真实偏差 `render-longContent.js:37`**（它在 `第${chapterId}章` 的行内位置）→ 该形态不可用 |
| R2 | **状态直写 mutate**：以 `mutate(` 的调用区间为作用域，区间外的 `X.prop = ` / `delete X.prop`（X 为 `getState()`/`getAppState()`/`state`/`appState`）→ 报错 | 绕过 mutate 的写路径（P1-1 的三处） | **3**（`intelligence/controller.js:27`、`app.js:688`、`training-mode-controller.js:49`） | **低（前提是做作用域识别）**。纯文本版今日命中 40 处、真实违规 3 处，假阳性 37 处全部来自 `mutate((state) => { state.x = ... })` → **必须用括号配对圈定 mutate 回调，不能正则全文扫描** |
| R3 | **分层方向**：`public/modules/core/**` 不得 import `../render/`、`../intelligence/`、`../voice/`；`server/**` 不得 import `public/` | 破坏分层的反向边 | **0**（core→render 0、server→public 0） | **低**。注意：不要把规则写成"core 不许 import coach/training"——那会命中 `api-client.js:1`、`core/state.js:8-10` 等 5 条**设计内**依赖（`docs/设计文档-解耦重构.md:180-200` 把 `prompts.js` 归 L0），造成 5 条误报。若确要治理 core↔training，需先补文档定义层，再配 allow-list |
| R4 | **`escapeHtml` 单实现**：`function escapeHtml` / `const escapeHtml` 在 `public/` 内出现次数 > 1 → 报错 | P2-1 的副本 | **1**（`render/coach-float.js:63`） | **零** |
| R5 | **`clamp 0–100` 单实现**：`Math.max(0, Math.min(100` 在 `public/` 内出现 > 2 次（允许非空/可空两族）→ 报错并打印坐标 | P2-2 的 11 份私有副本 | **12**（含已导出的 `coach/coach.js:26`） | **零**（`core/state.js:282` 的 `clampAvatarPosition` 也命中，属同族，一并迁移即可） |
| R6 | **日期键单实现**：禁止在 `public/` 出现 `toISOString().slice(0, 10)` 与 `getFullYear()` 拼日期串；统一调用 `training/real-practice.js:68 shanghaiDate` | P1-2 的三处漂移 | **3**（`training/growth.js:514`、`render/render-lifestyle.js:260`、`core/memory.js:250`） | **零**（`training/real-practice.js:79` 的 `validDate` 用同样表达式做校验，需加文件级豁免） |
| R7 | **render 模块测试覆盖**：`public/modules/render/*.js` 必须被至少一个 `test/*.mjs` **import**（`readFile` 源码断言不算）；缺失则列出名单并失败 | P1-4 的回归 | **10**（`dropdown`、`mobile-tabs`、`render-intake`、`render-intervention`、`render-lifestyle`、`render-longContent`、`render-mistakes`、`render-persona`、`render-scenario`、`render-session-report`） | **中**：会把"只被 app.js 装配、只做 DOM 拼接"的模块也列为缺失。建议先冻结存量白名单、只对新增文件生效，或在补齐 3 个重点模块后全量启用 |

> 另：现有 `scripts/check-circular.mjs`（108 行）有两个盲点，顺手补上成本极低——① `:32` 的 import 正则要求 `'` 或 `"` 引号，`` import(`./long-content/chapter-${n}.js`) ``（`public/modules/content/long-content-loader.js:37`）这类**反引号动态导入被完全跳过**，10 个 chapter 文件从未进入依赖图；② `:76-88` 的 DFS 是递归实现，模块数上千时会爆栈。当前规模下不影响结论（实测：磁盘 `public`+`server` 共 106 个 `.js`，图中 100 个 = 93 个项目内文件 + 7 个 `.agents/` runtime 文件；13 个项目内文件未入图 = 10 个 chapter + `coach/analysis-result.js` + `core/character-card.js` + `core/types.js`）。如果 R1–R7 复用同一解析器，需先修 ①。

---

## 明确不建议做的改动（附理由）

1. **不建议把 67 处 `innerHTML` 全改成 DOM API。** 现状是 566 处插值、0 处用户可控裸插——纪律已 100% 执行，改造收益接近 0；成本是重写 20+ 个渲染模块，并会让 `test/mistakes.test.mjs`、`test/session-report.test.mjs` 里已有的源码级断言全部失效。**先加 R1，再只在 R1 真报警时局部改。**
2. **不建议拆 `render-lifestyle.js:51-192`、`render-real-practice.js:49-136`、`render-date-journey.js:71-131`、`render-persona.js:153-224`。** 它们行数来自单个模板/单段顺序 DOM 操作，控制流深度 ≤3；拆出的一次性 fragment 函数不会带来任何可测性提升，只会增加跨函数参数。
3. **不建议拆 `dropdown.js:10-166` 与 `workspace-nav.js:20-114`。** 二者是"事件装配 + 8 个共享闭包状态"，拆分的唯一结果是把闭包变量全部变成参数对象。
4. **不建议为了"消除重复"而合并 `formatTs`/`shorten` 之外的渲染片段函数。** `scoreBar`、`dimensionRow`、`renderKnowledgeSources`、`card` 等虽然都返回 HTML，但各有独立契约（`card()` 是唯一同时转义 title 与 text 的函数，`render-coach.js:8-10`），合并会破坏 R1 的白名单结构。
5. **不建议给 25 个无测试模块全部补测。** 10 个 `chapter-*.js` 是内容数据、`core/types.js` 无运行时导出、`long-content-manifest.js` 已被解析测试间接覆盖——三者补测是纯粹的测试数量游戏。只补 `render-persona` / `render-scenario` / `tts-client`。
6. **不建议引入 ESLint/Prettier。** `package.json` 目前零 devDependency（`"engines": {"node": ">=18"}`，无 `devDependencies` 字段），项目明确走"零依赖 + `node --test`"路线。R1–R7 合计约 150 行，与 `check-circular.mjs`（108 行）同量级，收益/成本远优于引工具链。
7. **不建议把 `training-mode-controller.js` 重构成新的状态抽象层。** 它的问题只有一行（`:49`）——把 `state.trainingMode = next; saveAppState();` 换成注入的 `mutate` 即可，加抽象层会与 `intelligence/controller.js` 形成第 2 套并行的写状态模式，正好是 P1-1 的翻版。
8. **不建议现在动 `growth.js` 的 `DIMENSION_ALIASES`（`drive`↔`momentum`）。** 这层别名目前是 4 处手工边界的"汇合点"（`session-report.js:80,257`、`render-coach.js:104`、`growth.js`），改动面横跨 5 个模块；应先在 R1–R3 落地、测试网补上之后再做键名统一。

---

## 附：本轮未能验证的点（诚实边界）

- **真实浏览器渲染未验证**：所有结论基于源码静态分析 + Node 单测，未在浏览器中复现 P1-1 的面板不重绘。结论链（谁调用 `renderMemoryPanel`）已完整，但"用户点击后确实看不到更新"需要一次手工验收。
- **localStorage 损坏场景未实测**：P0-2 的触发（`setItem` 截断/外部写坏）只做了代码路径推演，没有构造真实损坏载荷。
- 长函数的行数由"相邻顶层声明边界"估算，非 AST 精确值（误差 ±3 行）；本报告已标注该口径。
