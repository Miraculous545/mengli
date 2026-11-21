# 梦璃皮肤站插件

源码版本：1.5.8。

## 功能

- 接收 QQ 桥接推送的日志、群友记忆、绑定和黑名单。
- 管理后台「梦璃日志」「梦璃记忆」「梦璃黑名单」「梦璃设置」。
- 管理员可编辑人设/提示词草稿并显式启用；可编辑群友画像和备注。
- 黑名单按「群/私聊 + 群友 openid」记录，支持站点后台加入/解除；桥接下一次推送时合并，梦璃不再回复名单中的群友。
- 只读兄弟插件 `minecraft-server` 的在线玩家和 `player_stats` 数据。

## 构建

需要 JDK 21，并以站点核心 `swust-skin.jar` 作为编译 classpath：

```bash
javac -encoding UTF-8 -cp /path/to/swust-skin.jar -d build src/cn/edu/swust/mc/skin/plugins/mengli/MengliPlugin.java
cp client.mjs plugin.json build/
jar --create --file mengli-plugin.jar -C build .
```

仓库内保留可部署的 `mengli-plugin.jar`；插件包根目录需要包含 `plugin.json`、`client.mjs` 和编译后的类。

## 黑名单

站点后台从已同步的群友记忆里选择具体群/私聊加入黑名单，保存后由桥接下一次推送（约 15 秒）同步到本地 SQLite。解除后下一条消息恢复回复；黑名单不会删除已有记忆。

## 推送 token

源码不硬编码真实 token。部署站点的 Java 进程需要设置：

```bash
MENGLI_INGEST_TOKEN=...
```

或 JVM 参数：

```bash
-Dmengli.ingest.token=...
```

也可以在后台「梦璃设置 → 推送 Token」保存；环境变量优先。桥接端使用同一个 token 调用 `/api/plugins/mengli/ingest`。未设置 token 时插件会拒绝推送，避免空 token 绕过。

## 数据

插件只读写自己的 `plugin_data`，另外只读兄弟插件 `minecraft-server` 的在线玩家和 `player_stats` 数据；不会修改用户、皮肤或现有插件表。
