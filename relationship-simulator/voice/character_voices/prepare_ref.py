#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""从本地音频截取 3–10 秒干净人声，生成角色参考音频（24kHz 单声道 WAV）。

  E:\\heartflow-voice\\venv-qwen\\Scripts\\python.exe voice\\character_voices\\prepare_ref.py ^
      --input "D:\\path\\clip.wav" --start 12.5 --duration 6 --out voice\\character_voices\\refs\\shinobu_ref.wav

用途：Qwen3-TTS Base 的零样本音色克隆需要一段目标音色的短参考音频。
可莉的参考音频已随 ModelScope 角色包提供；蝴蝶忍的 RVC 权重包只有
.pth 与 .index，不含原声，因此需要从用户本机合法持有的动画/游戏音轨里
自行截取一段（3–10 秒、单人、无背景音乐、无其它角色、无混响）。

截取后请在 characters.json 里按需补 refText（真实台词转写）；
若保持 xVectorOnly=true，则不需要转写文本，但声纹锁定会略弱。

仅输出 WAV 到本机，不会上传任何音频。
"""
import argparse
import io
import os
import wave

import numpy as np


def read_audio(path):
    """优先 soundfile（可读 mp3/flac/ogg），失败时退回标准库 wave。"""
    try:
        import soundfile as sf
        data, sample_rate = sf.read(path, dtype="float32", always_2d=False)
        if getattr(data, "ndim", 1) > 1:
            data = data.mean(axis=1)
        return np.asarray(data, dtype=np.float32), int(sample_rate)
    except Exception:
        with wave.open(path, "rb") as wav:
            sample_rate = wav.getframerate()
            raw = wav.readframes(wav.getnframes())
            channels = wav.getnchannels()
            width = wav.getsampwidth()
        if width != 2:
            raise ValueError("WAV 回退路径只支持 16-bit PCM，请先转成 16-bit WAV 或安装 soundfile。")
        data = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
        if channels > 1:
            data = data.reshape(-1, channels).mean(axis=1)
        return data, sample_rate


def resample(data, src_rate, dst_rate=24000):
    if src_rate == dst_rate:
        return data
    duration = len(data) / float(src_rate)
    target_len = int(round(duration * dst_rate))
    if target_len < 1:
        raise ValueError("音频太短，无法重采样。")
    src_pos = np.linspace(0, len(data) - 1, len(data), dtype=np.float64)
    dst_pos = np.linspace(0, len(data) - 1, target_len, dtype=np.float64)
    return np.interp(dst_pos, src_pos, data).astype(np.float32)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="本地音频文件路径")
    parser.add_argument("--start", type=float, default=0.0, help="起点秒数")
    parser.add_argument("--duration", type=float, default=6.0, help="截取时长（建议 3–10 秒）")
    parser.add_argument("--out", required=True, help="输出 WAV 路径")
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        raise SystemExit("找不到输入音频：%s" % args.input)
    if args.duration < 2.0 or args.duration > 15.0:
        raise SystemExit("时长建议在 2–15 秒之间（最佳 3–10 秒）。")

    data, sample_rate = read_audio(args.input)
    start = int(max(0.0, args.start) * sample_rate)
    length = int(args.duration * sample_rate)
    clip = data[start:start + length]
    if clip.size < sample_rate:
        raise SystemExit("截取结果不足 1 秒，请检查 --start 是否超出音频长度。")

    peak = float(np.abs(clip).max())
    if peak > 0:
        clip = clip * min(1.0, 0.9 / peak)  # 轻限幅，避免过载
    clip = resample(clip, sample_rate)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    pcm = (np.clip(clip, -1.0, 1.0) * 32767.0).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(24000)
        wav.writeframes(pcm.tobytes())
    with open(args.out, "wb") as out:
        out.write(buffer.getvalue())

    print("已生成参考音频：%s" % args.out)
    print("  时长 %.2fs / 24000Hz / 单声道 / 16-bit PCM / %.0f KB"
          % (len(clip) / 24000.0, os.path.getsize(args.out) / 1024.0))
    print("  参考文本如已知，请写入 characters.json 的 refText；xVectorOnly=true 时可留空。")
    print("  提醒：仅限本机个人非商业使用，角色语音版权归原版权方。")


if __name__ == "__main__":
    main()
