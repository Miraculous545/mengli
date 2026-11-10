@echo off
setlocal
cd /d "%~dp0"

if "%QQBOT_APPID%"=="" (
  echo [qqbot] 未设置 QQBOT_APPID。
  exit /b 1
)
if "%QQBOT_SECRET%"=="" (
  echo [qqbot] 未设置 QQBOT_SECRET。
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  set "NODE_EXE=C:\Users\Administrator\tools\node-v24.22.0-win-x64\node.exe"
) else (
  set "NODE_EXE=node"
)

"%NODE_EXE%" "%~dp0qqbot-connector.mjs"
