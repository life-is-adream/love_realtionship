# HeartFlow 技术债核对报告（2026-09-30）

> 执行人：严守真（quality-lead）· Task T1-POLISH-QA-20260930 · P0
> 核对范围：docs/代码审查报告-2026-08-02.md 全部遗留项 + 当前测试/架构基线
> 方法：`node --test` 全量运行、`node scripts/check-circular.mjs`、逐项源码取证（文件+行号+摘录）。本轮只审计，未改动任何代码。

---

## 一、当前基线

| 维度 | 2026-08-02 | 2026-08-10 | **2026-09-30（本次）** | 判定 |
|------|-----------|-----------|----------------------|------|
| 测试 | 284/284 | 333/333 | **371/371 通过**（0 fail / 0 skip / 耗时 4.78s） | ✅ 持续增长，无回归 |
| 测试文件数 | 24 | — | 38 | — |
| 循环依赖 | 41 模块 0 循环 | — | **56 模块 0 循环**（`node scripts/check-circular.mjs` ✅） | ✅ |
| server 模块 | 7 | — | 9（新增 `relationshipIntelligence.js`、`searchProxy.js`） | — |
| long-content-index.js | 1.13 MB | — | **1,134,734 B ≈ 1.08 MB**（8-20 构建） | ⚠️ 未瘦身 |

**flaky 观察**：本轮为单次运行，无失败、无超时，未发现不稳定迹象；正式打磨阶段建议连续跑 3 次确认无 flaky（见 backlog B10）。

**8-02 当轮已修 5 项（P0-1 / P1-2 / P1-5 / P2-9 / P2-12）已逐项复核，均无回归**：
- P0-1：`public/modules/core/config.js:224-225` 仅存注释说明，无 `process` 引用 ✓
- P1-2：`public/app.js:296-298` `renderDiffHtml` 逐片段 `escapeHtml(part.text)` 后拼接标签 ✓
- P1-5：`public/modules/core/learning-state.js:35-43` `knownIds` Set 幂等去重 ✓
- P2-9：`public/modules/coach/coach.js:59` 正则 `/[“「『"][^“”「」『』"']{1,40}[”」』"]/` 覆盖中文引号 ✓
- P2-12：`public/modules/training/micro-training.js:413,456` `contextText(context)` 统一提取 ✓

---

## 二、遗留项逐项判定

判定口径：**已修 / 部分修 / 未修 / 已失效**。

### P1 高

| # | 项 | 判定 | 证据 |
|---|----|------|------|
| P1-3 | 服务端单测缺失 | **部分修** | `test/server-modules.test.mjs`（220 行，~20 条断言）已覆盖：`readRequestJson`（合法/空/非法/2MB 超限）、`resolveCorsOrigin`（localhost/127.0.0.1/外部回落/自定义端口）、`sendJson` 附加头、`extractModelContent` 4 种结构、`normalizeProxyResponse`、`fetchWithRetry` 5 类场景、`checkRateLimit`（窗口+独立 IP）、config `inferApiMode/normalizeApiMode/maskEndpoint`、searchProxy 白名单与归一化。<br>**仍未覆盖**：① `routes-longContent` 章号校验与路径遍历防护；② `staticServer.serveStatic` 的 403 路径防护与 404 回退（见 P2-7，行为本身待改，改后必须补测）；③ `healthRoute`；④ `llmProxy.handleChat` 主流程（429/400/413/502/504 分支）。 |
| P1-4 | intake-quiz 产品孤岛 | **未修** | 全项目 grep `intake-quiz|intakeQuiz` 仅命中 docs/代码审查报告自身。`public/index.html` 无入口链接；server 无路由指向；主应用无 profile JSON 导入/消费代码。15 题测试做完仍无处消费。 |

### P2 中

| # | 项 | 判定 | 证据 |
|---|----|------|------|
| P2-6 | state.js 可变引用 + 双写路径 | **未修**（有局部缓解） | 核心问题仍在：`public/modules/core/state.js:153-156` `getState()` 直接返回内部 `currentState` 引用；`state.js:119-130` `saveState()` 直接 mutate（`state.trainingLog = []` 等）；第二写路径仍在：`public/app.js:487` `setState: (next) => { state = setStateStore(next); renderAll(); }`。<br>**缓解（不算修复）**：`app.js:486` 对外暴露的 `getState: () => structuredClone(getState())` 是只读快照；`state.js:136-147` 新增 `serializeStateForStorage`，存储序列化不再污染 live state。内部模块仍可拿引用直接改，一致性仍靠人工纪律。 |
| P2-7 | staticServer 404 一律回退 index.html | **未修** | `server/staticServer.js:53` `const target = existsSync(filePath) ? filePath : path.join(publicDir, "index.html");` —— 含 .js/.css 的资源路径 404 也回退 HTML；`staticServer.js:58` 全局 `Cache-Control: no-store` 未变。 |
| P2-8 | llmProxy CORS 硬编码 | **已修**（针对原问题） | `server/llmProxy.js:109` `const corsOrigin = resolveCorsOrigin(req.headers?.origin);`（124、130 处注入响应头）；`server/staticServer.js:12-21` `resolveCorsOrigin(origin, port = PORT)` 动态取 PORT、放行 localhost/127.0.0.1 任意端口。<br>**残留（低危）**：`searchProxy` / `relationshipIntelligence` / `routes-longContent` 端点仍无 CORS 头——前端同源调用无实际影响，仅异地调试时需注意。 |
| P2-10 | buildConversationSummary 双实现 | **未修** | `public/modules/core/state.js:242` `buildConversationSummary(messages)` vs `public/modules/core/memory.js:233` `buildConversationSummary(messages, analysis = null)` —— 签名不一致的双实现原样存在。 |
| P2-11 | timing.js 硬编码阶段 Set | **未修** | `public/modules/training/timing.js:10-18` 仍硬编码 7 阶段 `STAGE_VALUES = new Set([...])`；而 `public/modules/core/stages.js:20` 已导出 `STAGE_VALUES` 却未被 timing.js import。改动成本极低（S）。 |
| P2-13 | long-content-index.js 体积 | **未修** | 实测 `1,134,734` 字节（≈1.08 MB），仍为单文件全量加载。 |
| P2-14 | 两套长篇解析规则 | **未修** | `scripts/build-long-index.mjs` 与根目录 `validate-long-simulation.mjs` 均在，未抽共享解析模块（另新增 `scripts/build-love-learning.mjs`，解析规则发散风险进一步加大）。 |

### P3 低

| # | 项 | 判定 | 证据 |
|---|----|------|------|
| P3-15 | Google Fonts 无兜底 | **仍存在** | `public/index.html:7-9` preconnect + stylesheet，无 onerror/local fallback。 |
| P3-16 | diffText O(n×m) 无上限 | **仍存在** | `public/modules/training/optimizer.js:462-` 字符级 LCS，`Uint32Array(cols)` 全表，无输入长度截断。 |
| P3-17 | events.once 死代码 | **仍存在** | `public/modules/core/events.js:103` `export function once(...)`，无调用方（可保留）。 |
| P3-18 | app.js 兼容注释噪音 | **仍存在** | `public/app.js:460-479` 仍是大段迁移痕迹注释块。 |
| P3-19 | 请求体超限返回 400 应为 413 | **已修** | `server/staticServer.js:24-30` 新增 `RequestBodyTooLargeError`（code=BODY_TOO_LARGE）；`server/llmProxy.js:49-50` 捕获后 `sendJson(res, 413, { error: "payload_too_large", ... })`，且有对应单测（server-modules.test.mjs:37-43）。 |
| P3-20 | LLM_MODEL 硬编码 | **已修** | `server/config.js:19` `export const LLM_MODEL = process.env.LLM_MODEL \|\| "mimo-v2.5-pro";` |
| P3-21 | 无 lint/format 脚本 | **仍存在** | package.json scripts 仅 start/dev/test/check:circular/build:index 等，无 lint/format。 |

### 汇总

- **已修（含当轮验证）**：P0-1、P1-2、P1-5、P2-9、P2-12、**P2-8**、**P3-19**、**P3-20**（8 项）
- **部分修**：P1-3（1 项）
- **未修/仍存在**：P1-4、P2-6、P2-7、P2-10、P2-11、P2-13、P2-14、P3-15/16/17/18/21（12 项）
- **已失效**：无（重构未使任何原问题自然消失）

---

## 三、打磨 Backlog（按优先级）

工作量：S（≤0.5 天）/ M（0.5-2 天）/ L（>2 天）。依赖列指向 engineering-lead 的 T2 方案。

| # | 项 | 源头 | 工作量 | 说明 | 依赖 |
|---|----|------|--------|------|------|
| **B1** | 补齐服务端单测缺口：routes-longContent 章号校验+遍历防护、serveStatic 403/404、healthRoute、handleChat 主流程分支 | P1-3 | M | 用 fake req/res（现有 server-modules.test.mjs 已有模式可复用）。先写现有行为的特征测试，再改 P2-7 | 无——**可立即开工，为后续所有重构兜底** |
| **B2** | staticServer 404 语义：带扩展名资源 404 不回退；无扩展名才回退 SPA；静态资源可加 ETag/短缓存 | P2-7 | S | 与 B1 同文件同测，建议 B1 完成后立刻做，一次 PR | 需 T2 确认前端路由形态（当前仅 index.html 单页，风险低） |
| **B3** | 合并 buildConversationSummary：保留 memory.js 版（含 analysis 参数），state.js 改为 re-export 或删除，修调用方 | P2-10 | S | 需 grep 两处调用方确认行为差异 | 无 |
| **B4** | timing.js 复用 stages.js 的 STAGE_VALUES | P2-11 | S | 1 行 import + 删本地 Set，跑 timing.test.mjs 回归 | 无 |
| **B5** | intake-quiz 接入或移除（**需产品决策**）：A) index.html 加入口 + 实现 profile JSON 导入映射到 learning/user-profile；B) 从交付范围移除 | P1-4 | M（A）/ S（B） | 涉及产品取舍，需主理人拍板后再排 engineering-lead | 主理人决策 → T2 出方案 |
| **B6** | store 收敛：封装 `mutate(fn)`（自动 save+render）作为过渡，长期走单一 reducer；同时清理 window.RelationshipLLM.setState 第二写路径 | P2-6 | L | 影响面大（各模块均直接 mutate），建议放打磨后段，B1 测试先行 | T2 架构方案定稿后执行 |
| **B7** | long-content-index 拆章懒加载（按章拆 10 文件或运行时按需请求） | P2-13 | L | 性能项；playtest R2 若首屏/刷新耗时超阈值则提级 | 与 T2 性能方案合并考虑 |
| **B8** | 抽共享长篇解析模块，build-long-index / validate-long-simulation / build-love-learning 三脚本共用 | P2-14 | M/L | 规则漂移风险随脚本数量增加 | 无（纯脚本层，不影响运行时） |
| **B9** | P3 顺手清：字体本地兜底（P3-15，S）、diffText 长度上限（P3-16，S）、app.js 注释清理（P3-18，S）、lint 脚本（P3-21，S）、events.once 处置（P3-17，可选） | P3 | S×N | 均可夹带在相邻改动中 | 无 |
| **B10** | 测试稳定性确认：连续 3 次 `node --test` 比对结果一致；为 journey/integration 类测试加超时预算 | 新增 | S | 打磨收口前的门控动作 | B1 完成后 |

**Top 3 建议**：B1（测试兜底，无依赖立即开工）→ B2+B3+B4（三个 S 打包一次清掉，含安全语义修正）→ B5（产品决策项，尽早拍板避免打磨期返工）。

---

## 四、质量门判定

**PASS（可进入打磨执行阶段）**：测试 371/371 全绿、0 循环依赖、无阻断级问题残留；8-02 修复无回归。
**CONCERNS（进入编码前须确认）**：① B1 未完成前不建议动 staticServer/routes-longContent（P2-7 改动必须有测试护栏）；② B5 需产品决策；③ 单次运行不能断言无 flaky，收口前执行 B10。
