# S5 真实供应商验收

日期：2026-11-14  
证据：`docs/heartflow-2.1/logs/S5-real-provider.log`、`S5-synthetic-chat.png`

## 1. 配置

| 项 | 值 |
| --- | --- |
| Endpoint | `https://token-plan-cn.xiaomimimo.com/v1/chat/completions` |
| API 模式 | `chat_completions` |
| 模型 | `mimo-v2.6-flash` |
| 密钥 | 已配置（51 字符）；本文与日志不记录密钥 |
| 数据类型 | 原创合成文本/图片，不含真实聊天、姓名、电话、地址或截图 |

## 2. 实际结果

| 测试 | 请求 | HTTP | 单次时延 | 结果 |
| --- | --- | --- | --- | --- |
| 基础文本 | 一句不施压拒绝邀约的示范 | 200 | 2.9 s | 返回中文示范，`content` 27 字 |
| JSON 约束 | `response_format=json_object`，要求 `{"decision":"OBSERVE"}` | 200 | 15.4 s | JSON 可解析，`decision=OBSERVE` |
| 真实视觉 | 合成聊天 PNG（720×240，5,105 bytes）经 `/api/v2/imports/screenshot`，`remote_consent=true` | 200 | 15.8 s | `source=remote_vision`，识别 2 条消息，说话人 user/other 正确 |

前一轮补充测试也成功：基础文本 3.1 s / 10.1 s，JSON 75.8 s / 2.1 s，视觉 6.2 s / 20.6 s。JSON 首轮 75.8 s 说明长推理输出波动明显；前端 120 s 超时是必要的。

识别结果（合成图）：

```text
user: A: 周末有空吗?
other: B: 这周有点忙，改天吧。
```

标点由模型从中文全角改为半角/问号，属于可接受的 OCR 归一化，但 UI 仍应要求逐条核对。

## 3. 未完成 / 阻塞

| 项 | 状态 | 原因 |
| --- | --- | --- |
| 真实语音合成（ChatTTS/Kokoro） | **BLOCKED_EXTERNAL_VALIDATION** | `127.0.0.1:5001` 无 sidecar，连接被拒绝；C `tts selftest` 9/9 只验证本地 WAV 生成与文本分段，不是真实语音服务 |
| 真实语音识别/麦克风 | **BLOCKED_EXTERNAL_VALIDATION** | 未启动 ASR 服务，未采集真人音频 |
| 真实供应商故障/限流/超时回退 | **BLOCKED_EXTERNAL_VALIDATION** | 未做故障注入；只验证成功路径 |
| 真实供应商成本与配额 | 未计量 | 未记录 token 账单；不能承诺成本 |
| 多供应商兼容 | 未验证 | 只测 MiMo chat_completions，未测 Responses/OpenAI 兼容差异 |
| 真实视觉多样图片 | 未验证 | 只有 1 张合成图；未测模糊、长截图、群聊、深色模式、表情/图片消息 |

## 4. 安全与隐私

- 截图必须先 `remote_consent=true`，否则 400 `consent_required`，不调用模型（E2E 与安全冒烟均覆盖）。
- 视觉请求只发送当前图片与固定指令，不发送本地历史；但供应商仍会收到图片内容，UI 必须持续提示。
- 本轮使用的图片与文字均为合成，未上传任何用户数据。
- `.env` 不进静态目录，且静态服务器已拒绝点文件（S6）。

## 5. S5 门禁

- 真实文本模型：**PASS（单次成功路径）**。
- 真实 JSON 约束：**PASS（单次成功路径）**。
- 真实截图识别：**PASS（单张合成图）**。
- 真实语音/ASR/故障回退/成本：**BLOCKED_EXTERNAL_VALIDATION**。
- 不得把单次成功表述为稳定性、准确率或生产 SLA 已验证。
