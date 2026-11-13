# 梦璃 Linux 部署

目标系统：Ubuntu 22.04/24.04 或其他带 systemd 的 Linux。当前桥接已改成跨平台，但 **ZCode Linux CLI 仍需先在服务器上安装并验证**。

## 1. 准备

安装/确认：

- Node.js 24（至少 >=22.5，使用内置 `node:sqlite`）
- Python 3.10+（推荐 3.12）
- ZCode Linux 版，并完成 Provider 配置
- 可选：ffmpeg（媒体解析）、Noto CJK 字体（画像卡片）

部署脚本支持 `--install-deps`，在 Debian/Ubuntu 上会尝试安装 Python、venv、ffmpeg、Noto CJK，缺 Node 时用 NodeSource 安装 Node 24。

ZCode Provider 必须配置在运行机器人的用户下：

```text
/home/<user>/.zcode/v2/provider_config.json
```

最快方式是从当前 Windows 机器复制这个文件到服务器对应用户目录。手工配置时使用 OpenAI Chat Completions，Base URL：

```text
https://opencode.ai/zen/go/v1
```

主模型 `qwen3.8-flash`，备用 `deepseek-v4.1-flash`。API key 不要提交到 Git。

## 2. 解压和部署

```bash
sudo mkdir -p /opt/qqbot
sudo unzip mengli-deploy-linux-*.zip -d /opt
# 如果压缩包内层是 qqbot/，确认 /opt/qqbot/qqbot-agent-bridge.mjs 存在
cd /opt/qqbot
sudo bash deploy/linux/deploy-linux.sh --user <运行用户> --install-deps
```

脚本会：

- 检查 Node/Python/ZCode CLI/Provider；
- 创建 Python venv，安装 media-parser 和 Pillow；
- 导入 `runtime-data/` 中的记忆、绑定、设置；
- 提示输入 QQ/皮肤站密钥，写入 `~/.config/mengli/qqbot.env`（600）；
- 创建 `mengli-qqbot.service` 和 `mengli-monitor.service`；
- `systemctl enable --now` 启动两个服务；
- 检查 `http://127.0.0.1:8765/api/health`。

不需要有人登录；systemd 会开机启动。

## 3. 环境变量

环境文件默认：

```text
/home/<运行用户>/.config/mengli/qqbot.env
```

必填：

```text
QQBOT_APPID=...
QQBOT_SECRET=...
SWUSTMC_API_KEY=...
MENGLI_INGEST_TOKEN=...
QQBOT_AGENT_MODEL=qwen3.8-flash
QQBOT_MC_WATCH=1
QQBOT_MC_NOTIFY_GROUPS=群openid1,群openid2
QQBOT_AGENT_CWD=/opt/qqbot/workspace
```

如果 ZCode CLI 不在 PATH，增加：

```text
ZCODE_CLI=/绝对路径/zcode
```

## 4. 常用命令

```bash
systemctl status mengli-qqbot mengli-monitor
journalctl -u mengli-qqbot -u mengli-monitor -f
systemctl restart mengli-qqbot
curl http://127.0.0.1:8765/api/health
```

监控页只监听 `127.0.0.1:8765`，用 SSH 隧道访问，不要暴露公网。

## 5. 数据和备份

部署包默认包含：

- `runtime-data/memory.db`
- `runtime-data/mengli-bindings.json`
- `runtime-data/bot-settings.json`
- `runtime-data/mengli-push-state.json`

不包含 `sessions.json`、日志、媒体缓存和任何密钥。Linux 上会重新建立 ZCode 会话，群友画像和记忆保留。

备份运行中的数据：

```bash
cd /opt/qqbot
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('runtime/memory.db');db.exec(\"VACUUM INTO 'runtime/backup/memory-$(date +%F).db'\");db.close()"
```

## 6. 注意

- ZCode Linux CLI 的安装方式/路径以官方为准；脚本只检查 `command -v zcode` 或 `ZCODE_CLI`，无法自动登录。
- 如果 ZCode 没有 Linux 版或 Linux CLI 无法运行，仍需使用 Windows Server。
- 服务器需要能访问 `api.sgroup.qq.com`、`www.swustmc.com`、模型网关和媒体站点。
- 代理主 IP 没有玩家 sample 时，桥接会尝试皮肤站配置的“次 IP/备用线路”。
- 皮肤站插件需同步到 1.5.6 才能在站点编辑人设/提示词和群友记忆；站点 JAR 需要单独部署，不包含在这个 QQ 机器人包里。
- 新服务器验证正常后，停掉旧机器的看门狗/桥接，避免两个实例同时连接 QQ。
