package io.webcraft.bridge.ws;

import java.net.InetAddress;
import java.util.List;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Development-only harness: starts the dependency-free WebSocket server without Paper and echoes
 * every text message. Run it from the build output, connect with bridge/test-client/selftest.mjs,
 * then stop it. Not packaged into the plugin jar.
 */
public final class WsSelfTest {

    public static void main(String[] args) throws Exception {
        Logger logger = Logger.getLogger("WebCraftBridgeSelfTest");
        logger.setLevel(Level.ALL);
        WsServer server = new WsServer(
                new WsServer.Options(
                        InetAddress.getLoopbackAddress(),
                        0,
                        "/ws",
                        List.of("http://localhost:5174"),
                        true,
                        4
                ),
                new WsServer.Handler() {
                    @Override
                    public void onOpen(WsConnection connection) {
                        connection.sendText("{\"t\":\"welcome\"}");
                    }

                    @Override
                    public void onText(WsConnection connection, String message) {
                        if (message.contains("large")) {
                            String payload = "x".repeat(120_000);
                            connection.sendText("{\"t\":\"large\",\"data\":\"" + payload + "\"}");
                            return;
                        }
                        connection.sendText(message);
                    }

                    @Override
                    public void onClose(WsConnection connection, int code, String reason) {
                        System.out.println("SELFTEST_CLOSE code=" + code + " reason=" + reason);
                    }
                },
                logger,
                () -> "{\"ok\":true,\"selftest\":true}"
        );
        int port = server.start();
        System.out.println("SELFTEST_PORT=" + port);
        System.out.flush();
        Thread.sleep(30_000L);
        server.stop();
    }
}
