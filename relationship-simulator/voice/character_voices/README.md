# 角色音色（可莉 / 蝴蝶忍）· 本机个人非商用

在 HeartFlow 设置的语音引擎里选「角色音色 · 本地克隆」，即可用
`可莉 · 中文原声` 或 `蝴蝶忍 · 中文合成` 朗读聊天消息。蝴蝶忍沿用已确认的中文试听配置。

独立的双角色试听台（服务启动后访问）：`http://127.0.0.1:3000/voice-demo/index.html`
支持原声/克隆 A/B 对比、9 段样本播放、切换音色后输入任意文字现场合成。

> **许可边界（务必阅读）**
> 这些是社区公开的衍生模型/音频，**不是版权方授权的开源素材**。
> 可莉角色包为 CC-BY-NC（禁止商用、禁止再分发），训练语音版权归 COGNOSPHERE / miHoYo，
> 配音演员花玲；蝴蝶忍 RVC 模型页标注 `license:unknown`，角色语音版权归
> Aniplex / ufotable / 集英社，声优早见沙织。
> 蝴蝶忍的当前参考音频是用户提供的《睡眠.wav》，素材许可未核实。历史试听使用第三方 RVC 样本。
> 本项目按「本机个人学习、研究、自用、非商业」使用；**不得商用、不得分发权重或生成音频、
> 不得冒充官方**。米哈游官方素材使用公告亦要求角色配音仅限个人非商业使用并附版权声明。
> 参考此前生效判例：AI 复刻《原神》角色声音制售变声包被判赔 75 万元。

## 已下载并部署的资源

模型全部放在纯 ASCII 路径 `E:\heartflow-voice\models\`（项目路径含中文，espeak/torch 部分组件无法处理），项目内只保留配置与参考音频。

| 角色 | 资源 | 本地路径 | 体积 | 来源 / 许可 |
|---|---|---|---|---|
| 可莉 | GPT-SoVITS v4 中文角色包 | `E:\heartflow-voice\models\klee\v4\可莉_ZH\` | 231 MB（zip 213 MB） | [ModelScope aihobbyist/GPT-SoVITS_Model_Collection](https://modelscope.cn/models/aihobbyist/GPT-SoVITS_Model_Collection/summary)，CC-BY-NC，禁商用/禁再分发 |
| 可莉 | 中文原声参考音频（3.36s） | `voice/character_voices/refs/klee_ref.wav` | 316 KB | 同上角色包内 `reference_audios`，游戏原声、非合成 |
| 蝴蝶忍 | RVC v2 250 epochs 权重 + index（40 kHz / harvest F0） | `E:\heartflow-voice\models\shinobu\geekdom\` | 86.6 MB | [HF geekdom-tr/Kocho-Shinobu](https://huggingface.co/geekdom-tr/Kocho-Shinobu)，`license:unknown`，日语 |
| 蝴蝶忍 | RVC v2 600 epochs 备选权重 + index（48 kHz） | `E:\heartflow-voice\models\shinobu\kuma6\` | 65.7 MB | [HF Kuma6/Shinobu-Kocho](https://huggingface.co/Kuma6/Shinobu-Kocho)，`license:unknown` |
| 蝴蝶忍 | **当前参考片段（4.32s / 48kHz 单声道）** | `voice/character_voices/refs/shinobu_sleep_ref.wav` | 405 KiB | 用户提供的《蝴蝶忍系统声音.zip》内《睡眠.wav》 |
| 蝴蝶忍 | 历史参考片段（8.00s / 24kHz） | `voice/character_voices/refs/shinobu_ref.wav` | 375 KiB | 妙音站公开的蝴蝶忍 RVC 推理试听，供旧评测复现 |
| 蝴蝶忍 | 备用参考音色（2.50s） | `E:\heartflow-voice\models\shinobu\refs\shinobu_ref_vm.wav` | 117 KB | voice-models.com 用 `geekdom-tr/Kocho-Shinobu` 模型生成的公开样本 |
| RVC | hubert_base.pt / rmvpe.pt 推理底模 | **未下载** | — | 源站限速（hubert 189 MB 仅到 56% 即停止并清理半成品）；当前零样本克隆不需要，仅以后做 RVC 变声才需补齐 |
| 通用 | Qwen3-TTS-12Hz-1.7B-Base（克隆底模） | `E:\heartflow-voice\models\qwen\Qwen3-TTS-12Hz-1.7B-Base\` | 4.3 GB | [Qwen / ModelScope](https://modelscope.cn/models/Qwen/Qwen3-TTS-12Hz-1.7B-Base)，此前已由 `qwen_fetch.py` 下载 |

原始参考素材另存于 `E:\heartflow-voice\models\shinobu\refs\`（妙音 wav/mp3 与 voice-models mp3），便于重截或对照。

## 蝴蝶忍是怎么出声的

`char_shinobu` 用 Qwen3-TTS 的 `xVectorOnly` 模式从《睡眠.wav》提取声纹，并用 `Chinese` 标签生成中文。参考文件按试听所用字节原样保存，RVC 权重仅作历史资源。

## 架构

```
浏览器 → C 服务 :3000 (/api/tts, engine=character)
       → voice/tts_server.py :5001（引擎 character，仅做代理，标准库 HTTP）
       → voice/character_voices/character_server.py :5002（独占 GPU，Qwen3-TTS 1.7B Base 零样本克隆）
```

- `character_server.py` 用 `E:\heartflow-voice\venv-qwen\Scripts\python.exe` 运行（主 sidecar 的 venv-chattts 里没有 `qwen_tts`）。
- 1.7B bf16 推理约需 4.4 GB 显存，**不要与 ChatTTS 同时预热**；用角色音色时把主引擎设为 Kokoro（CPU）。
- 模型懒加载、音色 prompt 按角色缓存一次；仅绑定 `127.0.0.1`，不联网、不上传文本或音频。
- `characters.json` 是唯一音色表；`char_klee` 用 ICL 模式（参考音频 + 真实转写），
  `char_shinobu` 用 `xVectorOnly` 模式（只需音频，不需要台词转写）。
- 5002 的 `/health` 每次动态检查参考音频是否存在；5001 在收到未缓存的角色 voice 时会
  重新探测 5002，所以事后补参考音频通常不必重启 sidecar。
- `characters.json` 的 `label` / `source` / `license` 在 5002 启动时加载，改动后需重启 5002
  才会反映到 `/health`；参考音频与音色列表本身是动态的。

## 启动

1. 双击 `voice/character_voices/启动角色音色服务.cmd`（启动 5002，保持窗口开启）。
2. 在项目根目录另开命令提示符，先运行 `set HEARTFLOW_TTS_ENGINE=kokoro`，再运行
   `启动语音服务.cmd`（启动 5001），避免 ChatTTS 预热占用显存。
3. 启动网页（`npm start`，即 `heartflow-c\hf.exe serve --port 3000`），
   在设置 → 语音里选「角色音色 · 本地克隆」→「可莉 · 中文原声」或「蝴蝶忍 · 中文合成」。

手动启动：

```bat
cd /d E:\一门给年轻人的恋爱成长课\relationship-simulator
E:\heartflow-voice\venv-qwen\Scripts\python.exe voice\character_voices\character_server.py
rem 以下两行在同目录另开的命令提示符窗口运行
set HEARTFLOW_TTS_ENGINE=kokoro
E:\heartflow-voice\venv-chattts\Scripts\python.exe voice\tts_server.py
```

## API

| 服务 | 端点 | 说明 |
|---|---|---|
| 5002 | `GET /health` | 模型是否就绪、每个角色的 `refReady` / 来源 / 许可 |
| 5002 | `POST /tts` | `{text, voice, format?}` → `audio/wav` 或 `format=pcm` 的 raw float32；响应头带 `X-Tts-Sample-Rate` |
| 5001 | `POST /tts` | `engine=character` 时转发到 5002，行为与其它引擎一致（≤300 字、speed 钳制） |
| 3000 | `POST /api/tts` | 网页同源入口，C 侧清洗文本并完成 RMS + WAV 封装 |

`voice` 取 `char_klee` / `char_shinobu`。后者按已确认的试听使用 `Chinese` 语言标签。

## 替换 / 升级参考音频（可选）

若你手上有更干净、更接近动画原声的合法素材，可覆盖现有参考音频：

```bat
E:\heartflow-voice\venv-qwen\Scripts\python.exe voice\character_voices\prepare_ref.py ^
  --input "D:\path\shinobu_clip.wav" --start 12.5 --duration 6 ^
  --out voice\character_voices\refs\shinobu_sleep_ref.wav
```

脚本输出 24kHz 单声道 16-bit WAV。**覆盖后必须重启 5002**：音色 prompt 按角色缓存，
不重启会一直用旧声纹。若能确认片段的真实日语台词，把它填进 `characters.json` 的
`refText` 并把 `xVectorOnly` 改为 `false`，ICL 模式的声纹锁定会更稳。

## 下一阶段：可重复评测台（P0 延迟 / P1 相似度）

按核查结论，不再下载没有试听的 RVC 权重，改为优化现有 Qwen3-TTS 链路。评测台在 `voice/character_voices/eval/`：

- `cases.json`：固定 10 句中文 + 10 句日语，按短/中/长分层，覆盖轻柔、克制、清晰、停顿与「温柔中带一点锋利」；`refs.json`：历史评测使用的 A/B/C 参考音频候选。
- `evaluate.py` 四个子命令：`probe`（P0 延迟矩阵 + 分句实验）、`run`（多参考 × 多句，客观指标）、`normalize`（统一响度）、`report`（盲听页 + 主观评分表）。命令与指标口径见 `eval/README.md`。
- 盲听页：`http://127.0.0.1:3000/voice-eval/index.html`，或直接双击 `eval/out/试听.html`。A/B/C 匿名并排，答案在 `answer_key.csv`，评分填 `评分表.csv`。
- 第一轮实测数据与结论见 `eval/BASELINE.md`。

Qwen3-TTS 的 `generate_voice_clone` 一次性返回完整波形，因此首音频延迟等于完整生成时间。按 `eval/BASELINE.md` 的旧配置实测，RTX 3060 Laptop 6GB 上约 2.7s 固定开销 + 0.78s/字，最短 4 字句也要 5.65–6.89s。分 3 段可把 44 字长回复首响从 49.36s 降到 14.14s，总耗时下降 5.9%。

## 已知限制

- 首句需加载 4.3 GB 权重（约 9–15 秒），单句合成约 20–40 秒（缓存后短句可到 8 秒）；不适合实时对话，适合点选朗读。
- `speed` 参数在角色引擎里被忽略（Qwen 无独立语速控制），其余引擎行为不变。
- 蝴蝶忍使用日语参考进行中文合成，音色相似度以试听为准。
- 未配置参考音频时，`char_shinobu` 不会出现在可选音色表中，请求返回 `409 reference_missing`，不会静默降级成别的声音。
- 两套 RVC 权重**尚未接入推理链路**，hubert/rmvpe 底模也未落地：完整 RVC 变声还需 fairseq / faiss / F0 提取等依赖。当前文字→蝴蝶忍语音完全由 Qwen3-TTS 零样本克隆完成。
- 试听页与 `refs/*.wav` 均为本机素材：wav 已加入根 `.gitignore`，不会随代码入库；网页 `:3000` 默认监听 `0.0.0.0`，勿映射到公网。

## 声明

训练数据、角色形象与语音的全部权利归原版权方；模型来源见上表；
底层项目 [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS)（MIT）、
[RVC](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI)（MIT）、
Qwen3-TTS。生成内容应如实标注为 AI 合成。
