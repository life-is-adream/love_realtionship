# HeartFlow v2 实际接口与数据契约

适用范围：Windows 本机 C 服务和 Node 参考服务；本次 JSON 路由 `schema_version` 为 `2.0`，浏览器档案为 `schemaVersion: 1`，规则量表为 `rubric_version: 1.1.0`。这是当前实现说明，不是对未来服务端持久化 API 的承诺。

## 路由

| 方法与路径 | 输入 | 主要输出 |
| --- | --- | --- |
| `POST /api/v2/imports/chat` | `text`，可选 `mode: chat\|event` | `source_type`、`messages`、`quality`、`warnings`。 |
| `POST /api/v2/imports/screenshot` | `image_data_url`、`self_side: left\|right\|unknown`、`remote_consent: true` | `source: remote_vision`、待纠错的 `messages` 与 `warnings`；会调用配置的图像模型。 |
| `POST /api/v2/analyses` | `messages`、可选 `source_type` | `source`、`observations`、`hypotheses`、`decision`、`memory` 与既有 `engine`。服务端覆盖输入授权和状态信号，本次不写长期记忆。 |
| `POST /api/v2/replies` | `messages` | `source: local_templates`、三个 `suggestions`。最后一条为用户消息时返回等待对方的错误。可选模型建议经原 `/api/chat`。 |
| `POST /api/v2/learning/recommendations` | `query`；可选 `limit`（1–10，默认 3） | `courses`：实际编号、标题、目标和匹配词；按课程标题、目标与正文的本地 BM25 相关度排序。 |
| `GET /api/v2/practice/scenarios` | 无 | 既有情境列表。 |
| `POST /api/v2/practice/sessions` | `scenario_id` | `scenario`、客户端持有的 `session`。 |
| `POST /api/v2/practice/turns` | `scenario_id`、`response`、`branch`、`difficulty`；可选 `history`（最近 5 条用户回复，每条 1–1200 字） | 本地预设的 `text`、`branch`、`ended`、`state`（`tension` 0–3、`repair` 0–3）。状态由客户端回传，服务器不持久化；连续施压会升高紧张并在 3 时结束，道歉/共情/留出选择空间会缓和。模型角色使用原 `/api/chat`，由页面维护对话。 |
| `POST /api/v2/practice/feedback` | `session`、`responses`（每项 `text`、`after_refusal`）、`retry` | 既有反馈加 `skillEvaluation`。每轮最多 6 条用户练习回复。 |
| `POST /api/v2/learning/weekly-plan` | 可选 `focus` 或最近的 `scores` | 选择来源、重点和三项任务；没有可用依据时 `needs_assessment: true`。 |
| `POST /api/v2/voice/feedback` | `duration_ms`、`pause_ms` 数组 | 停顿次数、总时长、最长值、均值和局限说明，不接受或保存音频。 |

这些路径使用无状态请求，不创建服务端档案资源；任务书的 `/practice/sessions/{id}/…`、`/memories` 和服务端授权记录等只是建议接口，尚未实现。新增 v2 在 Windows 拒绝非本机连接，带 `Origin` 的请求限当前本机端口；这不是用户身份认证，也不保护旧接口。

## 数据模型

| 模型 | 当前字段与约束 |
| --- | --- |
| `ChatMessage` | `id`（`msg_001` 等，按当前次序重建）、`speaker`（`user` / `other` / `unknown`）、`text`、`timestamp_text`、`timestamp`。单条不超过 2000 字；无效或无时区时间的 `timestamp` 为 `null`。 |
| `ChatImport` | `schema_version`、`source_type`、`messages`、`quality`、`warnings`。输入顺序不是经核实的真实时间顺序。 |
| `RelationshipObservation` | `id`、`type: user_supplied_text`、`speaker`、`claim`、`source_message_ids`。claim 是输入的截取，不表示客观真实性。 |
| `RelationshipHypothesis` | `id`、`claim`、`support_ids`、`counterevidence`、`unknowns`、`status`；`support_ids` 指消息 ID，反证与未知目前是文本。 |
| `RelationshipAnalysis` | `source`、`observations`、`hypotheses`、`decision`、`memory`、`engine`。`decision.category` 为 `OBSERVE`、`MAINTAIN`、`ADVANCE`、`DE_ESCALATE` 或 `EXIT`。 |
| `CourseReference` | `course_no`、`title`、`goal`、`matched_terms`；编号 1–179，与本机 manifest 和对应文件核对。不提供章节 ID。 |
| `ReplySuggestion` | `tone`、`text`、`reason`；结果需用户核对和修改。 |
| `PracticeScenario` | 来自既有场景目录；含 `id`、`title`、`context`、`boundary`、`roleInstruction` 等。 |
| `PracticeSession` | 由客户端暂存并随反馈请求提交的已有会话对象；服务器不保存，也不以它作为身份凭证。 |
| `SkillEvaluation` | 量表版本、`score`、`maximum`、`dimensions`。每项含 `id`、`applicable`、`status`、`score`、`reason`、`evidence`；证据引用 `practice_user_N`。自然度本地规则默认不评分。 |
| `MemoryConsent` | 当前没有服务端同名资源。浏览器档案的 `consent` 默认为 `false`；`false` 时规范化结果不保留该档案的事件、评分和摘要。服务端 v2 分析始终不写记忆。 |

浏览器档案可在用户主动保存后记录最多 30 条 `assessments`：`id`、上海日期 `date`、`scenarioId`、`rubricVersion: 1.1.0` 和已评分维度的 0–4 分值 `dimensions`；不包含练习原文、模型理由或原文证据。图表只连接相同场景、相同维度的记录，不能据此认定现实能力变化。

一般 POST 请求限制约 120 KB，截图请求限制约 1.8 MB；仅接受 JSON 对象并返回结构化错误。默认仅监听 `127.0.0.1`；Host 不是本机地址时返回 403 `host_forbidden`，`/api/*` 来源不是本机页面时返回 403 `origin_forbidden`。用户在模型和浏览器侧撤销同意无法撤回已经发送或已经展示的信息。若以后新增服务端持久化，必须先实现认证、授权、资源归属、独立账户隔离、迁移、备份与可验证删除，不能信任客户端提交的关系 ID。
