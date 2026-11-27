# HeartFlow 项目交接报告（给下一个 AI）

- 生成日期：2026-11-14
- 项目根：`e:\一门给年轻人的恋爱成长课`
- 应用目录：`e:\一门给年轻人的恋爱成长课\relationship-simulator`
- 当前版本：HeartFlow 2.1（在 2.0 基础上完成 S0–S6 工程升级）
- 结论先说：**工程与自动验收通过；真实语音、独立人工标注/盲评、真实 embedding、C 端混合检索仍未完成。不要把这些描述成已通过。**

---

## 1. 项目一句话定位

HeartFlow 是一个本地优先的中文恋爱关系分析与训练应用：用户导入聊天文本或截图，系统给出基于证据的关系判断、低压力回复建议、179 节课程推荐和情景模拟训练；默认不猜测心理、不操控、不诊断。

它不是心理治疗工具，也不是情感操控工具。代码与文档强调边界、同意、证据不足时弃判。

---

## 2. 当前功能

### 2.1 关系分析

- 导入聊天文本：`POST /api/v2/imports/chat`
- 导入截图：`POST /api/v2/imports/screenshot`，必须有 `remote_consent=true` 才调用视觉模型
- 关系判断：`POST /api/v2/analyses`
  - 五类：`EXIT / DE_ESCALATE / OBSERVE / ADVANCE / MAINTAIN`
  - 补充弃判：`abstain=true`、`evidence_status=insufficient`
  - 输出证据分句：`message_id/start/end/text/unit`，使用 Unicode code point
  - 输出安全标志：`hard_boundary_detected / pressure_reply_blocked / threat_detected`
  - 输出审计：`decision_source / rule_version / model_used`
- 回复建议：`POST /api/v2/replies`，拒绝/降级场景禁止推进式话术
- 每周计划：`POST /api/v2/learning/weekly-plan`

### 2.2 179 节课程与检索

- 本地课程：`public/love-learning/courses/001.md` 到 `179.md`，配 `manifest.json`
- 课程检索：`POST /api/v2/learning/recommendations`
  - `mode=bm25`：2.0 旧路径
  - `mode=semantic`：字段加权 BM25 + 概念扩展 + 分块最高分
  - `mode=hybrid`：BM25 与 semantic 的 RRF 融合
  - `mode=hybrid_rerank`：未配置重排器时显式回退 `hybrid`
- 每条结果带真实引用：`citation.path / line_start / line_end / quote`
- 结构化索引：`public/love-learning/semantic-index/index.json`（179 门 / 889 块）

### 2.3 情景模拟与评分

- 场景列表：`GET /api/v2/practice/scenarios`
- 开始/推进/反馈：`/api/v2/practice/sessions`、`/turns`、`/feedback`
- 5 个场景：
  - `first-meeting`
  - `low-energy-reply`
  - `low-pressure-invitation`
  - `conflict-repair`
  - `breakup-recovery`
- 行为合同：场景版本、难度、分支、允许状态、边界、终止规则、学习目标、维度
- 状态由服务器从 `history + response` 重建，**不信任客户端 state**
- 五维评分：倾听、清晰度、边界、自然度、冲突处理；rubric `2.1.0`

### 2.4 语音与其他页面

- 语音反馈：`POST /api/v2/voice/feedback`
- 本地 TTS：C 端可生成 WAV；真实 ChatTTS sidecar 需另行启动（当前未验收）
- 前端页面：首页、摄入问卷、恋爱学习、人格与价值观自测、能力评估、宠物/陪伴、语音 Demo 等
- 旧版接口仍保留，v2 接口是当前主线

### 2.5 明确不做的事

- 不诊断心理疾病
- 不推断对方人格/动机
- 不生成操控、PUA、跟踪、施压话术
- 不在未授权时上传截图或写入长期记忆
- 不把合成评测指标说成真实用户效果

---

## 3. 技术栈

### 3.1 前端

| 项 | 实际 |
| --- | --- |
| 形态 | 多页静态站点 + SPA 式静态资源 |
| 语言 | 原生 HTML / CSS / JavaScript |
| 框架/构建 | 无 React/Vue、无 Webpack/Vite |
| 模块 | `public/modules/`、`public/app.js`、`public/home.js` 等 |
| 本地状态 | 浏览器 `localStorage`（周计划、授权、评分等） |
| 页面 | `index.html`、`love-learning.html`、`intake-quiz.html` 等 |

### 3.2 后端双实现

| 项 | C 服务（生产式） | Node 服务（参考实现） |
| --- | --- | --- |
| 入口 | `heartflow-c/hf.exe serve --port 3000 --root .` | `node server/index.js` |
| 语言 | C11 | Node.js ESM（v24.16.0） |
| HTTP | 自研 HTTP server | 原生 `node:http` |
| JSON | 自研 JSON | 原生 `JSON` |
| 依赖 | 零第三方运行时依赖 | 零 npm 运行时依赖 |
| 构建 | `python -m ziglang` + Git Bash `build.sh` | 无需构建 |
| 语义/练习 | 已实现 L0/L1，120/120 与 Node 对齐 | 已实现 L0/L1 + 可选 L2 适配器 |
| 课程检索 | 仅 BM25；semantic/hybrid 明确降级 | bm25/semantic/hybrid 全实现 |
| 静态服务 | `heartflow-c/src/server/static.c` | `server/staticServer.js` |

### 3.3 模型与外部能力

- 模型协议：OpenAI 兼容 `chat_completions`
- 当前配置：`mimo-v2.6-flash`，端点 `token-plan-cn.xiaomimimo.com`
- 密钥：在 `relationship-simulator/.env`，**不要读取、打印、提交**
- 代理：`server/llmProxy.js`
  - 限流：24 次/分钟/IP
  - 请求体：聊天 120KB、截图约 1.8MB
  - CORS 白名单
  - 截图必须显式远程授权
- 视觉：同一模型端点，真实合成图测试通过
- 语音：C 本地 WAV 可用；真实 TTS/ASR 未验收

### 3.4 知识资产

- `public/love-learning/`：179 节课程 + manifest
- 根目录 `.agents/skills/relationship-coach-cn/`：中文关系智能知识库与运行时（7 阶段 × 5 能力维度、参考书、课程等）
- `quality/`：2.1 新增的评测数据、schema、场景合同、脚本与报告

---

## 4. 代码结构

```text
relationship-simulator/
├─ heartflow-c/                 # C11 服务与构建
│  ├─ hf.exe                    # 构建产物（2.1 最终）
│  ├─ build.sh                  # Git Bash 构建脚本
│  ├─ src/server/               # httpd/routes/v2/static/config 等
│  ├─ src/voice/                # TTS CLI 与合成
│  └─ tests/v2-smoke.py         # C/Node v2 契约测试
├─ server/                      # Node 参考实现
│  ├─ index.js / http.js
│  ├─ v2.js                     # v2 路由、语义、检索、练习
│  ├─ semantic-review.js        # L2 可选模型复核适配器
│  ├─ llmProxy.js / voiceProxy.js
│  ├─ staticServer.js
│  └─ relationshipIntelligence.js
├─ public/                      # 前端、179 课、语义索引
├─ quality/                     # 2.1 数据集/评测/场景合同
├─ scripts/                     # 旧评测、E2E、构建索引
├─ test/                        # node:test 单元/契约测试
└─ docs/heartflow-2.1/          # 2.1 全部验收文档
```

关键文件：

- `server/v2.js`：v2 主逻辑
- `heartflow-c/src/server/v2.c`：C 端 v2 主逻辑
- `quality/scripts/`：语义/检索/练习/parity/security 评测
- `docs/heartflow-2.1/FINAL_ACCEPTANCE.md`：最终验收与阻塞项

---

## 5. API 一览（v2）

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| POST | `/api/v2/imports/chat` | 导入聊天文本 |
| POST | `/api/v2/imports/screenshot` | 导入截图，需远程授权 |
| POST | `/api/v2/analyses` | 关系分析 |
| POST | `/api/v2/replies` | 回复建议 |
| POST | `/api/v2/learning/recommendations` | 课程检索，支持 `mode` |
| GET | `/api/v2/practice/scenarios` | 场景列表 |
| POST | `/api/v2/practice/sessions` | 开始练习 |
| POST | `/api/v2/practice/turns` | 推进一轮 |
| POST | `/api/v2/practice/feedback` | 评分反馈 |
| POST | `/api/v2/learning/weekly-plan` | 每周计划 |
| POST | `/api/v2/voice/feedback` | 语音反馈 |
| POST | `/api/chat` | 通用模型代理（受限于限流与体量） |

错误格式统一为 `{ error, message }`；常见错误码：`invalid_messages`、`invalid_limit`、`consent_required`、`rate_limited`、`upstream_error`。

---

## 6. 如何启动、构建、测试

```powershell
cd "e:\一门给年轻人的恋爱成长课\relationship-simulator"

# C 版（默认生产式，仅本地）
npm start

# Node 版（含 semantic/hybrid 检索）
npm run start:node

# 全量测试
npm test

# C/Node v2 契约
python heartflow-c\tests\v2-smoke.py heartflow-c\hf.exe

# 浏览器 E2E（使用本地假模型）
node scripts\e2e-heartflow-v2.mjs

# TTS 自检
.\heartflow-c\hf.exe tts selftest

# 2.1 质量评测
node quality\scripts\validate-datasets.mjs
node quality\scripts\eval-semantics.mjs --split=test
node quality\scripts\eval-retrieval.mjs --split=test --mode=hybrid
node quality\scripts\eval-practice.mjs --split=test
node quality\scripts\check-semantic-parity.mjs
node quality\scripts\check-retrieval-parity.mjs
node quality\scripts\security-smoke.mjs
```

重新构建 C：

```powershell
cd heartflow-c
& 'D:\Git\bin\bash.exe' ./build.sh hf.exe
```

---

## 7. 当前验收数据（可复现）

| 检查 | 结果 |
| --- | --- |
| `npm test` | **1065/1065**，循环依赖 0，约定 0 |
| C/Node v2 smoke | **17/17** |
| 浏览器 E2E | **30/30**（本地假模型） |
| TTS 自检 | **9/9** |
| 安全冒烟 | **10/10** |
| 语义 C/Node parity | **120/120** |
| 检索 bm25 C/Node parity | **120/120** |
| 语义 test | Accuracy **96.7%**，Macro-F1 **0.960**，unsafe 0 |
| 检索 test | BM25 Recall@5 **41.4%**；Semantic **53.6%**；Hybrid **53.3%** |
| 检索引用 | 引用错误 0，validCitationRate 1.0 |
| 模拟 test | **30/30** |
| 真实模型 | 文本/JSON/视觉单次成功；JSON 时延 2–76 秒波动 |
| 最终 C 二进制 | SHA-256 `B96F40C37CC9B829EA7C7312AED845F2F31991B75F83B8475C919DD7DF92B3C1` |

注意：语义/检索数据是**原创合成 + 单一实现者标注**，`reviewed_by_human=false`；test 在迭代中被用于错误分析与 C/Node 对齐，**不是严格盲测**。96.7%/53.3% 不是真实用户指标。

---

## 8. 遇到的问题与技术债

### 8.1 高优先级

1. **C 生产路径没有 semantic/hybrid**
   - `npm start` 运行 C，只有 BM25。
   - Node 的 +12pp 检索收益未进入 C。
   - C 对 `mode=semantic/hybrid` 返回 `mode_effective=bm25` 和 `fallback_reason`，这是明确降级，不是 bug 隐藏。

2. **评测数据不具备独立人工质量**
   - 语义 120、检索 120、模拟 60，低于建议的 300+/120+/60。
   - 单一实现者编写，无第二标注者、无 kappa/alpha。
   - test 已被错误分析使用，不能宣称严格 held-out。

3. **没有真实本地 embedding**
   - `semantic` 是概念扩展 + 字段/分块 BM25，不是向量语义检索。
   - 本机无离线中文 embedding 模型；下载模型需要额外授权。

4. **真实语音/ASR 未验收**
   - `127.0.0.1:5001` 的 ChatTTS sidecar 当前未启动。
   - C TTS selftest 只验证本地 WAV 生成与文本分段，不是真实语音服务。

### 8.2 中优先级

5. **人工盲评缺失**
   - 自然度、共情、角色一致性未验证。
   - 规则评分只验证行为合同，不能替代人工评分。

6. **模型稳定性与成本**
   - 同一 JSON 请求时延 2–76 秒波动。
   - 未做真实供应商故障注入、重试/熔断、成本与配额统计。
   - 单次成功不等于 SLA。

7. **安全边界**
   - 无认证、无多租户、无 TLS，默认只监听回环。
   - C 静态/课程接口无限流；只有 `/api/chat` 有 24 次/分钟/IP。
   - 未做提示注入红队、并发压测、依赖 SBOM。
   - 日志脱敏未验证。

8. **回滚不完整**
   - C 二进制可精确回滚（`hf.pre-v2-20261113.exe`、`backups/hf-pre-s6-20261114.exe`）。
   - Node 源码在本轮开始前已是未提交/未跟踪状态，未生成 2.0 源快照，源码回滚只能 PARTIAL。

### 8.3 低优先级/维护性

9. **C 与 Node 双实现维护成本高**
   - 语义词表、检索、练习状态需要同时改两边并跑 parity。
   - 任何字段变化都要同步 smoke 测试。

10. **规则泛化有限**
    - 语义 test 仍有 2 条已知泛化失败：`可以，一起去`、`照现在的方式相处就行`。
    - 安全优先能降低伤害，但词表漏判/误报仍存在。

11. **视觉与前端覆盖有限**
    - 真实视觉只测 1 张合成图，未测模糊、长截图、群聊、深色模式。
    - 前端以原生 JS 多页面为主，存在 legacy 页面与重复代码。

12. **没有数据库/账号体系**
    - 服务端无持久化数据库；浏览器本地存储为主。
    - 多设备同步、用户隔离、审计日志都未实现。

---

## 9. 给下一个 AI 的硬性约束

1. **先读验收文档再改代码**
   - `docs/heartflow-2.1/FINAL_ACCEPTANCE.md`
   - `docs/heartflow-2.1/00_BASELINE_AUDIT.md` 到 `06_SECURITY_RELEASE_ROLLBACK.md`

2. **不要把阻塞项写成通过**
   - 独立人工标注/盲评、真实 TTS/ASR、真实 embedding、C 端 hybrid、生产认证/TLS 都是未完成。

3. **不要用冻结 test 调参**
   - `quality/datasets/FREEZE.json` 保护 test 哈希。
   - 需要迭代时新建 dev 或新版本 test，不要反复改 test 后宣称提升。

4. **保留 C 服务、179 课程和离线功能**
   - 任何改动不得删除 `heartflow-c/`、`public/love-learning/courses/`、旧接口兼容路径。
   - 修改 v2 字段必须同时更新 C 与 Node，并跑：
     - `npm test`
     - `python heartflow-c/tests/v2-smoke.py heartflow-c/hf.exe`
     - `node quality/scripts/check-semantic-parity.mjs`
     - `node quality/scripts/check-retrieval-parity.mjs`

5. **不要读取/打印/提交 `.env`**
   - 模型密钥在 `relationship-simulator/.env`。
   - 测试真实模型时只用合成数据，并显式记录时延、状态、是否失败。

6. **不要默认暴露服务**
   - 默认 `127.0.0.1`；公网部署前必须加认证、TLS、限流、日志脱敏。

7. **不要把规则分当心理测量**
   - 五维评分是产品反馈，不是临床或心理测量结论。
   - 不要推断人格、依恋类型、动机。

---

## 10. 建议的下一步（按优先级）

1. **把 semantic/hybrid 落到 C**
   - 目标：C 端也实现概念扩展 + 字段/分块 BM25 + RRF。
   - 验收：C/Node 排序 parity ≥ 120/120；C 端 hybrid Recall@5 达到 Node 水平。

2. **建立新的未曝光 test 与人工标注**
   - 语义 ≥300、检索 ≥200、模拟 ≥60。
   - 双人独立标注，报告 Cohen's kappa / Krippendorff alpha。
   - 冻结后只跑一次；不要用 test 调规则。

3. **做人工盲评**
   - 每维 ≥60 条，2 名评委，随机打乱来源。
   - 报告均值/中位数/95% CI/ICC 或 alpha。
   - 自然度单独评，不用规则分替代。

4. **真实语音/ASR 端到端**
   - 启动 ChatTTS/ASR sidecar，补成功、超时、断线、空音频、噪声测试。
   - 明确本地/远程语音的隐私边界。

5. **真实供应商稳定性**
   - 故障注入、重试/熔断、超时、限流、成本统计。
   - 记录 token 账单与 P50/P95，不要用单次成功代表 SLA。

6. **真实 embedding（可选）**
   - 在获得模型下载/部署授权后，引入本地中文 embedding。
   - 保留 BM25 回退；对比 semantic/hybrid 的真实增益与索引体积/时延。

7. **安全生产化**
   - 认证、多租户隔离、TLS、全接口限流、日志脱敏、SBOM、并发压测、提示注入红队。

8. **回滚能力**
   - 下次改动前先提交或打源码快照；补齐 Node 2.0 源码回滚路径。

---

## 11. 证据与文档索引

| 内容 | 路径 |
| --- | --- |
| 最终验收 | `docs/heartflow-2.1/FINAL_ACCEPTANCE.md` |
| 基线审计 | `docs/heartflow-2.1/00_BASELINE_AUDIT.md` |
| 数据与标注 | `docs/heartflow-2.1/01_DATASET_AND_ANNOTATION.md` |
| 语义升级 | `docs/heartflow-2.1/02_SEMANTIC_UPGRADE.md` |
| 课程检索 | `docs/heartflow-2.1/03_COURSE_RETRIEVAL.md` |
| 场景与评分 | `docs/heartflow-2.1/04_PRACTICE_AND_RUBRIC.md` |
| 真实供应商 | `docs/heartflow-2.1/05_REAL_PROVIDER_ACCEPTANCE.md` |
| 安全发布回滚 | `docs/heartflow-2.1/06_SECURITY_RELEASE_ROLLBACK.md` |
| 发布清单 | `docs/heartflow-2.1/RELEASE_MANIFEST.json` |
| 日志 | `docs/heartflow-2.1/logs/` |
| 评测报告 | `quality/reports/` |
| 数据集 | `quality/datasets/` |
| 场景合同 | `quality/scenarios/contracts-2.1.json` |
| 标注指南 | `quality/annotation-guidelines/ANNOTATION_GUIDELINES.md` |

---

## 12. 最短上手路径（给下一个 AI）

```powershell
cd "e:\一门给年轻人的恋爱成长课\relationship-simulator"
npm test
python heartflow-c\tests\v2-smoke.py heartflow-c\hf.exe
node quality\scripts\validate-datasets.mjs
node quality\scripts\eval-semantics.mjs --split=test
node quality\scripts\eval-retrieval.mjs --split=test --mode=hybrid
node quality\scripts\eval-practice.mjs --split=test
node quality\scripts\check-semantic-parity.mjs
node quality\scripts\check-retrieval-parity.mjs
```

然后阅读：

1. `docs/heartflow-2.1/FINAL_ACCEPTANCE.md`
2. `server/v2.js`
3. `heartflow-c/src/server/v2.c`
4. `quality/scripts/`
5. `docs/heartflow-2.1/06_SECURITY_RELEASE_ROLLBACK.md`

记住：**能复现的测试结果才算证据；未执行的验收必须写 BLOCKED，不能写 PASS。**
