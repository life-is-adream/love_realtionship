# 本地语音（双引擎 TTS）

完全离线的中文语音朗读：女方消息点「朗读」即可听到声音，也可在设置里开启「生成回复后自动朗读」。

两个引擎，随时切换：

| 引擎 | 模型 | 体积 | 运行位置 | 特点 |
|---|---|---|---|---|
| **ChatTTS 0.2.5** | GPT + Decoder + DVAE + Vocos + Embed | 约 1.2 GB 权重 + 约 3 GB 运行时 | RTX 3060（CUDA 12.1） | 拟真度高，自带停顿与语气词，像真人说话 |
| **Kokoro-82M** | ONNX 单文件 | 325 MB | CPU | 几乎瞬时出音，不占显存，兜底用 |

## 架构

```
浏览器 → Node 服务 (:3000, /api/tts) → Python sidecar (:5001, voice/tts_server.py) → ChatTTS(GPU) / Kokoro(CPU)
```

- Node 端：`server/voiceProxy.js`（转发 `engine` 字段 + 输入校验 + 未启动时的友好提示）
- Python 端：`voice/tts_server.py`（标准库 HTTP 服务，零 Web 框架依赖；双引擎单进程，默认引擎预热、另一个懒加载）
- 前端：`public/modules/voice/tts-client.js`（引擎/音色偏好、blob 缓存、播放控制）

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
| `GET /health` | 每个引擎的 `status / voices / device / loadSec / vramMb / sizeMb`，顶层另带默认引擎的兼容字段 |
| `GET /voices` | 默认引擎音色（兼容旧前端） |
| `POST /tts` | body `{text, engine?, voice?, speed?}` → `audio/wav`（24 kHz 单声道 16-bit），响应头含 `X-Tts-Engine` |
| `POST /api/tts`（Node） | 同 `/tts`，供前端同源调用 |

约束：单次 ≤ 300 字；speed 0.8–1.2（ChatTTS 映射为 `[speed_4..6]` 提示词）。

- ChatTTS 音色：`chat_wenrou / chat_qingliang / chat_chenwen / chat_yuanqi`（固定随机种子采样，重启后一致）
- Kokoro 音色：`zf_xiaobei / zf_xiaoni / zf_xiaoxiao / zf_xiaoyi`

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
| `HEARTFLOW_TTS_ENGINE` | `chattts` | 默认引擎（`chattts` / `kokoro`） |
| `HEARTFLOW_VOICE_ROOT` | `E:\heartflow-voice` | 模型根目录（必须纯 ASCII 路径） |
| `HEARTFLOW_CHATTTS_ROOT` | `%VOICE_ROOT%\chattts` | ChatTTS 权重目录 |
| `HEARTFLOW_CHATTTS_DEVICE` | `cuda` | `cuda` / `cpu`（无 CUDA 时自动回落 CPU） |
| `HEARTFLOW_CHATTTS_REFINE` | `[oral_2][laugh_0][break_4]` | 语气/停顿提示词，`[oral_N]` 越大越口语化 |
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

## 已知限制

- ChatTTS 是自回归生成，长句耗时随字数近似线性；一句话约 1–2 秒（3060 笔记本），长回复建议前端截断。
- ChatTTS 占约 2–3 GB 显存；与游戏同时开可能抢显存，此时可切回 Kokoro。
- 音色是随机采样出的说话人向量，不是真人录音克隆；同一个 seed 在本机可复现，换 GPU/CPU 会有细微差别。
- Kokoro 中文 G2P 走 espeak-ng 的 `cmn` 音素，个别多音字与语调可能不完美。
- 推理串行（两个引擎都不是线程安全的），同时点两条消息会排队。
- 语音输入（STT）未实现，可后续在 sidecar 增加 `/stt`（faster-whisper small 约 500 MB）。
