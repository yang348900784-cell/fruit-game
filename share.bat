@echo off
chcp 65001 >nul
title 🍉 合成大西瓜 - 公网分享
cd /d "%~dp0"

echo ========================================
echo   🍉 合成大西瓜 - 一键公网分享
echo   无需注册 · 无需暴露IP
echo ========================================
echo.

:: Check if server is running
python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/api/leaderboard')" 2>nul
if %errorlevel% neq 0 (
    echo [1/3] Starting game server...
    start /B python -c "import uvicorn; uvicorn.run('main:app',host='0.0.0.0',port=8001)" > server.log 2>&1
    timeout /t 4 /nobreak >nul
) else (
    echo [1/3] Game server already running ✓
)

echo [2/3] Connecting to Serveo tunnel...
echo.
echo ========================================
echo   ⏳ 正在建立安全隧道...
echo   首次连接可能需要 10-15 秒
echo ========================================
echo.

:: Start SSH tunnel to Serveo (free, no signup)
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 80:localhost:8001 serveo.net 2>&1 | findstr "Forwarding"

echo.
echo ========================================
echo   ✅ 分享成功！把下面链接发给朋友：
echo.
echo   https://你的serveo地址
echo.
echo   按 Ctrl+C 关闭分享
echo ========================================

pause
