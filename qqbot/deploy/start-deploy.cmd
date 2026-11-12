@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo 梦璃 QQ 机器人部署
echo 建议先安装并登录 ZCode，再用当前 Windows 用户运行。
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-server.ps1" %*
echo.
pause
