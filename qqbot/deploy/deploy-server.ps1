param(
  [switch]$DryRun,
  [switch]$NonInteractive,
  [switch]$SkipDeps,
  [switch]$SkipTask,
  [switch]$LogonTask
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$deployDir = $PSScriptRoot
$runtime = Join-Path $root 'runtime'
$runtimeData = Join-Path $root 'runtime-data'

function Write-Step([string]$message) {
  Write-Host ""
  Write-Host "==> $message" -ForegroundColor Cyan
}

function Write-Warn([string]$message) {
  Write-Host "WARN: $message" -ForegroundColor Yellow
}

function Fail([string]$message) {
  Write-Host "ERROR: $message" -ForegroundColor Red
  exit 1
}

function Invoke-Step([string]$description, [scriptblock]$action) {
  Write-Step $description
  if ($DryRun) {
    Write-Host "    [dry-run] skipped" -ForegroundColor DarkGray
    return
  }
  & $action
}

function Get-EnvValue([string]$name, [switch]$Secret) {
  $existing = [Environment]::GetEnvironmentVariable($name, 'User')
  if ($existing) { return $existing }
  $processValue = [Environment]::GetEnvironmentVariable($name, 'Process')
  if ($processValue) { return $processValue }
  if ($DryRun) {
    Write-Warn "$name 未配置（dry-run 不提示输入）"
    return ''
  }
  if ($NonInteractive) { Fail "缺少环境变量 $name；请先设置后再运行，或去掉 -NonInteractive" }
  if ($Secret) {
    $secure = Read-Host "请输入 $name" -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  }
  return Read-Host "请输入 $name"
}

function Read-WindowsPassword {
  if ($DryRun -or $NonInteractive) { return '' }
  $secure = Read-Host "请输入当前 Windows 账号 $env:USERNAME 的登录密码（只用于创建开机任务，不会写入文件）" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Set-UserEnv([string]$name, [string]$value) {
  if ($DryRun) {
    Write-Host "    [dry-run] $name = <configured>" -ForegroundColor DarkGray
    return
  }
  if (-not $value) { Fail "$name 不能为空" }
  [Environment]::SetEnvironmentVariable($name, $value, 'User')
  [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  Write-Host "    $name 已配置" -ForegroundColor Green
}

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}

function Ensure-Node {
  Write-Step '检查 Node.js'
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    if ($SkipDeps) { Fail '缺少 Node.js 24（已指定 -SkipDeps）' }
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) { Fail '缺少 Node.js，且没有 winget。请安装 Node.js 24 后重试：https://nodejs.org/' }
    if ($DryRun) {
      Write-Warn 'Node.js 未安装；正式运行时会尝试 winget 安装 OpenJS.NodeJS.LTS'
      return
    }
    Write-Host '正在用 winget 安装 Node.js LTS...'
    & winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    Refresh-Path
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { Fail 'Node.js 安装后仍未找到 node，请重新登录或手动安装 Node.js 24' }
  }
  $version = (& node -v).Trim().TrimStart('v')
  $parts = $version.Split('.')
  $major = [int]$parts[0]
  $minor = [int]$parts[1]
  if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 5)) {
    Fail "Node.js 版本过低：$version；需要 24（至少 >=22.5，内置 node:sqlite）"
  }
  Write-Host "    Node.js $version OK" -ForegroundColor Green
}

function Find-Python {
  if (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3.12 -c "import sys; print(sys.version)" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      return @{ Exe = 'py'; Args = @('-3.12') }
    }
  }
  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    $version = (& python -c "import sys; print(sys.version_info[0], sys.version_info[1])" 2>$null)
    if ($LASTEXITCODE -eq 0) {
      $pair = $version.Trim().Split(' ')
      if ([int]$pair[0] -ge 3 -and [int]$pair[1] -ge 10) {
        return @{ Exe = 'python'; Args = @() }
      }
    }
  }
  return $null
}

function Ensure-Python {
  Write-Step '检查 Python'
  $python = Find-Python
  if (-not $python) {
    if ($SkipDeps) { Fail '缺少 Python 3.12（已指定 -SkipDeps）' }
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) { Fail '缺少 Python 3.12，且没有 winget。请安装 Python 3.12 后重试：https://www.python.org/' }
    if ($DryRun) {
      Write-Warn 'Python 未安装；正式运行时会尝试 winget 安装 Python.Python.3.12'
      return $null
    }
    Write-Host '正在用 winget 安装 Python 3.12...'
    & winget install --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
    Refresh-Path
    $python = Find-Python
    if (-not $python) { Fail 'Python 安装后仍未找到，请重新登录或手动安装 Python 3.12' }
  }
  $version = (& $python.Exe @($python.Args) -c "import sys; print('.'.join(map(str, sys.version_info[:2])))").Trim()
  Write-Host "    Python $version OK" -ForegroundColor Green
  return $python
}

if ($env:OS -ne 'Windows_NT') {
  Fail '当前部署脚本只支持 Windows Server。Linux 需要先做跨平台改造。'
}
if (-not (Test-Path (Join-Path $root 'qqbot-agent-bridge.mjs'))) {
  Fail "没有找到 qqbot-agent-bridge.mjs。请把整包解压到 C:\QQbot 后再运行 deploy\deploy-server.ps1"
}

Write-Host "梦璃部署目录：$root"
Write-Host "模式：$(if ($DryRun) { 'DryRun' } else { '正式部署' })"

Ensure-Node
$python = Ensure-Python

Write-Step '检查 ZCode CLI 和 Provider 配置'
$zcode = $env:ZCODE_CLI
if (-not $zcode) {
  $defaultZcode = 'C:\Program Files\ZCode\resources\glm\zcode.cjs'
  if (Test-Path $defaultZcode) { $zcode = $defaultZcode }
}
if (-not $zcode -or -not (Test-Path $zcode)) {
  Fail '没有找到 ZCode CLI。请先安装 ZCode，或设置 ZCODE_CLI 指向 zcode.cjs'
}
$providerConfig = Join-Path $env:USERPROFILE '.zcode\v2\provider_config.json'
if (-not (Test-Path $providerConfig)) {
  Fail "没有找到 $providerConfig。请先用当前 Windows 用户登录 ZCode 并配置 Provider，然后再运行本脚本。"
}
Write-Host "    ZCode CLI: $zcode" -ForegroundColor Green
Write-Host "    Provider: $providerConfig" -ForegroundColor Green

Write-Step '检查是否已有实例'
$alreadyRunning = $false
try {
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/health' -TimeoutSec 3
  if ($health.ok) { $alreadyRunning = $true }
} catch { }
if ($alreadyRunning) {
  if ($DryRun) {
    Write-Warn '检测到 8765 已有实例；dry-run 不修改数据。'
  } else {
    Fail '检测到 8765 已有实例。请先停止 watchdog/桥接，再运行部署，避免覆盖正在使用的 memory.db。'
  }
}

Write-Step '准备运行目录'
Invoke-Step '创建 runtime/workspace/media-parser 目录' {
  foreach ($dir in @($runtime, (Join-Path $runtime 'backup'), (Join-Path $runtime 'media-cache'),
      (Join-Path $runtime 'inbound-media'), (Join-Path $runtime 'profile-cards'),
      (Join-Path $root 'workspace'), (Join-Path $root 'media-parser'))) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
}

if (Test-Path $runtimeData) {
  Write-Step '迁移 runtime-data'
  Invoke-Step '备份现有 memory.db（如有）' {
    $currentDb = Join-Path $runtime 'memory.db'
    if (Test-Path $currentDb) {
      $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
      Copy-Item $currentDb (Join-Path $runtime "backup\memory-before-deploy-$stamp.db") -Force
    }
  }
  Invoke-Step '导入 memory.db / 绑定 / 设置 / 推送游标' {
    foreach ($name in @('memory.db', 'mengli-bindings.json', 'bot-settings.json', 'mengli-push-state.json')) {
      $source = Join-Path $runtimeData $name
      if (Test-Path $source) {
        Copy-Item $source (Join-Path $runtime $name) -Force
        Write-Host "    导入 $name" -ForegroundColor Green
      }
    }
  }
} else {
  Write-Warn '没有 runtime-data/；将使用空记忆启动。需要迁移时把 memory.db 等文件放进 runtime-data/ 再重跑。'
}

Write-Step '配置环境变量'
$appId = Get-EnvValue 'QQBOT_APPID'
$appSecret = Get-EnvValue 'QQBOT_SECRET' -Secret
$skinKey = Get-EnvValue 'SWUSTMC_API_KEY' -Secret
$ingestToken = Get-EnvValue 'MENGLI_INGEST_TOKEN' -Secret
Set-UserEnv 'QQBOT_APPID' $appId
Set-UserEnv 'QQBOT_SECRET' $appSecret
Set-UserEnv 'SWUSTMC_API_KEY' $skinKey
Set-UserEnv 'MENGLI_INGEST_TOKEN' $ingestToken

$model = [Environment]::GetEnvironmentVariable('QQBOT_AGENT_MODEL', 'User')
if (-not $model) { $model = 'qwen3.8-flash' }
Set-UserEnv 'QQBOT_AGENT_MODEL' $model

$mcWatch = [Environment]::GetEnvironmentVariable('QQBOT_MC_WATCH', 'User')
$mcGroups = [Environment]::GetEnvironmentVariable('QQBOT_MC_NOTIFY_GROUPS', 'User')
if (-not $mcGroups -and -not $NonInteractive -and -not $DryRun) {
  $mcGroups = Read-Host 'MC 播报群 openid（逗号分隔，留空关闭播报）'
}
if (-not $mcWatch) { $mcWatch = if ($mcGroups) { '1' } else { '0' } }
Set-UserEnv 'QQBOT_MC_WATCH' $mcWatch
if ($mcGroups) { Set-UserEnv 'QQBOT_MC_NOTIFY_GROUPS' $mcGroups }

Write-Step '安装 Python 依赖'
$venv = Join-Path $root 'media-parser\.venv'
$venvPython = Join-Path $venv 'Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
  if ($DryRun) {
    Write-Warn '虚拟环境不存在；正式运行时会创建并安装 requirements-min.txt'
  } elseif ($python) {
    & $python.Exe @($python.Args) -m venv $venv
    if ($LASTEXITCODE -ne 0) { Fail '创建 Python venv 失败' }
  } else {
    Fail '无法创建 Python venv：没有可用的 Python'
  }
}
if (Test-Path $venvPython) {
  Write-Step '安装/更新 media-parser 依赖（含 Pillow）'
  if (-not $DryRun) {
    & $venvPython -m pip install -U pip
    if ($LASTEXITCODE -ne 0) { Fail 'pip 升级失败' }
    & $venvPython -m pip install -r (Join-Path $root 'media-parser\requirements-min.txt')
    if ($LASTEXITCODE -ne 0) { Fail 'Python 依赖安装失败' }
  }
}

if ($alreadyRunning) {
  Write-Warn 'dry-run：检测到已有实例，跳过启动。'
} else {
  Write-Step '启动看门狗'
  if (-not $DryRun) {
    Start-Process -FilePath 'powershell.exe' -ArgumentList @(
      '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
      '-File', (Join-Path $root 'watchdog.ps1')
    ) -WindowStyle Hidden
  }
}

if (-not $SkipTask) {
  Write-Step '注册开机启动任务'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (
    '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $root 'watchdog.ps1') + '"'
  )
  $taskUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  if ($DryRun) {
    Write-Host '    [dry-run] 跳过 Register-ScheduledTask' -ForegroundColor DarkGray
  } elseif ($LogonTask) {
    try {
      $trigger = New-ScheduledTaskTrigger -AtLogOn
      Register-ScheduledTask -TaskName 'Mengli QQ Bot' -Action $action -Trigger $trigger -User $taskUser -Force | Out-Null
      Write-Host '    已注册任务计划：Mengli QQ Bot（登录时启动）' -ForegroundColor Green
    } catch {
      Write-Warn "自动注册登录任务失败：$($_.Exception.Message)"
      Write-Warn '请手动用任务计划程序启动 watchdog.ps1。'
    }
  } elseif ($NonInteractive) {
    Write-Warn '非交互模式无法注册开机任务：任务计划需要当前 Windows 账号密码。'
    Write-Warn '请手动创建“开机时启动、不管用户是否登录都运行”的任务，或改用 -LogonTask 并配置自动登录。'
  } else {
    $password = Read-WindowsPassword
    if (-not $password) {
      Write-Warn '没有输入 Windows 密码，跳过开机任务；请手动创建任务计划。'
    } else {
      try {
        $trigger = New-ScheduledTaskTrigger -AtStartup
        $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
        Register-ScheduledTask -TaskName 'Mengli QQ Bot' -Action $action -Trigger $trigger -Settings $settings -User $taskUser -Password $password -RunLevel Limited -Force | Out-Null
        Write-Host '    已注册任务计划：Mengli QQ Bot（开机时启动，不需要登录）' -ForegroundColor Green
      } catch {
        Write-Warn "自动注册开机任务失败：$($_.Exception.Message)"
        Write-Warn '请手动用任务计划程序启动 watchdog.ps1，并设置“开机时启动、不管用户是否登录都要运行”。'
      }
    }
  }
}

if (-not $DryRun -and -not $alreadyRunning) {
  Write-Step '等待桥接健康检查'
  $healthy = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
      $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/health' -TimeoutSec 2
      if ($health.ok) { $healthy = $true; break }
    } catch { }
  }
  if (-not $healthy) {
    Write-Warn '健康检查未通过。下面是最新日志：'
    foreach ($log in @((Join-Path $runtime 'watchdog.log'), (Join-Path $runtime 'agent-bridge.log'))) {
      if (Test-Path $log) {
        Write-Host "--- $log ---"
        Get-Content $log -Tail 25
      }
    }
    Fail '部署后健康检查失败，请按上面日志排查。'
  }
}

Write-Host ""
if ($DryRun) {
  Write-Host "DryRun 检查完成，未修改系统配置。" -ForegroundColor Yellow
} else {
  Write-Host "部署完成。" -ForegroundColor Green
}
Write-Host "监控：http://127.0.0.1:8765/（只在本机/远程桌面内访问）"
Write-Host "日志：runtime\agent-bridge.log、runtime\watchdog.log"
Write-Host "QQ 群测试：@梦璃 发 /我的记忆、/服务器、/我的画像"
Write-Host ""
Write-Host "注意：默认注册为“开机时启动、不管用户是否登录都要运行”。如果没有输入 Windows 密码或注册失败，请手动在任务计划程序里设置同样的触发器和登录选项。"
