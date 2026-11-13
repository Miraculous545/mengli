#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"

DRY_RUN=0
INSTALL_DEPS=0
SKIP_SYSTEMD=0
NON_INTERACTIVE=0
RUN_USER="${SUDO_USER:-${USER:-}}"
ENV_FILE=""

usage() {
  cat <<'EOF'
用法：
  sudo bash deploy/linux/deploy-linux.sh [选项]

选项：
  --user NAME           运行机器人的 Linux 用户（默认 sudo 发起用户）
  --env-file PATH       密钥环境文件（默认 ~/.config/mengli/qqbot.env）
  --install-deps        用 apt 安装 Python/ffmpeg/Noto 字体，缺 Node 时用 NodeSource 安装 Node 24
  --skip-systemd        不安装/启动 systemd 服务，只准备目录、依赖和环境文件
  --non-interactive     不提示输入，要求所需环境变量已设置
  --dry-run             只检查并打印动作，不修改系统
  -h, --help            显示帮助
EOF
}

say() { printf '\n==> %s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) RUN_USER="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --install-deps) INSTALL_DEPS=1; shift ;;
    --skip-systemd) SKIP_SYSTEMD=1; shift ;;
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "未知参数：$1" ;;
  esac
done

[[ "$(uname -s)" == "Linux" ]] || fail "这个脚本只支持 Linux"
[[ -f "$ROOT/qqbot-agent-bridge.mjs" ]] || fail "没有找到 qqbot-agent-bridge.mjs，请把整包解压后再运行"
[[ -n "$RUN_USER" ]] || fail "无法确定运行用户，请加 --user <用户名>"
id "$RUN_USER" >/dev/null 2>&1 || fail "用户不存在：$RUN_USER"
if [[ "$(id -u)" -eq 0 && "$RUN_USER" == "root" ]]; then
  fail "不要用 root 运行机器人；请加 --user <普通用户名>"
fi

RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
RUN_GROUP="$(id -gn "$RUN_USER")"
[[ -n "$RUN_HOME" && -d "$RUN_HOME" ]] || fail "无法确定 $RUN_USER 的 HOME"
ENV_FILE="${ENV_FILE:-$RUN_HOME/.config/mengli/qqbot.env}"

SUDO=""
if [[ "$(id -u)" -ne 0 ]]; then
  command -v sudo >/dev/null 2>&1 || fail "需要 root 或 sudo 来安装 systemd 服务"
  SUDO="sudo"
fi

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[dry-run] %q ' "$@"; printf '\n'
  else
    "$@"
  fi
}

root_run() {
  if [[ -n "$SUDO" ]]; then
    run "$SUDO" "$@"
  else
    run "$@"
  fi
}

as_user() {
  if [[ "$(id -u)" -eq 0 ]]; then
    if command -v runuser >/dev/null 2>&1; then
      runuser -u "$RUN_USER" -- "$@"
    else
      sudo -u "$RUN_USER" -- "$@"
    fi
  else
    "$@"
  fi
}

say "检查 Node.js"
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  if [[ "$INSTALL_DEPS" -eq 1 ]]; then
    command -v apt-get >/dev/null 2>&1 || fail "缺少 Node.js，且当前不是 apt 系统；请手动安装 Node.js 24"
    command -v curl >/dev/null 2>&1 || fail "缺少 curl，无法自动安装 Node.js；请手动安装 Node.js 24"
    say "用 NodeSource 安装 Node.js 24（需要网络和 root）"
    run bash -c "curl -fsSL https://deb.nodesource.com/setup_24.x | $SUDO bash -"
    root_run apt-get install -y nodejs
    NODE_BIN="$(command -v node || true)"
  fi
fi
[[ -n "$NODE_BIN" ]] || fail "缺少 Node.js 24。请安装后重试，或加 --install-deps"
NODE_VERSION="$("$NODE_BIN" -v | sed 's/^v//')"
NODE_MAJOR="${NODE_VERSION%%.*}"
NODE_REST="${NODE_VERSION#*.}"
NODE_MINOR="${NODE_REST%%.*}"
if [[ "$NODE_MAJOR" -lt 22 || ( "$NODE_MAJOR" -eq 22 && "$NODE_MINOR" -lt 5 ) ]]; then
  fail "Node.js 版本过低：$NODE_VERSION；需要 24（至少 >=22.5）"
fi
printf '    Node.js %s: %s\n' "$NODE_VERSION" "$NODE_BIN"

say "检查 Python"
PYTHON_BIN="$(command -v python3 || true)"
if [[ -z "$PYTHON_BIN" && "$INSTALL_DEPS" -eq 1 ]] && command -v apt-get >/dev/null 2>&1; then
  root_run apt-get update
  root_run apt-get install -y python3 python3-venv python3-pip ffmpeg fonts-noto-cjk curl unzip
  PYTHON_BIN="$(command -v python3 || true)"
fi
[[ -n "$PYTHON_BIN" ]] || fail "缺少 python3。请安装 Python 3.10+，或加 --install-deps"
"$PYTHON_BIN" -c 'import sys; assert sys.version_info >= (3, 10)' || fail "Python 版本过低，需要 3.10+"
printf '    Python: %s\n' "$PYTHON_BIN"

if [[ "$INSTALL_DEPS" -eq 1 ]] && command -v apt-get >/dev/null 2>&1; then
  say "安装常用依赖（ffmpeg / Noto CJK / venv）"
  root_run apt-get install -y python3-venv python3-pip ffmpeg fonts-noto-cjk curl unzip
fi

say "检查 ZCode CLI 和 Provider"
ZCODE_CLI="${ZCODE_CLI:-}"
if [[ -z "$ZCODE_CLI" ]]; then
  ZCODE_CLI="$(command -v zcode || true)"
fi
if [[ -z "$ZCODE_CLI" && -x "$RUN_HOME/.local/bin/zcode" ]]; then
  ZCODE_CLI="$RUN_HOME/.local/bin/zcode"
fi
[[ -n "$ZCODE_CLI" ]] || fail "找不到 ZCode CLI。请安装 ZCode Linux 版，或设置 ZCODE_CLI 指向可执行文件"
ZCODE_PROVIDER="$RUN_HOME/.zcode/v2/provider_config.json"
[[ -f "$ZCODE_PROVIDER" ]] || fail "找不到 $ZCODE_PROVIDER；请先用 $RUN_USER 登录 ZCode 并配置 Provider"
printf '    ZCode CLI: %s\n    Provider: %s\n' "$ZCODE_CLI" "$ZCODE_PROVIDER"

say "准备目录"
run mkdir -p "$ROOT/runtime/backup" "$ROOT/runtime/media-cache" "$ROOT/runtime/inbound-media" "$ROOT/runtime/profile-cards" "$ROOT/workspace" "$ROOT/media-parser"
if [[ "$(id -u)" -eq 0 ]]; then
  run chown -R "$RUN_USER:$RUN_GROUP" "$ROOT"
fi

if [[ -d "$ROOT/runtime-data" ]]; then
  say "迁移 runtime-data"
  if [[ -f "$ROOT/runtime/memory.db" && "$DRY_RUN" -eq 0 ]]; then
    cp -f "$ROOT/runtime/memory.db" "$ROOT/runtime/backup/memory-before-linux-$(date +%Y%m%d-%H%M%S).db"
  fi
  for name in memory.db mengli-bindings.json bot-settings.json mengli-push-state.json; do
    if [[ -f "$ROOT/runtime-data/$name" ]]; then
      run cp -f "$ROOT/runtime-data/$name" "$ROOT/runtime/$name"
      printf '    %s\n' "$name"
    fi
  done
  if [[ "$(id -u)" -eq 0 ]]; then
    run chown -R "$RUN_USER:$RUN_GROUP" "$ROOT/runtime"
  fi
else
  warn "没有 runtime-data/，将使用空记忆启动。"
fi

say "创建 Python venv 并安装依赖"
if [[ ! -x "$ROOT/media-parser/.venv/bin/python" ]]; then
  run as_user "$PYTHON_BIN" -m venv "$ROOT/media-parser/.venv"
fi
if [[ "$DRY_RUN" -eq 0 ]]; then
  run as_user "$ROOT/media-parser/.venv/bin/python" -m pip install -U pip
  run as_user "$ROOT/media-parser/.venv/bin/python" -m pip install -r "$ROOT/media-parser/requirements-min.txt"
fi

read_required() {
  local name="$1" secret="${2:-0}" value=""
  value="${!name:-}"
  if [[ -n "$value" ]]; then
    printf '%s' "$value"
    return
  fi
  if [[ "$NON_INTERACTIVE" -eq 1 || "$DRY_RUN" -eq 1 ]]; then
    warn "环境变量 $name 未设置"
    return
  fi
  if [[ "$secret" -eq 1 ]]; then
    local value2
    read -rsp "请输入 $name: " value2
    printf '\n' >&2
    printf '%s' "$value2"
  else
    local value3
    read -rp "请输入 $name: " value3
    printf '%s' "$value3"
  fi
}

say "配置环境文件"
if [[ -f "$ENV_FILE" ]]; then
  # 已存在的环境文件优先，缺项再提示
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
APP_ID="$(read_required QQBOT_APPID 0)"
APP_SECRET="$(read_required QQBOT_SECRET 1)"
SKIN_KEY="$(read_required SWUSTMC_API_KEY 1)"
INGEST_TOKEN="$(read_required MENGLI_INGEST_TOKEN 1)"
if [[ "$DRY_RUN" -eq 0 ]]; then
  [[ -n "$APP_ID" && -n "$APP_SECRET" && -n "$SKIN_KEY" && -n "$INGEST_TOKEN" ]] || fail "缺少必填密钥；请设置环境变量或交互输入"
fi

MODEL="${QQBOT_AGENT_MODEL:-qwen3.8-flash}"
MC_WATCH="${QQBOT_MC_WATCH:-1}"
MC_GROUPS="${QQBOT_MC_NOTIFY_GROUPS:-}"
if [[ -z "$MC_GROUPS" && "$NON_INTERACTIVE" -eq 0 && "$DRY_RUN" -eq 0 ]]; then
  read -rp "MC 播报群 openid（逗号分隔，留空关闭播报）: " MC_GROUPS
fi
if [[ -z "$MC_GROUPS" ]]; then MC_WATCH=0; fi

if [[ "$DRY_RUN" -eq 0 ]]; then
  mkdir -p "$(dirname "$ENV_FILE")"
  umask 077
  {
    printf 'QQBOT_APPID=%s\n' "$APP_ID"
    printf 'QQBOT_SECRET=%s\n' "$APP_SECRET"
    printf 'SWUSTMC_API_KEY=%s\n' "$SKIN_KEY"
    printf 'MENGLI_INGEST_TOKEN=%s\n' "$INGEST_TOKEN"
    printf 'QQBOT_AGENT_MODEL=%s\n' "$MODEL"
    printf 'QQBOT_MC_WATCH=%s\n' "$MC_WATCH"
    printf 'QQBOT_MC_NOTIFY_GROUPS=%s\n' "$MC_GROUPS"
    printf 'QQBOT_AGENT_CWD=%s\n' "$ROOT/workspace"
    printf 'HOME=%s\n' "$RUN_HOME"
    if [[ -n "${ZCODE_CLI:-}" ]]; then printf 'ZCODE_CLI=%s\n' "$ZCODE_CLI"; fi
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  if [[ "$(id -u)" -eq 0 ]]; then chown "$RUN_USER:$RUN_GROUP" "$ENV_FILE"; fi
  printf '    已写入 %s\n' "$ENV_FILE"
fi

if [[ "$SKIP_SYSTEMD" -eq 1 ]]; then
  say "跳过 systemd"
  printf '手动启动：\n  cd %s\n  set -a; source %s; set +a\n  %s qqbot-agent-bridge.mjs\n  %s monitor/server.mjs\n' "$ROOT" "$ENV_FILE" "$NODE_BIN" "$NODE_BIN"
  exit 0
fi

say "安装 systemd 服务"
BRIDGE_UNIT="/etc/systemd/system/mengli-qqbot.service"
MONITOR_UNIT="/etc/systemd/system/mengli-monitor.service"
BRIDGE_CONTENT="[Unit]
Description=Mengli QQ Bot Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_GROUP
WorkingDirectory=$ROOT
EnvironmentFile=$ENV_FILE
Environment=HOME=$RUN_HOME
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=$NODE_BIN $ROOT/qqbot-agent-bridge.mjs
Restart=always
RestartSec=5
TimeoutStopSec=30
KillMode=mixed
UMask=0077
NoNewPrivileges=true
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
"
MONITOR_CONTENT="[Unit]
Description=Mengli QQ Bot Monitor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_GROUP
WorkingDirectory=$ROOT
EnvironmentFile=$ENV_FILE
Environment=HOME=$RUN_HOME
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=$NODE_BIN $ROOT/monitor/server.mjs
Restart=always
RestartSec=5
TimeoutStopSec=15
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
"
if [[ "$DRY_RUN" -eq 1 ]]; then
  printf '[dry-run] install %s\n[dry-run] install %s\n' "$BRIDGE_UNIT" "$MONITOR_UNIT"
else
  printf '%s' "$BRIDGE_CONTENT" | root_run tee "$BRIDGE_UNIT" >/dev/null
  printf '%s' "$MONITOR_CONTENT" | root_run tee "$MONITOR_UNIT" >/dev/null
  root_run systemctl daemon-reload
  root_run systemctl enable --now mengli-qqbot.service mengli-monitor.service
fi

if [[ "$DRY_RUN" -eq 0 ]]; then
  say "等待健康检查"
  HEALTHY=0
  for _ in $(seq 1 30); do
    sleep 1
    if "$NODE_BIN" -e 'fetch("http://127.0.0.1:8765/api/health").then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))' >/dev/null 2>&1; then
      HEALTHY=1
      break
    fi
  done
  if [[ "$HEALTHY" -ne 1 ]]; then
    warn "健康检查未通过，查看：journalctl -u mengli-qqbot -u mengli-monitor -n 100 --no-pager"
    exit 1
  fi
  printf '\n部署完成。监控：http://127.0.0.1:8765/\n'
  printf '服务状态：systemctl status mengli-qqbot mengli-monitor\n'
  printf '日志：journalctl -u mengli-qqbot -u mengli-monitor -f\n'
else
  printf '\nDryRun 完成，未修改系统。\n'
fi
