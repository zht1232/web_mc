# WebCraft 26.2 browser bridge

A Paper 26.2 plugin that hosts a loopback WebSocket endpoint. Browser clients join the real Paper
world through this sidecar instead of implementing the Java client protocol. The server remains
authoritative: block edits and avatar positions are validated and applied by the plugin using
Bukkit/Paper APIs, and Java players see each browser player as an armor-stand avatar.

This directory is intentionally self-contained. Nothing outside `bridge/` was modified.

## Status

- Plugin compiles against the exact Paper API bundled with the local Paper 26.2 build 129, and the
  jar packages successfully: `paper-plugin/build/dist/WebCraftBridge-0.1.0.jar`.
- The dependency-free WebSocket layer was tested outside Paper with Node 24: HTTP health, RFC 6455
  upgrade, masked text frames, a 120 KB server frame (64-bit length), echo and close.
- The plugin has **not** been loaded on Paper yet. The live server at
  `G:/Minecraftserver/DaemonData/Servers/1` was not installed into, started, stopped, reloaded or
  written to. World streaming, armor-stand visibility, block application and chat therefore remain
  to be validated on a server where a restart is allowed. See "Validation" below.

## Inspected facts (read-only)

- Live server process: `paper-26.2-129.jar`, port 25565, `online-mode=false`, whitelist off,
  `enforce-secure-profile=false`, management server disabled, RCON enabled.
- Paper `version.json`: Minecraft `26.2`, protocol `776`, Java `25`, world version `4903`.
- Bundled API: `io.papermc.paper:paper-api:26.2.build.129-stable` (exact artifact is published on
  Paper's Maven repository).
- Paper bundles Netty 4.2.15 under `libraries/`; Jetty is only a BOM, not a usable server. Plugin
  classloader access to server-internal libraries is not guaranteed, so this plugin uses **JDK-only
  sockets** and ships no shaded/copy dependencies. No third-party jars are downloaded.
- JDK 25 (Temurin 25.0.3) is at `G:/Minecraftserver/DaemonData/Tools/Java/25`; `javac` works.
- Gradle and Maven are not on PATH. A Gradle 9.1 distribution directory exists in the user profile,
  but the verified build path is `build-local.ps1` (javac + jar). `build.gradle.kts` is provided for a
  normal Gradle 9 / JDK 25 environment and is unverified here.

## Architecture

```
browser (Vite page, future)
   │  ws://127.0.0.1:8765/ws  (JSON, protocol v1)
   ▼
WebCraftBridge Paper plugin (this directory)
   │  hello / join / move / block intents / chat
   │  main-thread Bukkit calls
   ▼
Paper 26.2 world + Java players
   └─ armor-stand avatars visible to Java players (no NMS, no fake Player)
```

Why this and not the Java protocol: browsers cannot open raw TCP/Java sockets, and full login,
encryption and packet codecs would be a large, fragile reimplementation. A plugin already has
authoritative world access, block events, chat and entity APIs. A local WebSocket sidecar keeps the
browser integration to one clean JSON protocol. (If a future milestone needs Java players to see
browser players as real accounts, that is a separate vanilla-protocol proxy project.)

## Files

```
bridge/
  README.md
  PROTOCOL.md
  paper-plugin/
    plugin.yml                  legacy Bukkit descriptor (Paper still loads it; verified classes present)
    build.gradle.kts            alternative build, Gradle 9 + JDK 25 (not run here)
    settings.gradle.kts
    build-local.ps1             verified offline javac build using the local Paper API + libraries
    src/main/resources/config.yml
    src/main/java/io/webcraft/bridge/
      WebcraftBridgePlugin.java
      BridgeService.java        sessions, auth, join, movement, blocks, chat, snapshots
      BridgeSession.java
      BridgeConfig.java
      Avatar.java               invisible armor stand + equipment + name plate
      ChunkCodec.java           palette/RLE chunk sections
      Json.java                 dependency-free JSON
      RateLimiter.java
      ws/WsServer.java          raw ServerSocket + RFC 6455 handshake/framing
      ws/WsConnection.java
    src/test/java/.../WsSelfTest.java
  test-client/
    client.mjs                  dependency-free Node 22+ protocol client
    selftest.mjs                checks the WebSocket layer against WsSelfTest
```

## Build

Verified, offline, reads the local Paper jar read-only:

```powershell
powershell -ExecutionPolicy Bypass -File bridge/paper-plugin/build-local.ps1
```

Output: `bridge/paper-plugin/build/dist/WebCraftBridge-0.1.0.jar`.

The script extracts the bundled `paper-api` and `bungeecord-chat` jars from Paper into `%TEMP%` and
adds Paper's existing `libraries/` compile dependencies (Adventure, annotations, Guava). It never
writes to the server directory. If you move the Paper jar, pass `-PaperJar`, `-JdkHome` and
`-LibrariesDirectory`.

Alternative (not verified here): install Gradle 9.x and JDK 25, set `JAVA_HOME`, then
`cd bridge/paper-plugin && gradle build`. The dependency coordinate
`io.papermc.paper:paper-api:26.2.build.129-stable` was confirmed to exist. The toolchain may try to
download a JDK; configure `org.gradle.java.installations.paths` if needed.

## Install and run (only when you choose to restart)

The live server is untouched. When a restart is acceptable:

1. Copy `WebCraftBridge-0.1.0.jar` to the server's `plugins/` directory.
2. Start the server normally. Do not use `/reload` for a plugin that owns sockets.
3. The log prints `WebSocket bridge listening on ws://127.0.0.1:8765/ws`.
4. Client config lives in `plugins/WebCraftBridge/config.yml`. `token` is empty by default
   (loopback only); `allowed-origins` defaults to the local Vite ports 5173/5174.
5. `/wcbridge status` shows the port, connected/joined counts and whether a token is required.
   `/wcbridge token` prints the configured token to an operator/console.

The plugin binds to `127.0.0.1` by default. No Windows firewall rule is needed for loopback. If you
change `bind-address` to a LAN address, set a long random `token`, add the exact page origin (for
example `http://192.168.1.20:5174`) and create a firewall rule for TCP 8765. There is no TLS (`wss`)
yet; prefer a reverse proxy or tunnel for anything non-loopback.

## Try the protocol

```bash
# Node 22+; no npm install needed (global WebSocket/fetch)
node bridge/test-client/client.mjs --name Alice
node bridge/test-client/client.mjs --url ws://127.0.0.1:8765/ws --name Bob --token dev-token
```

Commands: `/move x y z [yaw] [pitch]`, `/look yaw pitch`, `/place x y z minecraft:stone`,
`/break x y z`, `/chunk cx cz`, `/chat text` (or plain text), `/ping`, `/inv`, `/held 0`, `/quit`.
The client prints `joined`, chunk summaries, `players`, `entities`, block/chat events and errors.

Health check: `http://127.0.0.1:8765/health` returns JSON.

WebSocket self-test (no Paper required):

```powershell
cd bridge/paper-plugin
# build first so build/classes exists
& "G:\Minecraftserver\DaemonData\Tools\Java\25\bin\javac.exe" -encoding UTF-8 --release 25 `
  -cp build/classes -d build/selftest-classes src/test/java/io/webcraft/bridge/ws/WsSelfTest.java
& "G:\Minecraftserver\DaemonData\Tools\Java\25\bin\java.exe" -cp "build/classes;build/selftest-classes" `
  io.webcraft.bridge.ws.WsSelfTest
# in another shell, from the repository root, use the printed SELFTEST_PORT:
node bridge/test-client/selftest.mjs <port>
```

## Online-mode / offline-mode and identity

- Browser clients are **not** Minecraft accounts. They never authenticate with Mojang/Microsoft and
  are not covered by `whitelist.json`, bans, `online-mode` or `enforce-secure-profile`.
- The bridge works with either `online-mode=true` or `false`. The current server is offline-mode.
- Each browser gets a generated bridge session UUID and a visible armor-stand NPC named after it.
  Chat from the browser reaches Java players as `[Web] Name: text`; Java chat is forwarded to browser
  clients when the legacy `AsyncPlayerChatEvent` fires.
- Protect the bridge independently: loopback bind, Origin allowlist, and a token before exposing it.
  The token is a shared secret, not an account system.

## Validation and limits

Verified here: compilation against the exact bundled Paper API, jar contents, `plugin.yml` parsing
with Paper's own `PluginDescriptionFile` (api-version 26.2), YAML parsing, WebSocket upgrade/framing
(including a 120 KB frame), health endpoint, close handshake, and Node client syntax. **Unverified:**
Paper plugin loading, chunk snapshot performance, armor-stand rendering and nameplate, reach/block
behavior, Java-block-event mirroring, legacy chat forwarding.

When a restart/test server is allowed, validate in this order:

1. Plugin enables without stack trace; log shows the bound port; `/wcbridge status` works.
2. `node client.mjs` receives `hello_ok`, `joined`, chunk sections, `stream_done`.
3. A Java player standing nearby sees the named armor stand; movement in the browser moves it.
4. Break/place a block from the client and from a Java player; both sides update.
5. Chat both directions; disconnect removes the armor stand.
6. Check `view-distance` cost on the main thread; lower it to 1 if needed.

Known limitations for this milestone: one configured world per session; no collision, gravity or
client physics (the server enforces a speed cap only); no inventory/crafting (empty virtual 41-slot handshake);
no skins or entity metadata; block physics/explosions are not streamed; chunk sections are JSON
(palette + RLE), not compressed binary; armor stands are not real players; no `wss`; no Java client
protocol and no Mineflayer.

Next for the browser agent: add a Vite WebSocket proxy (`/bridge` -> `ws://127.0.0.1:8765`, `ws: true`),
implement `hello`/`join`, render `section` palettes, apply `block` events, interpolate `player_move`
and `players`, and send rate-limited `move`/`look`/block intents. See `PROTOCOL.md`.

A minimal proxy entry (do not edit the game's `vite.config.ts` from this task) looks like:

```ts
server: {
  proxy: {
    "/bridge": {
      target: "ws://127.0.0.1:8765",
      ws: true,
      rewrite: (path) => path.replace(/^\/bridge/, "/ws"),
    },
  },
},
```

Then the page connects to `ws://<page-host>/bridge` (add `?token=...` if configured). The browser
Origin remains the page origin and must be listed in `config.yml`.
