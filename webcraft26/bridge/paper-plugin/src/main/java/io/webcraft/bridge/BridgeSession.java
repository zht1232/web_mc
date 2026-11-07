package io.webcraft.bridge;

import io.webcraft.bridge.ws.WsConnection;
import org.bukkit.World;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashSet;
import java.util.Set;

/** State for one WebSocket client. World access always happens through the bridge's main thread. */
final class BridgeSession {

    enum State {
        HELLO,
        JOINED
    }

    private final WsConnection connection;
    private final String id;
    private final String name;
    private final RateLimiter moveLimiter = new RateLimiter(20);
    private final RateLimiter lookLimiter = new RateLimiter(20);
    private final RateLimiter blockLimiter = new RateLimiter(8);
    private final RateLimiter chatLimiter = new RateLimiter(1);
    private final RateLimiter chunkLimiter = new RateLimiter(2);
    private final RateLimiter pingLimiter = new RateLimiter(2);

    private final Deque<int[]> pendingChunks = new ArrayDeque<>();
    private final Set<Long> queuedChunks = new HashSet<>();
    private final Set<Long> sentChunks = new HashSet<>();

    private volatile State state = State.HELLO;
    private World world;
    private Avatar avatar;
    private int heldSlot;

    private double lastX;
    private double lastY;
    private double lastZ;
    private float lastYaw;
    private float lastPitch;
    private long lastMoveNanos;
    private int moveViolations;
    private long violationWindowStart;

    private PendingTransform pending;

    private boolean initialStreaming;
    private boolean initialDone;

    private double broadcastX;
    private double broadcastY;
    private double broadcastZ;
    private float broadcastYaw;
    private float broadcastPitch;
    private boolean broadcastValid;

    BridgeSession(WsConnection connection, String id, String name) {
        this.connection = connection;
        this.id = id;
        this.name = name;
    }

    WsConnection connection() {
        return connection;
    }

    String id() {
        return id;
    }

    String name() {
        return name;
    }

    State state() {
        return state;
    }

    boolean joined() {
        return state == State.JOINED;
    }

    void markJoined(World world, Avatar avatar, double x, double y, double z, float yaw, float pitch) {
        this.world = world;
        this.avatar = avatar;
        this.lastX = x;
        this.lastY = y;
        this.lastZ = z;
        this.lastYaw = yaw;
        this.lastPitch = pitch;
        this.pending = null;
        this.lastMoveNanos = System.nanoTime();
        this.state = State.JOINED;
    }

    World world() {
        return world;
    }

    Avatar avatar() {
        return avatar;
    }

    boolean send(String json) {
        return connection.sendText(json);
    }

    void sendError(String code, String message) {
        send(Json.stringify(Json.map("t", "error", "code", code, "message", message)));
    }

    RateLimiter moveLimiter() {
        return moveLimiter;
    }

    RateLimiter lookLimiter() {
        return lookLimiter;
    }

    RateLimiter blockLimiter() {
        return blockLimiter;
    }

    RateLimiter chatLimiter() {
        return chatLimiter;
    }

    RateLimiter chunkLimiter() {
        return chunkLimiter;
    }

    RateLimiter pingLimiter() {
        return pingLimiter;
    }

    double lastX() {
        return lastX;
    }

    double lastY() {
        return lastY;
    }

    double lastZ() {
        return lastZ;
    }

    float lastYaw() {
        return lastYaw;
    }

    float lastPitch() {
        return lastPitch;
    }

    long lastMoveNanos() {
        return lastMoveNanos;
    }

    int moveViolations() {
        return moveViolations;
    }

    long violationWindowStart() {
        return violationWindowStart;
    }

    synchronized void recordMove(double x, double y, double z, float yaw, float pitch) {
        this.lastX = x;
        this.lastY = y;
        this.lastZ = z;
        this.lastYaw = yaw;
        this.lastPitch = pitch;
        this.lastMoveNanos = System.nanoTime();
        this.pending = new PendingTransform(x, y, z, yaw, pitch);
    }

    synchronized void recordLook(float yaw, float pitch) {
        this.lastYaw = yaw;
        this.lastPitch = pitch;
        this.pending = new PendingTransform(lastX, lastY, lastZ, yaw, pitch);
        this.lastMoveNanos = System.nanoTime();
    }

    void recordViolation() {
        long now = System.nanoTime();
        if (now - violationWindowStart > 10_000_000_000L) {
            violationWindowStart = now;
            moveViolations = 0;
        }
        moveViolations++;
    }

    synchronized PendingTransform takePendingTransform() {
        PendingTransform current = pending;
        pending = null;
        return current;
    }

    int heldSlot() {
        return heldSlot;
    }

    void heldSlot(int slot) {
        this.heldSlot = Math.max(0, Math.min(40, slot));
    }

    void beginInitialStream() {
        initialStreaming = true;
        initialDone = false;
    }

    boolean initialStreaming() {
        return initialStreaming;
    }

    boolean initialDone() {
        return initialDone;
    }

    void markInitialDone() {
        initialDone = true;
    }

    synchronized void enqueueChunk(int chunkX, int chunkZ, boolean front) {
        long key = chunkKey(chunkX, chunkZ);
        if (!queuedChunks.add(key)) {
            return;
        }
        int[] chunk = new int[]{chunkX, chunkZ};
        if (front) {
            pendingChunks.addFirst(chunk);
        } else {
            pendingChunks.addLast(chunk);
        }
    }

    synchronized int[] pollChunk() {
        int[] chunk = pendingChunks.poll();
        if (chunk != null) {
            queuedChunks.remove(chunkKey(chunk[0], chunk[1]));
        }
        return chunk;
    }

    synchronized void requeueChunk(int[] chunk) {
        long key = chunkKey(chunk[0], chunk[1]);
        if (queuedChunks.add(key)) {
            pendingChunks.addFirst(chunk);
        }
    }

    void markChunkSent(int chunkX, int chunkZ) {
        sentChunks.add(chunkKey(chunkX, chunkZ));
    }

    boolean hasSentChunk(int chunkX, int chunkZ) {
        return sentChunks.contains(chunkKey(chunkX, chunkZ));
    }

    boolean broadcastValid() {
        return broadcastValid;
    }

    void recordBroadcast(double x, double y, double z, float yaw, float pitch) {
        this.broadcastX = x;
        this.broadcastY = y;
        this.broadcastZ = z;
        this.broadcastYaw = yaw;
        this.broadcastPitch = pitch;
        this.broadcastValid = true;
    }

    double broadcastX() {
        return broadcastX;
    }

    double broadcastY() {
        return broadcastY;
    }

    double broadcastZ() {
        return broadcastZ;
    }

    float broadcastYaw() {
        return broadcastYaw;
    }

    float broadcastPitch() {
        return broadcastPitch;
    }

    static int floorChunk(double coordinate) {
        return (int) Math.floor(coordinate / 16.0);
    }

    static long chunkKey(int chunkX, int chunkZ) {
        return ((long) chunkX << 32) ^ (chunkZ & 0xFFFFFFFFL);
    }
    record PendingTransform(double x, double y, double z, float yaw, float pitch) {
    }
}
