# 梦璃皮肤站插件

源码版本：1.5.5。

## 构建

需要 JDK 21，并以站点核心 `swust-skin.jar` 作为编译 classpath：

```bash
javac -encoding UTF-8 -cp /path/to/swust-skin.jar -d build src/cn/edu/swust/mc/skin/plugins/mengli/MengliPlugin.java
cp client.mjs plugin.json build/
jar --create --file mengli-plugin.jar -C build .
```

构建产物不入库。插件包根目录需要包含 `plugin.json`、`client.mjs` 和编译后的类。

## 推送 token

源码不再硬编码真实 token。部署站点的 Java 进程需要设置：

```bash
MENGLI_INGEST_TOKEN=...
```

或 JVM 参数：

```bash
-Dmengli.ingest.token=...
```

桥接端使用同一个 token 调用 `/api/plugins/mengli/ingest`。未设置 token 时插件会拒绝推送，避免空 token 绕过。

## 数据

插件只读写自己的 `plugin_data`，另外只读兄弟插件 `minecraft-server` 的在线玩家和 `player_stats` 数据；不会修改用户、皮肤或现有插件表。
