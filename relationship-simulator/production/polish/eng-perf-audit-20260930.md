# 性能与架构优化方案（Phase 6 打磨 · 工程线）

- **Task ID**: T2-POLISH-ENG-20260930
- **负责人**: engineering-lead（程基岩）
- **日期**: 2026-09-30
- **性质**: 方案文档（本轮不改任何源码/测试/产物）
- **覆盖项**: P2-13（长篇索引体积）、P2-6（store 收敛）、P2-7（静态服务 404/缓存）、P2-8（CORS）

---

## 0. 结论速览

| 编号 | 问题 | 推荐方案 | 工作量 | 首屏收益 / 效果 |
|---|---|---|---|---|
| P2-13 | 1.13MB 单文件全量加载 | **按章拆 10 个 ES Module chunk + 2.2KB manifest 懒加载**（生成器同步改为 compact 输出） | M | 首屏 1,134,734B → 约 2.2KB（−99.8%） |
| P2-6 | getState() 暴露可变引用 + 双写路径 | **三阶段渐进迁移：先加 `mutate(fn)` 自动 save，再逐模块迁移调用方** | M（分三段 S/S/S） | 消除"忘了 saveState"类脏状态 bug |
| P2-7 | 404 一律回退 index.html + 全局 no-store | **资源路径 404、无扩展名才 SPA 回退；静态资源分级 Cache-Control** | S | .js 404 语义正确；静态资源可缓存（P2-13 的前提） |
| P2-8 | CORS 硬编码 | **复核：已部分修复。剩余缺口 = 局域网 origin + OPTIONS 预检 + 其它 /api 路由无 CORS 头** | S | LAN 访问不再被浏览器拦截 |

**建议实施顺序**: P2-7 → P2-8 → P2-13 → P2-6（理由见 §5）。

---

## 1. 实测数据：long-content-index.js 体积与结构

### 1.1 总量

| 指标 | 实测值 |
|---|---|
| 文件体积 | **1,134,734 字节（1.08 MiB）** |
| 文件行数 | ~33,400 行（2 空格缩进 pretty-print JSON） |
| 章节数 | 10 章，共 123 个复盘点 |
| 全部章节 compact JSON 总量 | **707,417 字节**（去掉缩进即省 37%） |

### 1.2 字段构成（compact UTF-8 字节）

| 字段组 | 字节数 | 占比 | 说明 |
|---|---|---|---|
| `reviewPoints.searchTerms`（检索词表） | **366,062** | 51.7% | 每个复盘点最多 240 个 2-4 gram 中文词 |
| `reviewPoints` 其它字段（intent/benefit/note/originalMaleReply…） | 201,525 | 28.5% | 复盘正文内容 |
| `reviewPoints.searchText` | 108,976 | 15.4% | 归一化检索全文 |
| `sections`（小节定位） | 25,109 | 3.5% | 极小 |
| 其余（章节元信息/JSON 结构开销） | ~5,745 | 0.8% | — |

**关键判断**：体积大头在"检索索引数据"（searchTerms + searchText = 67%），而首屏实际只需要章节 id/标题/复盘数。

### 1.3 每章体积（compact 字节）

| 章 | 章节数据 | 其中 searchTerms | 章 | 章节数据 | 其中 searchTerms |
|---|---|---|---|---|---|
| 1 | 104,012 | 50,165 | 6 | **155,254** | 104,857 |
| 2 | 94,062 | 35,950 | 7 | 82,817 | 32,182 |
| 3 | 39,584 | 22,544 | 8 | 55,503 | 21,979 |
| 4 | 21,334 | 11,068 | 9 | 38,603 | 22,533 |
| 5 | 47,642 | 25,386 | 10 | 68,606 | 39,398 |

单章最大 155KB（第 6 章），最小 21KB（第 4 章），平均 ~70KB——非常适合按章 lazy chunk。

### 1.4 前端引用点（改动面）

| 引用方 | 用途 | 需要的数据粒度 |
|---|---|---|
| `public/app.js:8,88` | 由教材证据映射找单章复盘点 | **单章** reviewPoints |
| `public/modules/render/render-longContent.js` | 章节列表（要 title + 复盘数）+ 阅读单章 | 列表只要 manifest；阅读要**单章** |
| `public/modules/render/render-intervention.js:14` | 介入练习取单章复盘 | **单章** reviewPoints |
| `public/modules/content/textbook-index.js:8` | 全文检索索引（`buildTextbookSearchIndex`） | **全部 10 章**（且已在调用时才懒构建） |
| `test/long-content-parse.test.mjs`、`test/textbook-integration.test.mjs` | 结构校验 | 全部 |

除"教材检索"外，所有消费方都只需要**单章**——这是拆包方案成立的根本依据。

---

## 2. P2-13：长篇索引拆包懒加载

### 2.1 推荐方案：按章拆 chunk + manifest（A 方案）

**产物结构**（全部由生成器产出，禁止手编）：

```
public/modules/content/
├── long-content-manifest.js      # export const longContentManifest = { generatedAt, totalChapters, chapters: [{id,title,file,summary,reviewCount,sectionCount}] }  ≈ 2.2KB
└── long-content/
    ├── chapter-01.js             # export const chapter = {...单章完整数据...}   21~155KB（compact）
    ├── ...
    └── chapter-10.js
```

**实测收益**：
- 首屏：1,134,734B → **~2.2KB manifest**（−99.8%），且省掉 1.08MB 的 JS 解析耗时；
- 打开单章：动态 import 一个 chunk（21~155KB，compact 后）；
- 教材检索（低频路径）：首次触发时 `Promise.all` 拉 10 个 chunk（合计 ~708KB，compact 后比现在 −37%），配 P2-7 缓存后二次访问走磁盘缓存。

### 2.2 生成脚本改动点（scripts/build-long-index.mjs）

1. 解析逻辑（正则、parseChapter、finalizeReview、CHAPTER_SUMMARIES）**零改动**；
2. 输出阶段改造：
   - `writeFile` 改为循环：每章输出 `public/modules/content/long-content/chapter-XX.js`，格式 `export const chapter = ${JSON.stringify(ch)};`（**compact，不加缩进**）；
   - 输出 manifest 文件（章节 id/title/file/summary/reviewCount/sectionCount）；
   - 文件头保留"自动生成，勿手编"注释，并在 manifest 中加 `source: "scripts/build-long-index.mjs"`；
3. `package.json` 的 `build:index` 脚本不变（入口仍是同一脚本）；生成前清空 `long-content/` 目录避免旧 chunk 残留；
4. README / docs/初学者开发指南.md 中"不要手编"的路径说明同步更新为两个路径。

### 2.3 前端加载时序改动点

新增一个加载器模块 `public/modules/content/long-content-loader.js`（纯 IO 封装，无 DOM，不破坏"纯函数与 IO 分离"风格，也不引入循环依赖）：

```js
// 职责：manifest 缓存 + 单章 chunk 的 Promise 级缓存
let manifestPromise = null;
const chapterCache = new Map(); // id -> Promise<chapter>

export function loadManifest() {
  manifestPromise ??= import("./long-content-manifest.js").then((m) => m.longContentManifest);
  return manifestPromise;
}

export function loadChapterIndex(chapterId) {
  if (!chapterCache.has(chapterId)) {
    const id = String(chapterId).padStart(2, "0");
    chapterCache.set(chapterId,
      import(`./long-content/chapter-${id}.js`).then((m) => m.chapter));
  }
  return chapterCache.get(chapterId);
}

export async function loadAllChapters() {  // 仅供教材检索与测试聚合
  const manifest = await loadManifest();
  return Promise.all(manifest.chapters.map((c) => loadChapterIndex(c.id)));
}
```

调用方迁移（4 处）：

| 文件 | 现状 | 改为 |
|---|---|---|
| `render-longContent.js` | 顶层 `import { longContentIndex }`；`renderChapterList` 用 `chapters.map`、`loadChapter` 用 `chapters.find` | 改 import loader；`renderChapterList` 改 async 用 manifest（数据字段 reviewPoints.length → manifest.reviewCount）；`loadChapter` 内 `longContentIndex.chapters.find(...)` → `await loadChapterIndex(chapterId)`（该函数已是 async，无时序风险） |
| `render-intervention.js` | 顶层 import；用单章 reviewPoints | 改 async：`const chapter = await loadChapterIndex(currentChapterId)` |
| `app.js:88` | 同步 `chapters.find` | 所在函数改 async 或 `await loadChapterIndex(mapping.chapter)`（需确认该路径调用链，工作量已计入） |
| `textbook-index.js` | `getSharedTextbookIndex()` 同步读全量 | `getSharedTextbookIndex()` 改 async：`await loadAllChapters()` 后构建缓存。**其调用方（render-learning 等教材检索路径）需跟随加 await** —— 这是本方案最大的迁移点 |

### 2.4 备选方案对比

| 方案 | 预估体积（实测/推算） | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| **A. 按章拆 chunk + manifest（compact 输出）** | 首屏 2.2KB；单章 21~155KB | 收益最大；检索/阅读都按需；chunk 可配长缓存 | 迁移 4 个调用方 + 2 个测试文件；async 化波及教材检索链 | ✅ **推荐** |
| B. 单文件 compact + 短字段名 | 实测短字段名仅 **694,625B**（−1.8%），compact 单独即 707,417B（−37%） | 改动最小（只改生成器一行 stringify） | 用户仍全量下载 0.7MB+；短字段名伤害生成数据可读性、需前端解码层 | ❌ 收益/成本比差，实测否定了"压缩字段名"路线 |
| C. A + searchTerms 不落盘、前端运行时重建 | 单章可再省 ~52% | 体积极致 | 需把 buildSearchTerms（gram 生成、别名、240 截断）移植到前端并保证与后端测试一致；检索行为有回归风险 | ⏸ 记为后续优化项，本轮不做 |

### 2.5 回归风险与测试策略

| 风险 | 缓解 |
|---|---|
| 4 个调用方迁移遗漏 → 运行时 undefined | `npm run check:circular` + 全局 grep `long-content-index` 清零（保留 loader 与 manifest 的引用）；loader 的 chunk 文件名模板 `chapter-${id}.js` 与生成器命名约定互为镜像，测试锁定 |
| 教材检索 async 化波及面 | `textbook-integration.test.mjs` 改造后必须覆盖"manifest + 全部 chunk 聚合后检索结果与旧全量一致"的等价断言 |
| chunk 命名/导出名手滑 | 测试直接 `import` 每个 chunk 断言 `chapter.id` 与文件名一致 |

测试改动：
- `test/long-content-parse.test.mjs`：不再 import 单体文件；改为 import manifest + 循环 import 10 个 chunk 聚合成 `longContentIndex` 等价对象，**全部现有断言原样保留**（结构契约不变，只是数据物理分布变了）；
- `test/textbook-integration.test.mjs`：同上聚合方式替换 import；
- 新增 `test/long-content-loader.test.mjs`：manifest 与 chunk 数量一致、chunk id 连续 1..10、`loadChapterIndex` 缓存幂等（用 node:jsdom 不需要——loader 无 DOM，node test 直接可跑 dynamic import）。

### 2.6 改动文件清单 / 工作量 / 回滚

- **改动/新增文件**：`scripts/build-long-index.mjs`（改输出）、`public/modules/content/long-content-manifest.js`（生成）、`public/modules/content/long-content/chapter-01..10.js`（生成）、`public/modules/content/long-content-loader.js`（新增）、`render-longContent.js`、`render-intervention.js`、`app.js`、`textbook-index.js` 及教材检索调用方（async 跟随）、`test/long-content-parse.test.mjs`、`test/textbook-integration.test.mjs`、`test/long-content-loader.test.mjs`（新增）、README/开发指南（路径说明）。
- **工作量**：M（0.5~1 人日，含测试改造）。
- **风险**：中——主要是 async 传染；无 npm 依赖变化，`check:circular` 守护不破。
- **回滚**：单 commit 交付，`git revert` 即回到单体文件；因产物全部由生成器再生成，不存在半迁移状态（生成器同一 commit 内原子切换输出格式）。
- **依赖**：建议在 P2-7 落地后实施，否则懒加载 chunk 无缓存策略、二次访问仍重复下载，收益打折。

---

## 3. P2-6：store 收敛（渐进式）

### 3.1 现状实测（调用方数量级）

- `core/state.js` 的直接导入方 **9 个文件**：`app.js`、`coach/parser.js`、`render/render-{chat,coach,intervention,learning,persona,scenario,stage}.js`。
- `getState()` 调用点约 **40 处**（读为主，读路径无害）；**直改型调用点约 25 处**（`getState()` 后 mutate + `saveState()` 成对出现），典型脏写法如 `render-chat.js:54` `getState().messages.push(...)`。
- `saveState()` 手动调用点约 **20 处**（app.js 4、render-persona 8、render-chat 4、render-intervention 1、render-learning 2、render-scenario 1）。
- 第二条写路径：`window.RelationshipLLM.setState`（app.js:487）→ `setStateStore(next)` + `renderAll()`；注意 `window.RelationshipLLM.getState` 已是 structuredClone 快照，只有 `setState` 是真实写路径。
- 另有 `love-learning.html` 内独立的迷你 store（自成体系，**不在本轮范围**）。

### 3.2 方案：三阶段渐进迁移

**核心原则**：`mutate(fn)` 是**新增** API，不删 `getState`/`saveState`/`setState`；每阶段独立可交付、可回滚；阶段内一次只迁 1~2 个文件。

**Phase A（S）：在 state.js 增加 `mutate(fn)` + 渲染订阅**

```js
let changeListener = null;
export function onStateChange(cb) { changeListener = cb; }  // app.js 启动时 onStateChange(renderAll)

/** 唯一推荐写路径：fn(state) 内同步修改，返回后自动 normalize+save+通知渲染 */
export function mutate(fn) {
  const state = getState();
  const result = fn(state);
  saveState();                       // 复用现有 saveState（内部已做兜底 normalize）
  changeListener?.(state);
  return result;
}
```

- `state.js` 在 core 层，**不得 import render**（会成环）——所以用 `onStateChange(cb)` 回调注入，app.js 注册 `renderAll`，零循环依赖（`check:circular` 守护）。
- 补 `test/state.test.mjs` 用例：mutate 后 localStorage 已更新、listener 被调用一次、fn 抛错时不 save 不通知。

**Phase B（S）：迁移 6 个 render-* 模块（约 20 个写点）**

机械替换：`const s = getState(); s.x = …; saveState();` → `mutate((s) => { s.x = …; })`。
顺序：render-scenario（1 点）→ render-intervention（1）→ render-learning（2）→ render-chat（4）→ render-persona（8）。每迁一个文件跑一次现有回归（state.test + 对应 render 测试）。

**Phase C（S）：迁移 app.js 写点 + 收口 window.RelationshipLLM**

- app.js 内约 5 处直改（如 runReplayAnalysis 的 `state.learning.replayAnalyses = …`）改 `mutate`；
- `window.RelationshipLLM.setState` **保留对外契约**（兼容标记注释声明其为集成契约），内部改为 `mutate(() => setStateStore(next))` 或直接 `state = setStateStore(next); renderAll()` 原样保留并加注释——它是外部调试入口，风险低、收益小，不强迁；
- 收尾：在控制清单中写明"**新代码禁止 getState() 后直接 mutate；写状态一律 mutate(fn)**"，并可加 dev-only 的 `Object.freeze(getState())` 抽查脚本（可选，不进默认路径）。

### 3.3 改动文件清单 / 工作量 / 回滚

- **改动文件**：`core/state.js`（+~15 行）、6 个 render-* 模块、`app.js`、`test/state.test.mjs`（新增 mutate 用例）。
- **工作量**：M 拆三段 S（Phase A ~1h、B ~2h、C ~1h，含测试）。
- **风险**：低——每段独立提交；mutate 是纯新增；最可能出问题的是 Phase B 中"读改写混在一个 getState 里"的点，迁移时需逐个确认没有跨事件的中间态依赖（render-* 都是一次性写完即存，无此模式，已抽查）。
- **回滚**：任一 Phase 单独 revert；由于 getState/saveState 始终保留，回滚零成本。
- **依赖**：与 P2-13 都要动 `render-*` 与 `app.js`，**不要同文件并行改**——顺序实施（见 §5）。

---

## 4. P2-7 / P2-8：静态服务与 CORS 最小修复

### 4.1 P2-7：404 回退与缓存策略

现状（`server/staticServer.js:45-61`）：目标不存在时一律回退 `index.html` → 请求 `/missing.js` 会拿到 **200 + HTML**（Content-Type 还是 text/html），前端报难排查的 MIME/语法错误；且所有响应 `Cache-Control: no-store`，静态资源零缓存。

**修复（改 `serveStatic` 一个函数）**：

```js
const ext = path.extname(safePath).toLowerCase();      // 用"请求路径"扩展名，而非回退目标
const filePath = path.normalize(path.join(publicDir, safePath));
if (!filePath.startsWith(publicDir)) return sendText(res, 403, "Forbidden");

const exists = existsSync(filePath);
if (!exists && ext) return sendText(res, 404, "Not Found");          // 资源类路径 → 真 404
const target = exists ? filePath : path.join(publicDir, "index.html"); // 无扩展名 → SPA 回退（保持现状兼容）
const cacheControl = target.endsWith("index.html") ? "no-cache"
  : /\.(js|css)$/.test(ext) ? "public, max-age=3600"
  : "public, max-age=86400";                                        // 图片/svg
res.writeHead(200, { "Content-Type": mime[ext || ".html"] || "application/octet-stream", "Cache-Control": cacheControl });
```

**行为对照表**：

| 请求 | 现状 | 修复后 |
|---|---|---|
| `GET /` | 200 index.html, no-store | 200 index.html, `no-cache`（每次协商校验，发布即生效） |
| `GET /app.js`（存在） | 200, no-store | 200, `max-age=3600` |
| `GET /missing.js` | **200 index.html（HTML 当 JS）** | **404 Not Found** |
| `GET /missing.css` | 同上 | 404 |
| `GET /some/route`（无扩展名） | 200 index.html | 200 index.html（SPA 回退保持） |
| 路径穿越 `../` | 403 | 403（不变） |

注：`index.html` 用 `no-cache` 而非 `max-age`，保证入口每次发布即失效；`.js/.css` 用 1h——**P2-13 若给 chunk 文件名加内容 hash，可升级为 `max-age=31536000, immutable`**（作为 P2-13 实施时的可选增强，默认先 1h 保守值）。

**测试补齐**（配合 QA 线 `test/server-modules.test.mjs` 现有模式，直接对 `serveStatic` 传 mock res 断言）：`/missing.js` → 404；`/no-ext-route` → 200 index.html + no-cache；`/app.js` → 200 + max-age=3600；`/../` → 403。共 ~4 个用例。

- **改动文件**：`server/staticServer.js`（仅 `serveStatic`）、`test/server-modules.test.mjs`（+用例）。
- **工作量**：S（1~2h 含测试）。**风险**：低。**回滚**：revert 单 commit。
- **依赖**：P2-13 依赖本项（缓存策略）；建议最先实施。

### 4.2 P2-8：CORS 复核与剩余缺口

**现状复核（重要）**：审查报告所指"llmProxy.js:81 硬编码 http://localhost:3000"**已部分修复**——现行代码（`llmProxy.js:109`）已委托 `staticServer.js` 的 `resolveCorsOrigin(origin, port=PORT)`：任意端口的 localhost/127.0.0.1 放行，否则回落 `http://localhost:${PORT}`。**改 PORT 场景已不再被拦**。

**剩余三个缺口**：
1. **局域网访问**（如 `http://192.168.x.x:3000` 打开页面）时 Origin 非 localhost → 回落值与 Origin 不匹配 → 浏览器拦 `/api/chat` 响应；
2. **无 OPTIONS 预检处理**：跨源 POST `application/json` 会先发预检，当前 `index.js` 对 OPTIONS 落到 `sendText(405)`；
3. **其它 /api 路由无 CORS 头**：`searchProxy`/`relationshipIntelligence`/`routes-longContent`/`healthRoute` 响应均不带 `Access-Control-Allow-Origin`（grep 证实仅 llmProxy 有）。

**最小修复方案**：

1. `resolveCorsOrigin` 增加**私有网段放行**（本地工具性质决定风险可控）：
```js
const PRIVATE_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[\w-]+\.local)$/;
if (PRIVATE_HOST.test(url.hostname)) return origin;
```
2. `server/index.js` 请求分发表头部加：`if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) { res.writeHead(204, { "Access-Control-Allow-Origin": resolveCorsOrigin(req.headers.origin), "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" }); return res.end(); }`
3. 统一入口（最小侵入）：把 CORS 头挂到 `sendJson` 的 `extraHeaders` 惯例上——在 4 个 /api handler 的响应路径统一通过新增的 `withCors(res, origin)` helper（或直接在 sendJson 默认注入 CORS 头，静态资源不加）。**推荐后者**：`sendJson` 内默认加 `Access-Control-Allow-Origin: resolveCorsOrigin(req.headers.origin)`，一处改动覆盖全部 API。

**行为对照表**：

| 场景 | 现状 | 修复后 |
|---|---|---|
| localhost:任意端口 同源/跨源 | 放行（已有） | 放行（不变） |
| 127.0.0.1 跨源 | 放行 | 放行 |
| `http://192.168.1.5:3000` 页面调 `/api/chat` | **被浏览器拦** | 放行 |
| 公网来源 / 恶意 Origin | 回落 localhost（=拒绝） | 回落（仍拒绝，白名单不扩大到公网） |
| 跨源预检 OPTIONS /api/* | 405 | 204 + 预检头 |
| `/api/search` 等 CORS 头 | 缺失 | 统一携带 |

**测试补齐**（`test/server-modules.test.mjs`）：resolveCorsOrigin 对 `192.168.1.5`/`10.0.0.2`/`evil.com`/空 Origin 的四分支；OPTIONS /api/chat → 204 + 预检头；sendJson 默认带 CORS 头。

- **改动文件**：`server/staticServer.js`（resolveCorsOrigin + sendJson）、`server/index.js`（OPTIONS 分支）、`test/server-modules.test.mjs`。
- **工作量**：S（1~2h 含测试）。**风险**：低（白名单仅扩内网）。**回滚**：revert 单 commit。
- **依赖**：独立，可插队实施。

---

## 5. 依赖关系与建议实施顺序

```
P2-7 (静态服务) ──┬──> P2-13 (拆包懒加载，需要缓存策略配合)
P2-8 (CORS)  ────┘（独立）
P2-6 (store 收敛) ──── 独立于 server 侧，但与 P2-13 同改 render-* / app.js
```

**推荐顺序与理由**：

| 序 | 项 | 理由 |
|---|---|---|
| 1 | **P2-7** | 最小改动、纯 server、独立收益（404 语义），且是 P2-13 缓存收益的前提 |
| 2 | **P2-8** | 同为 server 侧 S 级，可与 P2-7 一个 PR 窗口先后落地，测试都在 server-modules.test.mjs |
| 3 | **P2-13** | 性能主杠杆（首屏 −99.8%）；落在缓存策略就绪后实施；hash 文件名长缓存作为可选项同窗口评估 |
| 4 | **P2-6** | 与 P2-13 都触碰 render-* 与 app.js，串行避免冲突；且 mutate 上线后新代码有统一写路径约定 |

全部四项均为独立 commit、独立可 revert，建议每项落地后由 QA 线跑全量 `node --test` + `npm run check:circular` 再进下一项。

**待用户审批项**：
1. P2-13 采用 A 方案（拆 chunk）并放弃"压缩字段名"备选（实测 −1.8%，已否定）；
2. P2-8 的私有网段 CORS 白名单是否接受（安全边界：仅内网，公网来源仍拒绝）；
3. P2-6 Phase C 对 `window.RelationshipLLM.setState` 保留原样（兼容契约）还是一并收口；
4. 实施顺序 P2-7 → P2-8 → P2-13 → P2-6。
