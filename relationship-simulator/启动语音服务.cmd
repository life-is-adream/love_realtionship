@echo off
chcp 65001 >nul
title HeartFlow 语音服务（关闭此窗口即停止）
cd /d "%~dp0"

rem 优先用装了 ChatTTS + PyTorch 的大模型环境；没有则退回轻量 Kokoro 环境。
set "HF_PY=voice\venv\Scripts\python.exe"
set "HF_ENGINE=kokoro"
if exist "E:\heartflow-voice\venv-chattts\Scripts\python.exe" (
  set "HF_PY=E:\heartflow-voice\venv-chattts\Scripts\python.exe"
  set "HF_ENGINE=chattts"
)

echo ============================================
echo   HeartFlow 本地语音服务（双引擎 · 离线）
echo   默认引擎：%HF_ENGINE%（ChatTTS 拟真 / Kokoro 轻量）
echo   ChatTTS 首句需加载约 2GB 权重，约 15-30 秒
echo   看到 "[tts] 引擎 ... 就绪" 即完成；保持本窗口开启
echo ============================================
echo.
"%HF_PY%" voice\tts_server.py
echo.
echo 语音服务已退出。按任意键关闭窗口。
pause >nul
