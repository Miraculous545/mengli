package cn.edu.swust.mc.skin.plugins.mengli;

import cn.edu.swust.mc.skin.AuthUser;
import cn.edu.swust.mc.skin.Web;
import cn.edu.swust.mc.skin.plugin.PluginContext;
import cn.edu.swust.mc.skin.plugin.PluginRequest;
import cn.edu.swust.mc.skin.plugin.SkinPlugin;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 梦璃专用面板插件：接收 QQ 桥接推送的日志/群友记忆，并提供后台只读页面。
 * 不修改站点现有表或页面。
 */
public final class MengliPlugin implements SkinPlugin {
    // 推送 token 从部署环境注入，不把真实值提交到源码仓库。
    private static final String INGEST_TOKEN = resolveIngestToken();
    private static final int MAX_LOGS = 1200;
    private static final int MAX_BATCH = 300;
    private static final long BIND_CODE_TTL_MS = 10 * 60 * 1000;
    private static final int MAX_BINDINGS = 5000;
    private static final int MAX_PERSONA = 6000;
    private static final int MAX_PROFILE_TEXT = 1000;
    private static final int MAX_TAGS = 20;
    private static final int MAX_TAG_LENGTH = 50;
    private static final int MAX_NOTES = 20;
    private static final int MAX_NOTE_LENGTH = 500;
    private static final SecureRandom RANDOM = new SecureRandom();

    private PluginContext ctx;
    private final Object lock = new Object();

    private static String resolveIngestToken() {
        String value = System.getenv("MENGLI_INGEST_TOKEN");
        if (value == null || value.isBlank()) value = System.getProperty("mengli.ingest.token", "");
        return value.trim();
    }

    @Override
    public void activate(PluginContext context) {
        this.ctx = context;
        ctx.registerRoute("POST", "/ingest", this::ingest);
        ctx.registerRoute("GET", "/bind/status", this::bindStatus);
        ctx.registerRoute("POST", "/bind/code", this::createBindCode);
        ctx.registerRoute("POST", "/bind", this::bind);
        ctx.registerRoute("POST", "/lookup", this::lookup);
        ctx.registerRoute("POST", "/mc-players", this::mcPlayers);
        ctx.registerRoute("POST", "/playtime", this::playtime);
        ctx.registerRoute("GET", "/my-memory", this::myMemory);
        ctx.registerAdminRoute("GET", "/logs", this::logs);
        ctx.registerAdminRoute("GET", "/memory", this::memory);
        ctx.registerAdminRoute("GET", "/summary", this::summary);
        ctx.registerAdminRoute("GET", "/settings", this::getSettings);
        ctx.registerAdminRoute("POST", "/settings", this::saveSettings);
        ctx.registerAdminRoute("GET", "/persona", this::getPersona);
        ctx.registerAdminRoute("POST", "/persona", this::savePersona);
        ctx.registerAdminRoute("POST", "/memory/member", this::saveMemoryMember);
    }

    private Object ingest(PluginRequest request) throws Exception {
        Map<String, Object> body = request.json();
        if (body == null || INGEST_TOKEN.isEmpty() || !INGEST_TOKEN.equals(String.valueOf(body.get("token") == null ? "" : body.get("token")))) {
            throw Web.forbidden("梦璃推送 token 无效");
        }
        synchronized (lock) {
            if (ctx.getData("settings") == null && body.get("settings") instanceof Map<?, ?> incomingSettings) {
                ctx.setData("settings", sanitizeSettings(asMap(incomingSettings), defaultSettings()));
            }
            if (!Boolean.TRUE.equals(ctx.getData("personaInitialized"))
                    && body.get("personaSeed") instanceof String personaSeed
                    && !personaSeed.isBlank()) {
                ctx.setData("persona", clampText(personaSeed, MAX_PERSONA));
                ctx.setData("personaInitialized", true);
                ctx.setData("personaUpdatedAt", Instant.now().toString());
            }
            List<Map<String, Object>> existing = asMapList(ctx.getData("logs"));
            List<Map<String, Object>> incoming = asMapList(body.get("logs"));
            if (incoming.size() > MAX_BATCH) incoming = new ArrayList<>(incoming.subList(incoming.size() - MAX_BATCH, incoming.size()));
            existing.addAll(incoming);
            if (existing.size() > MAX_LOGS) {
                existing = new ArrayList<>(existing.subList(existing.size() - MAX_LOGS, existing.size()));
            }
            ctx.setData("logs", existing);
            Object memory = body.get("memory");
            if (memory instanceof Map<?, ?> map) ctx.setData("memory", asMap(map));
            if (body.get("bindings") instanceof Map<?, ?> incomingBindings && !incomingBindings.isEmpty()) {
                Map<String, Object> bindings = asMapObject(ctx.getData("bindings"));
                for (Map.Entry<?, ?> entry : incomingBindings.entrySet()) {
                    String key = entry.getKey() == null ? "" : String.valueOf(entry.getKey()).trim();
                    if (key.isEmpty() || key.length() > 240 || !(entry.getValue() instanceof Map<?, ?> rawBinding)) continue;
                    Map<String, Object> binding = asMap(rawBinding);
                    String siteUserId = String.valueOf(binding.get("siteUserId") == null ? "" : binding.get("siteUserId")).trim();
                    String userId = String.valueOf(binding.get("userId") == null ? "" : binding.get("userId")).trim();
                    if (siteUserId.isEmpty() || userId.isEmpty()) continue;
                    binding.put("bindingKey", key);
                    binding.put("siteUserId", siteUserId);
                    binding.put("userId", userId);
                    if (String.valueOf(binding.get("boundAt") == null ? "" : binding.get("boundAt")).isBlank()) {
                        binding.put("boundAt", Instant.now().toString());
                    }
                    bindings.put(key, binding);
                }
                while (bindings.size() > MAX_BINDINGS) {
                    String first = bindings.keySet().iterator().next();
                    bindings.remove(first);
                }
                ctx.setData("bindings", bindings);
            }
            String updatedAt = Instant.now().toString();
            ctx.setData("updatedAt", updatedAt);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("accepted", incoming.size());
            result.put("logTotal", existing.size());
            result.put("updatedAt", updatedAt);
            result.put("settings", currentSettings());
            result.put("persona", currentPersona());
            result.put("personaUpdatedAt", ctx.getData("personaUpdatedAt"));
            result.put("memoryOverrides", asMapList(ctx.getData("memory_overrides")));
            return result;
        }
    }

    private Object bindStatus(PluginRequest request) {
        AuthUser user = request.user();
        if (user == null) throw Web.unauthorized("请先登录皮肤站");
        Map<String, Object> account = new LinkedHashMap<>();
        account.put("id", user.id);
        account.put("username", user.username);
        account.put("nickname", user.nickname);
        account.put("qq", user.qq == null ? "" : user.qq);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("user", account);
        result.put("bindings", userBindings(user.id));
        return result;
    }

    private Object createBindCode(PluginRequest request) throws Exception {
        AuthUser user = request.user();
        if (user == null) throw Web.unauthorized("请先登录皮肤站");
        String qq = user.qq == null ? "" : user.qq.trim();
        synchronized (lock) {
            long now = System.currentTimeMillis();
            Map<String, Object> codes = asMapObject(ctx.getData("bind_codes"));
            codes.entrySet().removeIf(entry -> {
                Object value = entry.getValue();
                if (!(value instanceof Map<?, ?> map)) return true;
                Object expiresAt = map.get("expiresAt");
                return !(expiresAt instanceof Number number) || number.longValue() < now;
            });
            String code;
            do {
                code = String.format("%06d", RANDOM.nextInt(1_000_000));
            } while (codes.containsKey(code));
            Map<String, Object> record = new LinkedHashMap<>();
            record.put("siteUserId", user.id);
            record.put("siteUsername", user.username);
            record.put("siteNickname", user.nickname);
            record.put("qq", qq);
            record.put("createdAt", now);
            record.put("expiresAt", now + BIND_CODE_TTL_MS);
            codes.put(code, record);
            while (codes.size() > 100) {
                String first = codes.keySet().iterator().next();
                codes.remove(first);
            }
            ctx.setData("bind_codes", codes);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("code", code);
            result.put("qq", qq);
            result.put("expiresAt", now + BIND_CODE_TTL_MS);
            result.put("ttlSeconds", BIND_CODE_TTL_MS / 1000);
            return result;
        }
    }

    private Object bind(PluginRequest request) throws Exception {
        Map<String, Object> body = bodyWithToken(request);
        String code = String.valueOf(body.get("code") == null ? "" : body.get("code")).trim();
        String bindingKey = String.valueOf(body.get("bindingKey") == null ? "" : body.get("bindingKey")).trim();
        String userId = String.valueOf(body.get("userId") == null ? "" : body.get("userId")).trim();
        String nickname = String.valueOf(body.get("nickname") == null ? "" : body.get("nickname")).trim();
        if (!code.matches("\\d{6}")) throw Web.badRequest("绑定码格式不正确");
        if (bindingKey.isEmpty() || bindingKey.length() > 240) throw Web.badRequest("绑定对象不合法");
        synchronized (lock) {
            Map<String, Object> codes = asMapObject(ctx.getData("bind_codes"));
            Object raw = codes.get(code);
            if (!(raw instanceof Map<?, ?> map)) throw Web.forbidden("绑定码无效或已过期");
            long expiresAt = map.get("expiresAt") instanceof Number number ? number.longValue() : 0L;
            if (expiresAt < System.currentTimeMillis()) {
                codes.remove(code);
                ctx.setData("bind_codes", codes);
                throw Web.forbidden("绑定码已过期，请重新生成");
            }
            codes.remove(code);
            ctx.setData("bind_codes", codes);
            Map<String, Object> binding = new LinkedHashMap<>();
            binding.put("siteUserId", map.get("siteUserId"));
            binding.put("siteUsername", map.get("siteUsername"));
            binding.put("siteNickname", map.get("siteNickname"));
            binding.put("qq", map.get("qq"));
            binding.put("bindingKey", bindingKey);
            binding.put("userId", userId);
            binding.put("nickname", nickname);
            binding.put("boundAt", Instant.now().toString());
            Map<String, Object> bindings = asMapObject(ctx.getData("bindings"));
            bindings.put(bindingKey, binding);
            if (bindings.size() > MAX_BINDINGS) {
                String first = bindings.keySet().iterator().next();
                bindings.remove(first);
            }
            ctx.setData("bindings", bindings);
            return binding;
        }
    }

    private Object lookup(PluginRequest request) throws Exception {
        Map<String, Object> body = bodyWithToken(request);
        String bindingKey = String.valueOf(body.get("bindingKey") == null ? "" : body.get("bindingKey")).trim();
        if (bindingKey.isEmpty()) throw Web.badRequest("缺少绑定对象");
        Map<String, Object> bindings = asMapObject(ctx.getData("bindings"));
        Object raw = bindings.get(bindingKey);
        if (raw instanceof Map<?, ?> map) {
            Map<String, Object> result = asMap(map);
            result.put("bound", true);
            return result;
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("bound", false);
        return result;
    }

    private Map<String, Object> bodyWithToken(PluginRequest request) throws Exception {
        Map<String, Object> body = request.json();
        if (body == null || INGEST_TOKEN.isEmpty() || !INGEST_TOKEN.equals(String.valueOf(body.get("token") == null ? "" : body.get("token")))) {
            throw Web.forbidden("梦璃推送 token 无效");
        }
        return body;
    }

    private List<Map<String, Object>> userBindings(String siteUserId) {
        List<Map<String, Object>> result = new ArrayList<>();
        Map<String, Object> bindings = asMapObject(ctx.getData("bindings"));
        for (Object value : bindings.values()) {
            if (!(value instanceof Map<?, ?> map)) continue;
            if (!siteUserId.equals(String.valueOf(map.get("siteUserId")))) continue;
            Map<String, Object> item = asMap(map);
            item.remove("siteUserId");
            result.add(item);
        }
        result.sort((left, right) -> String.valueOf(right.get("boundAt")).compareTo(String.valueOf(left.get("boundAt"))));
        return result;
    }

    private Object myMemory(PluginRequest request) {
        AuthUser user = request.user();
        if (user == null) throw Web.unauthorized("请先登录皮肤站");
        List<Map<String, Object>> bindings = userBindings(user.id);
        HashSet<String> bindingKeys = new HashSet<>();
        for (Map<String, Object> binding : bindings) {
            Object key = binding.get("bindingKey");
            if (key != null) bindingKeys.add(String.valueOf(key));
        }
        List<Map<String, Object>> own = new ArrayList<>();
        Map<String, Object> memory = memoryWithOverrides();
        if (memory.get("members") instanceof List<?> members) {
            for (Object value : members) {
                if (!(value instanceof Map<?, ?> memberMap)) continue;
                boolean matched = false;
                Object keys = memberMap.get("bindingKeys");
                if (keys instanceof List<?> list) {
                    for (Object key : list) {
                        if (key != null && bindingKeys.contains(String.valueOf(key))) {
                            matched = true;
                            break;
                        }
                    }
                }
                if (!matched) {
                    Object key = memberMap.get("bindingKey");
                    matched = key != null && bindingKeys.contains(String.valueOf(key));
                }
                if (!matched) continue;
                Map<String, Object> member = asMap(memberMap);
                member.remove("bindingKey");
                member.remove("bindingKeys");
                own.add(member);
            }
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("bound", !bindings.isEmpty());
        result.put("members", own);
        result.put("updatedAt", ctx.getData("updatedAt"));
        return result;
    }

    private static Map<String, Object> asMapObject(Object value) {
        if (value instanceof Map<?, ?> map) return asMap(map);
        return new LinkedHashMap<>();
    }

    private Object mcPlayers(PluginRequest request) throws Exception {
        bodyWithToken(request);
        Map<String, Object> result = new LinkedHashMap<>();
        List<Map<String, Object>> servers = new ArrayList<>();
        result.put("servers", servers);
        result.put("updatedAt", Instant.now().toString());
        Path database = ctx.dataDir().getParent().resolve("minecraft-server").resolve("minecraft-server.db");
        if (!Files.isRegularFile(database)) return result;
        try {
            Class.forName("org.sqlite.JDBC");
            try (Connection connection = DriverManager.getConnection("jdbc:sqlite:" + database.toAbsolutePath());
                 PreparedStatement statement = connection.prepareStatement("""
                         SELECT s.id AS server_id, s.name AS server_name,
                                p.name AS player_name, p.uuid AS player_uuid,
                                p.afk, p.session_started_at
                         FROM servers s
                         LEFT JOIN online_players p ON p.server_id = s.id
                         WHERE s.visible = 1
                         ORDER BY s.sort_order ASC, s.created_at ASC, p.name ASC
                         """);
                 ResultSet rows = statement.executeQuery()) {
                Map<String, Map<String, Object>> grouped = new LinkedHashMap<>();
                while (rows.next()) {
                    String serverId = rows.getString("server_id");
                    Map<String, Object> server = grouped.computeIfAbsent(serverId, key -> {
                        Map<String, Object> item = new LinkedHashMap<>();
                        item.put("id", key);
                        item.put("name", "");
                        item.put("players", new ArrayList<Map<String, Object>>());
                        return item;
                    });
                    server.put("name", rows.getString("server_name"));
                    String playerName = rows.getString("player_name");
                    if (playerName != null && !playerName.isBlank()) {
                        Map<String, Object> player = new LinkedHashMap<>();
                        player.put("name", playerName);
                        player.put("uuid", rows.getString("player_uuid"));
                        player.put("afk", rows.getInt("afk") == 1);
                        player.put("sessionStartedAt", rows.getString("session_started_at"));
                        @SuppressWarnings("unchecked")
                        List<Map<String, Object>> players = (List<Map<String, Object>>) server.get("players");
                        players.add(player);
                    }
                }
                for (Map<String, Object> server : grouped.values()) {
                    @SuppressWarnings("unchecked")
                    List<Map<String, Object>> players = (List<Map<String, Object>>) server.get("players");
                    server.put("onlineCount", players.size());
                    servers.add(server);
                }
            }
        } catch (Exception error) {
            ctx.warn("读取 minecraft-server 在线玩家失败：" + error.getMessage());
            result.put("error", "Minecraft 服务器数据暂不可用");
        }
        return result;
    }

    private Object playtime(PluginRequest request) throws Exception {
        Map<String, Object> body = bodyWithToken(request);
        String siteUserId = String.valueOf(body.get("siteUserId") == null ? "" : body.get("siteUserId")).trim();
        String siteUsername = String.valueOf(body.get("siteUsername") == null ? "" : body.get("siteUsername")).trim();
        if (siteUserId.isEmpty() || siteUsername.isEmpty()) {
            String bindingKey = String.valueOf(body.get("bindingKey") == null ? "" : body.get("bindingKey")).trim();
            Object raw = asMapObject(ctx.getData("bindings")).get(bindingKey);
            if (raw instanceof Map<?, ?> binding) {
                if (siteUserId.isEmpty()) {
                    siteUserId = String.valueOf(binding.get("siteUserId") == null ? "" : binding.get("siteUserId")).trim();
                }
                if (siteUsername.isEmpty()) {
                    siteUsername = String.valueOf(binding.get("siteUsername") == null ? "" : binding.get("siteUsername")).trim();
                }
            }
        }
        if (siteUserId.length() > 40 || siteUsername.length() > 80) throw Web.badRequest("站点用户不合法");
        if (siteUserId.isEmpty() && siteUsername.isEmpty()) throw Web.badRequest("缺少站点用户");
        Map<String, Object> result = new LinkedHashMap<>();
        List<Map<String, Object>> servers = new ArrayList<>();
        result.put("servers", servers);
        result.put("available", false);
        Path database = ctx.dataDir().getParent().resolve("minecraft-server").resolve("minecraft-server.db");
        if (!Files.isRegularFile(database)) return result;
        long totalMillis = 0;
        long afkMillis = 0;
        try {
            Class.forName("org.sqlite.JDBC");
            try (Connection connection = DriverManager.getConnection("jdbc:sqlite:" + database.toAbsolutePath())) {
                HashSet<String> onlineServerIds = new HashSet<>();
                try (PreparedStatement online = connection.prepareStatement("""
                        SELECT DISTINCT p.server_id
                        FROM player_stats p
                        JOIN online_players o ON o.server_id = p.server_id AND o.uuid = p.uuid
                        WHERE (p.site_user_id = ?
                               OR (? <> '' AND (p.site_player_name = ? COLLATE NOCASE OR p.name = ? COLLATE NOCASE)))
                          AND o.last_seen_at >= ?
                        """);
                     PreparedStatement stats = connection.prepareStatement("""
                        SELECT s.id AS server_id, s.name AS server_name,
                               COALESCE(SUM(p.total_millis), 0) AS total_millis,
                               COALESCE(SUM(p.afk_millis), 0) AS afk_millis,
                               MAX(p.last_seen_at) AS last_seen_at
                        FROM player_stats p
                        JOIN servers s ON s.id = p.server_id
                        WHERE (p.site_user_id = ?
                               OR (? <> '' AND (p.site_player_name = ? COLLATE NOCASE OR p.name = ? COLLATE NOCASE)))
                        GROUP BY s.id, s.name
                        ORDER BY s.name ASC
                        """)) {
                    online.setString(1, siteUserId);
                    online.setString(2, siteUsername);
                    online.setString(3, siteUsername);
                    online.setString(4, siteUsername);
                    online.setString(5, Instant.now().minusSeconds(90).toString());
                    try (ResultSet rows = online.executeQuery()) {
                        while (rows.next()) onlineServerIds.add(rows.getString("server_id"));
                    }
                    stats.setString(1, siteUserId);
                    stats.setString(2, siteUsername);
                    stats.setString(3, siteUsername);
                    stats.setString(4, siteUsername);
                    try (ResultSet rows = stats.executeQuery()) {
                        while (rows.next()) {
                            long serverTotal = Math.max(0, rows.getLong("total_millis"));
                            long serverAfk = Math.min(Math.max(0, rows.getLong("afk_millis")), serverTotal);
                            Map<String, Object> item = new LinkedHashMap<>();
                            item.put("id", rows.getString("server_id"));
                            item.put("name", rows.getString("server_name"));
                            item.put("totalMillis", serverTotal);
                            item.put("afkMillis", serverAfk);
                            item.put("activeMillis", serverTotal - serverAfk);
                            item.put("lastSeenAt", rows.getString("last_seen_at"));
                            item.put("online", onlineServerIds.contains(rows.getString("server_id")));
                            servers.add(item);
                            totalMillis += serverTotal;
                            afkMillis += serverAfk;
                        }
                    }
                }
            }
            result.put("available", true);
            result.put("totalMillis", totalMillis);
            result.put("afkMillis", afkMillis);
            result.put("activeMillis", totalMillis - afkMillis);
            result.put("updatedAt", Instant.now().toString());
        } catch (Exception error) {
            ctx.warn("读取 minecraft-server 在线时长失败：" + error.getMessage());
            result.put("available", false);
            result.put("error", "在线时长数据暂不可用");
        }
        return result;
    }

    private Object logs(PluginRequest request) {
        int limit = parseInt(request.query("limit"), 300);
        limit = Math.max(1, Math.min(MAX_LOGS, limit));
        List<Map<String, Object>> all = asMapList(ctx.getData("logs"));
        int from = Math.max(0, all.size() - limit);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("items", new ArrayList<>(all.subList(from, all.size())));
        result.put("total", all.size());
        result.put("updatedAt", ctx.getData("updatedAt"));
        return result;
    }

    private Object memory(PluginRequest request) {
        Map<String, Object> result = memoryWithOverrides();
        if (!result.containsKey("members")) result.put("members", List.of());
        result.putIfAbsent("updatedAt", ctx.getData("updatedAt"));
        return result;
    }

    private Map<String, Object> memoryWithOverrides() {
        Object stored = ctx.getData("memory");
        Map<String, Object> result = stored instanceof Map<?, ?> map ? asMap(map) : new LinkedHashMap<>();
        List<Map<String, Object>> members = asMapList(result.get("members"));
        Map<String, Map<String, Object>> overrides = new LinkedHashMap<>();
        for (Map<String, Object> override : asMapList(ctx.getData("memory_overrides"))) {
            String id = String.valueOf(override.get("memberId") == null ? "" : override.get("memberId")).trim();
            if (!id.isEmpty()) overrides.put(id, override);
        }
        for (Map<String, Object> member : members) {
            Map<String, Object> override = overrides.get(String.valueOf(member.get("id")));
            if (override == null) continue;
            member.put("summary", override.getOrDefault("summary", member.get("summary")));
            member.put("personality", override.getOrDefault("personality", member.get("personality")));
            member.put("interactionStyle", override.getOrDefault("interactionStyle", member.get("interactionStyle")));
            member.put("tags", override.getOrDefault("tags", member.get("tags")));
            if (override.containsKey("notes")) member.put("notes", override.get("notes"));
            member.put("manualOverride", true);
            member.put("overrideUpdatedAt", override.get("updatedAt"));
        }
        result.put("members", members);
        return result;
    }

    private Object summary(PluginRequest request) {
        List<Map<String, Object>> logs = asMapList(ctx.getData("logs"));
        Object memory = ctx.getData("memory");
        int members = 0;
        if (memory instanceof Map<?, ?> map && map.get("members") instanceof List<?> list) members = list.size();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("logs", logs.size());
        result.put("members", members);
        result.put("updatedAt", ctx.getData("updatedAt"));
        return result;
    }

    private Object getSettings(PluginRequest request) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("settings", currentSettings());
        result.put("updatedAt", ctx.getData("settingsUpdatedAt"));
        return result;
    }

    private Object saveSettings(PluginRequest request) throws Exception {
        Map<String, Object> body = request.json();
        Map<String, Object> next = sanitizeSettings(body, currentSettings());
        synchronized (lock) {
            ctx.setData("settings", next);
            ctx.setData("settingsUpdatedAt", Instant.now().toString());
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("settings", next);
        result.put("updatedAt", ctx.getData("settingsUpdatedAt"));
        return result;
    }

    private String currentPersona() {
        Object value = ctx.getData("persona");
        return value == null ? "" : String.valueOf(value).trim();
    }

    private Object getPersona(PluginRequest request) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("persona", currentPersona());
        result.put("updatedAt", ctx.getData("personaUpdatedAt"));
        result.put("initialized", Boolean.TRUE.equals(ctx.getData("personaInitialized")));
        return result;
    }

    private Object savePersona(PluginRequest request) throws Exception {
        Map<String, Object> body = request.json();
        String persona = clampText(body == null ? "" : String.valueOf(body.get("persona") == null ? "" : body.get("persona")), MAX_PERSONA);
        synchronized (lock) {
            ctx.setData("persona", persona);
            ctx.setData("personaInitialized", true);
            ctx.setData("personaUpdatedAt", Instant.now().toString());
        }
        return getPersona(request);
    }

    private Object saveMemoryMember(PluginRequest request) throws Exception {
        Map<String, Object> body = request.json();
        String id = String.valueOf(body == null ? "" : body.get("memberId") == null ? body.get("id") : body.get("memberId")).trim();
        if (id.isEmpty()) throw Web.badRequest("缺少群友记忆 ID");
        synchronized (lock) {
            List<Map<String, Object>> overrides = asMapList(ctx.getData("memory_overrides"));
            if (body != null && Boolean.TRUE.equals(body.get("reset"))) {
                overrides.removeIf(item -> id.equals(String.valueOf(item.get("memberId"))));
                ctx.setData("memory_overrides", overrides);
                Map<String, Object> result = new LinkedHashMap<>();
                result.put("reset", true);
                result.put("memberId", id);
                return result;
            }
            Map<String, Object> target = findMemoryMember(id);
            if (target == null) throw Web.notFound("群友记忆不存在，等机器人下一次推送后再试");
            Map<String, Object> override = new LinkedHashMap<>();
            override.put("memberId", id);
            override.put("userOpenid", target.get("userOpenid"));
            override.put("scopeKey", target.get("scopeKey"));
            override.put("bindingKey", target.get("bindingKey"));
            override.put("summary", clampText(body.containsKey("summary") ? body.get("summary") : target.get("summary"), MAX_PROFILE_TEXT));
            override.put("personality", clampText(body.containsKey("personality") ? body.get("personality") : target.get("personality"), MAX_PROFILE_TEXT));
            override.put("interactionStyle", clampText(body.containsKey("interactionStyle") ? body.get("interactionStyle") : target.get("interactionStyle"), MAX_PROFILE_TEXT));
            override.put("tags", body.containsKey("tags") ? normalizeTags(body.get("tags")) : normalizeTags(target.get("tags")));
            if (body.containsKey("notes")) override.put("notes", normalizeNotes(body.get("notes")));
            override.put("updatedAt", Instant.now().toString());
            overrides.removeIf(item -> id.equals(String.valueOf(item.get("memberId"))));
            overrides.add(override);
            ctx.setData("memory_overrides", overrides);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("override", override);
            result.put("memberId", id);
            return result;
        }
    }

    private Map<String, Object> findMemoryMember(String id) {
        Object memory = ctx.getData("memory");
        if (!(memory instanceof Map<?, ?> map)) return null;
        for (Map<String, Object> member : asMapList(map.get("members"))) {
            if (id.equals(String.valueOf(member.get("id")))) return member;
        }
        return null;
    }

    private static String clampText(Object value, int max) {
        String text = value == null ? "" : String.valueOf(value).trim();
        return text.length() > max ? text.substring(0, max) : text;
    }

    private static List<String> normalizeTags(Object value) {
        List<String> tags = new ArrayList<>();
        Iterable<?> items = value instanceof List<?> list ? list
                : value instanceof String text ? List.of(text.split("[,，\\n\\r]+")) : List.of();
        for (Object item : items) {
            String tag = clampText(item, MAX_TAG_LENGTH);
            if (tag.isEmpty() || tags.contains(tag)) continue;
            tags.add(tag);
            if (tags.size() >= MAX_TAGS) break;
        }
        return tags;
    }

    private static List<Map<String, Object>> normalizeNotes(Object value) {
        List<Map<String, Object>> notes = new ArrayList<>();
        Iterable<?> items = value instanceof List<?> list ? list
                : value instanceof String text ? List.of(text.split("[\\n\\r]+")) : List.of();
        for (Object item : items) {
            String content = item instanceof Map<?, ?> map ? String.valueOf(map.get("content") == null ? "" : map.get("content")) : String.valueOf(item);
            content = clampText(content, MAX_NOTE_LENGTH);
            if (content.isEmpty()) continue;
            Map<String, Object> note = new LinkedHashMap<>();
            note.put("content", content);
            note.put("source", "site");
            note.put("createdAt", Instant.now().toString());
            notes.add(note);
            if (notes.size() >= MAX_NOTES) break;
        }
        return notes;
    }

    private Map<String, Object> currentSettings() {
        Map<String, Object> settings = defaultSettings();
        Object stored = ctx.getData("settings");
        if (stored instanceof Map<?, ?> map) settings.putAll(asMap(map));
        return settings;
    }

    private static Map<String, Object> defaultSettings() {
        Map<String, Object> settings = new LinkedHashMap<>();
        settings.put("mediaEnabled", true);
        settings.put("mcPlayerLimit", 5);
        settings.put("autoReplyEnabled", true);
        settings.put("autoReplyProbability", 0.15);
        settings.put("autoReplyCooldownSeconds", 30);
        settings.put("autoReplySmart", true);
        settings.put("autoReplyUserCooldownSeconds", 60);
        settings.put("memoryEnabled", true);
        settings.put("memoryRetentionDays", 90);
        settings.put("memoryRecentMessages", 6);
        settings.put("memoryAutoProfile", true);
        settings.put("memoryAutoProfileEvery", 20);
        return settings;
    }

    private static Map<String, Object> sanitizeSettings(Map<String, Object> input, Map<String, Object> base) {
        Map<String, Object> out = new LinkedHashMap<>(base);
        if (input == null) return out;
        putBool(out, input, "mediaEnabled");
        putNumber(out, input, "mcPlayerLimit", 1, 20, true);
        putBool(out, input, "autoReplyEnabled");
        putNumber(out, input, "autoReplyProbability", 0, 1, false);
        putNumber(out, input, "autoReplyCooldownSeconds", 0, 3600, true);
        putBool(out, input, "autoReplySmart");
        putNumber(out, input, "autoReplyUserCooldownSeconds", 0, 3600, true);
        putBool(out, input, "memoryEnabled");
        putNumber(out, input, "memoryRetentionDays", 0, 3650, true);
        putNumber(out, input, "memoryRecentMessages", 1, 20, true);
        putBool(out, input, "memoryAutoProfile");
        putNumber(out, input, "memoryAutoProfileEvery", 5, 500, true);
        return out;
    }

    private static void putBool(Map<String, Object> out, Map<String, Object> input, String key) {
        if (!input.containsKey(key)) return;
        Object value = input.get(key);
        out.put(key, Boolean.TRUE.equals(value) || "1".equals(String.valueOf(value)) || "true".equalsIgnoreCase(String.valueOf(value)));
    }

    private static void putNumber(Map<String, Object> out, Map<String, Object> input, String key,
                                  double min, double max, boolean integer) {
        if (!input.containsKey(key)) return;
        Object raw = input.get(key);
        double value;
        try {
            value = raw instanceof Number number ? number.doubleValue() : Double.parseDouble(String.valueOf(raw));
        } catch (Exception ignored) {
            return;
        }
        if (!Double.isFinite(value)) return;
        value = Math.max(min, Math.min(max, value));
        out.put(key, integer ? Math.round(value) : value);
    }

    private static int parseInt(String value, int fallback) {
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (Exception ignored) {
            return fallback;
        }
    }

    private static List<Map<String, Object>> asMapList(Object value) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (value instanceof List<?> list) {
            for (Object item : list) {
                if (item instanceof Map<?, ?> map) out.add(asMap(map));
            }
        }
        return out;
    }

    private static Map<String, Object> asMap(Map<?, ?> raw) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : raw.entrySet()) {
            out.put(String.valueOf(entry.getKey()), entry.getValue());
        }
        return out;
    }
}
