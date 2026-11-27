# hf — 关系档案引擎（C 版）

一个不联网也能用的本地程序：**命令行引擎 + 本地 HTTP 服务**，单文件约 515 KB（2.2 构建，526,848 字节），零外部依赖。

它替代的是原来的 Node 服务端（`server/` 下 14 个 JS 文件）与 `../../.agents/skills/relationship-coach-cn/runtime`（约 1300 行 JS）。前端 HTML/CSS/JS 仍作为静态资源存在——浏览器只能执行 JS，这部分不能"用 C 重写"，但**逻辑已经下沉到 C 服务端**，前端只剩渲染与交互。

## 当前覆盖范围

| 层 | 状态 | 说明 |
|---|---|---|
| CLI 五能力 | 已用 C 完成 | `reflect / add / memory / brake / trace` |
| HTTP 服务 | 已用 C 完成 | 静态站 + 7 个 API，替换 `server/*.js` |
| 关系智能运行时 | 已用 C 完成 | 状态机 / 分析器 / 记忆 / 预测 / 场景，与 JS 版逐字段对齐 |
| TTS 协议/文本/音频层 | 已用 C 完成 | 文本清洗、分句、参数校验、RMS 归一化、WAV 封装；WAV 与 Python 逐字节一致 |
| 循环依赖门禁 | 已用 C 完成 | `hf check circular`，替代 `scripts/check-circular.mjs` |
| 前端 HTML/CSS | 保持为静态资源 | 属于内容与样式，不是程序逻辑 |
| 前端 JS | 保留为薄 UI 层 | 浏览器限制；计算逻辑已由 C 接口提供 |
| 语音模型推理 | 仍为 Python | 只剩「加载模型 + 推理」，`voice/tts_server.py` 收到 `format=pcm` 时只回 raw float32 |
| 评测/浏览器自动化脚本 | 仍为 JS | 刻意 import 生产 JS 模块，C 化会失去评测意义 |

## 编译

有 gcc / clang：

```sh
make            # Linux / macOS（serve 仅 Windows）
make LDFLAGS="-lshell32 -lws2_32 -lwinhttp"   # Windows (MinGW)
```

没有编译器时，用 PyPI 上的 zig 充当 C 编译器：

```sh
python -m pip install ziglang -i https://mirrors.aliyun.com/pypi/simple/
./build.sh
```

**发布构建固定用 `./build.sh`（默认输出名 `hf.exe`）** [E]。整文件哈希依赖输出的目录与文件名：2026-11-27 实测，同目录同名连续构建两次逐字节相同；换目录或换名后哈希会变，差异只有 30 多个字节，全在调试目录（PE 头与 `.buildid` 段的调试时间戳、PDB GUID、PDB 文件名），代码段与数据段逐字节不变。2.2 验收文档写的「构建非确定性」因此不成立——那次是换名重建；要核对发布哈希，只能按原名原地重建。

## 启动服务

```sh
./hf.exe serve --port 3000 --root ..
# 或在项目根目录：npm start（package.json 的 start/dev 已指向 C 版）
```

`--root` 指向项目根目录（包含 `public/`、`long-simulation/`、`.env`）。启动后打开 `http://localhost:3000`。
质量门禁：`npm run check:circular`（C 版）／`npm run check:circular:js`（JS 对照）。

输出示例：

```
恋爱模拟器（C 版）已启动: http://localhost:3000
API 代理: POST http://localhost:3000/api/chat
模型: mimo-v2.6-flash
Endpoint: https://token-plan-cn.xiaomimimo.com/v1/chat/completions
API Key: 已配置
静态目录: .../public
```

## 七个 API（与 Node 版一一对应）

| 方法 | 路径 | 实现要点 |
|---|---|---|
| GET | `/api/health` | 返回模型、endpoint（去 query）、是否配置 key，从不回显 key |
| POST | `/api/chat` | 转发到 OpenAI-compatible 上游；Responses 模式自动补 `choices` 结构；120s 超时；5xx 重试一次。带 `"stream":true` 时切 SSE 流式（见下） |

**`/api/chat` 的 SSE 流式**（请求体加 `"stream":true`，仅 `chat_completions` 模式）：响应为 `text/event-stream; charset=utf-8`，`Connection: close`，每帧单行 `data: {...}\n\n`，以 `data: [DONE]\n\n` 收尾。帧的 `type` 有两种：`content`（正文增量在 `delta`）、`reasoning`（思维链增量在 `delta`，供前端显示"正在思考"，不混入正文）；上游错误帧带 `type:"error"` 和 `message`。C 侧用 WinHTTP 逐块读取上游 SSE（跨块拼行），**不攒完整响应**，首帧到达即转发——实测真实上游首帧约 4.8s（非流式需等 11–14s 全程）。不带 `stream` 的请求完全走原非流式路径，行为不变。 |
| POST | `/api/search` | 只接受查询词；域名白名单；优先外部搜索 API，否则走模型 web_search 插件 |
| POST | `/api/relationship-intelligence` | 确定性规则，无模型调用；输出分析、状态、决策、预测、记忆补丁 |
| GET | `/api/long-content/:n` | 10 章教材，严格校验章节号 |
| GET | `/api/tts/health` | 透传本地语音 sidecar 状态（含 `onlineEnabled`） |
| GET / POST | `/api/tts/online` | 在线语音运行时开关：GET 查状态，POST 只把 `{"enabled": bool}` 这一个布尔转发到 sidecar `/online`，不透传任意请求体；前端勾选开关时先弹隐私确认 |
| POST | `/api/tts` | C 侧清洗文本、钳制语速、校验 300 字、engine 白名单（`chattts` / `kokoro` / 一键启用的 `edge`）；请求 `format=pcm` 拿 raw float32 后自己做 RMS + WAV 封装；旧后端返回 WAV 时原样透传；白名单透传 `X-Tts-Engine` / `X-Tts-Latency-Ms` |
| OPTIONS | `/api/*` | CORS 预检，仅放行本机与 RFC1918 来源 |

## CLI 五个能力

| 需求 | 命令 | 它到底做什么 |
|---|---|---|
| 把感受翻译成语言 | `hf reflect` | 表层情绪 → 更底下的体验，附判断依据，给一句可自己补完的话 |
| 不站队的第三方 | 同上第 2 段 | 标出绝对化 / 读心 / 单边归因，只给问题，不给结论 |
| 记得住历史 | `hf add` `hf memory` | 主题纵向计数、处置分布、上一次的结果 |
| 关键时刻的刹车 | `hf brake` | 按情绪强度自动定时，到点前**无法**发送 |
| 看得见自己变了 | `hf trace` | 前后半段的强度、回避率、说清率对比 |

```sh
./hf.exe demo                       # 12 周故事跑一遍
./hf.exe reflect "他又是三个小时不回我消息"
./hf.exe add 冲突 "他说好十点回来，十二点才到" --note 忍
./hf.exe trace --weeks 12
```

## 验证

一条命令跑完全部回归（自动起停服务与假上游、自动清理）：

```sh
sh tests/run-all.sh
```

这只覆盖 C 回归。**发布前用统一门禁 `npm run gate`**（在项目根目录），它按顺序跑 9 步：C 回归 7 组、v2 契约（打生产 `hf.exe`）、C/Node 检索一致性、C/Node 语义一致性、数据集校验、Node 单元测试、循环依赖与编码约定、安全冒烟（打生产 C 服务）、发布清单。全部用假上游与合成数据，不消耗额度；`--list` 列出步骤，`--only id1,id2` 只跑指定步。用例数随开发增长，以各步输出为准。

也可以单独跑某一组：

```sh
sh tests/smoke.sh                            # CLI，10 项
sh tests/server-smoke.sh 3101 ..            # 服务端，24 项
sh tests/chat-proxy.sh                       # /api/chat 代理，13 项（本地假上游）
sh tests/check-parity.sh                     # 循环依赖门禁 C/JS 对照，11 项
python tests/parity.py [C地址] [Node地址]    # 与 Node 版逐字段对照
python tests/tts-proxy.py                    # /api/tts 接线 + /api/tts/online 开关，22 项（本地假推理后端）
voice/venv/Scripts/python.exe tests/tts-parity.py   # TTS 与 Python 逐字节对照，30 项
```

`parity.py` 默认连 C `:3100` 与 Node `:3200`，需两边同时运行；`run-all.sh` 会自动在 `:3102` / `:3201` 起停。`chat-proxy.sh` / `tts-proxy.py` 都让服务 `--root` 指向不含 `.env` 的临时目录，且只用假上游——**结构上保证不会碰到真实模型额度或真实推理模型**。`tts-parity.py` 需要 numpy，缺失时 `run-all.sh` 会跳过该组并继续跑其余。

已实测结果（2026-11-07 音色验收收敛后，`run-all.sh` 全绿，共 124 项）：

- **CLI 冒烟：10/10**，**服务端冒烟：24/24**
- **关系智能对照：5/5 全部一致**（无记忆、带记忆、明确拒绝、安全风险、空消息错误码）
- **chat 代理：13/13**（转发内容与 Authorization、模型名、上游 5xx→502、请求体 2MB 超限→413、缺密钥→400、Responses 归一化 `choices`）
- **TTS 自测 9/9、算法对照 30/30**（14 组文本清洗 + 8 组分句 + 8 组 WAV；8 组 WAV **字节级完全一致**）
- **TTS 接线 22/22**（文本清洗、语速钳制、engine 白名单含一键启用的 `edge`、PCM→WAV、旧 WAV 后端透传、health 代理、`X-Tts-*` 头透传、在线开关 GET/POST/拒绝非布尔/关闭）
- **循环依赖门禁 11/11**（真实项目两边同为 106 模块 / 0 环；构造的有环 fixture 两边都 exit 1）
- **静态资源字节级一致**：`/`、`/styles.css`、`/modules/core/api-client.js`、`/api/long-content/1` 与 Node 版 `cmp` 完全相同
- **`/api/health` 输出逐字节一致**；`npm test` 1034/1034 通过，约定检查 0 违规

### 发布清单

`hf.exe` 与回滚用二进制不入库（见 `.gitignore`），`RELEASE_MANIFEST.json` 就是「被验收的那个 `hf.exe`」在仓库里的唯一凭据。它记录：

- 生产 `hf.exe` 的大小与 SHA-256；
- 全部编译输入的指纹——`src/**/*.{c,h}` 加 `build.sh`，换行符归一后计算，Windows 与 LF 检出得到同一个值；
- 工具链版本，以及回滚文件（`hf.pre-v2-*.exe`、`backups/*.exe`）的哈希。

`npm run release:check` 校验三者仍然一致，并且 C 引擎源码已全部提交；它是 `npm run gate` 的最后一步。
发布顺序：改源码 → `./build.sh` → `npm run gate` → 提交源码 → `npm run release:manifest` 重新生成清单 → 提交清单。

`docs/heartflow-2.1/RELEASE_MANIFEST.json` 是 2.1 发布时的历史快照，不再更新。

### 真实模型端到端（手动，不进 `run-all.sh`）

回归脚本刻意全用假上游/假推理后端，可在任何机器零费用零 GPU 地跑。要验真实链路：先在项目根目录双击「启动语音服务.cmd」（等 `/health` 里 `chattts.status == ready`，首次约 25 秒、显存约 1.1 GB），再：

```sh
./hf.exe serve --port 3000 --root ..
python tests/real-e2e.py               # 真实合成 4 个音色 + 一键开关链路，27 项，免费
python tests/real-e2e.py --with-llm    # 额外发 1 次最小 LLM 请求，会产生该账号计费
```

**不用设环境变量、不用重启**：脚本发现 `edge` 未注册时，会自己 `POST /api/tts/online {"enabled":true}`
（等价于在设置面板点「启用在线语音」），确认 health 解锁后跑在线音色，最后再关回去验证恢复纯离线。
在线合成时文本会离开本机（详见 `voice/README.md`）；服务端另有 403 兜底：未解锁时即便绕过前端
直连 `127.0.0.1:5001` 请求 `engine=edge` 也会被拒，不依赖前端自觉。

脚本覆盖离线兜底 `chat_qingche`、Kokoro，以及**真人听感验收通过的两个在线音色**
`edge_wenrou`（温柔 · 自然）/ `edge_yuanqi`（元气 · 明亮），校验 WAV 格式、信号有效性与 `X-Tts-*` 头，
样本写到 `.e2e-out/`。2026-11-07 收敛后实测 **27/27 全过**：ChatTTS 加载 21.49s（cuda）产出 2.68s 音频；
Kokoro 2.47s 合成 3.80s；在线温柔 · 自然 14.83s（首次建连）/ 元气 · 明亮 3.38s 各产出 4.15s / 4.10s；
全部 1ch / 16bit / 24kHz、rms≈2949、未削波。启动时 `engines=chattts,kokoro / onlineEnabled=False`，
开关打开后出现 `edge`，关闭后恢复 `chattts,kokoro`。
此前基线：音色工坊版 29/29（含后来被真人听感淘汰的变调御姐 / 萝莉）；更早 13/13 + LLM 分支 9/9
（真实 LLM `mimo-v2.6-flash` 返回 `收到`，18 tokens / 0.72s）。

**浏览器全链路**：`node scripts/e2e-browser.mjs --live --base-url=http://127.0.0.1:3000` 在 C 服务上 **12/12 通过**（含 `live-upstream` 教练通道真实调用上游、刷新后风格与身份标识持久化、0 页面异常），报告见 `docs/verification/2026-11-07-browser-e2e-live-C.md`；非 live 版 11/11。修复前 C 服务连页面都渲染不出来，见「坑 6」。

**真实链路才暴露出的三件事**（已修/已记录）：① Python 与 Node 都回 `X-Tts-Engine` / `X-Tts-Latency-Ms`，C 版原先全丢——现由 `hf_http_header()` 白名单透传，并已加进 `tts-proxy.py` 回归；② 请求行没剥离 `?query` 导致全部 JS 模块 404、前端整体起不来，见「坑 6」；③ 推理模型 token 预算太小会被 reasoning 吃光正文，见「已知边界」。

## 六个实现上的坑（都已在代码里注释）

**1. Windows 中文路径。** `fopen` 走 ANSI 代码页，路径含中文直接失败；必须 `_wfopen` + UTF-8→UTF-16。这是"首页 404"的真实原因，不是路由问题。同类问题还有 `_getcwd`：`hf check circular` 必须改用 `GetCurrentDirectoryW` + UTF-8 转换，否则模块表全空。

**2. UTF-8 分句不能用 `strpbrk`。** 分隔符集合里的字节会命中汉字内部字节（例如 `！` 的 `0x81` 命中"联"的第二字节），把句子从字中间切断。必须先解码成码点再比较。TTS 分句同理，且 `min_len/max_len` 与 300 字上限都必须按**码点数**算，按字节算中文会被算成 3 倍。

**3. 主题相似度要先删标点。** JS 版先 `replace(/[\s\p{P}\p{S}]+/)` 再取二元组，所以二元组会跨过标点；直接对原串取二元组会系统性偏低。

**4. Python `len()` 与 `re` 都按字符而非字节。** `float_to_wav` 的 `astype(int16)` 是**向零截断**不是四舍五入；numpy 用 float32 累加、C 用 double 求 RMS，实测 8 组信号仍字节级一致，但不要想当然把 C 改成 `round()`。

**5. 扫描 JS import 时，`export` 不等于 re-export。** `export function f(){ q(".x") }` 里的选择器字符串不是模块路径——必须要求关键字与引号之间有 `from`；反过来 `import {` / `export {` 才需要跨行续读，把 `export function ... {` 误设成 pending 会吞掉下一行的动态 `import("./x.js")`。这两处曾让 C 版少算 1 个模块（105 vs 106）。

**6. HTTP 请求行必须剥离 `?query`，否则前端整体起不来。** `static.c` 会给 `.js` 里的相对 import 注入 `?v=<版本>`，浏览器随后按带 query 的 URL 请求模块；而 `httpd.c` 原先直接把整个请求目标存进 `c->req.path`，`ext_of()` 得到 `.js?v=...`、文件路径也带上 query → **所有 JS 模块 404**。API 请求都不带 query，所以逐字节 parity 与 19 项冒烟全都测不到；直到用真实浏览器跑 `e2e-browser.mjs` 才发现「首页能开、聊天记录不渲染」。修法是在解析请求行时截断 `?` / `#`，并在 `server-smoke.sh` 补 5 项带 query 的用例。**教训：比对「文件内容一致」不等于验证「浏览器实际请求形态」。**

## 已知边界

- **`serve` 仅 Windows**：出站 HTTPS 用系统自带的 WinHTTP，避免引入 OpenSSL；非 Windows 只编 CLI。
- **真实模型已端到端跑通，但覆盖有限** [E]：2026-11-07 用本机 ChatTTS/Kokoro 与 `mimo-v2.6-flash` 各跑通一次，真实浏览器经 C 服务调用真实上游 12/12 通过（见上节）。仍未覆盖：**前端 TTS 播放控件实际出声**（只验到 WAV 字节与信号统计，浏览器 E2E 不覆盖语音模块）、**真实长对话/多轮记忆**、**联网搜索 `/api/search`**、**ChatTTS 全部音色与语速边界**，以及 Python sidecar 在其它机器 / CPU-only 环境的表现。
- **推理模型必须留足 token 预算** [E]：真实请求 `mimo-v2.6-flash` 时设 `max_completion_tokens=16`，16 个 token 全被 `reasoning_content` 消耗，返回 `content: ""` / `finish_reason: length`。这不是 C 侧 bug；给到 64 或传 `thinking={"type":"disabled"}` 即正常（实测 2 tokens 返回 `收到`）。`.env` 默认 4096，正常路径不受影响。
- **上游 5xx 的报错措辞沿用 Node 版**：重试一次仍 5xx 时返回 `502 {"error":"upstream_unreachable"}`（"无法连接"），而实际上游有响应。这是两边一致的既有语义，不是 C 版移植偏差；若要改成 `upstream_error`，应同时改 Node 与 C。
- **前端 JS 未 wasm 化，且判断为「不建议现在做」**：浏览器只能执行 JS，DOM 操作与 wasm 加载都必然要 JS 胶水，所以「前端全 C」在语义上就不成立。已用 `.wasm-probe/build.sh` 实测（2026-11-07）：C 计算层能编成 wasm，但 `wasm32-wasi` 产物 1.2 MB 且依赖 7 个 WASI 导入，浏览器还得再引一个 WASI shim；`wasm32-freestanding` 又缺 libc 头文件。**关键是计算层已经在 C 服务端**（`/api/relationship-intelligence`），再编一份浏览器 wasm 是重复劳动。只有当目标是「无服务端的纯静态 / 离线单机版」时才值得做，那时应走 freestanding + 自实现最小 libc 以去掉 WASI 导入。
- **模型推理必须留 Python，这是硬约束不是偷懒** [E]：ChatTTS 0.2.5 依赖 PyTorch/CUDA，没有可用的 C 推理 API；Kokoro 是 ONNX，理论上可走 onnxruntime 的 C API，但要引入 `onnxruntime.dll`，并复刻 phonemizer、espeak 数据路径、音色查表与分词，与「单二进制零依赖」直接冲突。因此把 `voice/tts_server.py` 的**协议/文本/音频层全部搬到 C**，Python 侧只剩「加载模型 + 推理」；C 带 `format=pcm` 时后端只回 raw float32，WAV 由 C 生成。这是当前约束下能做到的最大 C 化。
- **构建/评测脚本按性质分流，没有一刀切** [I]：
  - 已切 C：`package.json` 的 `start`/`dev`（→ `hf.exe serve`）、`check:circular`（→ `hf check circular`）；JS 版保留为 `start:node`/`check:circular:js` 作对照基准。
  - 保留 JS：`eval-*.mjs` / `e2e-browser.mjs` 刻意 import 生产 JS 模块并驱动浏览器 CDP，「测的就是跑的那套」，改成 C 就得复刻整套 JS 逻辑或失去评测意义；`build-long-index.mjs`、`check-conventions.mjs` 产物仍被前端与 `npm test` 消费，且后者是 694 行半个词法分析器，复刻成本远高于收益。
  - legacy：`start-bg.mjs` 与三个 `.ps1` 仍指向已废弃的 `node server/index.js`，因 `test/background-start.test.mjs`、`test/windows-process-identity.test.mjs` 钉住旧契约而保留，不再是推荐入口。
- **关系智能是规则不是理解**：词典与模式匹配必然有误判，所以每条结论都带证据 id，允许被驳回。

## 目录

```
src/hf.h             CLI 公共类型
src/json.c           JSON 解析/序列化（自写，无依赖）
src/sha256.c         观察 ID 摘要
src/server/httpd.c   HTTP/1.1 服务（Winsock，线程/连接）
src/server/config.c  .env、路径、URL 白名单、宽字符 fopen
src/server/net.c     出站 HTTPS（WinHTTP）
src/server/static.c  静态资源、MIME、模块版本号注入
src/server/routes.c  7 个 API
src/server/coach*.c  关系智能运行时（分析/状态/记忆/预测/场景）
src/voice/tts.c      TTS 文本清洗 / 分句 / RMS / WAV 封装
src/voice/cli.c      hf tts 对照入口
src/tools/check.c    hf check circular（替代 JS 门禁脚本）
src/main.c           命令分发（serve / tts / check 入口在这里）
tests/run-all.sh     一键跑完 7 组回归（共 124 项，全用假后端）
tests/smoke.sh       CLI 五能力冒烟
tests/server-smoke.sh HTTP 服务冒烟
tests/chat-proxy.sh  /api/chat 代理回归（本地假上游）
tests/parity.py      C 与 Node 逐字段对照
tests/fake_upstream.py 本地假上游（不消耗真实额度）
tests/tts-parity.py  TTS 与 Python 逐字节对照（需 numpy）
tests/tts-proxy.py   /api/tts 接线 + /api/tts/online 开关回归（本地假推理后端）
tests/check-parity.sh 循环依赖门禁 C/JS 对照
tests/v2-smoke.py    v2 契约与隐私（默认打 hf.exe，可传入别的构建路径）
RELEASE_MANIFEST.json 当前生产二进制的发布清单（见「验证 → 发布清单」）
tests/real-e2e.py    真实模型端到端（手动；需本地权重，--with-llm 计费）
.e2e-out/            真实合成的 WAV 样本（不入库）
.wasm-probe/         wasm 可行性探针（非产品代码，见其 build.sh 头部结论）
```
