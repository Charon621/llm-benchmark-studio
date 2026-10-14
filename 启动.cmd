@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo 请安装 Node.js 24 LTS & pause & exit /b 1)
if not exist node_modules (call npm ci || (pause & exit /b 1))
echo 浏览器打开 http://127.0.0.1:8812
node --env-file-if-exists=.env src/server.js
pause
