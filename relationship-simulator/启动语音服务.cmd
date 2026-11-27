@echo off
chcp 65001 >nul
title HeartFlow 语音服务（关闭此窗口即停止）
cd /d "%~dp0"

rem 选择 Python 解释器，优先级从高到低（脚本内不再硬编码盘符）：
rem   1) 环境变量 HF_PY_OVERRIDE 显式指定 python.exe
rem   2) HEARTFLOW_VOICE_DIR 指向的外部语音环境（venv-chattts）
rem   3) 项目内 voice\venv（Kokoro 轻量环境，随项目走）
rem 换机器/换盘符无需改本脚本；都没找到会明确报错。
set "HF_PY="
set "HF_ENGINE=kokoro"

if defined HF_PY_OVERRIDE set "HF_PY=%HF_PY_OVERRIDE%"

rem 外部 ChatTTS 环境：HEARTFLOW_VOICE_DIR 应指向包含 venv-chattts 的目录
if not defined HF_PY if defined HEARTFLOW_VOICE_DIR (
  if exist "%HEARTFLOW_VOICE_DIR%\venv-chattts\Scripts\python.exe" (
    set "HF_PY=%HEARTFLOW_VOICE_DIR%\venv-chattts\Scripts\python.exe"
    set "HF_ENGINE=chattts"
  )
)

rem 回退：项目内 Kokoro 环境
if not defined HF_PY if exist "voice\venv\Scripts\python.exe" (
  set "HF_PY=voice\venv\Scripts\python.exe"
  set "HF_ENGINE=kokoro"
)

if not defined HF_PY (
  echo [错误] 找不到可用的 Python 环境。
  echo 请设置 HF_PY_OVERRIDE 指向 python.exe，或 HEARTFLOW_VOICE_DIR 指向语音环境根目录。
  echo 本脚本已移除硬编码盘符，换机器无需修改。
  pause >nul
  exit /b 1
)

echo ============================================
echo   HeartFlow 本地语音服务（双引擎 · 离线）
echo   解释器：%HF_PY%
echo   默认引擎：%HF_ENGINE%（ChatTTS 拟真 / Kokoro 轻量）
echo   ChatTTS 首句需加载约 2GB 权重，约 15-30 秒
echo   看到 "[tts] 引擎 ... 就绪" 即完成；保持本窗口开启
echo ============================================
echo.
"%HF_PY%" voice\tts_server.py
echo.
echo 语音服务已退出。按任意键关闭窗口。
pause >nul
