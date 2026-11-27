# 蝴蝶忍角色音色评测台

目的：在**不引入新权重**的前提下，量化优化现有 Qwen3-TTS 零样本克隆链路。按 P0（延迟）→ P1（相似度 / 说话方式）→ P2（少样本微调触发判断）推进。全部本机离线，不调用在线服务。

运行环境固定：`E:\heartflow-voice\venv-qwen\Scripts\python.exe`（Python 3.10 / torch 2.5.1+cu121 / RTX 3060 Laptop 6GB）。所有命令在项目根目录 `relationship-simulator` 下执行。

> ## ⚠️ 先读：配置漂移（2026-11-08）
>
> 用户已更换蝴蝶忍音色，**当前生产配置**（`voice/character_voices/characters.json`）：
>
> | 项 | 当前值 | 旧值（本评测台历史数据所用） |
> |---|---|---|
> | 参考音频 | `refs/shinobu_sleep_ref.wav`（《睡眠.wav》，日语，4.32s / 48kHz 单声道） | `refs/shinobu_ref.wav`（妙音站 RVC 推理输出，8.0s / 24kHz） |
> | `language` | `Chinese` | `Japanese` |
> | `xVectorOnly` | `true`（`refText` 为空） | `true` |
> | `refs.json` 编号 | `R5_sleep`（匿名 E，默认关闭） | `R1_main8s`（匿名 A） |
>
> **`BASELINE.md` / `LANGTAG.md` / `PROSODY.md` 以及 `out/` 下全部音频，都是旧配置下的历史实验**，只可用于方法学参考，**不能当作当前音色的结论**。特别是「维持 `Japanese` 标签」这条结论在新参考上未复验。
>
> 评测脚本默认 `--lang-tag role` 刻意固定 `Japanese`，以保住历史数据的可复现性。要评测**当前生产**，须显式：
>
> ```bat
> %PY% %EV% run --refs R5_sleep --lang-tag current
> %PY% %EV% prosody --refs R5_sleep --lang-tag current --cases zh_m01,ja_m01 --repeat 2
> ```
>
> `current` 从 `characters.json` 实时读取 `language`，不再硬编码。`role` 与 `current` 不可混用同一份 `results.json` / `prosody/results.json`：WAV 文件名不含标签与参考 id，换配置重跑会覆盖旧基线音频，务必先备份 `out/`。

## 一、流式结论（2026-11-07 源码核查）

`qwen_tts==<本机安装版>` 的 `inference/qwen3_tts_model.py::generate_voice_clone`：

- 返回 `Tuple[List[np.ndarray], int]`，一次性给完整波形，**没有 generator / yield / streaming 输出接口**。
- `non_streaming_mode` 的官方 docstring 原文：「this option currently only simulates streaming text input when set to `false`, rather than enabling true streaming input or streaming generation」。默认值为 `False`。
- 当前三层链路 `C :3000 → tts_server.py :5001 → character_server.py :5002` 全部使用 `Content-Length` 完整响应，无 chunked / SSE。C 侧 `route_tts` 虽有 `hf_tts_split` 分句函数，但只用于 CLI 测试，未接入 `/api/tts`。

**结论：3 秒首音频目标不能靠真流式实现。** 当前接口下「首音频延迟」= 「完整生成时间」，报告中记为 `ttfaSec` 并标注 `ttfaEqualsSynth=true`。唯一可行路径是工程分段：把回复按句切短、第一段先合成先播放、后续段后台预取。`3 秒` 是优化指标而非现有硬件的性能承诺，是否可达由 `probe` 的分句实验实测决定。

**S2 已落地（2026-11-09）**：`public/modules/voice/speech-segments.js` 提供纯函数分段口径，`tts-client.js` 对 `character` 引擎实现「首段到达即播 + 播放期间预取下一段 + 段间 400ms 留白 + 可中断」，其它引擎仍整段一次请求。对照试听见 `public/voice-demo/index.html` 的「S2 首响对照」区，端到端实测数据与落地清单见 **`S2.md`**（首响 22.67s → 12.11s，−46.6%，总时长持平）。前端分段走 `/api/tts` → `characters.json`，**因此自动使用当前最新音色**。

## 二、五个子命令

```bat
set PY=E:\heartflow-voice\venv-qwen\Scripts\python.exe
set EV=voice\character_voices\eval\evaluate.py

:: P0：延迟矩阵（文本长度 × non_streaming_mode）+ 分句首段实验
%PY% %EV% probe --both-modes

:: P1：小规模冒烟（3 个历史参考音频 × 前 2 句，验证框架）
%PY% %EV% run --limit 2 --lang zh,ja

:: P1：历史全量评测（3 参考 × 20 句 = 60 次合成，按当前速度约 15–30 分钟）
%PY% %EV% run

:: 当前生产配置评测（新参考 + 新标签；先备份 out/！）
%PY% %EV% run --refs R5_sleep --lang-tag current

:: 历史样本补统一响度（不重跑推理；新版 run 已内置，仅老数据需要）
%PY% %EV% normalize

:: 汇总：盲听试听页 + 主观评分表 + 答案表
%PY% %EV% report

:: 语言标签 2x2 严格对照（独立目录，不覆盖盲听基线）
%PY% %EV% langtag --cases ja_s01,zh_s01,ja_m01,zh_m01 --tags j,c --refs R1_main8s --repeat 2

:: 说话方式零成本改进对照（历史配置，5 变体）
%PY% %EV% prosody --cases zh_m01,ja_m01 --refs R1_main8s --repeat 2

:: 说话方式对照（当前生产配置）
%PY% %EV% prosody --refs R5_sleep --lang-tag current --cases zh_m01,ja_m01 --repeat 2

:: S2 整句 vs 分段端到端对照（需先启动 :5002 / :5001 / :3000）
:: 分段口径直接调生产模块 speech-segments.js；启动前从 :5002/health 记录当前 ref/language
%PY% voice\character_voices\eval\e2e_s2.py --text "稍微休息一下也没关系的，我会在这里陪着你。"
```

`run` 默认 **skip-existing**：结果逐条落盘，中断后重跑同一命令会跳过已完成项。要全部重算加 `--force`。其它常用参数：`--refs R1_main8s,R2_vm2p5s`（新参考为 `R5_sleep`）、`--cases ja_l01,zh_l01`、`--lang ja`、`--non-streaming true`。

⚠️ **不要直接用 `run --lang-tag Chinese` 做标签对比**：`run` 的 WAV 文件名只含 `refId + caseId`，不含标签，会**覆盖 P1 盲听基线音频**。语言标签对照一律走 `langtag`（`--tags j,c,a`，输出到 `out/langtag/`）。实测结论见 `LANGTAG.md`（旧配置）。同理，`run --lang-tag current` / `prosody --lang-tag current` 与历史数据混跑也会覆盖音频，先备份 `out/`。

⚠️ **长评测用后台任务跑**：本机前台长命令曾被瞬时 `SIGTERM`，且残留 Python 进程不退出会与后续任务争抢 6GB 显存（表现为 10 分钟跑不完一次合成）。启动前先确认无同名 `evaluate.py` 残留进程。`prosody` 参数：`--gap-ms`（段间静音，默认 400）、`--slow`（变速 rate，默认 0.87）。实测结论见 `PROSODY.md`（旧配置）。

**两份已完成的路线结论（均基于旧参考 `R1_main8s` + `Japanese` 标签）**：`LANGTAG.md` —— 当时维持 `Japanese` 标签，改中文标签会让声纹与说话方式退化；`PROSODY.md` —— 分段+400ms 留白是唯一声纹无损的有效手段，变速后处理会让 `speakerCos` 掉 0.023，**不推荐**。两者均为评测实验，未改动生产推理代码；换音色后需按上节命令复验。

## 三、评测集与变量

- `cases.json`：固定 **10 句中文 + 10 句日语**，按短 / 中 / 长分层，覆盖轻柔、克制、清晰、停顿与「温柔中带一点锋利」五个语气维度。台词是聊天回复场景，不修改既有句子以保证跨轮可比。
- `refs.json`：3 个启用的历史候选 + 2 个默认关闭的条目。
  | 匿名 | ref_id | 时长 | 来源 | 默认 |
  |---|---|---|---|---|
  | A | `R1_main8s` | 8.0s | 旧生产参考（妙音站「推理后」wav 0.5s 起），P1 盲听基线 | 启用 |
  | B | `R2_vm2p5s` | 2.5s | voice-models 用 geekdom 模型生成的样本 | 启用 |
  | C | `R3_alt6s` | 6.0s | 同 R1 源音频的另一片段（3.0s 起），检验片段选取的影响 | 启用 |
  | D | `R4_other8s` | 8.0s | 备用，需先生成 | 关闭 |
  | E | `R5_sleep` | 4.32s | **当前生产参考**（《睡眠.wav》，48kHz 单声道，未重采样） | 关闭 |
- 语言标签变量：`role`（默认）= 历史生产 `Japanese`，**中文句子也用日语标签念**（跨语言克隆），用于复现 `BASELINE` / `LANGTAG` / `PROSODY`；`current` = 读 `characters.json`，当前为 `Chinese`。`langtag` 子命令已完成 4 句 × 2 标签 × 2 重复的严格对照，**旧配置下的结论是维持 `Japanese` 标签**：改成 `Chinese` 会让中文中句 `speakerCos` −0.013、`f0` −63Hz、语速 +21%，与「轻柔克制」目标相悖；唯一收益是延迟 −21.4%。详见 `LANGTAG.md`。**该结论在新参考 `R5_sleep` 上尚未复验**，而生产已改为 `Chinese`，请勿据此回退生产配置。

## 四、指标口径

| 指标 | 含义 |
|---|---|
| `ttfaSec` / `synthSec` | 首音频延迟 / 完整生成时间；本接口下二者相同 |
| `rtf` | 生成耗时 / 音频时长，<1 表示快于实时 |
| `speakerCos` | 参考音频与生成音频在模型自带 `speaker_encoder` 上的嵌入余弦相似度。**只作相对排序**，不等同于人耳相似度 |
| `f0` / `f0Std` | 基频中位数 / 起伏；`f0Std` 小对应「克制」 |
| `brightness` / `flatness` / `rms` | 频谱质心 / 平坦度 / 能量，反映明暗与气声 |
| `pauseCount` / `longestPauseSec` | ≥0.15s 的句内停顿次数与最长停顿，量化「换气与留白」 |
| `charsPerSec` | 字符数 / 有声时长，语速代理；蝴蝶忍应偏慢且稳 |
| `silencePct` | 20ms 分帧静音占比 |

F0 / 亮度 / 静音口径与 `voice/voice_lab.py` 一致（SR=24000、FFT 自相关法），便于和历史实验室数据横向比较。所有生成 WAV 统一响度（RMS≈0.09、峰值留余量），消除「音量大显得好听」的盲听偏差；`normalize` 会同步重算声学指标，`speakerCos` 与延迟保持推理时的原始记录（余弦相似度对全局增益近似不变）。

主观评分由 `report` 生成 `评分表.csv`：音色相似度、自然度、语气贴合、日语发音各 1–5 分。`试听.html` 里参考音频以 A/B/C 匿名并排，`answer_key.csv` 才给映射，避免先入为主。**最终决策以听感为准，客观数值只作筛选。**

## 五、P2 少样本微调的触发条件

只有同时满足以下条件才值得考虑微调 Qwen3-TTS：

1. 3 个参考音频的 `speakerCos` 与主观音色分都已收敛，且最好候选仍明显不像角色；
2. 换语言标签、调整参考片段、文本/分段/后处理韵律手段（已实测，见 `LANGTAG.md` / `PROSODY.md`）、调整采样参数（`temperature` / `top_p` / `repetition_penalty`）都无效或未带来稳定收益；
3. 有合法持有、足够时长（通常 ≥ 数分钟）且干净的角色语音素材——当前参考音频是第三方 AI 推理输出或用户提供的短游戏语音片段，**不构成可用训练集**，微调会固化转换痕迹 / 样本过短；
4. 6GB 显存能承载训练（1.7B 全参微调基本不可行，只能 LoRA，且需要额外验证）。

在此之前，P1 的收益/成本比明显更高。

## 六、产物与边界

`out/` 全部是生成物，已加入根 `.gitignore`，不入库：`wav/`、`results.json`、`latency.json`、`试听.html`、`评分表.csv`、`answer_key.csv`、`refs/`、`langtag/`、`prosody/`、`s2_e2e/`（`e2e_s2.py` 的整句/分段 WAV 与 `results.json`，内含当次 `:5002/health` 记录的 ref / language，便于事后核对用的是哪版音色）。`e2e_s2.py` 与 `S2.md` 未被 `.gitignore` 忽略，可随评测台其它文件一起提交（当前整个 `eval/` 目录尚未纳入 git 跟踪），可重复执行。试听页用相对路径引用音频，直接双击 `out/试听.html` / `out/langtag/index.html` / `out/prosody/index.html` 即可播放，无需启动服务。网页服务副本位于 `public/voice-eval/`、`public/voice-langtag/`、`public/voice-prosody/`（同样不入库），需带完整 `index.html` 访问。S2 首响对照页位于 `public/voice-demo/index.html`。

参考音频与生成音频均为第三方公开 AI 推理试听片段 / 用户提供片段的衍生物，**非动画原声、无开源授权声明**。角色与语音版权归 Aniplex / ufotable / 集英社，声优早见沙织。仅限本机个人非商业评测，禁止分发；对外展示须标注为 AI 合成。
