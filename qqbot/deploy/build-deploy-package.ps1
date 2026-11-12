param(
  [string]$OutputDir = '',
  [switch]$NoData
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Write-Warn([string]$message) {
  Write-Host "WARN: $message" -ForegroundColor Yellow
}
if (-not $OutputDir) { $OutputDir = Join-Path $root 'deploy-out' }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stage = Join-Path $env:TEMP "mengli-deploy-$stamp"
$pkg = Join-Path $stage 'qqbot'
New-Item -ItemType Directory -Force -Path $pkg | Out-Null

Write-Host '复制源码（排除 venv、runtime、日志、实验文件和旧包）...'
$excludeDirs = @('.git', 'runtime', 'deploy-out', 'lab3', 'lab_doc', 'workspace', '.venv', '__pycache__')
$robocopyArgs = @($root, $pkg, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/XD') + $excludeDirs + @('/XF', 'node.zip', '*.log')
& robocopy @robocopyArgs | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy 失败，退出码 $LASTEXITCODE" }
New-Item -ItemType Directory -Force -Path (Join-Path $pkg 'workspace') | Out-Null

if (-not $NoData) {
  Write-Host '导出当前记忆和绑定（不含 secrets / logs / sessions）...'
  $data = Join-Path $pkg 'runtime-data'
  New-Item -ItemType Directory -Force -Path $data | Out-Null
  $sourceDb = Join-Path $root 'runtime\memory.db'
  if (Test-Path $sourceDb) {
    $targetDb = Join-Path $data 'memory.db'
    $jsFile = Join-Path $env:TEMP "mengli-vacuum-$stamp.js"
    @'
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[2]);
db.exec("VACUUM INTO '" + process.argv[3].replace(/'/g, "''") + "'");
db.close();
'@ | Set-Content -Path $jsFile -Encoding UTF8
    & node $jsFile $sourceDb $targetDb
    $vacuumCode = $LASTEXITCODE
    Remove-Item $jsFile -Force -ErrorAction SilentlyContinue
    if ($vacuumCode -ne 0) { throw '导出 memory.db 失败' }
    Write-Host '  已导出 memory.db'
  } else {
    Write-Warn '没有找到 runtime/memory.db，包内将没有记忆数据'
  }
  foreach ($name in @('mengli-bindings.json', 'bot-settings.json', 'mengli-push-state.json')) {
    $source = Join-Path (Join-Path $root 'runtime') $name
    if (Test-Path $source) {
      Copy-Item $source (Join-Path $data $name) -Force
      Write-Host "  已导出 $name"
    }
  }
}

$firstRun = @'
梦璃部署包（Windows Server）

1. 把整个 qqbot 文件夹放到例如 C:\QQbot。
2. 先安装 ZCode，并用将来运行看门狗的用户登录、配置 Provider。
3. 以该用户打开 PowerShell（建议管理员），运行：
   powershell -NoProfile -ExecutionPolicy Bypass -File C:\QQbot\deploy\deploy-server.ps1
4. 按提示输入 AppID/AppSecret/皮肤站 API key/推送 token；脚本会完成
   Python venv、记忆迁移、环境变量、看门狗和开机启动任务。
   注册开机任务时会询问一次当前 Windows 账号密码。
5. 打开 http://127.0.0.1:8765/api/health 确认 ok。
6. 如果账号没有密码或任务注册失败，请手动创建“开机时启动、不管用户是否登录都要运行”的任务，
   或使用 -LogonTask 并配置 Windows 自动登录。

这个包可能包含 runtime-data/memory.db 和绑定缓存，里面有群友聊天数据，不要公开分享。
'@
$firstRunPath = Join-Path $pkg 'FIRST-RUN.txt'
[IO.File]::WriteAllText($firstRunPath, $firstRun, (New-Object System.Text.UTF8Encoding($true)))

$zip = Join-Path $OutputDir "mengli-deploy-$stamp.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Write-Host '压缩部署包...'
Compress-Archive -Path $pkg -DestinationPath $zip -Force
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "部署包已生成：$zip" -ForegroundColor Green
if ($NoData) {
  Write-Host '包内数据：无（-NoData）'
} else {
  Write-Host '包内数据：包含 memory.db / 绑定 / 设置'
  Write-Host '提醒：包含记忆数据，不要上传公开仓库或发给无关人员。'
}
