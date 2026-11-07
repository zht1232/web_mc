#!/usr/bin/env node
// Tiny protocol test client for the WebCraftBridge Paper plugin.
// Requires Node 22+ (global WebSocket/fetch); no npm dependencies.
//
//   node client.mjs
//   node client.mjs --url ws://127.0.0.1:8765/ws --name Alice --token dev-token
//   node client.mjs --x 100 --y 70 --z 200
//
// Commands (stdin):
//   /help | /ping | /inv | /chunk cx cz | /held 0-8
//   /move x y z [yaw] [pitch] | /look yaw pitch
//   /place x y z minecraft:stone | /break x y z
//   /chat text  (or type plain text)
//   /quit

import readline from "node:readline";

const argv = process.argv.slice(2);
function option(name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
}
const wsUrl = option("url", process.env.WEBCRAFT_WS || "ws://127.0.0.1:8765/ws");
const name = option("name", "NodeTester");
const token = option("token", process.env.WEBCRAFT_TOKEN || "");
const autoJoin = !argv.includes("--no-join");

const target = new URL(wsUrl);
if (token) {
  target.searchParams.set("token", token);
}
const displayTarget = `${target.protocol}//${target.host}${target.pathname}`;

let myId = null;
let joined = false;
let pingSequence = 0;
const pings = new Map();
let lastPlayerSignature = "";
let lastEntityCount = -1;

const socket = new WebSocket(target);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "wcb> " });

function send(message) {
  if (socket.readyState !== WebSocket.OPEN) {
    console.log("[client] socket is not open");
    return false;
  }
  socket.send(JSON.stringify(message));
  return true;
}

function log(...parts) {
  console.log(...parts);
}

socket.addEventListener("open", () => {
  log(`[client] connected to ${displayTarget}`);
  send({ t: "hello", protocol: 1, name, ...(token ? { token } : {}) });
});

socket.addEventListener("message", (event) => {
  let message;
  try {
    message = JSON.parse(event.data);
  } catch {
    log("[client] non-JSON message", String(event.data).slice(0, 120));
    return;
  }

  switch (message.t) {
    case "hello_ok":
      myId = message.id;
      log(`[client] hello_ok id=${myId} server=${message.server?.name} tokenRequired=${message.tokenRequired}`);
      if (autoJoin) {
        const position = {};
        for (const key of ["x", "y", "z"]) {
          if (argv.includes(`--${key}`)) {
            position[key] = Number(option(key, "0"));
          }
        }
        send({ t: "join", ...position });
      }
      break;
    case "joined":
      joined = true;
      log(`[client] joined world=${message.world} dimension=${message.dimension} `
        + `y=${message.minY}..${message.maxY} spawn=${JSON.stringify(message.spawn)} view=${message.viewDistance}`);
      break;
    case "chunk_begin":
      // Keep the log readable: summarize at chunk_end.
      break;
    case "section":
      break;
    case "chunk_end":
      log(`[chunk] ${message.cx},${message.cz} sections=${message.sections}`);
      break;
    case "stream_done":
      log("[client] initial stream done");
      break;
    case "players": {
      const signature = message.players.map((player) => `${player.id}:${player.kind}`).sort().join("|");
      if (signature !== lastPlayerSignature) {
        lastPlayerSignature = signature;
        log(`[players] ${message.players.length}`
          + message.players.map((player) => ` ${player.name}(${player.kind})`).join(""));
      }
      break;
    }
    case "entities":
      if (message.entities.length !== lastEntityCount) {
        lastEntityCount = message.entities.length;
        log(`[entities] ${message.entities.length}`);
      }
      break;
    case "block":
      log(`[block] ${message.x},${message.y},${message.z} -> ${message.state} (${message.source}:${message.by})`);
      break;
    case "chat":
      log(`[chat:${message.source}] ${message.from.name}: ${message.text}`);
      break;
    case "player_join":
      log(`[player_join] ${message.player.name} (${message.player.kind})`);
      break;
    case "player_leave":
      log(`[player_leave] ${message.id}`);
      break;
    case "player_move":
      break;
    case "self":
      log(`[self] corrected to ${message.x},${message.y},${message.z} yaw=${message.yaw} pitch=${message.pitch}`);
      break;
    case "inv":
      log(`[inv] size=${message.size} held=${message.held} virtual=${message.virtual} items=${message.items.length}`);
      break;
    case "pong": {
      const sentAt = pings.get(message.id);
      if (sentAt) {
        pings.delete(message.id);
        log(`[ping] id=${message.id} rtt=${Date.now() - sentAt}ms`);
      }
      break;
    }
    case "error":
      log(`[error] ${message.code}: ${message.message}`);
      break;
    default:
      log("[server]", JSON.stringify(message).slice(0, 300));
  }
});

socket.addEventListener("close", (event) => {
  log(`[client] closed code=${event.code} reason=${event.reason || "(none)"}`);
  rl.close();
  process.exit(0);
});

socket.addEventListener("error", () => {
  log("[client] WebSocket error (is the plugin running on the configured port?)");
});

const pingTimer = setInterval(() => {
  if (!joined) {
    return;
  }
  const id = ++pingSequence;
  pings.set(id, Date.now());
  send({ t: "ping", id });
}, 10_000);
pingTimer.unref?.();

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    rl.prompt();
    return;
  }
  if (!trimmed.startsWith("/")) {
    send({ t: "chat", text: trimmed });
    return;
  }

  const parts = trimmed.slice(1).split(/\s+/);
  const command = parts.shift().toLowerCase();
  const number = (value) => Number(value);
  switch (command) {
    case "help":
      log("/ping /inv /chunk cx cz /held slot /move x y z [yaw] [pitch] /look yaw pitch "
        + "/place x y z state /break x y z /chat text /quit");
      break;
    case "ping":
      send({ t: "ping", id: `manual-${++pingSequence}` });
      break;
    case "inv":
      send({ t: "inv_req" });
      break;
    case "held":
      send({ t: "held", slot: number(parts[0]) });
      break;
    case "chunk":
      send({ t: "chunk_req", cx: number(parts[0]), cz: number(parts[1]) });
      break;
    case "move":
      send({
        t: "move",
        x: number(parts[0]),
        y: number(parts[1]),
        z: number(parts[2]),
        yaw: parts[3] === undefined ? undefined : number(parts[3]),
        pitch: parts[4] === undefined ? undefined : number(parts[4]),
      });
      break;
    case "look":
      send({ t: "look", yaw: number(parts[0]), pitch: number(parts[1]) });
      break;
    case "place":
      send({
        t: "block_set",
        x: number(parts[0]),
        y: number(parts[1]),
        z: number(parts[2]),
        state: parts.slice(3).join(" "),
      });
      break;
    case "break":
      send({ t: "block_break", x: number(parts[0]), y: number(parts[1]), z: number(parts[2]) });
      break;
    case "chat":
      send({ t: "chat", text: parts.join(" ") });
      break;
    case "quit":
      socket.close(1000, "test client quit");
      break;
    default:
      log(`unknown command: /${command} (try /help)`);
  }
  rl.prompt();
});

rl.on("close", () => {
  // Keep the connection open for piped/non-interactive runs; a terminal closing stdin means quit.
  if (process.stdin.isTTY && socket.readyState === WebSocket.OPEN) {
    socket.close(1000, "stdin closed");
  }
});

process.on("SIGINT", () => {
  socket.close(1000, "SIGINT");
});

log(`[client] target=${displayTarget} name=${name}`);
rl.prompt();
