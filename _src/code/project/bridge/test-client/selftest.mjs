// Dependency-free check for the plugin's WebSocket layer.
// Usage: node selftest.mjs <port>
// Start WsSelfTest first (see README), then run this. Requires Node 22+ (global WebSocket/fetch).
const port = process.argv[2];
if (!port) {
  console.error("usage: node selftest.mjs <port>");
  process.exit(2);
}

const health = await fetch(`http://127.0.0.1:${port}/health`);
console.log("health", health.status, await health.text());

const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
let welcome = false;
let echo = false;
let large = false;

const timeout = setTimeout(() => {
  console.error("FAIL: timeout");
  process.exit(1);
}, 5000);

ws.addEventListener("message", (event) => {
  if (event.data.includes('"welcome"')) {
    welcome = true;
    console.log("recv welcome");
  } else if (event.data.includes('"t":"large"')) {
    large = event.data.length > 100_000;
    console.log("recv large frame", event.data.length, "bytes");
  } else if (event.data.includes('"t":"selftest"')) {
    echo = true;
    console.log("recv echo");
  }
  if (welcome && echo && large) {
    clearTimeout(timeout);
    ws.close(1000, "selftest done");
    console.log("PASS websocket handshake, 64-bit text frame, echo, health endpoint");
    setTimeout(() => process.exit(0), 100);
  }
});

ws.addEventListener("open", () => {
  ws.send('{"t":"selftest","n":1}');
  ws.send('{"t":"large","n":2}');
});

ws.addEventListener("error", (event) => {
  console.error("FAIL: websocket error", event);
  process.exit(1);
});

ws.addEventListener("close", (event) => {
  if (!welcome || !echo || !large) {
    clearTimeout(timeout);
    console.error("FAIL: closed early", event.code, event.reason);
    process.exit(1);
  }
});
