# 梦璃

西南科技大学 Minecraft 星空社 QQ 官方机器人「梦璃」的私有源码备份。

## 目录

- `qqbot/`：QQ 官方机器人桥接、ZCode agent 调用、媒体解析、本地监控、群友记忆与皮肤站推送。
- `skin-plugin/mengli/`：皮肤站 Java 插件源码（1.5.5），提供绑定 QQ、日志/记忆/设置面板、在线时长和 MC 在线玩家数据。
- `skin-site/admin-pages/`：皮肤站后台插件页路由的本地前端补丁文件，基于当时的站点版本，部署前需要对照上游 `swust-skin-java` 重新核对。

## 不包含

- `runtime/`：QQ 日志、SQLite 记忆、绑定缓存、媒体缓存和会话映射。
- `media-parser/.venv/`、`__pycache__`、测试缓存。
- QQ AppSecret、皮肤站 API key、梦璃推送 token。
- 与梦璃无关的本地实验文档和下载包。

## 部署提示

桥接需要的凭据全部从环境变量读取：

```text
QQBOT_APPID
QQBOT_SECRET
SWUSTMC_API_KEY
MENGLI_INGEST_TOKEN
```

`skin-plugin/mengli` 的推送 token 也已从源码移除，构建/部署皮肤站时通过 `MENGLI_INGEST_TOKEN` 环境变量（或 JVM 参数 `-Dmengli.ingest.token=...`）注入；当前线上已部署的旧 JAR 不受影响。

桥接启动、指令和完整环境变量见 `qqbot/README.md`。
