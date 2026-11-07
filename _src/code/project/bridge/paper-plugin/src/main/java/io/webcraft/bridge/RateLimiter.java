package io.webcraft.bridge;

/** Small token bucket used for per-session message rate limits. */
final class RateLimiter {

    private final double capacity;
    private final double refillPerSecond;
    private double tokens;
    private long lastNanos;

    RateLimiter(double perSecond) {
        this.capacity = Math.max(1.0, perSecond);
        this.refillPerSecond = Math.max(0.01, perSecond);
        this.tokens = capacity;
        this.lastNanos = System.nanoTime();
    }

    synchronized boolean tryAcquire() {
        long now = System.nanoTime();
        double elapsed = (now - lastNanos) / 1_000_000_000.0;
        lastNanos = now;
        tokens = Math.min(capacity, tokens + elapsed * refillPerSecond);
        if (tokens >= 1.0) {
            tokens -= 1.0;
            return true;
        }
        return false;
    }
}
