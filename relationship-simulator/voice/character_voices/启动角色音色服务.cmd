@echo off
chcp 65001 >nul
title HeartFlow 角色音色服务（可莉 / 蝴蝶忍 · 关闭此窗口即停止）
cd /d "%~dp0..\.."

set "HF_PY=E:\heartflow-voice\venv-qwen\Scripts\python.exe"
if not exist "%HF_PY%" (
  echo [错误] 找不到 Qwen 推理环境：%HF_PY%
  echo 请参照 voice\README.md「Qwen 环境」章节重建。
  pause
  exit /b 1
)

echo ============================================
echo   HeartFlow 角色音色服务 127.0.0.1:5002
echo   本机个人非商用；角色语音版权归原版权方
echo   首次朗读需加载 4.3GB 权重，约 9-15 秒
echo   保持本窗口开启，再启动「启动语音服务.cmd」
echo ============================================
echo.
"%HF_PY%" voice\character_voices\character_server.py
echo.
echo 角色音色服务已退出。按任意键关闭窗口。
pause >nul
