# 梦璃看门狗：不依赖管理员权限。每 15 秒检查桥接与监控，发现退出就重新拉起。
# 凭据从当前用户环境变量读取，不写入本文件。登录启动项只负责以隐藏窗口启动本脚本。
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtime = Join-Path $root 'runtime'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
$logFile = Join-Path $runtime 'watchdog.log'

$mutex = New-Object System.Threading.Mutex($false, 'Local\QQbotMengliWatchdog')
if (-not $mutex.WaitOne(0)) { exit 0 }

$env:QQBOT_APPID = [Environment]::GetEnvironmentVariable('QQBOT_APPID', 'User')
$env:QQBOT_SECRET = [Environment]::GetEnvironmentVariable('QQBOT_SECRET', 'User')
$env:QQBOT_MEDIA_BILI_MAX_QN = [Environment]::GetEnvironmentVariable('QQBOT_MEDIA_BILI_MAX_QN', 'User')

$node = 'C:\Users\Administrator\tools\node-v24.22.0-win-x64\node.exe'
if (-not (Test-Path $node)) {
  $node = (Get-Command node -ErrorAction Stop).Source
}

function Write-Log([string]$message) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
  Add-Content -Path $logFile -Value $line -Encoding UTF8
  $item = Get-Item $logFile
  if ($item.Length -gt 5MB) {
    Set-Content -Path $logFile -Value '' -Encoding UTF8
  }
}

function Get-BridgeProcess {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*qqbot-agent-bridge.mjs*' } |
    Select-Object -First 1
}

function Test-Monitor {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8765/api/health' -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Start-Node([string]$script, [string]$name) {
  $process = Start-Process -FilePath $node -ArgumentList @($script) -WorkingDirectory $root -WindowStyle Hidden -PassThru
  Write-Log ('启动 {0} pid={1}' -f $name, $process.Id)
}

if (-not $env:QQBOT_APPID -or -not $env:QQBOT_SECRET) {
  Write-Log '缺少 QQBOT_APPID / QQBOT_SECRET，看门狗退出'
  exit 1
}

Write-Log '看门狗启动'
while ($true) {
  if (-not (Get-BridgeProcess)) {
    Start-Node 'qqbot-agent-bridge.mjs' 'bridge'
  }
  if (-not (Test-Monitor)) {
    Start-Node 'monitor/server.mjs' 'monitor'
  }
  Start-Sleep -Seconds 15
}
