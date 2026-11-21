import { chromium } from "playwright";
import { launchOptions } from "./lib/browser.mjs";
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1699, height: 901 }, deviceScaleFactor: 1.5 })).newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto("http://127.0.0.1:5174/?play&perf=0", { waitUntil: "load" });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(7000);
await p.evaluate(() => { window.__mc.setShaders(true); window.__mc.setShaderQuality("high"); });
await p.waitForTimeout(1500);
await p.evaluate(async () => {
  const g = window.__mc;
  const { Vec3 } = await import("/src/vanilla/core/Geometry.ts");
  g.level.time = 6000;
  const px = Math.floor(g.player.pos.x), pz = Math.floor(g.player.pos.z);
  const gy = g.level.getHeight(px, pz);
  const water = g.mc.stateOf("water");
  for (let dx = -8; dx <= 8; dx++) for (let dz = 0; dz <= 18; dz++) {
    g.level.setBlockState(px + dx, gy, pz + dz, water);
    for (let dy = 1; dy <= 2; dy++) g.level.setBlockState(px + dx, gy + dy, pz + dz, 0);
  }
  for (let dx = -8; dx <= 8; dx++) g.level.setBlockState(px + dx, gy, pz - 2, g.mc.stateOf("stone"));
  g.player.pos = new Vec3(px + 0.5, gy + 1.7, pz - 1.2);
  g.player.vel = new Vec3(0, 0, 0);
  g.player.yaw = 0; g.player.pitch = 8;
});
await p.waitForTimeout(2500);
const r = await p.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const loop = () => { if (++n < 180) requestAnimationFrame(loop); else res({ fps: +(n * 1000 / (performance.now() - t0)).toFixed(1), diag: window.__mc.perfDiagnostics() }); };
  requestAnimationFrame(loop);
}));
console.log(JSON.stringify({ r, glError: await p.evaluate(() => window.__mc.gl.getError()), errors: errors.slice(0, 4) }, null, 2));
await b.close();
