package io.webcraft.bridge.ws;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;
import java.util.logging.Level;
import java.util.logging.Logger;

/** One accepted TCP connection. Performs the HTTP upgrade, then RFC 6455 framing. */
public final class WsConnection {

    private static final int MAX_HEADER_BYTES = 16 * 1024;
    private static final int MAX_INCOMING_BYTES = 64 * 1024;
    private static final int MAX_OUTGOING_BYTES = 16 * 1024 * 1024;
    private static final long MAX_QUEUED_BYTES = 8L * 1024 * 1024;

    private final WsServer server;
    private final Socket socket;
    private final WsServer.Options options;
    private final WsServer.Handler handler;
    private final Logger logger;
    private final Consumer<WsConnection> onClosed;
    private final BufferedInputStream input;
    private final BufferedOutputStream output;
    private final Object writeLock = new Object();
    private final LinkedBlockingQueue<byte[]> outbox = new LinkedBlockingQueue<>();
    private final AtomicLong queuedBytes = new AtomicLong();
    private final AtomicBoolean terminated = new AtomicBoolean();
    private final AtomicBoolean closeSent = new AtomicBoolean();
    private final String remote;

    private volatile boolean open;
    private volatile boolean handlerOpened;
    private volatile Map<String, String> query = Map.of();
    private volatile String origin;
    private volatile long lastActivityNanos = System.nanoTime();

    WsConnection(
            WsServer server,
            Socket socket,
            WsServer.Options options,
            WsServer.Handler handler,
            Logger logger,
            Consumer<WsConnection> onClosed
    ) {
        this.server = server;
        this.socket = socket;
        this.options = options;
        this.handler = handler;
        this.logger = logger;
        this.onClosed = onClosed;
        this.remote = String.valueOf(socket.getRemoteSocketAddress());
        try {
            InputStream rawInput = socket.getInputStream();
            OutputStream rawOutput = socket.getOutputStream();
            this.input = new BufferedInputStream(rawInput, 16 * 1024);
            this.output = new BufferedOutputStream(rawOutput, 32 * 1024);
        } catch (IOException exception) {
            throw new IllegalStateException("cannot open socket streams", exception);
        }
    }

    public String remote() {
        return remote;
    }

    public String queryParam(String name) {
        return query.get(name);
    }

    public String origin() {
        return origin;
    }

    public boolean isOpen() {
        return open && !terminated.get();
    }

    long lastActivityNanos() {
        return lastActivityNanos;
    }

    void run() {
        try {
            socket.setSoTimeout(15_000);
            String header = readHttpHeader();
            if (header == null) {
                return;
            }

            Request request = Request.parse(header);
            if (request == null) {
                writeHttp(400, "Bad Request", "{\"error\":\"bad_request\"}", null);
                return;
            }
            query = request.query();
            origin = request.headers().get("origin");

            if ("/health".equals(request.path())) {
                writeHttp(200, "OK", server.healthJson(), null);
                return;
            }
            if (!options.path().equals(request.path())) {
                writeHttp(404, "Not Found", "{\"error\":\"not_found\"}", null);
                return;
            }
            if (!"GET".equals(request.method())) {
                writeHttp(405, "Method Not Allowed", "{\"error\":\"method_not_allowed\"}", "Allow: GET\r\n");
                return;
            }
            if (!server.isOriginAllowed(origin)) {
                writeHttp(403, "Forbidden", "{\"error\":\"origin_not_allowed\"}", null);
                return;
            }

            String upgrade = request.headers().getOrDefault("upgrade", "");
            String connection = request.headers().getOrDefault("connection", "");
            String version = request.headers().getOrDefault("sec-websocket-version", "");
            String key = request.headers().get("sec-websocket-key");
            if (!"websocket".equalsIgnoreCase(upgrade)
                    || !connection.toLowerCase(Locale.ROOT).contains("upgrade")
                    || key == null) {
                writeHttp(426, "Upgrade Required",
                        "{\"error\":\"websocket_upgrade_required\"}",
                        "Sec-WebSocket-Version: 13\r\n");
                return;
            }
            if (!"13".equals(version)) {
                writeHttp(426, "Upgrade Required",
                        "{\"error\":\"unsupported_websocket_version\"}",
                        "Sec-WebSocket-Version: 13\r\n");
                return;
            }
            if (!validWebSocketKey(key)) {
                writeHttp(400, "Bad Request", "{\"error\":\"bad_websocket_key\"}", null);
                return;
            }

            String accept;
            try {
                accept = webSocketAccept(key);
            } catch (NoSuchAlgorithmException exception) {
                writeHttp(500, "Internal Server Error", "{\"error\":\"sha1_unavailable\"}", null);
                return;
            }

            String response = "HTTP/1.1 101 Switching Protocols\r\n"
                    + "Upgrade: websocket\r\n"
                    + "Connection: Upgrade\r\n"
                    + "Sec-WebSocket-Accept: " + accept + "\r\n"
                    + "\r\n";
            synchronized (writeLock) {
                output.write(response.getBytes(StandardCharsets.US_ASCII));
                output.flush();
            }

            socket.setSoTimeout(0);
            open = true;
            handlerOpened = true;
            server.register(this);
            Thread.ofVirtual()
                    .name("WebCraftBridge-WsWriter-" + Integer.toHexString(System.identityHashCode(this)))
                    .start(this::writeLoop);

            handler.onOpen(this);
            readLoop();
        } catch (SocketTimeoutException exception) {
            terminate(1008, "handshake timeout");
        } catch (IOException exception) {
            terminate(1006, "connection closed");
        } catch (RuntimeException exception) {
            logger.log(Level.WARNING, "WebSocket connection failed: " + remote, exception);
            terminate(1011, "internal error");
        } finally {
            terminate(1000, "closed");
        }
    }

    public boolean sendText(String text) {
        if (!isOpen() || text == null) {
            return false;
        }
        byte[] payload = text.getBytes(StandardCharsets.UTF_8);
        if (payload.length > MAX_OUTGOING_BYTES) {
            close(1009, "outgoing message too large");
            return false;
        }
        return enqueue(encodeFrame(0x1, payload));
    }

    void sendPing() {
        if (!isOpen()) {
            return;
        }
        long now = System.nanoTime();
        byte[] payload = new byte[8];
        for (int index = 0; index < 8; index++) {
            payload[index] = (byte) (now >>> (56 - index * 8));
        }
        enqueue(encodeFrame(0x9, payload));
    }

    private void sendPong(byte[] payload) {
        if (!isOpen()) {
            return;
        }
        enqueue(encodeFrame(0xA, payload));
    }

    private boolean enqueue(byte[] frame) {
        long queued = queuedBytes.addAndGet(frame.length);
        if (queued > MAX_QUEUED_BYTES) {
            queuedBytes.addAndGet(-frame.length);
            close(1013, "client too slow");
            return false;
        }
        if (!outbox.offer(frame)) {
            queuedBytes.addAndGet(-frame.length);
            return false;
        }
        return true;
    }

    /** Sends a close frame (when possible) and releases the socket. Safe to call many times. */
    public void close(int code, String reason) {
        if (terminated.get()) {
            return;
        }
        if (closeSent.compareAndSet(false, true)) {
            byte[] payload = closePayload(code, reason);
            synchronized (writeLock) {
                try {
                    output.write(encodeFrame(0x8, payload));
                    output.flush();
                } catch (IOException ignored) {
                    // the peer is already gone
                }
            }
        }
        terminate(code, reason);
    }

    private void terminate(int code, String reason) {
        if (!terminated.compareAndSet(false, true)) {
            return;
        }
        open = false;
        try {
            socket.close();
        } catch (IOException ignored) {
            // closing
        }
        outbox.clear();
        queuedBytes.set(0);
        onClosed.accept(this);
        if (handlerOpened) {
            try {
                handler.onClose(this, code, reason);
            } catch (RuntimeException exception) {
                logger.log(Level.WARNING, "WebSocket close handler failed", exception);
            }
        }
    }

    private void writeLoop() {
        try {
            while (!terminated.get()) {
                byte[] frame = outbox.poll(1L, TimeUnit.SECONDS);
                if (frame == null) {
                    continue;
                }
                queuedBytes.updateAndGet(current -> Math.max(0L, current - frame.length));
                synchronized (writeLock) {
                    output.write(frame);
                    output.flush();
                }
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            terminate(1006, "writer interrupted");
        } catch (IOException exception) {
            terminate(1006, "write failed");
        }
    }

    private void readLoop() throws IOException {
        ByteArrayOutputStream fragments = null;
        int fragmentOpcode = -1;

        while (isOpen()) {
            Frame frame = readFrame();
            if (frame == null) {
                return;
            }
            lastActivityNanos = System.nanoTime();

            int opcode = frame.opcode();
            if (opcode >= 0x8) {
                handleControl(frame);
                if (opcode == 0x8) {
                    return;
                }
                continue;
            }

            if (opcode == 0x2) {
                close(1003, "binary frames are not supported");
                return;
            }

            if (opcode == 0x1) {
                if (fragmentOpcode != -1) {
                    close(1002, "new data frame inside fragmented message");
                    return;
                }
                if (frame.fin()) {
                    dispatchText(frame.payload());
                } else {
                    fragmentOpcode = opcode;
                    fragments = new ByteArrayOutputStream(Math.max(64, frame.payload().length));
                    fragments.write(frame.payload());
                    if (fragments.size() > MAX_INCOMING_BYTES) {
                        close(1009, "message too large");
                        return;
                    }
                }
                continue;
            }

            if (opcode == 0x0) {
                if (fragmentOpcode == -1 || fragments == null) {
                    close(1002, "unexpected continuation frame");
                    return;
                }
                fragments.write(frame.payload());
                if (fragments.size() > MAX_INCOMING_BYTES) {
                    close(1009, "message too large");
                    return;
                }
                if (frame.fin()) {
                    byte[] payload = fragments.toByteArray();
                    fragments = null;
                    fragmentOpcode = -1;
                    dispatchText(payload);
                }
                continue;
            }

            close(1002, "unknown opcode");
            return;
        }
    }

    private void dispatchText(byte[] payload) {
        try {
            handler.onText(this, new String(payload, StandardCharsets.UTF_8));
        } catch (RuntimeException exception) {
            logger.log(Level.WARNING, "WebSocket message handler failed", exception);
            close(1011, "handler error");
        }
    }

    private void handleControl(Frame frame) {
        if (!frame.fin() || frame.payload().length > 125) {
            close(1002, "invalid control frame");
            return;
        }
        switch (frame.opcode()) {
            case 0x8 -> {
                int code = 1000;
                String reason = "";
                if (frame.payload().length >= 2) {
                    code = ((frame.payload()[0] & 0xFF) << 8) | (frame.payload()[1] & 0xFF);
                    if (frame.payload().length > 2) {
                        reason = new String(frame.payload(), 2, frame.payload().length - 2, StandardCharsets.UTF_8);
                    }
                }
                close(code, reason);
            }
            case 0x9 -> sendPong(frame.payload());
            case 0xA -> {
                // Any frame counts as activity; pong payload is not used.
            }
            default -> close(1002, "unknown control opcode");
        }
    }

    private Frame readFrame() throws IOException {
        int first = input.read();
        if (first < 0) {
            return null;
        }
        int second = readByte();
        boolean fin = (first & 0x80) != 0;
        if ((first & 0x70) != 0) {
            close(1002, "reserved bits set");
            return null;
        }
        int opcode = first & 0x0F;
        boolean masked = (second & 0x80) != 0;
        long length = second & 0x7F;

        if (length == 126) {
            length = ((long) readByte() << 8) | readByte();
        } else if (length == 127) {
            length = 0;
            for (int index = 0; index < 8; index++) {
                length = (length << 8) | readByte();
            }
            if (length < 0) {
                close(1002, "invalid frame length");
                return null;
            }
        }

        boolean control = opcode >= 0x8;
        if (control && (!fin || length > 125)) {
            close(1002, "invalid control frame");
            return null;
        }
        if (length > MAX_INCOMING_BYTES) {
            close(1009, "frame too large");
            return null;
        }
        if (!masked) {
            close(1002, "client frames must be masked");
            return null;
        }

        byte[] mask = new byte[4];
        readFully(mask, 0, 4);
        byte[] payload = new byte[(int) length];
        readFully(payload, 0, payload.length);
        for (int index = 0; index < payload.length; index++) {
            payload[index] ^= mask[index & 3];
        }
        return new Frame(fin, opcode, payload);
    }

    private int readByte() throws IOException {
        int value = input.read();
        if (value < 0) {
            throw new EOFException("unexpected end of stream");
        }
        return value;
    }

    private void readFully(byte[] target, int offset, int length) throws IOException {
        int read = 0;
        while (read < length) {
            int count = input.read(target, offset + read, length - read);
            if (count < 0) {
                throw new EOFException("unexpected end of stream");
            }
            read += count;
        }
    }

    private String readHttpHeader() throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream(1024);
        int state = 0;
        while (buffer.size() < MAX_HEADER_BYTES) {
            int value = input.read();
            if (value < 0) {
                return null;
            }
            buffer.write(value);
            if (state == 0 && value == '\r') {
                state = 1;
            } else if (state == 1 && value == '\n') {
                state = 2;
            } else if (state == 2 && value == '\r') {
                state = 3;
            } else if (state == 3 && value == '\n') {
                return buffer.toString(StandardCharsets.US_ASCII);
            } else {
                state = value == '\r' ? 1 : 0;
            }
        }
        writeHttp(431, "Request Header Fields Too Large", "{\"error\":\"headers_too_large\"}", null);
        return null;
    }

    private void writeHttp(int status, String reason, String body, String extraHeaders) {
        byte[] payload = body.getBytes(StandardCharsets.UTF_8);
        String headers = "HTTP/1.1 " + status + " " + reason + "\r\n"
                + "Content-Type: application/json; charset=utf-8\r\n"
                + "Content-Length: " + payload.length + "\r\n"
                + "Connection: close\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + (extraHeaders == null ? "" : extraHeaders)
                + "\r\n";
        synchronized (writeLock) {
            try {
                output.write(headers.getBytes(StandardCharsets.US_ASCII));
                output.write(payload);
                output.flush();
            } catch (IOException ignored) {
                // client went away
            }
        }
    }

    private static boolean validWebSocketKey(String key) {
        try {
            return Base64.getDecoder().decode(key.trim()).length == 16;
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private static String webSocketAccept(String key) throws NoSuchAlgorithmException {
        MessageDigest digest = MessageDigest.getInstance("SHA-1");
        byte[] hash = digest.digest((key.trim() + WsServer.WS_GUID).getBytes(StandardCharsets.US_ASCII));
        return Base64.getEncoder().encodeToString(hash);
    }

    private static byte[] closePayload(int code, String reason) {
        byte[] text = reason == null ? new byte[0] : reason.getBytes(StandardCharsets.UTF_8);
        if (text.length > 123) {
            byte[] shortened = new byte[123];
            System.arraycopy(text, 0, shortened, 0, shortened.length);
            text = shortened;
        }
        byte[] payload = new byte[2 + text.length];
        payload[0] = (byte) ((code >>> 8) & 0xFF);
        payload[1] = (byte) (code & 0xFF);
        System.arraycopy(text, 0, payload, 2, text.length);
        return payload;
    }

    private static byte[] encodeFrame(int opcode, byte[] payload) {
        int length = payload.length;
        int headerLength = length < 126 ? 2 : (length <= 0xFFFF ? 4 : 10);
        byte[] frame = new byte[headerLength + length];
        frame[0] = (byte) (0x80 | opcode);
        if (length < 126) {
            frame[1] = (byte) length;
        } else if (length <= 0xFFFF) {
            frame[1] = 126;
            frame[2] = (byte) ((length >>> 8) & 0xFF);
            frame[3] = (byte) (length & 0xFF);
        } else {
            frame[1] = 127;
            long value = length;
            for (int index = 0; index < 8; index++) {
                frame[2 + index] = (byte) ((value >>> (56 - index * 8)) & 0xFF);
            }
        }
        System.arraycopy(payload, 0, frame, headerLength, length);
        return frame;
    }

    private record Frame(boolean fin, int opcode, byte[] payload) {
    }

    private record Request(String method, String path, Map<String, String> headers, Map<String, String> query) {

        static Request parse(String header) {
            if (header == null || header.isEmpty()) {
                return null;
            }
            String[] lines = header.split("\r\n");
            if (lines.length == 0) {
                return null;
            }
            String[] requestLine = lines[0].split(" ");
            if (requestLine.length < 3) {
                return null;
            }
            String method = requestLine[0].toUpperCase(Locale.ROOT);
            String target = requestLine[1];
            int marker = target.indexOf('?');
            String path = marker < 0 ? target : target.substring(0, marker);
            Map<String, String> query = new LinkedHashMap<>();
            if (marker >= 0 && marker + 1 < target.length()) {
                for (String pair : target.substring(marker + 1).split("&")) {
                    if (pair.isEmpty()) {
                        continue;
                    }
                    int equals = pair.indexOf('=');
                    String name = equals < 0 ? pair : pair.substring(0, equals);
                    String value = equals < 0 ? "" : pair.substring(equals + 1);
                    try {
                        query.putIfAbsent(
                                URLDecoder.decode(name, StandardCharsets.UTF_8),
                                URLDecoder.decode(value, StandardCharsets.UTF_8));
                    } catch (IllegalArgumentException ignored) {
                        // keep the raw pair out of the map
                    }
                }
            }
            Map<String, String> headers = new HashMap<>();
            for (int index = 1; index < lines.length; index++) {
                String line = lines[index];
                if (line.isEmpty()) {
                    continue;
                }
                int colon = line.indexOf(':');
                if (colon <= 0) {
                    continue;
                }
                headers.put(line.substring(0, colon).trim().toLowerCase(Locale.ROOT),
                        line.substring(colon + 1).trim());
            }
            return new Request(method, path, headers, query);
        }
    }
}
