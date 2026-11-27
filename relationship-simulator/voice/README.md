# 本地语音（默认双引擎 TTS + 可选在线引擎）

默认完全离线的中文语音朗读：女方消息点「朗读」即可听到声音，也可在设置里开启「生成回复后自动朗读」。

默认两个本地引擎完全离线、不联网；第三个「微软神经语音」**音质最好但默认零联网**，
在设置面板点一次「启用在线语音」即可解锁，无需重启（见下方「在线引擎」）：

| 引擎 | 模型 | 体积 | 运行位置 | 特点 |
|---|---|---|---|---|
| **ChatTTS 0.2.5** | GPT + Decoder + DVAE + Vocos + Embed | 约 1.2 GB 权重 + 约 3 GB 运行时 | RTX 3060（CUDA 12.1） | 纯本地兜底，音质一般；自带停顿与语气词 |
| **Kokoro-82M** | ONNX 单文件 | 325 MB | CPU | 纯本地兜底，几乎瞬时出音、不占显存 |
| **微软神经语音**（一键启用） | Edge Neural TTS | 无本地权重 | 在线 | **听感验收通过**：2 个未经变调的原生中文女声；**合成时文本会离开本机** |

> 2026-11-07 两轮结论（第二轮推翻了第一轮的选型）：
> ① **客观海选**：旧 4 个 ChatTTS 音色是随机种子碰运气采出来的，默认 F0 154Hz 偏闷；
> `[oral_2][laugh_0][break_4]` 会把频谱平坦度从 0.054 推到 0.110，故换干净口令、扩到 8 个离线音色，
> 并接入音质更高的在线引擎。
> ② **真人听感验收**：F0 / 亮度 / 平坦度只能筛「干净」，**筛不出「好听」**。离线 8 个与在线 7 个
> 变调音色全部未通过，只有 2 个零变调的微软原生女声（温柔 · 自然 / 元气 · 明亮）被认可。
> 因此产品音色表收敛为「2 个主推 + 4 个离线兜底」，其余降级为试听页反例，不再出现在下拉框。
> 全部 46 个真实样本见 `voice/lab-out/试听.html`（`python voice/voice_lab.py html` 可重建）。

## 架构

```
浏览器 → C 服务 (:3000, /api/tts, /api/tts/online) → Python sidecar (:5001) → ChatTTS(GPU) / Kokoro(CPU) / [Edge(在线, 一键启用)]
         ↑ 文本清洗 / 校验 / RMS 归一化 / WAV 封装 / 开关转发        ↑ 只剩「加载模型 + 推理」
```

- **C 端**：`heartflow-c/src/voice/tts.c` + `src/server/routes.c` 的 `/api/tts`。负责 300 字上限、engine 白名单（含 `edge`）、语速钳制、去舞台提示/emoji、标点归一、RMS 响度归一化、16-bit WAV 封装。与 Python 原实现逐字节对照（`heartflow-c/tests/tts-parity.py`，8 组 WAV 完全一致）。
- **Python 端**：`voice/tts_server.py` 仍用标准库 HTTP（零 Web 框架），多引擎单进程；C 版请求带 `format=pcm` 时只回 raw float32，把 WAV 那一步交给 C。不带该字段时仍是原来的 WAV 行为，旧前端/旧代理完全兼容。Edge 分支把 24kHz mp3 在内存里解码成 float32，因此三个引擎共用同一条 `format=pcm` 音频链路，C 侧不需要知道声音来自本机还是网络。
- **前端**：`public/modules/voice/tts-client.js`（引擎/音色偏好、blob 缓存、播放控制、在线开关）。在线引擎在 health 未报告它注册前保持禁用；勾选开关会先弹明示确认，避免静默把聊天文本送出本机。在线失败时自动回退 Kokoro 朗读，断网不会让按钮哑掉。
- `server/voiceProxy.js` 是 Node 参照实现，日常运行不再经过它。

**为什么模型推理不能一起搬到 C**：ChatTTS 依赖 PyTorch/CUDA，没有可用的 C 推理 API；Kokoro 虽是 ONNX，走 onnxruntime 的 C API 要引入 DLL 并复刻 phonemizer/音色查表，与「单二进制零依赖」冲突。详见 `heartflow-c/README.md`「已知边界」。

## 目录与体积

| 位置 | 内容 | 体积 |
|---|---|---|
| `E:\heartflow-voice\chattts\asset\` | ChatTTS 权重（sha256 与官方 HF 仓库逐一核对通过） | 1.22 GB |
| `E:\heartflow-voice\venv-chattts\` | Python 3.10 + torch 2.5.1+cu121 + transformers 4.44.2 | 约 4.5 GB |
| `E:\heartflow-voice\wheels\` | torch / torchaudio 离线 wheel（重装用） | 2.45 GB |
| `E:\heartflow-voice\models\kokoro-v1.0.onnx` | Kokoro 主模型 | 325 MB |
| `E:\heartflow-voice\models\voices-zh.bin` | 4 个中文女声（npz） | 2 MB |
| `E:\heartflow-voice\espeak-ng-data\` + `espeak-ng.dll` | 中文 G2P 数据 | 18 MB |
| `voice/venv/` | Kokoro 兜底环境（onnxruntime 等） | ~200 MB |

**为什么模型不在项目目录**：`espeak-ng.dll` 在 Windows 上无法处理含中文的路径（项目路径含「一门给年轻人的恋爱成长课」），会回退到编译期路径并崩溃（`Error processing file 'D:/a/...phontab'`）。因此模型、espeak 数据、torch 环境都放在纯 ASCII 路径 `E:\heartflow-voice`。可用环境变量 `HEARTFLOW_VOICE_ROOT` 覆盖。

## 启动

```bat
:: 双击项目根目录「启动语音服务.cmd」（会自动优先选装了 ChatTTS 的 venv），或手动：
E:\heartflow-voice\venv-chattts\Scripts\python.exe voice\tts_server.py
```

日志出现 `引擎 chattts 就绪，耗时 xx s，设备 cuda` 即可用（首次约 15–30 秒，之后有缓存）。端口 `127.0.0.1:5001`，仅本机可访问。

## API

| 端点 | 说明 |
|---|---|
| `GET /health` | 每个引擎的 `status / voices / device / loadSec / vramMb / sizeMb`，顶层另带默认引擎的兼容字段与 `onlineEnabled`。`edge` 只在开关解锁后列出，且带 `online: true`；前端据此解锁在线音色 |
| `GET /online` | 只读查询在线开关状态 `{"enabled": bool}`，不触发任何联网 |
| `POST /online` | body `{"enabled": bool}`，运行时解锁 / 关闭在线引擎；未解锁时 `POST /tts` 请求 `engine=edge` 一律 `403 online_disabled` |
| `POST /api/tts/online`（C 服务） | 前端同源开关入口；C 只转发一个布尔到 sidecar `/online`，不透传任意请求体 |
| `GET /voices` | 默认引擎音色（兼容旧前端） |
| `POST /tts` | body `{text, engine?, voice?, speed?, format?}` → `audio/wav`（24 kHz 单声道 16-bit），响应头含 `X-Tts-Engine`；带 `format: "pcm"` 时改为返回 `application/octet-stream` 的 raw float32 |
| `POST /api/tts`（C 服务） | 前端同源入口；C 侧清洗文本后带 `format=pcm` 请求 sidecar，自己完成 RMS + WAV 封装；若后端返回 WAV 则原样透传；白名单透传 `X-Tts-Engine` / `X-Tts-Latency-Ms`（2026-11-07 真实链路实测补齐，已纳入 `tts-proxy.py` 回归） |

约束：单次 ≤ 300 字；speed 0.8–1.2（ChatTTS 映射为 `[speed_4..6]` 提示词）。C 侧与 Python 侧都会做同样的上限与钳制。

- **ChatTTS（sidecar 保留 8 个；真人听感验收后，前端只暴露 `chat_qingche` / `chat_lengjing` 作离线兜底）**

| id | 标签 | seed | F0 / 亮度 / 平坦度 | 说明 |
|---|---|---|---|---|
| `chat_qingche` | 清澈 · 自然 | 666 | 163 / 1732 / 0.074 | ✅ 前端保留；离线默认 |
| `chat_yujie` | 清冷 · 御姐 | 42 | 139 / 1224 / 0.075 | 低沉、音高起伏小 |
| `chat_tianmei` | 甜亮 · 少女 | 65535 | 243 / 1540 / 0.096 | 离线可达的最高音 |
| `chat_lengjing` | 沉静 · 平稳 | 31 | 163 / 1076 / 0.050 | ✅ 前端保留；噪声最低、起伏最小 |
| `chat_wenrou` | 温柔 · 低缓 | 777 | 154 / 1334 / 0.086 | 旧默认，保留兼容 |
| `chat_qingliang` | 清亮 · 偏高 | 2024 | 242 / 1321 / 0.100 | 旧版 |
| `chat_chenwen` | 沉稳 · 中音 | 31415 | 142 / 2293 / 0.152 | 旧版 |
| `chat_yuanqi` | 元气 · 明亮 | 8888 | 229 / 1968 / 0.126 | 旧版 |

- **Kokoro（sidecar 4 个；前端 2 个）**：`zf_xiaoxiao / zf_xiaoyi`
- **微软神经语音（产品 2 个，另 7 个仅作试听反例）**：见下方「在线引擎」表。

**指标只是筛选依据，好不好听以人耳为准**：本轮客观指标（F0 / 亮度 / 平坦度）筛出的音色
在真人听感验收里几乎全军覆没，所以最终选型反过来以试听页为准，客观指标只用来排除明显噪声。
旧版本存过、已被淘汰的音色 id 会在读取偏好时自动落回该引擎首选音色，不会让旧配置卡在废音色上。

## 音色工坊

`voice/voice_lab.py` 把「挑音色」从拍脑袋变成可复现流程：批量采样说话人向量 → 用同一句测试文本真实合成 → 测客观声学指标 → 生成试听页。

```bat
E:\heartflow-voice\venv-chattts\Scripts\python.exe voice\voice_lab.py edge
E:\heartflow-voice\venv-chattts\Scripts\python.exe voice\voice_lab.py chattts --prosody
E:\heartflow-voice\venv-chattts\Scripts\python.exe voice\voice_lab.py html
```

产物 `voice/lab-out/`（已 gitignore）：46 个真实 WAV/MP3 样本、`meta.json` 指标、`试听.html`。
双击试听页即可 A/B，浏览器只读同目录音频，不联网、不上传。

| 指标 | 含义 | 怎么读 |
|---|---|---|
| `f0` | 基频中位数（Hz） | 低偏成熟、高偏稚嫩。ChatTTS 32 个种子实测只到 243Hz，做不出真萝莉音 |
| `brightness` | 频谱质心（Hz） | 越高越清亮；过低会发闷 |
| `flatness` | 频谱平坦度 | 越接近 1 越像噪声，干净人声通常 < 0.15；**mp3 样本不可与 WAV 直接比** |
| `f0Std` | 基频标准差 | 越大语调起伏越夸张；冷感人声要小 |

2026-11-07 实测结论：32 个 ChatTTS 种子里最干净的 `seed=1024` 平坦度 0.032 但亮度只有 914（偏闷），
所以产品没选它，而是取「明亮 × 干净」平衡的 `seed=666`。韵律对照还证明现网
`[oral_2][laugh_0][break_4]` 会把平坦度从 0.054 推到 0.110，故默认口令改为
`[oral_0][laugh_0][break_0]`（保留 refine 的自然句读，去掉口头禅与碎停顿）。

## 在线引擎（一键启用，默认零联网）

**2026-11-07 真人听感验收结论（别再走回头路）**：微软免费 read-aloud 端点下，普通话原生女声
只有 2 个——`zh-CN-XiaoxiaoNeural`（Warm，F0≈235Hz）与 `zh-CN-XiaoyiNeural`（Lively，F0≈289Hz）；
其余中文 voice 是方言 / 港台口音，不是「风格档位」。

曾用 SSML `pitch` 硬造「清冷御姐 −22Hz / 甜美萝莉 +52Hz」，也试过注入 `mstts:express-as`
情感风格。两条路都不成立：

| 做法 | 实测结果 |
|---|---|
| `pitch` 大幅变调 | 基频平移会连共振峰一起搬，音色从「真人」变成电音 / 卡通；真人听感判定不可用 |
| `mstts:express-as` | 端点直接拒绝，`calm / serious / affectionate / cheerful` 全部 `NoAudioReceived` |

所以产品只保留 2 个零 / 近零变调的原生音色（`voice_presets.py` 的 `EDGE_PRODUCT_IDS`）：

| id | 标签 | 底层音色 | pitch / rate | F0 实测 | 结论 |
|---|---|---|---|---|---|
| `edge_wenrou` | 温柔 · 自然 | `zh-CN-XiaoxiaoNeural` | 0 / 0 | 235 | **默认**，耐听、不挑文本 |
| `edge_yuanqi` | 元气 · 明亮 | `zh-CN-XiaoyiNeural` | +10Hz / +10% | 289 | 活泼备选 |

另外 7 条变调预设只留在 `voice_presets.py` / 试听页作**反例证据**，不进产品音色表；
`test/tts-client.test.mjs` 有断言锁住「产品音色变调不得超过 ±10Hz」，防止以后又加回去。
离线 ChatTTS / Kokoro 同样降级为「无网络兜底」，前端各只留 2 个相对能听的。

### 隐私边界与一键开关

合成时文本会离开本机发给微软，因此默认零注册、零联网：

- sidecar 默认 `ONLINE_ENABLED=false`：`/health` 不列 `edge`、不做启动预热（避免热身就发文本）；
- **服务端自己兜底**：未解锁时即便绕过前端直连 `127.0.0.1:5001` 请求 `engine=edge`，
  也会被 `403 online_disabled` 拒绝，不依赖前端自觉；
- 前端下拉框在 health 未报告 `edge` 前保持禁用。

启用**不用改环境变量、不用重启**：设置面板勾选「启用在线语音」→ 弹窗明示「文本会离开本机」→
确认后前端 `POST /api/tts/online {"enabled":true}` → C 转发到 sidecar `POST /online` →
自动切到 `edge_wenrou`。关掉开关立刻恢复纯离线。只有想开机即启用才需要环境变量：

```bat
set HEARTFLOW_TTS_ALLOW_ONLINE=1
E:\heartflow-voice\venv-chattts\Scripts\python.exe voice\tts_server.py
```

依赖 `edge-tts`（已装在 `venv-chattts`）与 PyAV（解码 mp3）。C 侧仍按 `format=pcm` 统一收音频，
不感知声音来自本机还是网络。产品的 `speed`（0.8–1.2）叠加到预设 `rate` 上（变速，不变调）。

## 录音克隆音色

> **状态：已停用（2026-10-22）。** 实测产物不可用：长文本字词漂移、延迟高（58 字 26 秒）、
> 音色保真度不达预期。前端音色表已移除，`voices/` 目录已清空；历史产物与工具保留在
> `E:\heartflow-voice\backups\` 与 `E:\heartflow-voice\`。要用回，把 `backups` 里的 json
> 改名放回 `voices/` 即可。以下内容保留作技术记录。

把一段参考录音变成可选音色，靠 `voices/*.json` 描述，服务启动时自动载入并出现在音色表里。

```bat
cd /d E:\heartflow-voice
venv-chattts\Scripts\python.exe make_voice_profile.py ^
  --audio "C:\Users\lenovo\Downloads\录音机-20261021-2216.m4a" ^
  --start 14.42 --dur 3.14 ^
  --text "反正就不停的冲刺，不停冲刺。" ^
  --id chat_myrec --label "录音 · 女声"
```

JSON 字段：`id / label / spkSmp / txtSmp / source / refStart / refSeconds / minTokPerChar / seed`。

生成时会自动跑一道验收（能量 / 频谱平坦度 / 基频偏差 / 频谱相似度），不达标就不写文件；
确认要写加 `--force`，只想写文件跳过验收加 `--no-verify`。基频偏差阈值是 4 个半音。

五个必须知道的约束（都是实测踩出来的）：

1. **`txtSmp` 必须是参考音频的真实内容**，占位文本会让模型直接返回空音频。文本不必逐字精确，但音节要大致对得上；没有转写可用 `asr_transcribe.py`（本地 faster-whisper，模型已缓存在 HF hub）。
2. **`min_new_token` 必须给下限**。带音频提示时模型会在 prompt 收尾处直接给 EOS，不设下限只念半句（实测 19 字只出 0.84s）。服务端按「本句字数 × `minTokPerChar`」计算。
3. **克隆音色必须逐句合成**。两句放进同一批，输出会变成「第一句 + 第一句的重复 + 噪声」，第二句直接丢失。因此克隆音色的延迟明显高于内置音色（58 字约 26 秒）。
4. **采样种子决定成败，且必须逐次质检**。同一份 `spkSmp` 换个种子就在「清晰语音」和「噪声」之间跳变。服务端固定种子后生成，再用 RMS 与频谱平坦度自检，不达标自动换下一个种子重试（最多 4 次）。`tune_seed.py` 可离线搜种子。
5. **`voices/` 下同 id 多个文件会互相遮挡**。曾被一份 `_backup_xxx.json` 顶掉正式音色，导致测试的一直是旧音色。现在只认 `{id}.json`，其余忽略并告警；备份请放到 `E:\heartflow-voice\backups`。

**能力边界（重要）**：ChatTTS 的音频提示迁移的是频谱包络与音高走向，长文本的中后段仍会漂移——参考音频的文本会渗进输出，四句以上实测出现字词错乱。这与官方把「零样本音色克隆」列为未实现功能一致。当前可用的区间是单句到两句；要稳定复刻某个人的音色，需换成专为克隆设计的引擎。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `HEARTFLOW_TTS_ALLOW_ONLINE` | `0` | 设 `1` 则开机即解锁在线 `edge`；**会让合成文本离开本机**。日常推荐用设置面板的一键开关（运行时生效、无需重启），详见「在线引擎」 |
| `HEARTFLOW_TTS_ENGINE` | `chattts` | 默认引擎（`chattts` / `kokoro` / `edge`，但 `edge` 需同时开启上一项） |
| `HEARTFLOW_VOICE_ROOT` | `E:\heartflow-voice` | 模型根目录（必须纯 ASCII 路径） |
| `HEARTFLOW_CHATTTS_ROOT` | `%VOICE_ROOT%\chattts` | ChatTTS 权重目录 |
| `HEARTFLOW_CHATTTS_DEVICE` | `cuda` | `cuda` / `cpu`（无 CUDA 时自动回落 CPU） |
| `HEARTFLOW_CHATTTS_REFINE` | `[oral_0][laugh_0][break_0]` | 语气/停顿提示词。`[oral_N]` 越大越口语化（会插口头禅）、`[break_N]` 是停顿密度；2026-11-07 实测旧值 `[oral_2][laugh_0][break_4]` 噪声偏多，已降为干净值 |
| `HEARTFLOW_CHATTTS_SKIP_REFINE` | `0` | 设 `1` 跳过文本润色（快约 30%，但少了自然停顿） |
| `HEARTFLOW_CHATTTS_MIN_TOK_PER_CHAR` | `9.4` | 录音克隆的每字音频码下限，折算约每秒 5 字；调小更快但可能吞字 |
| `HEARTFLOW_CLONE_MAX_TRIES` | `4` | 克隆音色质检不达标时的最多重试次数（每次换种子） |
| `HEARTFLOW_CLONE_MIN_RMS` | `0.004` | 质检下限：RMS 低于此值判为噪声 |
| `HEARTFLOW_CLONE_MAX_FLATNESS` | `0.15` | 质检上限：频谱平坦度高于此值判为噪声（浊音语音通常 0.05–0.12） |

## 重建步骤

### ChatTTS 环境

```bat
:: 1. venv 用系统 Python 3.10（torch/transformers 生态兼容性最好）
C:\Users\lenovo\AppData\Local\Programs\Python\Python310\python.exe -m venv E:\heartflow-voice\venv-chattts

:: 2. torch（CUDA 12.1）：NJU 镜像实测 7-12 MB/s，比官方快 40 倍
::    https://mirrors.nju.edu.cn/pytorch/whl/cu121/torch-2.5.1%2Bcu121-cp310-cp310-win_amd64.whl
::    https://mirrors.nju.edu.cn/pytorch/whl/cu121/torchaudio-2.5.1%2Bcu121-cp310-cp310-win_amd64.whl

:: 3. 依赖（PyPI 走 NJU 索引，pip 直连 files.pythonhosted.org 会被 SIGTERM 打断）
::    numpy<2.0  numba==0.60.0  pybase16384  tqdm  transformers==4.44.2  vocos  vector-quantize-pytorch
::    ChatTTS==0.2.5 必须 --no-deps，否则它会把 torch 换成 CPU 版
::    最后补 kokoro-onnx onnxruntime espeakng-loader —— 一个解释器跑双引擎

:: 4. 权重：ModelScope 镜像 AI-ModelScope/ChatTTS（HF 镜像 429 限流）
::    https://modelscope.cn/api/v1/models/AI-ModelScope/ChatTTS/repo?Revision=master&FilePath=asset/gpt/model.safetensors
::    共 9 个文件，见下方校验表；GPT.pt / *.pt 是老格式，safetensors 版本不需要
```

### 权重校验（`ChatTTS/res/sha256_map.json` 官方值）

| 文件 | 大小 | sha256 前缀 |
|---|---|---|
| `asset/gpt/model.safetensors` | 853 MB | `cd0806fd` |
| `asset/Embed.safetensors` | 146 MB | `2ff0be71` |
| `asset/Decoder.safetensors` | 104 MB | `77aa55e0` |
| `asset/DVAE.safetensors` | 60 MB | `1d0b044a` |
| `asset/Vocos.safetensors` | 54 MB | `07e55614` |
| `asset/gpt/config.json` | 762 B | `0aaa1ecd` |
| `asset/tokenizer/tokenizer.json` | 449 KB | `843838a6` |
| `asset/tokenizer/tokenizer_config.json` | 11 KB | `43e9d658` |
| `asset/tokenizer/special_tokens_map.json` | 8 KB | `bd0ac9d9` |

`Chat.load(source="custom")` 会自己做 sha256 校验，任一不符会直接拒绝加载（报 `check models in custom path failed`）。

### Kokoro 环境

```bat
python -m venv voice/venv
voice\venv\Scripts\python.exe -m pip install --no-index --find-links voice/wheels --no-deps voice/wheels/*.whl
:: 模型：https://hf-mirror.com/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model.onnx
:: 中文音色 voices/zf_*.bin（raw float32 510x1x256，用 numpy 合成 npz）
```

## 2026 本地 TTS 上限实验（Qwen3-TTS · 独立环境，未接入产品）

调研结论与完整数据见 `docs/verification/2026-11-07-3060-tts-capability.md`；
试听页 `voice/lab-qwen/试听.html`。首轮 20 个样本（16 本地 + 4 旧基线），
**第三轮听感验收后收敛为 13 个**（9 个 VoiceDesign 描述样本 + 4 个旧基线）。

**这不是产品里的第四个引擎**，是独立实验：不改动 `tts_server.py`、C 服务与前端，
权重和 Python 环境都放在 `E:\heartflow-voice\`（仓库外），不影响默认纯离线链路。

| 模型 | 权重 | 显存峰值 | 单句 | 能力 |
|---|---|---|---|---|
| Qwen3-TTS 0.6B-CustomVoice | 1.82GB | 2.4GB | 29–43s | 9 个官方音色，中文女声 2 个，无指令控制（**试听页已下线**） |
| Qwen3-TTS 1.7B-VoiceDesign | 4.52GB | **4.4GB** | 23–39s | **自然语言描述直接设计音色**，首轮 F0 实测 173–396Hz |

- 工具：`voice/qwen_lab.py`（`design` / `html` / `all`；增量加样本用
  `design --only id1,id2`），环境与下载器在
  `E:\heartflow-voice\{venv-qwen, qwen_fetch.py, _probe_qwen.py}`。用独立 venv + `.pth`
  复用已有 CUDA torch，不污染 ChatTTS 环境。
- 必须 **bf16 + sdpa**：fp16 会在采样阶段触发 CUDA device-side assert；Windows 无官方 flash-attn。
- **描述不等于音色 ID**：同一「清冷御姐」描述两次合成 F0 168Hz / 203Hz。要固化角色声线，
  需按官方做法「设计参考音频 → Base 模型克隆 → 保存 prompt」，另需约 3.4GB 权重。
- 性能代价明显（单句 30s 上下，对比 ChatTTS 5–12s、Kokoro 2s），
  适合离线预生成而非聊天实时朗读；是否接入产品待听感验收后决定。

### 第三轮听感验收（2026-11-07 晚）

boss 在试听页给出三条结论，已按此收敛。**只下线、不删 WAV**：淘汰样本由 `qwen_lab.py`
的 `prune()` 归档到 `lab-qwen/_retired/`，随时可回滚。

| 处置 | 对象 | 原因 |
|---|---|---|
| 整组下线 | 0.6B-CustomVoice 的 9 个官方预置音色 | 中文女声只有 2 个，其余是男声 / 其它语种对照，不是产品候选 |
| 下线 | 「知性 · 沉静」 | 听感未通过 |
| 判废 → 换候选 | 「甜美 · 萝莉」 | 「声音不对」；boss 要的是原神可莉那种音色 |

「可莉向」**不是角色克隆**，也没有用任何游戏音频——模型不认识游戏角色，把角色名写进描述
只会引入噪声。做法是把目标拆成声学特征，用 4 个候选覆盖不同侧重点：
A 天然童声（脆亮不刺耳、无刻意卖萌）、B 蹦跳元气（语速快、语调跳跃、兴奋感）、
C 奶气软糯（轻微鼻音、咬字稚气）、D 用 B 的描述换一句角色化台词，只用来判断像不像。
关键修正是**去掉发嗲**：旧描述写的是「黏人、做作又刻意卖萌」，走的是撒娇方向；
可莉是「天然小孩、精力过剩」，两者不是一回事。

新增一律用 `design --only ...` 增量合成，绝不重跑整组：VoiceDesign 每次即兴构造说话人，
重跑会让已经听过的样本悄悄变声（实测同一「清冷御姐」描述两次 F0 168 / 203Hz）。

## 角色音色（2026-11-07 新增，个人非商用）

`engine=character` 是第四个引擎，把可莉中文原声 / 蝴蝶忍日语声线接入网页
（可莉参考音频是角色包自带的真实游戏原声；蝴蝶忍参考音频是第三方公开的 RVC 推理试听，
AI 生成、非动画原声）。
推理落在独立进程 `voice/character_voices/character_server.py`（:5002，
`venv-qwen` + Qwen3-TTS-12Hz-1.7B-Base 零样本克隆），本 sidecar 只做 HTTP 代理。
链路、下载的资源、许可、启动方式与参考音频替换方法见
[`voice/character_voices/README.md`](character_voices/README.md)。

- 新增环境变量：`HEARTFLOW_CHAR_TTS_URL`（默认 `http://127.0.0.1:5002`）、
  `HEARTFLOW_CHAR_TTS_TIMEOUT`（默认 240 秒）。
- 启动 `启动语音服务.cmd` 时会探测一次 5002；未启动则 `character` 在 `/health` 中为
  `error`，前端下拉框保持禁用，不会静默把请求丢给别的音色。
- 角色引擎占约 4.4GB 显存，**不要与 ChatTTS 同时预热**；要用角色音色时把
  `HEARTFLOW_TTS_ENGINE` 设为 `kokoro`。
- `speed` 在角色引擎被忽略；单句合成约 20–40 秒，适合点选朗读而非实时对话。
- 角色语音版权归原版权方，模型多为 CC-BY-NC / 未声明许可，**禁止商用与再分发**。

## 已知限制

- ChatTTS 是自回归生成，长句耗时随字数近似线性；一句话约 1–2 秒（3060 笔记本），长回复建议前端截断。
- ChatTTS 占约 2–3 GB 显存；与游戏同时开可能抢显存，此时可切回 Kokoro。
- 音色是随机采样出的说话人向量，不是真人录音克隆；同一个 seed 在本机可复现，换 GPU/CPU 会有细微差别。
- **现有三套引擎里仍没有可用的御姐 / 童声声线**：ChatTTS 32 个种子 F0 上限约 243Hz，做不出童声；微软免费端点只有 2 个普通话原生女声，变调硬造会连共振峰一起搬（听感判废），`mstts:express-as` 又被端点直接拒绝。本地 Qwen3-TTS-VoiceDesign 已在本机 3060 Laptop 上覆盖 F0 173–396Hz（全程离线），但**首轮「甜美 · 萝莉」396Hz 那档真人听感判废**——高 F0 不等于好听，已换成「可莉向」候选重新试听，见上一节；目前仍是独立实验，未接入产品。
- 在线 `edge` 需要联网且文本会离开本机，默认零注册、零联网、零预热；普通话原生女声数量由微软侧决定（2026-11-07 为 2 个）。产品只暴露这 2 个，不做变调。
- Kokoro 中文 G2P 走 espeak-ng 的 `cmn` 音素，个别多音字与语调可能不完美。
- 推理串行（两个引擎都不是线程安全的），同时点两条消息会排队。
- 语音输入（STT）未实现，可后续在 sidecar 增加 `/stt`（faster-whisper small 约 500 MB）。
