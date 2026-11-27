#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""真声克隆：真实可莉中文参考音频 + Qwen3-TTS 1.7B-Base 零样本合成。

  E:\\heartflow-voice\\venv-qwen\\Scripts\\python.exe voice\\qwen_klee.py
  E:\\heartflow-voice\\venv-qwen\\Scripts\\python.exe voice\\qwen_klee.py --limit 1

参考音频来自 ModelScope aihobbyist/GPT-SoVITS_Model_Collection 的
「原神/中文/可莉_ZH.zip」角色包自带 wav（CC-BY-NC，禁商用 / 禁再分发，仅本机研究）。
产物写入 voice/lab-qwen/ 的 clone_*.wav 与 meta.json，再调 qwen_lab.py 的 build_html 汇总。

与 VoiceDesign 的根本区别：描述只能调「风格维度」，参考音频直接给定「声纹」。
create_voice_clone_prompt 产出的 prompt 存成 .pt，重复合成不必再编码参考音频，
也就是官方「设计参考音频 → Base 克隆 → 保存 prompt 复用」里的最后一步。
"""
import argparse
import gc
import os
import time
import traceback

from qwen_lab import (OUT, MODEL_ROOT, SAMPLE_TEXT, KLEE_TEXT,
                      _write_wav, measure, voiced_flatness,
                      read_meta, write_meta, build_html)

MODEL_NAME = "Qwen3-TTS-12Hz-1.7B-Base"
REF_WAV = "klee_ref.wav"
REF_TEXT = "玩得太开心，忘、忘在脑后了……"
PROMPT_FILE = "klee_voice_prompt.pt"

CASES = [
    ("clone_klee_sample", "真声克隆 · 同一句测试文本", SAMPLE_TEXT, False,
     "ICL 模式（参考音频 + 参考文本共同锁定声线）。与下方 4 个描述候选用同一句文本，可直接 A/B。"),
    ("clone_klee_line", "真声克隆 · 可莉式台词", KLEE_TEXT, False,
     "ICL 模式，换一句活泼台词：「%s」" % KLEE_TEXT),
    ("clone_klee_xvec", "真声克隆 · 仅声纹向量（对照）", SAMPLE_TEXT, True,
     "x-vector only：只用说话人嵌入、不喂参考文本，用来判断 ICL 到底带来多少提升。"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="只跑前 N 个用例（冒烟用）")
    args = ap.parse_args()

    import torch
    from qwen_tts import Qwen3TTSModel

    model_dir = os.path.join(MODEL_ROOT, MODEL_NAME)
    ref_path = os.path.join(OUT, REF_WAV)
    if not os.path.isdir(model_dir):
        raise SystemExit("找不到 Base 权重：%s" % model_dir)
    if not os.path.isfile(ref_path):
        raise SystemExit("找不到参考音频：%s" % ref_path)

    print("=== 加载 %s (bf16 + sdpa) ===" % MODEL_NAME, flush=True)
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()
    t0 = time.time()
    model = Qwen3TTSModel.from_pretrained(
        model_dir, device_map="cuda:0", dtype=torch.bfloat16,
        attn_implementation="sdpa")
    load_sec = time.time() - t0
    print("  加载 %.1fs  显存 %.2f GB" %
          (load_sec, torch.cuda.max_memory_allocated() / 1e9), flush=True)

    prompts = {}
    for xvec in (False, True):
        items = model.create_voice_clone_prompt(
            ref_audio=ref_path,
            ref_text=None if xvec else REF_TEXT,
            x_vector_only_mode=xvec)
        prompts[xvec] = items
        print("  prompt xvec=%-5s 构建完成（%d item）" % (xvec, len(items)), flush=True)

    # 保存 ICL prompt：以后要复用同一个角色声线，直接加载这个 .pt，不必再编码参考音频。
    from dataclasses import asdict
    prompt_path = os.path.join(OUT, PROMPT_FILE)
    torch.save({"items": [asdict(it) for it in prompts[False]]}, prompt_path)
    print("  音色 prompt 已保存：%s" % prompt_path, flush=True)

    entries = [e for e in read_meta() if e.get("group") != "clone"]
    cases = CASES[:args.limit] if args.limit else CASES
    for index, (ident, label, text, xvec, detail) in enumerate(cases, 1):
        print("  [%d/%d] %s" % (index, len(cases), label), end=" ", flush=True)
        try:
            torch.cuda.reset_peak_memory_stats()
            t = time.time()
            wavs, sr = model.generate_voice_clone(
                text=text, language="Chinese", voice_clone_prompt=prompts[xvec])
            elapsed = time.time() - t
            path = os.path.join(OUT, ident + ".wav")
            _write_wav(wavs, sr, path)
            flat_v, silence = voiced_flatness(path)
            entry = {
                "id": ident, "group": "clone", "label": label, "detail": detail,
                "file": ident + ".wav", "model": MODEL_NAME,
                "sampleRate": sr, "loadSec": round(load_sec, 1),
                "synthSec": round(elapsed, 1),
                "vramGb": round(torch.cuda.max_memory_allocated() / 1e9, 2),
                "note": "本地离线 · 真声克隆",
                "flatnessVoiced": flat_v, "silencePct": silence,
            }
            entry.update(measure(path))
            entries.append(entry)
            write_meta(entries)
            print("F0=%3dHz 亮度=%4d 平坦度=%.3f %.1fs %.2fGB" %
                  (entry["f0"], entry["brightness"], entry["flatness"],
                   elapsed, entry["vramGb"]), flush=True)
        except Exception as e:
            print("FAIL %s: %s" % (type(e).__name__, str(e)[:120]), flush=True)
            entries.append({"id": ident, "group": "clone", "label": label,
                            "detail": detail, "error": "%s: %s" % (type(e).__name__, e),
                            "note": "合成失败"})
            write_meta(entries)
            traceback.print_exc()
        gc.collect()

    del model
    gc.collect()
    torch.cuda.empty_cache()
    build_html()


if __name__ == "__main__":
    main()
