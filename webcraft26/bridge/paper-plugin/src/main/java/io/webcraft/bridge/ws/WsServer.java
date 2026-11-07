package io.webcraft.bridge.ws;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * A deliberately small, dependency-free RFC 6455 WebSocket server.
 *
 * <p>Paper exposes Netty on its own classpath, but plugin classloaders may not see all server
 * libraries, and adding Jetty/Netty as a shaded dependency would require a network build. A raw
 * socket implementation using only the JDK keeps the bridge plugin self-contained and portable
 * across Paper builds. It is intended for a handful of loopback browser clients, not as a public
 * reverse proxy.</p>
 */
public final class WsServer {

    public interface Handler {
        void onOpen(WsConnection connection);

        void onText(WsConnection connection, String message);

        void onClose(WsConnection connection, int code, String reason);
    }

    public record Options(
            InetAddress bindAddress,
            int port,
            String path,
            List<String> allowedOrigins,
            boolean allowMissingOrigin,
            int maxConnections
    ) {
        public Options {
            if (bindAddress == null) {
                throw new IllegalArgumentException("bindAddress");
            }
            if (port < 0 || port > 65535) {
                throw new IllegalArgumentException("port");
            }
            path = path == null || path.isBlank() ? "/ws" : path;
            if (!path.startsWith("/")) {
                throw new IllegalArgumentException("path must start with '/'");
            }
            allowedOrigins = allowedOrigins == null ? List.of() : List.copyOf(allowedOrigins);
            maxConnections = maxConnections <= 0 ? 16 : maxConnections;
        }
    }

    static final String WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    private final Options options;
    private final Handler handler;
    private final Logger logger;
    private final Supplier<String> healthJson;
    private final Set<WsConnection> connections = ConcurrentHashMap.newKeySet();
    private final AtomicInteger connectionCount = new AtomicInteger();
    private final AtomicInteger connectionSequence = new AtomicInteger();
    private final ScheduledExecutorService scheduler;

    private volatile ServerSocket serverSocket;
    private volatile boolean running;
    private Thread acceptThread;

    public WsServer(Options options, Handler handler, Logger logger, Supplier<String> healthJson) {
        this.options = options;
        this.handler = handler;
        this.logger = logger;
        this.healthJson = healthJson == null ? () -> "{\"ok\":true}" : healthJson;
        ThreadFactory factory = runnable -> {
            Thread thread = new Thread(runnable, "WebCraftBridge-Heartbeat");
            thread.setDaemon(true);
            return thread;
        };
        this.scheduler = Executors.newSingleThreadScheduledExecutor(factory);
    }

    /** Starts accepting connections and returns the actual bound port. */
    public synchronized int start() throws IOException {
        if (running) {
            throw new IllegalStateException("already running");
        }
        ServerSocket socket = new ServerSocket();
        socket.setReuseAddress(true);
        socket.bind(new InetSocketAddress(options.bindAddress(), options.port()), 64);
        serverSocket = socket;
        running = true;
        acceptThread = Thread.ofPlatform()
                .name("WebCraftBridge-WsAccept")
                .daemon(true)
                .start(this::acceptLoop);
        scheduler.scheduleAtFixedRate(this::heartbeat, 20L, 20L, TimeUnit.SECONDS);
        logger.info(() -> "WebSocket bridge listening on ws://" + options.bindAddress().getHostAddress()
                + ":" + socket.getLocalPort() + options.path()
                + " (max " + options.maxConnections() + " clients)");
        return socket.getLocalPort();
    }

    public synchronized void stop() {
        running = false;
        ServerSocket socket = serverSocket;
        if (socket != null) {
            try {
                socket.close();
            } catch (IOException ignored) {
                // closing
            }
        }
        for (WsConnection connection : connections.toArray(WsConnection[]::new)) {
            connection.close(1001, "server stopping");
        }
        scheduler.shutdownNow();
        logger.info("WebSocket bridge stopped");
    }

    public int boundPort() {
        ServerSocket socket = serverSocket;
        return socket == null ? options.port() : socket.getLocalPort();
    }

    public int connectionCount() {
        return connectionCount.get();
    }

    public int activeConnections() {
        return connections.size();
    }

    boolean isOriginAllowed(String origin) {
        if (origin == null) {
            return options.allowMissingOrigin();
        }
        String normalized = normalizeOrigin(origin);
        for (String allowed : options.allowedOrigins()) {
            if (allowed == null) {
                continue;
            }
            if ("*".equals(allowed.trim())) {
                return true;
            }
            if (normalizeOrigin(allowed).equals(normalized)) {
                return true;
            }
        }
        return false;
    }

    private static String normalizeOrigin(String origin) {
        String value = origin.trim().toLowerCase(Locale.ROOT);
        while (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }
        return value;
    }

    String healthJson() {
        try {
            return healthJson.get();
        } catch (RuntimeException exception) {
            logger.log(Level.WARNING, "health supplier failed", exception);
            return "{\"ok\":false}";
        }
    }

    void register(WsConnection connection) {
        connections.add(connection);
    }

    void onConnectionClosed(WsConnection connection) {
        connections.remove(connection);
        connectionCount.updateAndGet(current -> Math.max(0, current - 1));
    }

    private void acceptLoop() {
        ServerSocket socket = serverSocket;
        while (running && socket != null && !socket.isClosed()) {
            Socket accepted;
            try {
                accepted = socket.accept();
            } catch (IOException exception) {
                if (running) {
                    logger.log(Level.WARNING, "WebSocket accept failed", exception);
                }
                break;
            }

            int count = connectionCount.incrementAndGet();
            if (count > options.maxConnections()) {
                connectionCount.decrementAndGet();
                reject(accepted, 503, "Service Unavailable", "{\"error\":\"too_many_connections\"}");
                continue;
            }

            try {
                accepted.setTcpNoDelay(true);
                accepted.setKeepAlive(true);
            } catch (IOException ignored) {
                // best effort
            }

            WsConnection connection;
            try {
                connection = new WsConnection(
                        this,
                        accepted,
                        options,
                        handler,
                        logger,
                        this::onConnectionClosed
                );
                Thread.ofVirtual()
                        .name("WebCraftBridge-Ws-" + connectionSequence.incrementAndGet())
                        .start(connection::run);
            } catch (RuntimeException exception) {
                logger.log(Level.WARNING, "could not start WebSocket connection", exception);
                connectionCount.updateAndGet(current -> Math.max(0, current - 1));
                try {
                    accepted.close();
                } catch (IOException ignored) {
                    // already gone
                }
            }
        }
    }

    private void heartbeat() {
        long now = System.nanoTime();
        for (WsConnection connection : connections) {
            if (!connection.isOpen()) {
                continue;
            }
            if (now - connection.lastActivityNanos() > TimeUnit.SECONDS.toNanos(75)) {
                connection.close(1001, "heartbeat timeout");
            } else {
                connection.sendPing();
            }
        }
    }

    private void reject(Socket socket, int status, String reason, String body) {
        try (socket) {
            byte[] payload = body.getBytes(StandardCharsets.UTF_8);
            String headers = "HTTP/1.1 " + status + " " + reason + "\r\n"
                    + "Content-Type: application/json; charset=utf-8\r\n"
                    + "Content-Length: " + payload.length + "\r\n"
                    + "Connection: close\r\n"
                    + "Access-Control-Allow-Origin: *\r\n"
                    + "\r\n";
            OutputStream output = socket.getOutputStream();
            output.write(headers.getBytes(StandardCharsets.US_ASCII));
            output.write(payload);
            output.flush();
        } catch (IOException ignored) {
            // client went away
        }
    }

    Collection<WsConnection> connections() {
        return List.copyOf(connections);
    }
}
