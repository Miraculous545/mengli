@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem 凭据由 watchdog.ps1 从用户环境变量（注册表）读取，避免 Explorer 进程环境过期导致误判。
rem 看门狗自带单实例互斥，重复运行会直接退出；桥接/监控由它负责拉起和重启。
start "" powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0watchdog.ps1"
timeout /t 5 /nobreak >nul
start "" "http://127.0.0.1:8765/"
