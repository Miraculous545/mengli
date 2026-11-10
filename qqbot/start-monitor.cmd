@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  set "NODE_EXE=C:\Users\Administrator\tools\node-v24.22.0-win-x64\node.exe"
) else (
  set "NODE_EXE=node"
)

"%NODE_EXE%" "%~dp0monitor\server.mjs"
