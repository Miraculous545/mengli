# QQ ⇄ ZCode agent 桥

把 QQ 官方机器人接到本机 ZCode：QQ 私聊或群聊 @ 机器人后，由无头 ZCode 会话处理，再把回复发回 QQ。每个 QQ 会话对应一个独立的 ZCode 会话，可连续追问；支持断线重连、消息队列、基本指令和媒体链接解析。

它调用的是同一套 ZCode CLI、模型和配置，但每个 QQ 会话是新开的 agent 会话，不共享桌面里这个对话的记忆。默认工作目录是 `QQbot/workspace`；需要它直接改插件仓库时把 `QQBOT_AGENT_CWD` 指到仓库目录。

## 启动

凭据只从环境变量读取，不写入仓库：

```bat
setx QQBOT_APPID 你的AppID
setx QQBOT_SECRET 你的AppSecret
```

`setx` 对之后新开的终端生效。然后运行：

```bat
start-qqbot.cmd
```

它会以隐藏窗口启动看门狗，由看门狗拉起桥接和监控，并打开 <http://127.0.0.1:8765/>。看门狗每 15 秒检查一次，桥接或监控退出后会自动重启；日志在 `runtime/watchdog.log`。

登录自启已配置到当前用户的启动文件夹：`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\QQbotMengli.vbs`。它只负责以隐藏窗口运行 `watchdog.ps1`，凭据仍从用户环境变量读取，不落盘。删除这个 `.vbs` 即可取消开机自启。

停止时先停看门狗，避免它再把子进程拉起来：

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'watchdog\.ps1' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'qqbot-agent-bridge\.mjs|monitor/server\.mjs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

机器人同时只能有一个网关连接：启动前不要在其他地方用同一个 AppID 再连一份。

## 使用

- 私聊直接发消息。
- 群聊需要 @ 机器人。
- 每个群/每个私聊各自维护上下文，互不影响。
- 单个 ZCode 会话上下文超过 5 万 tokens 或复用 30 轮后会自动重开，避免越聊越慢；群友记忆和最近聊天仍会注入，不会因为重开而“失忆”。
- 群聊回复可能被拆成多条（单条约 1400 字），最多 5 条。

内置指令：

| 指令 | 作用 |
|---|---|
| `/new` `/reset` `/clear` `/新对话` | 清空当前会话，开始新对话 |
| `/stop` `/停止` | 中止当前任务（会杀掉正在跑的 agent） |
| `/bot-ping` `/ping` | 网关与队列状态 |
| `/bot-status` `/status` | 当前会话状态 |
| `/persona` `/人设` | 查看人设是否已加载 |
| `/媒体解析` `/media` | 查看/开关媒体链接自动解析；`/媒体解析 开`、`/媒体解析 关` |
| `/记住 <内容>` | 让梦璃记住当前群友的一件事 |
| `/是谁 <名字>` | 查当前群里某位群友的画像 |
| `/我的记忆` | 查看梦璃记住的当前群友画像/备注 |
| `/我的画像` | 用梦璃记忆生成当前用户的画像图片卡片 |
| `/忘记我` | 清除该 QQ 用户的全局记忆（所有群和私聊） |
| `/记忆` | 记忆开关、保留天数与库统计 |
| `/整理记忆` | 让模型重新整理当前群友画像 |
| `/bot-help` `/help` | 指令列表 |

## 群友记忆

同一位 QQ 用户（同一 openid）在群聊和私聊里共用一份记忆，存放在本地 SQLite `runtime/memory.db`，字段对齐 YuDream ai-chatbot 的画像模型：摘要、人格、互动风格、标签、事实、消息/回复计数、最近活跃与最近分析时间。数据库会保留该用户出现过的群/私聊映射，用于群内点名和站点“我的记忆”过滤，但画像、消息和备注本身已合并。

- 默认同一 QQ 用户在测试群和私聊中共用一份记忆。监控页设置里的“独立记忆群”可以填一个或多个群 openid（逗号/空格分隔），这些群会从空画像开始，只记录本群发言，测试群和私聊看不到它的画像，它也不会读取测试群的画像。大群正式启用前把大群 openid 加进去即可，下一条消息生效，不需要重启。
- 独立群按 openid 隔离；左侧群列表的复制按钮可以拿到 openid。把群从独立列表移除时，已有独立画像会合并回全局画像；不想合并就先在该群发 `/忘记我` 清空。
- 回复前会把该群友的画像、备注、最近几条发言拼成一小段注入提示词；`/new` 不会清掉记忆库。
- 绑定用户的显示名固定为皮肤站昵称；记忆只保留这一个称呼，群名片只用于识别和提及匹配，不会用来称呼用户。`/绑定` 已停用，不能自定义昵称或别名。未绑定用户暂时使用群昵称，但同样不接受哥哥/姐姐/御姐等关系称呼。
- QQ 官方群消息里的 @ 可能只带 openid，部分群事件甚至只留下空格占位、不返回被 @ 用户的信息；桥接能解析时用昵称，解析不到时用“你 @ 的那位”指代。当前应用没有群成员信息接口权限时（接口返回 `11253 应用无接口访问权限`），无法自动获取最新群名片；要完整支持 @ 提及和群名片，需要换 OneBot/NapCat 等协议，或让用户用普通文字写名字。
- 问“我是谁/你认识我吗/说说我”或“谁谁谁是谁”时，会先叫出昵称，再结合画像摘要、人格特点、互动风格、标签和最近发言描述，并轻微参考对方的说话语气；不会只说“不知道/只是群友”。
- `/是谁 奈璟柠` 可以直接查当前群里该群友的画像。
- `/我的画像` 会把同一份画像渲染成 PNG 卡片：摘要/人格作为“人格画像”，加上互动风格、标签和互动/触发/完成回复统计。头像优先读取皮肤站账号头像（只读 API key 访问用户资料），下载后裁成圆形；没有绑定、没有头像或接口失败时回退到首字母。卡片和头像缓存在 `runtime/profile-cards/`，7 天自动清理；渲染脚本在 `profile-card/render_profile_card.py`，依赖 Pillow 和中文字体。
- 注意：官方 QQ 群事件只提供群昵称和成员 openid，不提供真实 QQ 号。绑定用户的称呼以皮肤站昵称为准；QQ 号只用于识别，不会作为称呼输出。
- `/记住 喜欢红石` 记手动备注；`/忘记我` 删除该 QQ 用户的全局记忆（包括所有群和私聊）。
- `/整理记忆` 会用模型把发言沉淀成摘要/人格/互动风格/标签/事实；也可以在监控页设置自动画像（每 N 条触发一次，默认关闭）。
- 监控页「记忆」标签可以搜索群友、查看画像/备注/最近发言，编辑摘要/人格/标签、增删备注或删除整个记忆。
- 消息默认保留 90 天，可在监控页设置里改保留天数；`/忘记我` 和监控页删除立即生效。

隐私提醒：记忆库只在本机 `runtime/memory.db`，但会保存群友发言文字。开放群里使用建议先告知成员，并设置合理的保留天数；不需要时可在监控页关闭记忆。

## 媒体链接解析

发支持平台的链接时，桥接会先快速识别标题/作者等元数据，让梦璃先把评论发回来；视频在后台继续下载，下载完再把媒体补发到同一个会话。这样首条回复不用等整个视频下完。默认开启，可用 `/媒体解析 关` 关闭。

B站默认限制到 480P（`QQBOT_MEDIA_BILI_MAX_QN=32`）以加快下载；想更清晰可设 `64`（720P）/`80`（1080P），想最高画质设 `0`。

支持的平台（31 个）：B站、抖音、快手、AcFun、红果短剧、网易云音乐、喜马拉雅、微博、小红书、闲鱼、今日头条、小黑盒、雪球、微信公众号/视频号、知乎、百度贴吧、NGA、虎扑、豆瓣、V2EX、稀土掘金、CSDN、博客园、Gitee、TikTok、YouTube、Steam、Twitter/X、Pixiv、GitHub、GitLab。

默认限制：视频 50MB、音频 20MB、图片 3 张（单张 15MB），一次最多 4 个媒体加 1 条评论。解析核心来自 `media-parser/vendor/astrbot_plugin_media_parser`（AGPLv3，见该目录 `LICENSE` 与 `README.upstream.md`），适配层是 `media-parser/parse_media.py`。

首次部署或移动目录后，重建 Python 依赖：

```bat
cd media-parser
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-min.txt
```

单独测试解析器：

```bat
media-parser\.venv\Scripts\python.exe media-parser\parse_media.py --url "https://www.bilibili.com/video/BV..."
media-parser\.venv\Scripts\python.exe media-parser\parse_media.py --list-platforms
```

媒体缓存放在 `runtime/media-cache`，超过 6 小时的旧文件会在下次解析时清理。

## 配置

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `QQBOT_APPID` | 必填 | QQ 机器人 AppID |
| `QQBOT_SECRET` | 必填 | QQ 机器人 AppSecret |
| `QQBOT_AGENT_CWD` | `./workspace` | agent 工作目录；想让它直接改插件仓库可指向仓库根 |
| `QQBOT_AGENT_MODE` | `guarded` | `guarded` 会拦住危险命令；`yolo` 全放开；`plan` 只读 |
| `QQBOT_AGENT_TIMEOUT_MS` | `120000` | 单轮超时；避免图片处理卡住时长时间不回复 |
| `QQBOT_MEDIA_ENABLED` | `1` | 是否默认开启媒体链接解析 |
| `QQBOT_MEDIA_MAX_VIDEO_MB` | `50` | 视频大小上限 |
| `QQBOT_MEDIA_MAX_AUDIO_MB` | `20` | 音频大小上限 |
| `QQBOT_MEDIA_MAX_IMAGE_MB` | `15` | 单张图片大小上限 |
| `QQBOT_MEDIA_MAX_IMAGES` | `3` | 一次最多发送几张图 |
| `QQBOT_MEDIA_MAX_DOWNLOADS` | `2` | 同时下载媒体的最大任务数 |
| `QQBOT_MEDIA_DEDUPE_TTL_MS` | `300000` | 同群同链接去重窗口（毫秒） |
| `QQBOT_INBOUND_MAX_IMAGES` | `4` | 单条消息最多下载几张入站图片 |
| `QQBOT_INBOUND_MAX_IMAGE_MB` | `10` | 单张入站图片大小上限（MB） |
| `QQBOT_INBOUND_CONTEXT_MAX_KB` | `500` | 最近群聊上下文单张图片上限（KB），超过跳过 |
| `QQBOT_INBOUND_QUOTE_MAX_KB` | `1024` | 引用消息单张图片上限（KB），超过跳过 |
| `QQBOT_MEDIA_BILI_MAX_QN` | `32` | B站最大画质：16=360P、32=480P、64=720P、80=1080P、0=不限制 |
| `QQBOT_MEDIA_TIMEOUT_MS` | `180000` | 单次解析/下载超时 |
| `QQBOT_MEDIA_PYTHON` | `media-parser/.venv/Scripts/python.exe` | Python 解释器路径 |
| `QQBOT_MEDIA_SCRIPT` | `media-parser/parse_media.py` | 解析 CLI 路径 |
| `QQBOT_PROFILE_PYTHON` | 同 `QQBOT_MEDIA_PYTHON` | 画像卡片渲染 Python，需要 Pillow |
| `QQBOT_PROFILE_FONT` / `QQBOT_PROFILE_FONT_BOLD` | 自动查找 | 画像卡片中文字体；Linux 建议装 Noto CJK 或指定字体文件 |
| `QQBOT_MEMORY_DB` | `runtime/memory.db` | 群友记忆 SQLite 文件 |
| `QQBOT_EVENT_LOG` | `1` | 是否写 `runtime/events.jsonl` 供监控面板使用 |
| `QQBOT_MONITOR_PORT` | `8765` | 监控面板端口 |
| `QQBOT_MONITOR_HOST` | `127.0.0.1` | 监控面板监听地址 |
| `SWUSTMC_API_KEY` | 空 | 皮肤站只读 API key；不写入仓库 |
| `SWUSTMC_BASE_URL` | `https://www.swustmc.com` | 皮肤站地址 |
| `SWUSTMC_ADMIN_COOKIE` | 空 | 皮肤站管理员登录 Cookie，可选；用于读取在线玩家名字 |
| `QQBOT_MC_WATCH` | `0` | 是否开启 MC 服务器主动播报 |
| `QQBOT_MC_NOTIFY_GROUPS` | 空 | 播报目标群 openid，逗号分隔 |
| `QQBOT_MC_WATCH_INTERVAL_MS` | `20000` | 服务器状态轮询间隔（毫秒） |
| `QQBOT_MC_OFFLINE_CONFIRM_POLLS` | `2` | 连续探测到离线多少次才播报，防止站点 ping 瞬断造成假离线 |
| `MENGLI_INGEST_URL` | `https://www.swustmc.com/api/plugins/mengli/ingest` | 梦璃面板推送地址 |
| `MENGLI_INGEST_TOKEN` | 空 | 梦璃面板推送 token；不写入仓库 |
| `QQBOT_ALLOW_USERS` | 空=全部 | 允许的发送者 openid，逗号分隔 |
| `QQBOT_ALLOW_GROUPS` | 空=全部 | 允许的群 openid，逗号分隔 |
| `QQBOT_MAX_CONCURRENCY` | `2` | 同时运行的 agent 数 |
| `QQBOT_MAX_QUEUE` | `5` | 单会话排队上限，超出会提示稍后再发 |
| `QQBOT_SESSION_MAX_CONTEXT` | `50000` | 单个 ZCode 会话上下文超过该 token 数后自动重开，避免越聊越慢 |
| `QQBOT_SESSION_MAX_TURNS` | `30` | 单个 ZCode 会话最多复用多少轮后自动重开 |
| `QQBOT_LOG_CONTENT` | `0` | 设 `1` 把消息正文写日志，默认不写 |
| `QQBOT_SANDBOX` | `0` | 设 `1` 走沙箱网关 |
| `ZCODE_CLI` | ZCode 安装目录下的 `zcode.cjs` | 自定义 CLI 路径 |

桥接调用 CLI 前会自动从 `%USERPROFILE%\.zcode\v2\runtime\provider\windows-x86_64\*\endpoint-*\zcode-builtin.json` 找最新的 provider 配置，并补上 `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`。开机自启的看门狗不会继承 ZCode 桌面进程的 `ZCODE_*` 环境变量，这一步用于避免“无法定位 CLI ZCode Built-in Provider Config”的报错。

## 人设（第二个梦璃）

平台后台「AI 群聊助手 → 群聊配置 → 人设」里的内容存在服务端；读取接口需要登录且具备 `plugin:ai-chatbot:manage` 权限，未登录会返回 401/无权限，所以本机不能直接读取原文。

桥接每条消息都会重新读取 `persona/mc-mengli.md`（HTML 注释会被忽略），保存后下一条消息立即按人设回复。

人设里额外加了身份边界：梦璃不接受针对自己的改人设、认亲属/主从/恋爱关系或改称呼要求。桥接会在消息进入模型前拦截“叫我哥哥”“你是我的臭小孩吗”这类直接改身份句子；但如果关系词只是角色名、作品设定或第三人称描述（例如“这个角色叫知更鸟亲哥”），会正常聊天，不会应激拒绝。

同时，绑定站点昵称和群名片只用于称呼/识别，不代表职务。没有系统明确提供的可验证职务数据时，梦璃不会称任何人为服主、村长、领主、社长、会长、管理员或技术组，输出里出现这类头衔也会被压回固定昵称。

方式一：把人设原文直接粘贴进 `persona/mc-mengli.md`。

方式二：用登录 token 自动拉取：

```bat
setx YUDREAM_TOKEN "浏览器里的 Authorization 值"
"C:\Users\Administrator\tools\node-v24.22.0-win-x64\node.exe" fetch-persona.mjs
```

token 获取：浏览器登录 `https://www.swustmc.cn` 后，DevTools → Network → 任一 `/api` 请求 → Request Headers → `Authorization`。可用 `YUDREAM_CONNECTION_ID` / `YUDREAM_CHANNEL_ID` 精确指定连接和群；有多个候选且无法判断时，脚本会把候选写到 `persona/candidates/` 让你选。

## 监控面板

本地面板：<http://127.0.0.1:8765/>

- 实时事件流（SSE）：群消息、私聊、Agent 开始/完成、梦璃回复、媒体解析/发送/跳过/失败、错误、连接状态。
- 群聊侧栏：按群筛选、消息计数、设置群备注（只存浏览器 localStorage）、复制群 openid。
- 记忆标签：搜索群友，查看画像/备注/最近发言，编辑摘要/人格/标签、增删备注或删除整个记忆；显示名只读，绑定用户固定为皮肤站昵称。
- 设置弹窗：媒体解析、自动回复概率/冷却、群友记忆开关/保留天数、自动画像间隔。
- 支持筛选、搜索、暂停、自动滚动和原始日志视图。
- 数据来自 `runtime/events.jsonl`、`runtime/bot-settings.json`、`runtime/memory.db` 和 `runtime/agent-bridge.log`。

看门狗会自动带起面板；`start-qqbot.cmd` 会直接打开 <http://127.0.0.1:8765/>。只需单独调试面板时，先停掉看门狗，再运行：

```bat
start-monitor.cmd
```

默认只监听 `127.0.0.1`；需要局域网访问可设 `QQBOT_MONITOR_HOST=0.0.0.0`，面板没有鉴权，慎用。

事件日志包含群/用户 openid 和梦璃的回复文本，仅保存在本机 `runtime/` 下；不需要可在环境变量里设 `QQBOT_EVENT_LOG=0`。

## 自动回复与媒体监听

群全量消息需要在 QQ 侧由群主/管理员给机器人开启；桥接端只能被动接收。`runtime/bridge-status.json` 里的 `groupFullMessages` 大于 0，说明当前群已经生效。

自动回复默认开启“智能判断”：

- 被点名（消息里出现“梦璃”）、提问、Minecraft/社团相关等有意义的消息才进入回复判定。
- 群全量消息里文字点名“梦璃”不再按概率，100% 交给模型判断是否需要接话；模型只输出内部标记 `[[NO_REPLY]]` 时桥接不发送任何消息。点名触发不受基础概率和自动回复冷却限制，但灌水/刷屏仍会被过滤；要完全停用请关闭“群聊自动回复”总开关。
- `1`、`6`、`哈哈哈`、`好`、`确实`、`谢谢` 这类灌水/过短内容，`awslawsl` 这类重复内容，同一用户 10 秒内连续 3 条，或群聊 10 秒内 6 条，都会直接跳过自动回复。
- 基础概率用于中等相关消息；高相关至少提升到 75%；普通闲聊按基础概率的 20% 小概率参与（20% 基础时为 4%）。灌水/重复/刷屏仍然不回复。关闭智能判断后，通过灌水/刷屏过滤的消息按基础概率回复，不再做相关度评分。
- 自动按群人数降频（群规模每小时刷新一次）：

| 群人数 | 中等相关（基础 20% 时） | 普通闲聊 | 高相关 | 每群 10 分钟 / 小时上限 | 群冷却 |
|---|---:|---:|---:|---:|---:|
| < 50 | 20% | 4% | 75% | 10 / 40 | 30 秒 |
| 50–199 | 10% | 2% | 53% | 6 / 20 | 60 秒 |
| 200–499 | 5% | 1% | 38% | 4 / 15 | 120 秒 |
| 500+ | 3% | 1% | 29% | 2 / 8 | 180 秒 |

- 每群频率上限按自动回复触发次数计算，点名“梦璃”也受上限保护；达到上限后即使点名也不会触发。
- 群规模通过官方群信息接口获取，每小时刷新；获取失败时按 200 人档保守处理。
- 同群冷却和同一用户冷却分开计算，默认 30 秒 / 60 秒，可在监控页设置里关闭智能判断或调整冷却。
- @ 机器人的消息和私聊不受自动回复概率限制。

媒体监听只对已知平台链接启动解析，普通网页链接不会再无意义地调用解析器；同一群同一链接 5 分钟内重复发送会跳过下载，媒体下载默认最多同时 2 个，避免多个视频同时拖慢机器。B站默认仍是 480P，可用环境变量调整。

媒体下载完成后会立即上传发送，不再等 agent 评论跑完；agent 较慢、超时或桥接重启时，已经下载好的图片/视频不会跟着丢掉。评论文字随后单独发送。

## 引用消息与群图片

当群友引用某条消息时，桥接会把引用内容一起放进提示词：优先使用事件里的引用正文；如果只给了 `message_id`，会从最近 5 分钟的群消息缓存里找原文和作者。找不到时会明确告诉模型“引用内容未获取，不要编造”。

QQ 群里的图片/表情包附件会下载到 `runtime/inbound-media/`，然后提示模型用 Read 工具查看。支持当前消息、引用消息和最近群聊上下文里的图片：

- 当前消息最多 4 张，引用消息最多 2 张，最近上下文最多 2 张。
- 当前消息单张上限 10MB；引用图片超过 1MB、上下文图片超过 500KB 会跳过，避免视觉处理把 agent 卡住。
- 文件保留 24 小时，群聊最近上下文取最近 4 条、2 分钟内的消息。
- 如果 QQ 事件没有附件 URL、或者下载失败，桥接不会假装看到了图片，只会提示模型不要编造。

## 皮肤站接入

桥接已接入 `https://www.swustmc.com` 的只读 API，当前提供：

- `/服务器`（别名 `/在线`、`/mcstatus`）：读取皮肤站登记的 MC 服务器状态，按服务器分段显示在线人数、地址和在线玩家名；默认每个服务器最多显示 5 个名字，可在梦璃设置页“服务器播报显示玩家数”调整。
- `/我的在线时长`（别名 `/在线时长`、`/playtime`）：按绑定账号读取皮肤站 `player_stats`，播报累计在线、活跃、挂机和分服记录；数据由 MC 服务端的 `minecraft-server-report` 上报。没有绑定会提示先 `/绑定账号`。
- `/皮肤 <玩家名>`（别名 `/skin`）：查询皮肤站角色；只有一个匹配时，先发“当前角色/皮肤/披风”，再发送皮肤和披风图片。
- `/我的皮肤`（别名 `/myskin`）：按 QQ 绑定关系找到站点账号的当前角色，同样发送文字和皮肤/披风图片；需要先绑定 QQ。QQ 有时把 `@梦璃` 留在纯文本里，桥接会先去掉开头的称呼再识别指令，`@梦璃 /我的皮肤` 和 `/我的皮肤` 都能触发。
- 角色查询先按站点用户名/昵称找，再按角色所有者 ID 兜底，所以站点登录名和角色名不一致时也能找到。成功校验过的绑定会持久化到 `runtime/mengli-bindings.json`；插件重装后桥接会随推送把绑定写回站点，机器人侧和站点「我的记忆」都不用重新绑定。

API key 只从环境变量 `SWUSTMC_API_KEY` 读取，不写入仓库；桥接只调用 GET 接口，不做创建、修改或删除。发给模型的子进程会主动移除这个变量，避免被提示词套取。

注意：当前 API key 调 `/api/plugins/minecraft-server/admin/overview` 返回 403。在线玩家名单优先读站点心跳；心跳为空时桥接会直接查询服务器 status ping 的 `players.sample`，因此大多数服也能拿到名字。服务端隐藏 sample 或在线人数超过 sample 长度时，仍需要 `minecraft-server-report` 心跳插件或管理员登录 Cookie 才能完整判断进出。

## MC 服务器实时播报

桥接会定时读取皮肤站的服务器状态，发现在线人数或玩家变化时主动发到指定 QQ 群，不需要群友 @ 梦璃。

```bat
setx QQBOT_MC_WATCH 1
setx QQBOT_MC_NOTIFY_GROUPS "群openid,另一个群openid"
setx QQBOT_MC_WATCH_INTERVAL_MS 20000
```

- 目标群修改后需要重启看门狗（或重启电脑）才会生效。看门狗启动时会从当前用户环境变量重新读取 `QQBOT_*`、`SWUSTMC_*`、`MENGLI_*`，避免开机自启继承 Explorer 的旧环境快照；桥接启动日志里的“目标群 N 个”可用于确认数量。
- 默认每 20 秒检查一次，一次轮询的变化合并成一条消息，避免刷屏。
- 站点 ping 只有约 2 秒的探测窗口，网络抖动时可能瞬时返回离线。默认连续 2 次探测到离线才播报“已离线”；真实停服会晚一轮（约 40 秒）播报，短暂抖动不会刷假离线。
- 人数变化会播报，例如“长期生存服 在线人数 5 → 6 人（增加 1）”。
- 如果配置了管理员登录 Cookie，会进一步播报“冒险家 X 进入了/离开了服务器”并列出在线玩家。
- 站点 `online_players` 为空时，桥接会直接 ping 服务器读取 `players.sample`，补全当前在线名单；只有样本数量覆盖全部在线人数时才用来判断进出，避免截断名单造成假进出。服务端隐藏 sample 时才退回人数播报。
- 在线时长和完整在线名单优先来自皮肤站 `minecraft-server` 的心跳数据；MC 服务端安装 `game-integrations` 里的 `minecraft-server-report` 插件并按 `server-id + api-key` 上报后，进出播报最稳定。没有心跳时，桥接会用服务器 status ping 的 `players.sample` 兜底；两者都拿不到才退回人数播报。`mengli` 1.5.3 会只读这些数据，通过 `/api/plugins/mengli/mc-players` 和 `/api/plugins/mengli/playtime` 提供给桥接。
- 管理员 Cookie 只从环境变量 `SWUSTMC_ADMIN_COOKIE` 读取，不写入仓库；会过期，过期后自动退回人数播报。
- 获取 Cookie：登录皮肤站后台，DevTools → Network → 任意 `/api/plugins/minecraft-server/admin/overview` 请求 → Request Headers → 复制 `Cookie` 的完整值。更稳妥的是给机器人单独建一个管理员服务账号，避免使用个人登录态。
- QQ 官方机器人主动群消息有额度限制；发送失败会写日志，不会反复轰炸。


## 皮肤站梦璃面板

`mengli` 是皮肤站的独立 Java 插件，不改动现有板块：

- 普通用户导航新增「绑定QQ」：直接生成 6 位绑定码，然后在 QQ 群 @梦璃 发 `/绑定账号 123456`；不需要填写 QQ 号，绑定身份取自发码的 QQ 会话。
- 管理后台新增「梦璃日志」「梦璃记忆」「梦璃设置」三个入口。
- 日志来自 `runtime/events.jsonl`，记忆来自 `runtime/memory.db` 的画像/备注/最近发言。
- 本地桥接每 15 秒推送日志、每 30 秒推送记忆快照到 `/api/plugins/mengli/ingest`。
- 「梦璃设置」保存后由桥接下一次推送自动同步到本地 `bot-settings.json`，其他管理员也可以修改。
- 页面接口是管理员路由，未登录或非管理员无法读取。
- 插件新增 token 保护的 `/api/plugins/mengli/playtime`：按 `siteUserId` 只读兄弟插件 `minecraft-server.db` 的 `player_stats`，供 `/我的在线时长` 使用。

绑定码按“当前群/私聊 + openid”记录；用户在哪个群发 `/绑定账号`，就绑定哪个群的梦璃身份。官方 QQ 机器人不提供 QQ 号，绑定码就是 openid 和站点账号之间的桥，因此站点页面不再要求填写 QQ 号。

安装：在皮肤站「管理后台 → 插件管理」上传：

```text
D:\code\swust-skin-java\plugin-src\mengli\mengli-plugin.jar
```

如果之前装过旧版本，需要先在插件管理里卸载旧的「梦璃」，再上传 1.5.5；站点里的旧日志会清空，但本地 `runtime/memory.db`、`events.jsonl`、绑定缓存和机器人设置不受影响，桥接会自动把绑定、记忆和设置重新推送。

1.5.5 支持按多个群/私聊绑定键匹配同一位 QQ 用户的合并记忆；站点“群友记忆”和“我的记忆”会显示“已合并 N 个群/私聊”。同时继续只读 `minecraft-server` 的在线玩家库和在线时长库。

插件数据存在站点自己的 `plugin_data` 表，不会修改用户、皮肤或现有插件表。插件推送 token 只从环境变量 `MENGLI_INGEST_TOKEN` 读取；发往 ZCode agent 的子进程会移除它。

## 安全边界

默认允许所有能给机器人发消息的人使用，agent 以 `guarded` 模式运行。这个机器人背后是一个能读写文件、执行命令的 agent；如果你不打算公开，建议至少设置：

```bat
setx QQBOT_ALLOW_USERS "你的用户openid"
setx QQBOT_ALLOW_GROUPS "你的群openid"
```

openid 会出现在 `runtime/agent-bridge.log` 的收消息记录里。不要同时把 `QQBOT_AGENT_MODE` 设为 `yolo` 又保持完全开放。

## 状态与日志

- `runtime/bridge-status.json`：网关是否在线、机器人身份、会话数、队列、最近错误。
- `runtime/agent-bridge.log`：连接、收发、agent 耗时；默认不记录正文。
- `runtime/watchdog.log`：看门狗启停、桥接/监控自动拉起记录。
- `runtime/sessions.json`：QQ 会话到 ZCode sessionId 的映射；删掉它等于全部重开。
- `runtime/bot-settings.json`：媒体解析、自动回复、群友记忆等设置。
- `runtime/mengli-bindings.json`：已校验的皮肤站绑定缓存，插件重装后仍可用 `/我的皮肤`；删除后需要重新绑定。
- `runtime/memory.db`：群友记忆 SQLite。
- `runtime/media-settings.json`：旧版媒体解析开关（已迁移到 `bot-settings.json`）。
- `runtime/media-cache/`：解析下载的媒体文件。
- `runtime/inbound-media/`：QQ 群消息里的图片/表情包缓存，24 小时后清理。
- `runtime/bridge.pid`：单实例锁。

## 自测

不连 QQ，直接验证 agent 调用：

```bat
"C:\Users\Administrator\tools\node-v24.22.0-win-x64\node.exe" qqbot-agent-bridge.mjs --self-test "只回复：桥接自测通过"
```

模拟一条 QQ 消息走完整链路（解析、排队、agent、回复只打印不真发）：

```bat
"C:\Users\Administrator\tools\node-v24.22.0-win-x64\node.exe" qqbot-agent-bridge.mjs --simulate "只回复：模拟链路通过"
"C:\Users\Administrator\tools\node-v24.22.0-win-x64\node.exe" qqbot-agent-bridge.mjs --simulate group "只回复：群聊链路通过"
```

模拟带媒体链接的消息（会真实解析和下载，媒体发送只打印不真发）：

```bat
"C:\Users\Administrator\tools\node-v24.22.0-win-x64\node.exe" qqbot-agent-bridge.mjs --simulate "看看这个 https://www.bilibili.com/video/BV1GJ411x7h7"
```

## 只测连通性

`qqbot-connector.mjs` 仍保留：它只维护网关连接并记录事件类型，不接 agent。用 `start-connector.cmd` 启动，和桥接二选一。
