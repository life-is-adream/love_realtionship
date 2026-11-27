# S6 安全、构建发布与回滚

## 1. 构建产物

| 产物 | 大小 | SHA-256 | 说明 |
| --- | --- | --- | --- |
| `heartflow-c/hf.exe`（2.1 最终） | 510,976 | `B96F40C37CC9B829EA7C7312AED845F2F31991B75F83B8475C919DD7DF92B3C1` | 含 S2 语义字段、S4 状态修复、S6 点文件拒绝 |
| `heartflow-c/backups/hf-pre-s6-20261114.exe` | 510,976 | `3220EF78D19DCAEF43FA4BA9E01AF406B8BDDB12DD78EF602F3C7488CD0A7681` | S6 安全加固前快照 |
| `heartflow-c/hf.pre-v2-20261113.exe` | — | `908EB34735B07EDF863C656CE5CDFB5779A7C7241CEA0FB84E5E9FBE1D0D99D1` | 2.0 原始二进制备份 |

完整清单：`docs/heartflow-2.1/RELEASE_MANIFEST.json`。构建环境：Windows + Node 24.16.0 + `python -m ziglang 0.17.1` + `build.sh`（C11，`-O2`）。构建可重复，但未做跨机器 bit-for-bit 验证。

## 2. 安全加固与验证

### 2.1 本轮修复

- 静态服务器拒绝点文件/点目录：`/.env`、`/.git/config` 从 SPA 回退 200 改为 404。
- 路径穿越仍返回 403（`/../`、编码变体），与既有测试一致。
- 截图无 `remote_consent` 时 400，且不调用模型。
- 模型代理保持 2MB body 上限、24 次/分钟/IP 限流、CORS 白名单。
- C/Node 语义与检索的 `state` 均由服务器重建，忽略客户端伪造。

### 2.2 安全冒烟（实际）

`node quality/scripts/security-smoke.mjs` → **10/10 通过**，日志 `docs/heartflow-2.1/logs/S6-security.log`：

| 检查 | 结果 |
| --- | --- |
| `.env` 不可下载 / 不含密钥 | PASS（404） |
| 编码路径穿越 | PASS（404/403） |
| `.git` 不可下载 | PASS（404） |
| 非法 JSON | PASS（400） |
| 81 条消息上限 | PASS（400） |
| 检索 limit=11 | PASS（400） |
| 截图无授权 | PASS（400 consent_required） |
| CORS 陌生 Origin | PASS（不回显） |
| 聊天限流 | PASS（第 25 次 429） |

### 2.3 未覆盖的安全项（风险）

- **无用户认证/多租户隔离**：服务默认只监听 `127.0.0.1`，但一旦配置 `HF_BIND_HOST` 暴露到局域网，任何访问者都可使用模型额度与本地课程接口。
- **无 TLS**：本地 HTTP；公网部署必须前置反向代理与 TLS。
- **提示注入**：用户聊天/截图文字会进入模型 prompt；当前靠固定指令、JSON schema 校验、无工具调用降低影响，未做对抗性红队。
- **DoS**：只对 `/api/chat` 限流；C 静态/课程接口无限流；未做并发压测。
- **依赖与供应链**：未运行 `npm audit`/SBOM；项目几乎零运行时依赖，但构建工具（zig）未锁定校验和。
- **日志脱敏**：未验证生产日志是否会写入消息正文；本轮日志只记录状态/时延/计数。

## 3. 发布回归（实际）

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `npm test` | **1065/1065**，循环依赖 0，约定 0 | `logs/S6-npm-test.log` |
| C/Node v2 smoke | **17/17** | `logs/S6-v2-smoke.log` |
| 浏览器 E2E | **30/30** | `logs/S6-e2e-browser.log` |
| TTS 自检 | **9/9** | `logs/S6-tts-selftest.log` |
| 语义 C/Node parity | **120/120** | `logs/S6-semantic-parity.log` |
| 检索 bm25 C/Node parity | **120/120** | `logs/S6-retrieval-parity.log` |
| 安全冒烟 | **10/10** | `logs/S6-security.log` |
| 数据集校验 | PASS | `logs/S6-quality-validate.log` |
| 语义 test | 96.7% / Macro-F1 0.960 / unsafe 0 | `quality/reports/semantics-test-2.1.*` |
| 检索 test hybrid | Recall@5 53.3% / MRR 0.595 / 引用错误 0 | `quality/reports/retrieval-test-hybrid-2.1.*` |
| 模拟 test | 30/30 | `quality/reports/practice-test-2.1.*` |

## 4. 部署

```powershell
# 生产式启动（C，默认仅回环）
npm start
# Node 参考实现（含 semantic/hybrid 检索与 L2 适配器）
npm run start:node
# 首次或课程正文变更后重建索引
npm run quality:index
```

- 默认 `HOST=127.0.0.1`，不要直接暴露公网。
- `.env` 只放本机，权限应限制为当前用户；不要提交。
- 失败回退：模型不可用时截图/教练接口返回 502/503 并提示手动粘贴；不影响本地课程与规则分析。

## 5. 回滚

### 5.1 C 二进制（可精确回滚）

```powershell
# 停止服务后
Copy-Item heartflow-c\hf.pre-v2-20261113.exe heartflow-c\hf.exe -Force   # 回到 2.0
# 或回到 S6 前（仍是 2.1 语义/练习改动，但无点文件加固）
Copy-Item heartflow-c\backups\hf-pre-s6-20261114.exe heartflow-c\hf.exe -Force
# 校验
Get-FileHash heartflow-c\hf.exe -Algorithm SHA256
```

### 5.2 Node/源码（部分可回滚）

- `server/staticServer.js` 是跟踪文件，可用 `git checkout -- server/staticServer.js` 回到 2.0；但这会重新引入 `/.env` 200 SPA 回退风险。
- `server/v2.js`、`server/semantic-review.js`、`heartflow-c/src/server/v2.c`、`heartflow-c/src/server/static.c`、`quality/`、`docs/heartflow-2.1/` 在 S0 时已是未提交/未跟踪状态，**本轮没有生成 2.0 源码快照**。因此 Node 源码无法仅靠 git 精确回滚到本轮开始前；需要用户自有的未提交备份，或按 `02/03/04` 文档逆向修改。
- 数据无迁移：删除 `public/love-learning/semantic-index/` 与 `quality/reports/` 不影响原有 179 课与离线功能。
- `.env` 未修改。

**回滚状态：C 二进制 PASS；Node/源码 PARTIAL（缺少 2.0 源快照）。**

### 5.3 回滚后验证

```powershell
npm test
python heartflow-c\tests\v2-smoke.py heartflow-c\hf.exe
node scripts\e2e-heartflow-v2.mjs
```

## 6. 发布门禁

- 自动测试、C/Node 契约、E2E、安全冒烟：PASS。
- 真实模型/视觉：单次成功路径 PASS；语音、故障、成本：BLOCKED。
- 独立人工标注、盲评、kappa/alpha：BLOCKED。
- C 端 semantic/hybrid：明确降级，不能宣称获得混合检索收益。
