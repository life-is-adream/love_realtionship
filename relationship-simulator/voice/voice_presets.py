#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""语音音色预设：sidecar 与音色实验室共用，避免两边定义漂移。

## 2026-11-07 听感验收结论（重要，别再走回头路）

Edge 的免费 read-aloud 端点下，微软只提供 **2 个普通话原生女声**：
  zh-CN-XiaoxiaoNeural（Warm，F0≈235Hz）和 zh-CN-XiaoyiNeural（Lively，F0≈289Hz）。
其余中文 voice 是方言 / 港台口音，不是「风格差异」。

曾经尝试用 SSML `pitch` 硬造「清冷御姐 −22Hz / 甜美萝莉 +52Hz」，
也试过注入 `mstts:express-as` 情感风格。实测结果：
  - 变调会连共振峰一起搬，音色从「真人」变成电音/卡通，用户判定为「垃圾」；
  - `mstts:express-as` 被该端点直接拒绝（NoAudioReceived）。
两条路都不成立，因此**产品只保留零/近零变调的 2 个原生音色**。

下面 EDGE_VOICES 里的 9 条是音色工坊的实验预设（含 7 条被淘汰的反例），
供试听页 A/B 与回归复现使用；产品实际暴露的是 EDGE_PRODUCT_VOICES。

隐私：edge 需要联网，合成时文本会离开本机。默认零注册、零联网，
必须在设置面板显式开启（或启动时设 HEARTFLOW_TTS_ALLOW_ONLINE=1）。
"""

EDGE_VOICES = [
    {"id": "edge_yujie", "label": "清冷 · 御姐", "voice": "zh-CN-XiaoxiaoNeural", "pitch": "-22Hz", "rate": "-8%"},
    {"id": "edge_lengyan", "label": "冷艳 · 低缓", "voice": "zh-CN-XiaoxiaoNeural", "pitch": "-38Hz", "rate": "-12%"},
    {"id": "edge_zhixing", "label": "知性 · 沉静", "voice": "zh-CN-XiaoxiaoNeural", "pitch": "-10Hz", "rate": "-4%"},
    {"id": "edge_wenrou", "label": "温柔 · 自然", "voice": "zh-CN-XiaoxiaoNeural", "pitch": "+0Hz", "rate": "+0%"},
    {"id": "edge_luoli", "label": "甜美 · 萝莉", "voice": "zh-CN-XiaoyiNeural", "pitch": "+52Hz", "rate": "+6%"},
    {"id": "edge_ruannuo", "label": "软甜 · 少女", "voice": "zh-CN-XiaoyiNeural", "pitch": "+28Hz", "rate": "+2%"},
    {"id": "edge_yuanqi", "label": "元气 · 明亮", "voice": "zh-CN-XiaoyiNeural", "pitch": "+10Hz", "rate": "+10%"},
    {"id": "edge_dongbei", "label": "东北 · 爽朗", "voice": "zh-CN-liaoning-XiaobeiNeural", "pitch": "+0Hz", "rate": "+0%"},
    {"id": "edge_shaanxi", "label": "陕西 · 清亮", "voice": "zh-CN-shaanxi-XiaoniNeural", "pitch": "+0Hz", "rate": "+0%"},
]

EDGE_BY_ID = {item["id"]: item for item in EDGE_VOICES}

# 听感验收通过的两个：变调幅度 0 / +10Hz，都是原生声线，不做共振峰破坏。
# 「温柔 · 自然」作默认（更耐听、不挑文本）；「元气 · 明亮」作活泼备选。
EDGE_PRODUCT_IDS = ("edge_wenrou", "edge_yuanqi")
EDGE_PRODUCT_VOICES = [EDGE_BY_ID[vid] for vid in EDGE_PRODUCT_IDS]
EDGE_DEFAULT = "edge_wenrou"

# ChatTTS 的「风格化」音色：seed 由 voice_lab.py 海选 + 客观声学指标确定，
# 标签是听感描述而非物理事实；详见 voice/README.md「音色工坊」。
# 客观指标（F0 / 频谱平坦度）只能筛「干净」，筛不出「好听」——
# 这批离线音色在真人听感验收中未通过，产品里降级为「无网络兜底」。
# 保持在 tts_server.py 的 CHATTTS_VOICES 中维护，此处只留说明，避免重复定义。
