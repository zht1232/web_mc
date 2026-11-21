import { chromium } from "playwright";
import { launchOptions } from "./lib/browser.mjs";
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1000, height: 640 } })).newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto("http://127.0.0.1:5174/?play&perf=0", { waitUntil: "load" });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(7000);
await p.evaluate(() => { window.__mc.setShaders(true); window.__mc.setShaderQuality("high"); window.__mc.player.pitch = 8; window.__mc.player.yaw = 28.6; });
await p.waitForTimeout(1500);
const res = await p.evaluate(() => new Promise((resolve) => {
  const g = window.__mc;
  const gl = g.gl;
  const W = 400, H = 220;
  const x = Math.floor(gl.drawingBufferWidth / 2 - W / 2);
  const y = Math.floor(gl.drawingBufferHeight * 0.35);
  const a = new Uint8Array(W * H * 4);
  const b2 = new Uint8Array(W * H * 4);
  requestAnimationFrame(() => {
    gl.readPixels(x, y, W, H, gl.RGBA, gl.UNSIGNED_BYTE, a);
    setTimeout(() => requestAnimationFrame(() => {
      gl.readPixels(x, y, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b2);
      let changed = 0; let maxDelta = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.abs(a[i] - b2[i]) + Math.abs(a[i + 1] - b2[i + 1]) + Math.abs(a[i + 2] - b2[i + 2]);
        if (d > 12) changed++;
        if (d > maxDelta) maxDelta = d;
      }
      resolve({ changed, total: W * H, maxDelta, sway: window.__mc.player ? true : false });
    }), 900);
  });
}));
// control: turn the wind off at runtime by zeroing the uniform through a re-set is not exposed; instead
// compare against a second pair with the player's view unchanged (same test, larger wait)
console.log(JSON.stringify({ res, errors: errors.slice(0, 5) }));
await b.close();
