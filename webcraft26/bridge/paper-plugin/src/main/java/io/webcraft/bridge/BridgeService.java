package io.webcraft.bridge;

import io.webcraft.bridge.ws.WsConnection;
import net.kyori.adventure.text.Component;
import io.webcraft.bridge.ws.WsServer;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.data.BlockData;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.player.AsyncPlayerChatEvent;
import org.bukkit.event.player.PlayerArmorStandManipulateEvent;
import org.bukkit.scheduler.BukkitTask;

import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.logging.Level;
import java.util.logging.Logger;
import java.util.regex.Pattern;

/**
 * Owns the WebSocket endpoint, browser sessions and their visible armor-stand avatars. Everything
 * that touches Bukkit world state is dispatched onto the server thread.
 */
public final class BridgeService implements Listener {

    static final String VERSION = "0.1.0";
    private static final int PROTOCOL = 1;
    private static final Pattern NAME_PATTERN = Pattern.compile("[A-Za-z0-9_]{1,16}");
    private static final int MAX_INCOMING_CHARS = 32 * 1024;

    private final WebcraftBridgePlugin plugin;
    private final BridgeConfig config;
    private final Logger log;

    private final Map<WsConnection, BridgeSession> sessionsByConnection = new ConcurrentHashMap<>();
    private final Set<BridgeSession> joinedSessions = ConcurrentHashMap.newKeySet();

    private volatile WsServer server;
    private volatile ScheduledExecutorService timeouts;
    private BukkitTask streamTask;
    private BukkitTask avatarTask;
    private BukkitTask playersTask;
    private BukkitTask entitiesTask;
    private volatile boolean running;

    BridgeService(WebcraftBridgePlugin plugin, BridgeConfig config) {
        this.plugin = plugin;
        this.config = config;
        this.log = plugin.getLogger();
    }

    public BridgeConfig config() {
        return config;
    }

    public void start() throws Exception {
        InetAddress bindAddress = InetAddress.getByName(config.bindAddress());
        WsServer.Options options = new WsServer.Options(
                bindAddress,
                config.port(),
                config.path(),
                config.allowedOrigins(),
                config.allowMissingOrigin(),
                config.maxClients()
        );
        server = new WsServer(options, new WsServer.Handler() {
            @Override
            public void onOpen(WsConnection connection) {
                BridgeService.this.onOpen(connection);
            }

            @Override
            public void onText(WsConnection connection, String message) {
                BridgeService.this.onText(connection, message);
            }

            @Override
            public void onClose(WsConnection connection, int code, String reason) {
                BridgeService.this.onClose(connection, code, reason);
            }
        }, log, this::healthJson);

        timeouts = Executors.newSingleThreadScheduledExecutor(new ThreadFactory() {
            @Override
            public Thread newThread(Runnable runnable) {
                Thread thread = new Thread(runnable, "WebCraftBridge-Timeout");
                thread.setDaemon(true);
                return thread;
            }
        });

        // Remove armor stands left behind by an unclean previous shutdown before clients connect.
        cleanupStaleAvatars();
        running = true;
        int boundPort;
        try {
            boundPort = server.start();
        } catch (Exception exception) {
            running = false;
            throw exception;
        }

        plugin.getServer().getPluginManager().registerEvents(this, plugin);
        streamTask = plugin.getServer().getScheduler().runTaskTimer(plugin, this::tickStreams, 1L, 2L);
        avatarTask = plugin.getServer().getScheduler().runTaskTimer(plugin, this::tickAvatars, 1L, 2L);
        playersTask = plugin.getServer().getScheduler().runTaskTimer(plugin, this::tickPlayers, 1L, 4L);
        entitiesTask = plugin.getServer().getScheduler().runTaskTimer(plugin, this::tickEntities, 20L, 10L);

        if (!bindAddress.isLoopbackAddress() && !config.tokenRequired()) {
            log.warning("WebCraftBridge is bound to a non-loopback address without a token. "
                    + "Set token in config.yml and add an allowed origin before exposing it.");
        }
        log.info("WebCraftBridge " + VERSION + " ready on port " + boundPort
                + " (world=" + config.worldName() + ", view=" + config.viewDistance() + " chunks)");
    }

    public void stop() {
        running = false;
        if (streamTask != null) {
            streamTask.cancel();
            streamTask = null;
        }
        if (avatarTask != null) {
            avatarTask.cancel();
            avatarTask = null;
        }
        if (playersTask != null) {
            playersTask.cancel();
            playersTask = null;
        }
        if (entitiesTask != null) {
            entitiesTask.cancel();
            entitiesTask = null;
        }
        // Remove visible avatars before closing sockets: onClose cleanup is a no-op once running=false.
        for (BridgeSession session : List.copyOf(joinedSessions)) {
            Avatar avatar = session.avatar();
            if (avatar != null) {
                avatar.remove();
            }
        }
        joinedSessions.clear();
        if (server != null) {
            server.stop();
            server = null;
        }
        sessionsByConnection.clear();
        if (timeouts != null) {
            timeouts.shutdownNow();
            timeouts = null;
        }
        // Catch avatars whose deferred cleanup was cancelled by this shutdown.
        cleanupStaleAvatars();
        log.info("WebCraftBridge stopped");
    }

    public String statusLine() {
        WsServer current = server;
        int boundPort = current == null ? config.port() : current.boundPort();
        int clients = current == null ? 0 : current.activeConnections();
        return "WebCraftBridge " + VERSION + " | ws://" + config.bindAddress() + ":" + boundPort + config.path()
                + " | clients=" + clients + " joined=" + joinedSessions.size()
                + " | world=" + config.worldName()
                + " | token=" + (config.tokenRequired() ? "required" : "none")
                + " | view=" + config.viewDistance();
    }

    private String healthJson() {
        return Json.stringify(Json.map(
                "ok", true,
                "plugin", "WebCraftBridge",
                "version", VERSION,
                "clients", server == null ? 0 : server.activeConnections(),
                "joined", joinedSessions.size(),
                "world", config.worldName()
        ));
    }

    private void onOpen(WsConnection connection) {
        log.fine("bridge client connected: " + connection.remote());
        if (!running) {
            connection.close(1012, "bridge restarting");
            return;
        }
        ScheduledExecutorService scheduler = timeouts;
        if (scheduler != null) {
            try {
                scheduler.schedule(() -> {
                    if (!sessionsByConnection.containsKey(connection)) {
                        connection.close(4008, "hello timeout");
                    }
                }, 10L, TimeUnit.SECONDS);
            } catch (RejectedExecutionException ignored) {
                // plugin is shutting down
            }
        }
    }

    private void onText(WsConnection connection, String text) {
        if (!running) {
            connection.close(1012, "bridge restarting");
            return;
        }
        if (text.length() > MAX_INCOMING_CHARS) {
            connection.close(1009, "message too large");
            return;
        }

        Map<String, Object> message;
        try {
            message = Json.parseObject(text);
        } catch (IllegalArgumentException exception) {
            sendConnectionError(connection, "bad_json", "invalid JSON: " + exception.getMessage());
            return;
        }
        String type = Json.str(message, "t");
        if (type == null || type.isEmpty()) {
            sendConnectionError(connection, "bad_message", "missing t");
            return;
        }

        BridgeSession session = sessionsByConnection.get(connection);
        if (session == null) {
            if ("hello".equals(type)) {
                handleHello(connection, message);
            } else {
                sendConnectionError(connection, "not_authenticated", "send hello first");
            }
            return;
        }

        switch (type) {
            case "hello" -> session.sendError("already_hello", "hello already completed");
            case "join" -> {
                if (session.joined()) {
                    session.sendError("already_joined", "session is already in the world");
                } else {
                    runMain(() -> handleJoin(session, message));
                }
            }
            case "ping" -> handlePing(session, message);
            case "leave" -> connection.close(1000, "client leave");
            default -> {
                if (!session.joined()) {
                    session.sendError("not_joined", "send join first");
                    return;
                }
                switch (type) {
                    case "move" -> handleMove(session, message);
                    case "look" -> handleLook(session, message);
                    case "block_set" -> handleBlockSet(session, message);
                    case "block_break" -> handleBlockBreak(session, message);
                    case "chat" -> handleChat(session, message);
                    case "inv_req" -> runMain(() -> sendInventory(session));
                    case "held" -> handleHeld(session, message);
                    case "chunk_req" -> handleChunkRequest(session, message);
                    default -> session.sendError("unknown_message", "unknown message type: " + type);
                }
            }
        }
    }

    private void onClose(WsConnection connection, int code, String reason) {
        BridgeSession session = sessionsByConnection.remove(connection);
        if (session == null) {
            return;
        }
        boolean wasJoined = session.joined();
        joinedSessions.remove(session);
        if (wasJoined) {
            runMain(() -> {
                Avatar avatar = session.avatar();
                if (avatar != null) {
                    avatar.remove();
                }
                if (running) {
                    broadcastToJoined(Json.stringify(Json.map(
                            "t", "player_leave",
                            "id", session.id()
                    )));
                }
            });
        }
        log.info("bridge client left: " + session.name() + " (" + connection.remote()
                + ", code=" + code + ", reason=" + reason + ")");
    }

    private void handleHello(WsConnection connection, Map<String, Object> message) {
        if (config.tokenRequired()) {
            String helloToken = Json.str(message, "token");
            String queryToken = connection.queryParam("token");
            if (!tokenMatches(helloToken) && !tokenMatches(queryToken)) {
                sendConnectionError(connection, "auth_failed", "invalid bridge token");
                connection.close(4001, "authentication failed");
                return;
            }
        }

        Integer protocol = Json.integer(message, "protocol");
        if (protocol == null || protocol != PROTOCOL) {
            sendConnectionError(connection, "protocol_mismatch", "protocol 1 required");
            connection.close(4002, "protocol mismatch");
            return;
        }

        String rawName = Json.str(message, "name");
        if (rawName == null) {
            sendConnectionError(connection, "bad_name", "name is required");
            return;
        }
        String name = rawName.trim();
        if (!NAME_PATTERN.matcher(name).matches()) {
            sendConnectionError(connection, "bad_name", "name must match [A-Za-z0-9_]{1,16}");
            return;
        }

        synchronized (sessionsByConnection) {
            for (BridgeSession existing : sessionsByConnection.values()) {
                if (existing.name().equalsIgnoreCase(name)) {
                    sendConnectionError(connection, "name_in_use", "another bridge client uses that name");
                    return;
                }
            }
            BridgeSession session = new BridgeSession(connection, UUID.randomUUID().toString(), name);
            sessionsByConnection.put(connection, session);
            session.send(Json.stringify(Json.map(
                    "t", "hello_ok",
                    "protocol", PROTOCOL,
                    "id", session.id(),
                    "name", session.name(),
                    "tokenRequired", config.tokenRequired(),
                    "server", Json.map(
                            "name", "WebCraft 26.2",
                            "version", VERSION,
                            "minecraft", "26.2"
                    ),
                    "limits", Json.map(
                            "maxClients", config.maxClients(),
                            "viewDistance", config.viewDistance(),
                            "reach", config.maxReach(),
                            "maxSpeed", config.maxSpeed(),
                            "tickHz", 20
                    )
            )));
            log.info("bridge client hello: " + name + " (" + connection.remote() + ")");
        }
    }

    private void handleJoin(BridgeSession session, Map<String, Object> message) {
        if (!running || !session.connection().isOpen() || session.state() != BridgeSession.State.HELLO) {
            return;
        }
        if (sessionsByConnection.get(session.connection()) != session) {
            return;
        }

        World world = Bukkit.getWorld(config.worldName());
        if (world == null) {
            session.sendError("world_not_found", "world '" + config.worldName() + "' is not loaded");
            return;
        }

        Double requestX = Json.number(message, "x");
        Double requestY = Json.number(message, "y");
        Double requestZ = Json.number(message, "z");
        if ((requestX != null && !isFinite(requestX))
                || (requestY != null && !isFinite(requestY))
                || (requestZ != null && !isFinite(requestZ))) {
            session.sendError("bad_position", "position must be finite");
            return;
        }

        Location worldSpawn = world.getSpawnLocation();
        double x = requestX == null ? worldSpawn.getX() + 0.5 : requestX;
        double z = requestZ == null ? worldSpawn.getZ() + 0.5 : requestZ;
        if (Math.abs(x) > 30_000_000.0 || Math.abs(z) > 30_000_000.0) {
            session.sendError("bad_position", "position out of range");
            return;
        }
        if (config.maxJoinDistance() > 0) {
            double dx = x - worldSpawn.getX();
            double dz = z - worldSpawn.getZ();
            double limit = config.maxJoinDistance();
            if (dx * dx + dz * dz > limit * limit) {
                session.sendError("spawn_too_far", "join position is more than " + config.maxJoinDistance()
                        + " blocks from the world spawn");
                return;
            }
        }

        int blockX = floor(x);
        int blockZ = floor(z);
        int minY = world.getMinHeight();
        int maxY = world.getMaxHeight();

        try {
            world.getChunkAt(blockX >> 4, blockZ >> 4);
        } catch (RuntimeException exception) {
            log.log(Level.WARNING, "failed to load join chunk for " + session.name(), exception);
            session.sendError("world_error", "server could not load the join chunk");
            return;
        }

        double y;
        if (requestY == null) {
            try {
                Block highest = world.getHighestBlockAt(blockX, blockZ);
                y = Math.min(highest.getY() + 1.0, maxY - 2.0);
            } catch (RuntimeException exception) {
                log.log(Level.WARNING, "failed to find surface for " + session.name(), exception);
                session.sendError("world_error", "server could not find a safe join height");
                return;
            }
        } else {
            y = requestY;
        }
        int blockY = floor(y);
        if (blockY < minY || blockY > maxY - 2) {
            session.sendError("bad_position", "y must be between " + minY + " and " + (maxY - 2));
            return;
        }
        Location location = new Location(world, x, y, z);
        if (!world.getWorldBorder().isInside(location)) {
            session.sendError("outside_border", "position is outside the world border");
            return;
        }
        Block feet = world.getBlockAt(blockX, blockY, blockZ);
        Block head = world.getBlockAt(blockX, blockY + 1, blockZ);
        if (feet.getType().isSolid() || head.getType().isSolid()) {
            session.sendError("spawn_blocked", "join position is inside a solid block");
            return;
        }

        float yaw = floatValue(message, "yaw", 0.0F);
        float pitch = floatValue(message, "pitch", 0.0F);
        if (!Float.isFinite(yaw) || !Float.isFinite(pitch)) {
            session.sendError("bad_position", "yaw/pitch must be finite");
            return;
        }
        yaw = Avatar.normalizeYaw(yaw);
        pitch = Avatar.clampPitch(pitch);

        UUID avatarId;
        try {
            avatarId = UUID.fromString(session.id());
        } catch (IllegalArgumentException exception) {
            session.sendError("internal", "invalid session id");
            return;
        }
        Avatar avatar = new Avatar(avatarId, session.name(), location, yaw, pitch);
        avatar.apply();
        session.markJoined(world, avatar, x, y, z, yaw, pitch);
        session.recordBroadcast(x, y, z, yaw, pitch);
        joinedSessions.add(session);

        // Close may race with the scheduled join; never leave an orphan avatar or joined entry.
        if (!session.connection().isOpen() || sessionsByConnection.get(session.connection()) != session) {
            joinedSessions.remove(session);
            avatar.remove();
            return;
        }

        session.send(Json.stringify(Json.map(
                "t", "joined",
                "protocol", PROTOCOL,
                "id", session.id(),
                "name", session.name(),
                "world", world.getName(),
                "dimension", world.getKey().toString(),
                "minY", minY,
                "maxY", maxY,
                "tickHz", 20,
                "viewDistance", config.viewDistance(),
                "reach", config.maxReach(),
                "maxSpeed", config.maxSpeed(),
                "spawn", Json.map(
                        "x", round3(x),
                        "y", round3(y),
                        "z", round3(z),
                        "yaw", round1(yaw),
                        "pitch", round1(pitch)
                )
        )));
        sendInventory(session);

        String joinJson = Json.stringify(Json.map(
                "t", "player_join",
                "player", webPlayerObject(session)
        ));
        for (BridgeSession other : joinedSessions) {
            if (other != session && other.joined() && other.world().getUID().equals(world.getUID())) {
                other.send(joinJson);
            }
        }
        session.send(buildPlayersJson(world));

        session.beginInitialStream();
        enqueueAround(session, blockX >> 4, blockZ >> 4, config.viewDistance());
        log.info("bridge player joined: " + session.name() + " at " + world.getName()
                + " " + blockX + "," + blockY + "," + blockZ);
    }

    private void handleMove(BridgeSession session, Map<String, Object> message) {
        if (!session.moveLimiter().tryAcquire()) {
            return;
        }
        Double x = Json.number(message, "x");
        Double y = Json.number(message, "y");
        Double z = Json.number(message, "z");
        if (x == null || y == null || z == null || !isFinite(x) || !isFinite(y) || !isFinite(z)) {
            session.sendError("bad_move", "x, y and z are required and must be finite");
            return;
        }
        float yaw = floatValue(message, "yaw", session.lastYaw());
        float pitch = floatValue(message, "pitch", session.lastPitch());
        if (!Float.isFinite(yaw) || !Float.isFinite(pitch)) {
            session.sendError("bad_move", "yaw/pitch must be finite");
            return;
        }

        World world = session.world();
        if (y < world.getMinHeight() || y > world.getMaxHeight() - 1) {
            sendSelfCorrection(session);
            return;
        }
        Location target = new Location(world, x, y, z);
        if (Math.abs(x) > 30_000_000.0 || Math.abs(z) > 30_000_000.0
                || !world.getWorldBorder().isInside(target)) {
            sendSelfCorrection(session);
            return;
        }

        long now = System.nanoTime();
        double deltaSeconds = Math.min(1.0, Math.max(0.001, (now - session.lastMoveNanos()) / 1_000_000_000.0));
        double allowance = config.maxSpeed() * deltaSeconds + 0.1;
        double dx = x - session.lastX();
        double dy = y - session.lastY();
        double dz = z - session.lastZ();
        if (dx * dx + dy * dy + dz * dz > allowance * allowance) {
            session.recordViolation();
            if (session.moveViolations() >= 20) {
                session.connection().close(4003, "movement rejected");
            } else {
                sendSelfCorrection(session);
            }
            return;
        }

        session.recordMove(x, y, z, Avatar.normalizeYaw(yaw), Avatar.clampPitch(pitch));
    }

    private void handleLook(BridgeSession session, Map<String, Object> message) {
        if (!session.lookLimiter().tryAcquire()) {
            return;
        }
        float yaw = floatValue(message, "yaw", session.lastYaw());
        float pitch = floatValue(message, "pitch", session.lastPitch());
        if (!Float.isFinite(yaw) || !Float.isFinite(pitch)) {
            session.sendError("bad_look", "yaw/pitch must be finite");
            return;
        }
        session.recordLook(Avatar.normalizeYaw(yaw), Avatar.clampPitch(pitch));
    }

    private void sendSelfCorrection(BridgeSession session) {
        session.send(Json.stringify(Json.map(
                "t", "self",
                "x", round3(session.lastX()),
                "y", round3(session.lastY()),
                "z", round3(session.lastZ()),
                "yaw", round1(session.lastYaw()),
                "pitch", round1(session.lastPitch()),
                "teleport", true
        )));
    }

    private void handleBlockSet(BridgeSession session, Map<String, Object> message) {
        if (!session.blockLimiter().tryAcquire()) {
            session.sendError("rate_limited", "block changes are limited to 8 per second");
            return;
        }
        Integer x = blockCoordinate(message, "x");
        Integer y = blockCoordinate(message, "y");
        Integer z = blockCoordinate(message, "z");
        String state = Json.str(message, "state");
        if (x == null || y == null || z == null) {
            session.sendError("bad_block", "integer x, y and z are required");
            return;
        }
        if (state == null || state.isEmpty() || state.length() > 256) {
            session.sendError("bad_block", "state is required");
            return;
        }
        runMain(() -> applyBlockSet(session, x, y, z, state));
    }

    private void handleBlockBreak(BridgeSession session, Map<String, Object> message) {
        if (!session.blockLimiter().tryAcquire()) {
            session.sendError("rate_limited", "block changes are limited to 8 per second");
            return;
        }
        Integer x = blockCoordinate(message, "x");
        Integer y = blockCoordinate(message, "y");
        Integer z = blockCoordinate(message, "z");
        if (x == null || y == null || z == null) {
            session.sendError("bad_block", "integer x, y and z are required");
            return;
        }
        runMain(() -> applyBlockBreak(session, x, y, z));
    }

    private void applyBlockSet(BridgeSession session, int x, int y, int z, String state) {
        if (!session.joined() || !session.connection().isOpen()) {
            return;
        }
        World world = session.world();
        if (!checkBlockTarget(session, world, x, y, z)) {
            return;
        }
        Block block = world.getBlockAt(x, y, z);
        if (!block.getType().isAir()) {
            session.sendError("block_occupied", "target block is not air");
            return;
        }
        BlockData data;
        try {
            data = Bukkit.getServer().createBlockData(state);
        } catch (IllegalArgumentException exception) {
            session.sendError("bad_block", "unknown block state: " + state);
            return;
        }
        if (!data.getMaterial().isBlock() || data.getMaterial().isAir()) {
            session.sendError("bad_block", "state is not a placeable block");
            return;
        }
        block.setBlockData(data, true);
        broadcastBlock(world, x, y, z, data.getAsString(), session.name(), "web");
    }

    private void applyBlockBreak(BridgeSession session, int x, int y, int z) {
        if (!session.joined() || !session.connection().isOpen()) {
            return;
        }
        World world = session.world();
        if (!checkBlockTarget(session, world, x, y, z)) {
            return;
        }
        Block block = world.getBlockAt(x, y, z);
        Material type = block.getType();
        if (type.isAir()) {
            session.sendError("block_empty", "target block is already air");
            return;
        }
        if (type.getHardness() < 0.0F) {
            session.sendError("unbreakable", "target block is unbreakable");
            return;
        }
        block.setType(Material.AIR, true);
        broadcastBlock(world, x, y, z, ChunkCodec.AIR, session.name(), "web");
    }

    private boolean checkBlockTarget(BridgeSession session, World world, int x, int y, int z) {
        if (y < world.getMinHeight() || y >= world.getMaxHeight()) {
            session.sendError("bad_block", "y is outside the world height");
            return false;
        }
        if (!world.isChunkLoaded(x >> 4, z >> 4)) {
            session.sendError("chunk_not_loaded", "target chunk is not loaded");
            return false;
        }
        if (!world.getWorldBorder().isInside(new Location(world, x + 0.5, y + 0.5, z + 0.5))) {
            session.sendError("outside_border", "target block is outside the world border");
            return false;
        }
        Avatar avatar = session.avatar();
        if (avatar == null) {
            session.sendError("not_joined", "avatar is not available");
            return false;
        }
        Location eye = avatar.location().clone().add(0.0, 1.62, 0.0);
        if (distanceToBlock(eye, x, y, z) > config.maxReach()) {
            session.sendError("out_of_reach", "target block is out of reach");
            return false;
        }
        return true;
    }

    private void handleChat(BridgeSession session, Map<String, Object> message) {
        if (!session.chatLimiter().tryAcquire()) {
            session.sendError("rate_limited", "chat is limited to one message per second");
            return;
        }
        String raw = Json.str(message, "text");
        if (raw == null) {
            session.sendError("bad_chat", "text is required");
            return;
        }
        String text = sanitizeChat(raw);
        if (text.isEmpty()) {
            return;
        }
        runMain(() -> {
            if (!session.joined() || !session.connection().isOpen()) {
                return;
            }
            broadcastToJoined(Json.stringify(Json.map(
                    "t", "chat",
                    "from", Json.map(
                            "id", session.id(),
                            "name", session.name(),
                            "kind", "web"
                    ),
                    "text", text,
                    "ts", System.currentTimeMillis(),
                    "source", "web"
            )));
            Bukkit.broadcast(Component.text("[Web] " + session.name() + ": " + text));
        });
    }

    private void handleHeld(BridgeSession session, Map<String, Object> message) {
        Integer slot = Json.integer(message, "slot");
        if (slot == null || slot < 0 || slot > 8) {
            session.sendError("bad_slot", "slot must be 0..8");
            return;
        }
        runMain(() -> {
            session.heldSlot(slot);
            sendInventory(session);
        });
    }

    private void sendInventory(BridgeSession session) {
        if (!session.joined() || !session.connection().isOpen()) {
            return;
        }
        session.send(Json.stringify(Json.map(
                "t", "inv",
                "size", 41,
                "held", session.heldSlot(),
                "items", List.of(),
                "virtual", true,
                "note", "inventory is reserved for a later milestone"
        )));
    }

    private void handleChunkRequest(BridgeSession session, Map<String, Object> message) {
        if (!session.chunkLimiter().tryAcquire()) {
            session.sendError("rate_limited", "chunk requests are limited to 2 per second");
            return;
        }
        Integer chunkX = Json.integer(message, "cx");
        Integer chunkZ = Json.integer(message, "cz");
        if (chunkX == null || chunkZ == null) {
            session.sendError("bad_chunk", "integer cx and cz are required");
            return;
        }
        runMain(() -> {
            if (!session.joined()) {
                return;
            }
            int playerChunkX = BridgeSession.floorChunk(session.avatar().location().getX());
            int playerChunkZ = BridgeSession.floorChunk(session.avatar().location().getZ());
            int maxDistance = config.viewDistance() + 2;
            if (Math.abs(chunkX - playerChunkX) > maxDistance || Math.abs(chunkZ - playerChunkZ) > maxDistance) {
                session.sendError("chunk_out_of_range", "chunk request is outside the configured view distance");
                return;
            }
            session.enqueueChunk(chunkX, chunkZ, true);
        });
    }

    private void handlePing(BridgeSession session, Map<String, Object> message) {
        if (!session.pingLimiter().tryAcquire()) {
            return;
        }
        session.send(Json.stringify(Json.map(
                "t", "pong",
                "id", message.get("id"),
                "now", System.currentTimeMillis()
        )));
    }

    private void tickStreams() {
        if (!running) {
            return;
        }
        for (BridgeSession session : joinedSessions) {
            if (!session.joined() || !session.connection().isOpen()) {
                continue;
            }
            int[] chunk = session.pollChunk();
            if (chunk == null) {
                if (session.initialStreaming() && !session.initialDone()) {
                    session.send("{\"t\":\"stream_done\"}");
                    session.markInitialDone();
                }
                continue;
            }
            if (!sendChunk(session, chunk[0], chunk[1])) {
                session.requeueChunk(chunk);
            }
        }
    }

    private boolean sendChunk(BridgeSession session, int chunkX, int chunkZ) {
        List<String> messages;
        try {
            messages = ChunkCodec.encode(session.world(), chunkX, chunkZ);
        } catch (RuntimeException exception) {
            log.log(Level.WARNING, "failed to encode chunk " + chunkX + "," + chunkZ
                    + " for " + session.name(), exception);
            session.sendError("chunk_error", "server could not encode that chunk");
            return true;
        }
        for (String message : messages) {
            if (!session.send(message)) {
                return false;
            }
        }
        session.markChunkSent(chunkX, chunkZ);
        return true;
    }

    private void enqueueAround(BridgeSession session, int centerX, int centerZ, int radius) {
        int safeRadius = Math.max(0, Math.min(8, radius));
        for (int ring = 0; ring <= safeRadius; ring++) {
            for (int dx = -ring; dx <= ring; dx++) {
                for (int dz = -ring; dz <= ring; dz++) {
                    if (Math.max(Math.abs(dx), Math.abs(dz)) != ring) {
                        continue;
                    }
                    int chunkX = centerX + dx;
                    int chunkZ = centerZ + dz;
                    if (!session.hasSentChunk(chunkX, chunkZ)) {
                        session.enqueueChunk(chunkX, chunkZ, false);
                    }
                }
            }
        }
    }

    private void tickAvatars() {
        if (!running) {
            return;
        }
        for (BridgeSession session : joinedSessions) {
            if (!session.joined() || !session.connection().isOpen()) {
                continue;
            }
            Avatar avatar = session.avatar();
            if (avatar == null) {
                continue;
            }
            BridgeSession.PendingTransform pending = session.takePendingTransform();
            if (pending != null) {
                avatar.setPosition(
                        new Location(session.world(), pending.x(), pending.y(), pending.z()),
                        pending.yaw(),
                        pending.pitch()
                );
            }
            avatar.apply();

            Location location = avatar.location();
            boolean changed = !session.broadcastValid()
                    || Math.abs(location.getX() - session.broadcastX()) > 0.01
                    || Math.abs(location.getY() - session.broadcastY()) > 0.01
                    || Math.abs(location.getZ() - session.broadcastZ()) > 0.01
                    || Math.abs(Avatar.normalizeYaw(avatar.yaw() - session.broadcastYaw())) > 0.1F
                    || Math.abs(avatar.pitch() - session.broadcastPitch()) > 0.1F;
            if (changed) {
                session.recordBroadcast(location.getX(), location.getY(), location.getZ(), avatar.yaw(), avatar.pitch());
                String moveJson = Json.stringify(Json.map(
                        "t", "player_move",
                        "id", session.id(),
                        "x", round3(location.getX()),
                        "y", round3(location.getY()),
                        "z", round3(location.getZ()),
                        "yaw", round1(avatar.yaw()),
                        "pitch", round1(avatar.pitch())
                ));
                for (BridgeSession other : joinedSessions) {
                    if (other != session && other.joined()
                            && other.world().getUID().equals(session.world().getUID())) {
                        other.send(moveJson);
                    }
                }
            }

            int chunkX = BridgeSession.floorChunk(location.getX());
            int chunkZ = BridgeSession.floorChunk(location.getZ());
            if (!session.hasSentChunk(chunkX, chunkZ)) {
                enqueueAround(session, chunkX, chunkZ, config.viewDistance());
            }
        }
    }

    private void tickPlayers() {
        if (!running || joinedSessions.isEmpty()) {
            return;
        }
        Map<UUID, String> cache = new HashMap<>();
        for (BridgeSession session : joinedSessions) {
            if (!session.joined() || !session.connection().isOpen()) {
                continue;
            }
            World world = session.world();
            String json = cache.computeIfAbsent(world.getUID(), ignored -> buildPlayersJson(world));
            session.send(json);
        }
    }

    private String buildPlayersJson(World world) {
        List<Object> players = new ArrayList<>();
        for (Player player : Bukkit.getOnlinePlayers()) {
            if (!player.getWorld().getUID().equals(world.getUID())) {
                continue;
            }
            Location location = player.getLocation();
            players.add(Json.map(
                    "id", player.getUniqueId().toString(),
                    "name", player.getName(),
                    "kind", "java",
                    "x", round3(location.getX()),
                    "y", round3(location.getY()),
                    "z", round3(location.getZ()),
                    "yaw", round1(location.getYaw()),
                    "pitch", round1(location.getPitch())
            ));
        }
        for (BridgeSession session : joinedSessions) {
            if (session.joined() && session.avatar() != null
                    && session.world().getUID().equals(world.getUID())) {
                players.add(webPlayerObject(session));
            }
        }
        return Json.stringify(Json.map("t", "players", "players", players));
    }

    private Map<String, Object> webPlayerObject(BridgeSession session) {
        Avatar avatar = session.avatar();
        Location location = avatar.location();
        return Json.map(
                "id", session.id(),
                "name", session.name(),
                "kind", "web",
                "x", round3(location.getX()),
                "y", round3(location.getY()),
                "z", round3(location.getZ()),
                "yaw", round1(avatar.yaw()),
                "pitch", round1(avatar.pitch())
        );
    }

    private void tickEntities() {
        if (!running || joinedSessions.isEmpty()) {
            return;
        }
        for (BridgeSession session : joinedSessions) {
            if (!session.joined() || !session.connection().isOpen() || session.avatar() == null) {
                continue;
            }
            Location center = session.avatar().location().clone().add(0.0, 1.0, 0.0);
            Collection<Entity> nearby = session.world().getNearbyEntities(center, 48.0, 48.0, 48.0,
                    entity -> !(entity instanceof Player)
                            && !entity.getScoreboardTags().contains(Avatar.TAG));
            List<Object> entities = new ArrayList<>(Math.min(nearby.size(), 128));
            for (Entity entity : nearby) {
                if (entities.size() >= 128) {
                    break;
                }
                Location location = entity.getLocation();
                entities.add(Json.map(
                        "id", entity.getUniqueId().toString(),
                        "type", entity.getType().getKey().toString(),
                        "x", round3(location.getX()),
                        "y", round3(location.getY()),
                        "z", round3(location.getZ()),
                        "yaw", round1(location.getYaw()),
                        "pitch", round1(location.getPitch())
                ));
            }
            session.send(Json.stringify(Json.map("t", "entities", "entities", entities)));
        }
    }

    private void broadcastBlock(World world, int x, int y, int z, String state, String by, String source) {
        if (!running || joinedSessions.isEmpty()) {
            return;
        }
        String json = Json.stringify(Json.map(
                "t", "block",
                "world", world.getName(),
                "x", x,
                "y", y,
                "z", z,
                "state", state,
                "by", by,
                "source", source
        ));
        for (BridgeSession session : joinedSessions) {
            if (session.joined() && session.world().getUID().equals(world.getUID())) {
                session.send(json);
            }
        }
    }

    private void broadcastToJoined(String json) {
        for (BridgeSession session : joinedSessions) {
            if (session.joined() && session.connection().isOpen()) {
                session.send(json);
            }
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBlockPlace(BlockPlaceEvent event) {
        if (!running || joinedSessions.isEmpty()) {
            return;
        }
        Block block = event.getBlock();
        broadcastBlock(block.getWorld(), block.getX(), block.getY(), block.getZ(),
                block.getBlockData().getAsString(), event.getPlayer().getName(), "java");
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBlockBreak(BlockBreakEvent event) {
        if (!running || joinedSessions.isEmpty()) {
            return;
        }
        Block block = event.getBlock();
        broadcastBlock(block.getWorld(), block.getX(), block.getY(), block.getZ(),
                ChunkCodec.AIR, event.getPlayer().getName(), "java");
    }

    // Paper still fires the legacy event for compatibility; modern AsyncChatEvent is a later upgrade.
    @SuppressWarnings("deprecation")
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onAsyncChat(AsyncPlayerChatEvent event) {
        if (!running || joinedSessions.isEmpty()) {
            return;
        }
        String text = event.getMessage();
        if (text.length() > 240) {
            text = text.substring(0, 240);
        }
        String json = Json.stringify(Json.map(
                "t", "chat",
                "from", Json.map(
                        "id", event.getPlayer().getUniqueId().toString(),
                        "name", event.getPlayer().getName(),
                        "kind", "java"
                ),
                "text", text,
                "ts", System.currentTimeMillis(),
                "source", "java"
        ));
        broadcastToJoined(json);
    }

    @EventHandler(ignoreCancelled = true)
    public void onEntityDamage(EntityDamageEvent event) {
        if (event.getEntity().getScoreboardTags().contains(Avatar.TAG)) {
            event.setCancelled(true);
        }
    }

    @EventHandler(ignoreCancelled = true)
    public void onArmorStandManipulate(PlayerArmorStandManipulateEvent event) {
        if (event.getRightClicked().getScoreboardTags().contains(Avatar.TAG)) {
            event.setCancelled(true);
        }
    }

    private void cleanupStaleAvatars() {
        int removed = 0;
        for (World world : Bukkit.getWorlds()) {
            for (ArmorStand stand : world.getEntitiesByClass(ArmorStand.class)) {
                if (stand.getScoreboardTags().contains(Avatar.TAG)) {
                    stand.remove();
                    removed++;
                }
            }
        }
        if (removed > 0) {
            log.info("Removed " + removed + " bridge avatar entity/entities");
        }
    }

    private void sendConnectionError(WsConnection connection, String code, String message) {
        connection.sendText(Json.stringify(Json.map(
                "t", "error",
                "code", code,
                "message", message
        )));
    }

    private boolean tokenMatches(String provided) {
        if (!config.tokenRequired()) {
            return true;
        }
        if (provided == null) {
            return false;
        }
        return MessageDigest.isEqual(
                provided.getBytes(StandardCharsets.UTF_8),
                config.token().getBytes(StandardCharsets.UTF_8)
        );
    }

    private void runMain(Runnable task) {
        if (!running || !plugin.isEnabled()) {
            return;
        }
        try {
            plugin.getServer().getScheduler().runTask(plugin, task);
        } catch (IllegalStateException ignored) {
            // server is shutting down
        }
    }

    private static boolean isFinite(double value) {
        return Double.isFinite(value);
    }

    private static int floor(double value) {
        return (int) Math.floor(value);
    }

    private static Integer blockCoordinate(Map<String, Object> message, String key) {
        Double value = Json.number(message, key);
        if (value == null || !Double.isFinite(value) || Math.abs(value) > 30_000_000.0) {
            return null;
        }
        double rounded = Math.rint(value);
        if (Math.abs(value - rounded) > 1.0E-6) {
            return null;
        }
        return (int) rounded;
    }

    private static float floatValue(Map<String, Object> message, String key, float defaultValue) {
        Double value = Json.number(message, key);
        if (value == null || !Double.isFinite(value)) {
            return defaultValue;
        }
        return value.floatValue();
    }

    private static double distanceToBlock(Location eye, int x, int y, int z) {
        double dx = Math.max(Math.max(x - eye.getX(), 0.0), eye.getX() - (x + 1.0));
        double dy = Math.max(Math.max(y - eye.getY(), 0.0), eye.getY() - (y + 1.0));
        double dz = Math.max(Math.max(z - eye.getZ(), 0.0), eye.getZ() - (z + 1.0));
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    private static String sanitizeChat(String raw) {
        String text = raw.trim();
        if (text.length() > 240) {
            text = text.substring(0, 240);
        }
        StringBuilder builder = new StringBuilder(text.length());
        for (int index = 0; index < text.length(); index++) {
            char character = text.charAt(index);
            if (character != '\u00a7' && (character == '\t' || character >= 0x20)) {
                builder.append(character);
            }
        }
        return builder.toString();
    }

    private static double round3(double value) {
        return Math.round(value * 1000.0) / 1000.0;
    }

    private static double round1(double value) {
        return Math.round(value * 10.0) / 10.0;
    }
}
