# 梦璃 QQ 机器人服务器部署

本文按当前代码的实际依赖编写。当前桥接使用 Windows 的 `taskkill`、PowerShell 看门狗和 Windows 版 ZCode 路径，**优先推荐 Windows Server 2022**；Linux 需要先做跨平台改造，见文末。

## 1. 服务器规格

- Windows Server 2022（Desktop Experience），2 核 4G 起，40G 磁盘。
- 时区设为 `Asia/Shanghai`，否则 `/服务器` 时间和日志会对不上。
- 关闭自动睡眠；服务器重启后要能自动拉起看门狗。
- 网络只需出站 443：QQ 网关、皮肤站、模型网关和媒体站点；不需要公网入站端口。
- 监控页只监听 `127.0.0.1:8765`，通过 RDP/VPN 或 SSH 隧道访问，不要直接暴露公网。

## 2. 安装依赖

### Node.js

安装 Node.js 24（桥接使用内置 `node:sqlite`，不要用过旧版本）。确认：

```bat
node -v
```

### Python

安装 Python 3.12，然后在 `QQbot` 目录创建虚拟环境：

```bat
py -3.12 -m venv media-parser\.venv
media-parser\.venv\Scripts\python.exe -m pip install -U pip
media-parser\.venv\Scripts\python.exe -m pip install -r media-parser\requirements-min.txt
```

`requirements-min.txt` 已包含 Pillow，画像卡片和媒体解析共用这个环境。需要解析视频时再安装 `ffmpeg` 并加入 PATH。

### ZCode

安装 ZCode，完成登录/Provider 配置，确保当前 Windows 用户下存在：

```text
%USERPROFILE%\.zcode\v2\provider_config.json
```

并用同一用户测试无头 CLI：

```bat
"C:\Program Files\ZCode\resources\glm\zcode.cjs" -p "只回复OK" --json --no-color --cwd "D:\QQbot\workspace" --mode guarded --locale zh-CN
```

如果安装路径不同，设置 `ZCODE_CLI`。这一步必须用**将来运行看门狗的那个 Windows 用户**执行，否则找不到 provider 配置和模型凭据。

### Provider 配置

最快的方式是把当前这台机器已经能用的 Provider 配置复制过去：

1. 关闭当前机器和服务器上的 ZCode。
2. 把当前机器的 `%USERPROFILE%\.zcode\v2\provider_config.json` 复制到服务器**运行看门狗的那个用户**的同一路径。
3. 确认文件里包含 `providerRules`、`baseUrl` 和 `apiKey`；这个文件含密钥，不要提交 Git 或发给别人。
4. 启动 ZCode，确认模型列表能看到 `qwen3.8-flash`。

如果手工新建，Provider 填：

```text
类型：OpenAI Chat Completions（OpenAI 兼容）
Base URL：https://opencode.ai/zen/go/v1
模型：qwen3.8-flash
备用模型：deepseek-v4.1-flash
API Key：从当前机器的 provider_config.json 里取，不要贴到聊天
```

QQ 机器人通过 `QQBOT_AGENT_MODEL=qwen3.8-flash` 使用这个模型；桥接会在 `runtime/` 里生成机器人专用 provider 配置，不修改桌面 ZCode 的模型选择。配置好后用上面的 CLI 命令测试，返回 `"response": "OK"` 即可。

## 3. 复制哪些文件

复制整个 `QQbot` 源码目录，但排除：

- `runtime/`（数据要单独迁移）
- `media-parser/.venv/`
- `media-parser/__pycache__/`、`profile-card/__pycache__/`
- `workspace/` 里的临时文件
- `lab3/`、`lab_doc/`、`node.zip`、日志
- `.git/`（服务器不需要）

必须保留：

```text
qqbot-agent-bridge.mjs
mc-watch.mjs
mc-ping.mjs
skin-site.mjs
mengli-site.mjs
mengli-push.mjs
memory/store.mjs
monitor/
media-parser/（不要 venv）
profile-card/render_profile_card.py
persona/mc-mengli.md
watchdog.ps1
```

## 4. 迁移数据

先在旧机器停止桥接/看门狗，再用 SQLite 的 `VACUUM INTO` 做一致性备份：

```bat
mkdir runtime\backup
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('runtime/memory.db');db.exec(\"VACUUM INTO 'runtime/backup/memory-move.db'\");db.close()"
```

把以下文件复制到新服务器对应的 `runtime/`：

- `runtime/backup/memory-move.db` → `runtime/memory.db`
- `runtime/mengli-bindings.json`（皮肤站绑定缓存，必须带）
- `runtime/bot-settings.json`（自动回复、记忆、独立群等设置）
- `runtime/mengli-push-state.json`（可选；带上可避免向皮肤站重复推日志）

不要复制：

- `runtime/sessions.json`：ZCode session 绑定的是旧机器的 CLI 数据库，复制过去容易恢复失败；让机器人在新机器重新开会话，群友画像还在。
- `runtime/*.log`、`*.pid`、`media-cache/`、`inbound-media/`、`profile-cards/`：缓存和运行时文件，可重新生成。

如果使用皮肤站插件推送，确认 `MENGLI_INGEST_TOKEN` 与站点插件当前 token 一致；不一致会导致日志/绑定推送失败。

## 5. 环境变量

在**运行看门狗的用户**下配置用户环境变量。不要写进仓库或脚本。

必填：

| 变量 | 说明 |
|---|---|
| `QQBOT_APPID` | QQ 开放平台机器人 AppID |
| `QQBOT_SECRET` | QQ 开放平台机器人 AppSecret |
| `SWUSTMC_API_KEY` | 皮肤站只读 API key |
| `MENGLI_INGEST_TOKEN` | 梦璃插件推送 token |
| `QQBOT_AGENT_MODEL` | 建议 `qwen3.8-flash`；留空则跟随 ZCode 默认 |

MC 播报和访问控制：

| 变量 | 说明 |
|---|---|
| `QQBOT_MC_WATCH` | `1` 开启服务器播报 |
| `QQBOT_MC_NOTIFY_GROUPS` | 播报群 openid，逗号分隔 |
| `QQBOT_ALLOW_GROUPS` | 可选；只允许这些群使用 |
| `QQBOT_ALLOW_USERS` | 可选；只允许这些用户使用 |
| `SWUSTMC_ADMIN_COOKIE` | 可选；补充在线玩家名单 |

其他常用项：

| 变量 | 默认/建议 |
|---|---|
| `QQBOT_AGENT_CWD` | 默认 `QQbot/workspace` |
| `QQBOT_AGENT_MODE` | `guarded` |
| `QQBOT_MONITOR_HOST` | `127.0.0.1` |
| `QQBOT_MONITOR_PORT` | `8765` |
| `QQBOT_SESSION_MAX_CONTEXT` | `50000` |
| `QQBOT_SESSION_MAX_TURNS` | `30` |
| `QQBOT_MC_NAME_WAIT_POLLS` | `3` |

PowerShell 示例（把值换成真实值；不要把这段带真实密钥发到聊天里）：

```powershell
$vars = @{
  QQBOT_APPID = '<APPID>'
  QQBOT_SECRET = '<SECRET>'
  SWUSTMC_API_KEY = '<SKIN_API_KEY>'
  MENGLI_INGEST_TOKEN = '<INGEST_TOKEN>'
  QQBOT_AGENT_MODEL = 'qwen3.8-flash'
  QQBOT_MC_WATCH = '1'
  QQBOT_MC_NOTIFY_GROUPS = '<GROUP_OPENID_1>,<GROUP_OPENID_2>'
}
foreach ($item in $vars.GetEnumerator()) {
  [Environment]::SetEnvironmentVariable($item.Key, $item.Value, 'User')
}
```

设置后必须重启看门狗/重新登录该用户，环境变量才会进入新进程。修改 `QQBOT_AGENT_MODEL` 后旧 ZCode 会话会自动重开一次，群友画像和记忆仍然保留。

## 6. 启动方式

不要用 `start-qqbot.cmd` 做服务器开机启动，它会打开浏览器。用任务计划程序：

- 触发器：`启动时`
- 用户：运行 ZCode 的专用 Windows 用户
- 勾选“不管用户是否登录都要运行”
- 程序：`powershell.exe`
- 参数：

```text
-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "D:\QQbot\watchdog.ps1"
```

`watchdog.ps1` 会负责拉起桥接和监控，并每 15 秒检查一次。服务器重启后它会自动恢复。

## 7. 启动后检查

```powershell
curl.exe http://127.0.0.1:8765/api/health
```

应返回 `{"ok":true,...}`。再看：

- `runtime/agent-bridge.log`：应出现 `READY`、`目标群 N 个`、`model=qwen3.8-flash`
- `runtime/watchdog.log`：应有 bridge/monitor 启动记录
- QQ 群 @ 梦璃发 `/我的记忆`、`/服务器`
- 查看 `runtime/bridge-status.json` 的 `connected` 和 `lastError`

## 8. 备份

建议每天备份：

- `runtime/memory.db`
- `runtime/mengli-bindings.json`
- `runtime/bot-settings.json`

SQLite 运行中不要直接复制 `memory.db`，用 `VACUUM INTO` 或先停桥接。备份文件不要提交到 Git。

## 9. Linux 注意事项

当前代码不能直接原样搬 Linux：

- `watchdog.ps1` 是 PowerShell 脚本。
- `killTree()` 调用 `taskkill`，Linux 上无法停止 agent。
- ZCode provider 发现路径写死了 `windows-x86_64`。
- `start-*.cmd` 是 Windows 批处理。

如果一定要用 Linux，需要先做跨平台改造，至少包括：

1. provider 根目录按 `process.platform` 选择 `linux-x86_64` / `windows-x86_64`。
2. `killTree` 在 Linux 使用进程组 `kill` 或 `pkill -P`。
3. 用 systemd 替代 `watchdog.ps1`，分别托管 bridge 和 monitor。
4. 确认 ZCode 官方 Linux CLI 可用，并重新登录/配置 provider。
5. 安装 Noto CJK 字体，设置 `QQBOT_PROFILE_FONT` / `QQBOT_PROFILE_FONT_BOLD`。

在完成这些改造前，优先选 Windows Server；它和当前代码、看门狗、`taskkill`、ZCode 路径完全一致，迁移风险最低。
