param(
  [string]$OutputDir = '',
  [switch]$NoData
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $OutputDir) { $OutputDir = Join-Path $root 'deploy-out' }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

function Write-Warn([string]$message) {
  Write-Host "WARN: $message" -ForegroundColor Yellow
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stage = Join-Path $env:TEMP "mengli-linux-$stamp"
$pkg = Join-Path $stage 'qqbot'
New-Item -ItemType Directory -Force -Path $pkg | Out-Null

Write-Host '复制 Linux 源码（排除 Windows 看门狗、旧部署脚本和运行时）...'
$excludeDirs = @('.git', 'runtime', 'deploy-out', 'lab3', 'lab_doc', 'workspace', '.venv', '__pycache__', 'deploy')
$robocopyArgs = @($root, $pkg, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/XD') + $excludeDirs + @('/XF', 'node.zip', '*.log', 'watchdog.ps1', 'start-*.cmd')
& robocopy @robocopyArgs | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy 失败，退出码 $LASTEXITCODE" }
New-Item -ItemType Directory -Force -Path (Join-Path $pkg 'workspace') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $pkg 'deploy\linux') | Out-Null
Copy-Item (Join-Path $root 'deploy\linux\deploy-linux.sh') (Join-Path $pkg 'deploy\linux\deploy-linux.sh') -Force
Copy-Item (Join-Path $root 'deploy\linux\README-LINUX.md') (Join-Path $pkg 'deploy\linux\README-LINUX.md') -Force

# Zip does not preserve executable bits reliably, and Windows CRLF breaks shebang; normalize shell files.
Get-ChildItem $pkg -Recurse -Filter *.sh | ForEach-Object {
  $text = [IO.File]::ReadAllText($_.FullName)
  $text = $text -replace "`r`n", "`n" -replace "`r", "`n"
  [IO.File]::WriteAllText($_.FullName, $text, (New-Object System.Text.UTF8Encoding($false)))
}

if (-not $NoData) {
  Write-Host '导出记忆和绑定...'
  $data = Join-Path $pkg 'runtime-data'
  New-Item -ItemType Directory -Force -Path $data | Out-Null
  $sourceDb = Join-Path $root 'runtime\memory.db'
  if (Test-Path $sourceDb) {
    $targetDb = Join-Path $data 'memory.db'
    $jsFile = Join-Path $env:TEMP "mengli-vacuum-linux-$stamp.js"
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
    Write-Warn '没有 runtime/memory.db，Linux 包将使用空记忆'
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
梦璃 Linux 部署包

1. 解压到例如 /opt/qqbot。
2. 用运行机器人的用户安装/登录 ZCode，配置 Provider：
   /home/<user>/.zcode/v2/provider_config.json
3. 以 root 执行：
   cd /opt/qqbot
   bash deploy/linux/deploy-linux.sh --user <运行用户> --install-deps
4. 按提示输入 AppID/AppSecret/皮肤站 API key/推送 token 和 MC 群 openid。
5. 脚本会创建 venv、导入 runtime-data、安装 systemd 服务并开机启动。
6. 验证：curl http://127.0.0.1:8765/api/health

注意：
- ZCode Linux CLI 必须先可用；脚本会检查 ZCODE_CLI 或 PATH 中的 zcode。
- 这个包包含群友记忆和绑定数据，不要公开分享。
- 先确认 Linux 版 ZCode 能正常运行，再切换正式机器人。
'@
[IO.File]::WriteAllText((Join-Path $pkg 'FIRST-RUN-LINUX.txt'), $firstRun, (New-Object System.Text.UTF8Encoding($true)))

$zip = Join-Path $OutputDir "mengli-deploy-linux-$stamp.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Write-Host '压缩 Linux 部署包...'
Compress-Archive -Path $pkg -DestinationPath $zip -Force
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host "Linux 部署包已生成：$zip" -ForegroundColor Green
if ($NoData) {
  Write-Host '包内数据：无（-NoData）'
} else {
  Write-Host '包内数据：包含 memory.db / 绑定 / 设置'
  Write-Host '提醒：包含群友数据，不要公开分享。'
}
