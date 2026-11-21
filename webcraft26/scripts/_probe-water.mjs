import { chromium } from "playwright";
import { launchOptions } from "./lib/browser.mjs";
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await p.goto("http://127.0.0.1:5174/?play&perf=0", { waitUntil: "load" });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(7000);
await p.evaluate(() => { window.__mc.setShaders(true); window.__mc.setShaderQuality("high"); });
await p.waitForTimeout(1200);
const setup = await p.evaluate(async () => {
  const g = window.__mc;
  const { Vec3 } = await import("/src/vanilla/core/Geometry.ts");
  g.level.time = 6000;
  const px = Math.floor(g.player.pos.x), pz = Math.floor(g.player.pos.z);
  const gy = g.level.getHeight(px, pz);
  const water = g.mc.stateOf("water");
  const stone = g.mc.stateOf("stone");
  for (let dx = -3; dx <= 3; dx++) for (let dz = 0; dz <= 6; dz++) {
    g.level.setBlockState(px + dx, gy, pz + dz, water);
    for (let dy = 1; dy <= 3; dy++) g.level.setBlockState(px + dx, gy + dy, pz + dz, 0);
  }
  // wall across the far side of the pool
  for (let dx = -3; dx <= 3; dx++) for (let dy = 1; dy <= 4; dy++) g.level.setBlockState(px + dx, gy + dy, pz + 7, stone);
  // stand on the near edge
  for (let dx = -3; dx <= 3; dx++) g.level.setBlockState(px + dx, gy, pz - 2, stone);
  g.player.pos = new Vec3(px + 0.5, gy + 1.2, pz - 1.4);
  g.player.vel = new Vec3(0, 0, 0);
  g.player.yaw = 0; g.player.pitch = 18;
  return { px, pz, gy };
});
await p.waitForTimeout(2500);
const st = await p.evaluate(() => ({ glError: window.__mc.gl.getError(), diag: window.__mc.perfDiagnostics() }));
await p.screenshot({ path: "shots/_water-ssr.png" });
await p.evaluate(() => { window.__mc.renderer.post.wwater = 0; window.__mc.setShaderQuality("low"); });
await p.waitForTimeout(1200);
await p.screenshot({ path: "shots/_water-noreflect.png" });
console.log(JSON.stringify({ setup, st, errors: errors.slice(0, 6) }, null, 2));
await b.close();
