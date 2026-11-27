# -*- coding: utf-8 -*-
"""C 版 TTS 文本/音频层 与 voice/tts_server.py 逐字节对照。

用法（用 voice/venv 的 Python，因为 float_to_wav 依赖 numpy）：
    voice/venv/Scripts/python.exe heartflow-c/tests/tts-parity.py

对照三组：normalize_for_tts、split_sentences、float_to_wav（WAV 字节）。
不加载任何模型、不启动服务、不消耗额度。
"""
import importlib.util
import math
import os
import random
import struct
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
HF = os.path.join(HERE, "..", "hf.exe")
TTS_PY = os.path.join(ROOT, "voice", "tts_server.py")

spec = importlib.util.spec_from_file_location("tts_server", TTS_PY)
tts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tts)

fails = 0
passes = 0


def ok(name, cond, detail=""):
    global fails, passes
    if cond:
        passes += 1
    else:
        fails += 1
        print("  FAIL %s%s" % (name, ("  " + detail) if detail else ""))


def run_c(*args):
    p = subprocess.run([HF, "tts"] + list(args), capture_output=True, timeout=20)
    if p.returncode != 0:
        raise RuntimeError("hf tts 失败: %s" % p.stderr.decode("utf-8", "replace"))
    return p.stdout.decode("utf-8")


NORMALIZE_CASES = [
    "（微笑）你好？",
    "真的....吗??",
    "  A  \t B  ",
    "（轻轻笑）其实我有点难过😔……你别多想；好吗?",
    "【小声】我不知道：[沉默] 也许吧、再想想",
    "他说…………我不想聊了。。。",
    "😀🎉 早上好 ☀️",
    "全角空格\u3000在这里\u3000结束",
    "（未闭合的舞台提示",
    "没有标点的连续一句话",
    "！！！",
    "",
    "a.b.c...d",
    "换行\n在这里\n结束",
]

SPLIT_CASES = [
    "今天有点累。早点休息吧！明天再说；或者周末见？",
    "没有标点的连续一句话",
    "短。也短。还是短。",
    "。！？",
    "",
    "第一句很长很长很长很长很长很长很长很长很长很长，第二句接着说，第三句收尾。",
    "换行\n在这里\n也算分隔\n对吧",
    "  前后有空格  。  再来一句  ！  ",
]


def main():
    print("TTS C/Python 逐字节对照")
    print("------------------------------")

    for i, text in enumerate(NORMALIZE_CASES):
        want = tts.normalize_for_tts(text)
        # Windows 控制台会把 printf("\n") 转成 CRLF，先去掉行尾再看内容
        got = run_c("normalize", "--text", text).rstrip("\r\n")
        ok("normalize[%d]" % i, got == want, "want=%r got=%r" % (want, got))

    for i, text in enumerate(SPLIT_CASES):
        want = tts.split_sentences(text)
        got = run_c("split", "--text", text).splitlines()
        ok("split[%d]" % i, got == want, "want=%r got=%r" % (want, got))

    # ---- WAV ----
    rng = random.Random(20261107)
    signals = {
        "silence": [0.0] * 512,
        "square": [0.2 if i % 2 else -0.2 for i in range(1024)],
        "sine": [0.5 * math.sin(2 * math.pi * 440 * i / 24000) for i in range(2048)],
        "quiet": [0.0001 * math.sin(i) for i in range(256)],
        "loud": [0.9 if i % 3 else -0.9 for i in range(512)],
        "random": [rng.uniform(-0.7, 0.7) for _ in range(4096)],
        "tiny1": [0.3],
        "tiny3": [0.1, -0.4, 0.25],
    }
    with tempfile.TemporaryDirectory(prefix="hf-tts-parity-") as td:
        for name, values in signals.items():
            raw = struct.pack("<%df" % len(values), *values)
            f32 = os.path.join(td, name + ".f32")
            wav = os.path.join(td, name + ".wav")
            with open(f32, "wb") as f:
                f.write(raw)
            run_c("wav", "--in", f32, "--out", wav)
            with open(wav, "rb") as f:
                got = f.read()
            want = tts.float_to_wav(values, tts.SAMPLE_RATE)
            if got == want:
                ok("wav[%s]" % name, True)
                continue
            # 不完全一致时，量化差异：头必须相同，数据段统计最大 LSB 偏差
            head_same = got[:44] == want[:44] and len(got) == len(want)
            diffs = [abs(ord(got[k:k + 1]) - ord(want[k:k + 1]))
                     for k in range(44, min(len(got), len(want)))]
            # 按 16bit 小端样本比较
            samples = []
            for k in range(44, min(len(got), len(want)) - 1, 2):
                a = struct.unpack_from("<h", got, k)[0]
                b = struct.unpack_from("<h", want, k)[0]
                samples.append(abs(a - b))
            mx = max(samples) if samples else 0
            print("  INFO wav[%s]: 头=%s 长度=%d/%d 最大样本差=%d LSB"
                  % (name, head_same, len(got), len(want), mx))
            # numpy float32 与 C double 累加的舍入差异允许 1 LSB；超过即失败
            ok("wav[%s] <=1 LSB" % name, head_same and mx <= 1,
               "max=%d LSB" % mx)

    print("\n结果：%d 通过，%d 失败" % (passes, fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
