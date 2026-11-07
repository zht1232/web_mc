package io.webcraft.bridge;

import org.bukkit.configuration.file.FileConfiguration;

import java.util.List;

/** Validated snapshot of config.yml. */
public record BridgeConfig(
        String bindAddress,
        int port,
        String path,
        String token,
        List<String> allowedOrigins,
        boolean allowMissingOrigin,
        int maxClients,
        String worldName,
        int viewDistance,
        double maxReach,
        double maxSpeed,
        int maxJoinDistance
) {

    public static BridgeConfig from(FileConfiguration config) {
        String bind = config.getString("bind-address", "127.0.0.1");
        if (bind == null || bind.isBlank()) {
            bind = "127.0.0.1";
        }
        int port = clamp(config.getInt("port", 8765), 0, 65535);
        String path = config.getString("path", "/ws");
        if (path == null || path.isBlank()) {
            path = "/ws";
        }
        if (!path.startsWith("/")) {
            path = "/" + path;
        }
        String token = config.getString("token", "");
        if (token == null) {
            token = "";
        }
        List<String> origins = config.getStringList("allowed-origins");
        int maxClients = clamp(config.getInt("max-clients", 16), 1, 128);
        String world = config.getString("world", "world");
        if (world == null || world.isBlank()) {
            world = "world";
        }
        int viewDistance = clamp(config.getInt("view-distance", 2), 0, 8);
        double maxReach = clamp(config.getDouble("max-reach", 6.0), 1.0, 12.0);
        double maxSpeed = clamp(config.getDouble("max-speed", 12.0), 1.0, 64.0);
        int maxJoinDistance = clamp(config.getInt("max-join-distance", 256), 0, 30_000_000);
        return new BridgeConfig(bind, port, path, token.trim(), List.copyOf(origins),
                config.getBoolean("allow-missing-origin", true), maxClients, world,
                viewDistance, maxReach, maxSpeed, maxJoinDistance);
    }

    public boolean tokenRequired() {
        return !token.isEmpty();
    }

    private static int clamp(int value, int minimum, int maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    private static double clamp(double value, double minimum, double maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }
}
