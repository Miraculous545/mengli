# 梦璃一键部署包说明

这个包用于 **Windows Server 2022**。Linux 暂不支持，需要先做跨平台改造。

## 使用步骤

1. 解压到例如 `C:\QQbot`。
2. 用将来运行机器人的 Windows 用户安装 ZCode，登录并配置 Provider。
3. 打开 PowerShell，运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\QQbot\deploy\deploy-server.ps1
```

也可以双击 `deploy\start-deploy.cmd`。

脚本会：

- 检查 Node.js 24 / Python 3.12 / ZCode；
- 创建 Python venv 并安装媒体解析和画像卡片依赖；
- 把包内 `runtime-data/` 的 `memory.db`、绑定和设置导入 `runtime/`；
- 提示输入 QQ/皮肤站密钥并写入当前用户环境变量；
- 启动看门狗；
- 注册“开机时启动、不管用户是否登录都要运行”的任务计划（会询问一次当前 Windows 账号密码）；
- 检查 `http://127.0.0.1:8765/api/health`。

## 必要的手工项

- ZCode 登录和 Provider 配置无法打进包，必须在服务器上完成。
- 密钥不会包含在压缩包里；脚本会交互式询问，或读取当前用户已有的环境变量。
- 开机任务需要当前 Windows 账号密码；如果账号没有密码、使用 Microsoft 账号导致注册失败，可以改用 `-LogonTask` 并把服务器配置为自动登录。
- 监控页只监听 `127.0.0.1:8765`，不要暴露公网。

## 包内数据

默认包含：

- `runtime-data/memory.db`：群友记忆
- `runtime-data/mengli-bindings.json`：皮肤站绑定缓存
- `runtime-data/bot-settings.json`：机器人设置
- `runtime-data/mengli-push-state.json`：推送游标（如有）

不包含：

- `runtime/sessions.json`
- 日志、PID、媒体缓存、画像卡片缓存
- 任何 AppSecret / API key / 推送 token

包含群友聊天数据，不要把包上传公开仓库或发给无关人员。

## 重新打包

在开发机 `QQbot` 目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy\build-deploy-package.ps1
```

生成 `deploy-out\mengli-deploy-<时间>.zip`。不想带记忆数据时加 `-NoData`。

## 命令行参数

`deploy-server.ps1` 支持：

- `-DryRun`：只检查环境，不修改配置/不启动。
- `-NonInteractive`：不提示输入，要求所需环境变量已配置。
- `-SkipDeps`：不自动尝试安装 Node/Python。
- `-SkipTask`：不注册任务计划。
- `-LogonTask`：改为注册“登录时启动”，适用于服务器自动登录、但无法提供 Windows 密码的情况。
