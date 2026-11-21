import { chromium } from "playwright";
import { launchOptions } from "./lib/browser.mjs";
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto("http://127.0.0.1:5174/?play&perf=0", { waitUntil: "load" });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(7000);
await p.evaluate(() => { window.__mc.setShaders(true); window.__mc.setShaderQuality("high"); });
await p.waitForTimeout(1200);
await p.evaluate(async () => {
  const g = window.__mc;
  const { Vec3 } = await import("/src/vanilla/core/Geometry.ts");
  g.level.time = 6000;
  const px = Math.floor(g.player.pos.x), pz = Math.floor(g.player.pos.z);
  const gy = g.level.getHeight(px, pz);
  const water = g.mc.stateOf("water");
  for (let dx = -6; dx <= 6; dx++) for (let dz = 0; dz <= 14; dz++) {
    g.level.setBlockState(px + dx, gy, pz + dz, water);
    for (let dy = 1; dy <= 2; dy++) g.level.setBlockState(px + dx, gy + dy, pz + dz, 0);
  }
  const stone = g.mc.stateOf("stone"); for (let dx = -6; dx <= 6; dx++) for (let dy = 1; dy <= 6; dy++) g.level.setBlockState(px + dx, gy + dy, pz + 15, stone);
  for (let dx = -6; dx <= 6; dx++) g.level.setBlockState(px + dx, gy, pz - 2, g.mc.stateOf("stone"));
  g.player.pos = new Vec3(px + 0.5, gy + 1.7, pz - 1.2);
  g.player.vel = new Vec3(0, 0, 0);
  g.player.yaw = 0; g.player.pitch = 8;
});
await p.waitForTimeout(2200);
await p.evaluate(() => { window.__mc.renderer.debugMode = 16; });
await p.waitForTimeout(1200);
await p.screenshot({ path: "shots/_water-dbg16.png" });
const s = await p.evaluate(() => new Promise((res) => {
  const gl = window.__mc.gl;
  requestAnimationFrame(() => {
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const out = [];
    for (const [fx, fy] of [[0.5, 0.4], [0.35, 0.36], [0.65, 0.42], [0.5, 0.3]]) {
      const b2 = new Uint8Array(4);
      gl.readPixels(Math.floor(w * fx), Math.floor(h * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b2);
      out.push([fx, fy, [...b2]]);
    }
    res(out);
  });
}));
console.log(JSON.stringify({ s, errors: errors.slice(0, 5) }));
await b.close();

