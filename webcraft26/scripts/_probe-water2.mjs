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
const setup = await p.evaluate(async () => {
  const g = window.__mc;
  const { Vec3 } = await import("/src/vanilla/core/Geometry.ts");
  g.level.time = 6000;
  const px = Math.floor(g.player.pos.x), pz = Math.floor(g.player.pos.z);
  const gy = g.level.getHeight(px, pz);
  const water = g.mc.stateOf("water");
  const stone = g.mc.stateOf("stone");
  for (let dx = -6; dx <= 6; dx++) for (let dz = 0; dz <= 14; dz++) {
    g.level.setBlockState(px + dx, gy, pz + dz, water);
    for (let dy = 1; dy <= 2; dy++) g.level.setBlockState(px + dx, gy + dy, pz + dz, 0);
  }
  for (let dx = -6; dx <= 6; dx++) for (let dy = 1; dy <= 6; dy++) g.level.setBlockState(px + dx, gy + dy, pz + 15, stone);
  for (let dx = -6; dx <= 6; dx++) g.level.setBlockState(px + dx, gy, pz - 2, stone);
  g.player.pos = new Vec3(px + 0.5, gy + 1.7, pz - 1.2);
  g.player.vel = new Vec3(0, 0, 0);
  g.player.yaw = 0; g.player.pitch = 4;
  return { px, pz, gy };
});
await p.waitForTimeout(2500);
await p.screenshot({ path: "shots/_water-grazing-on.png" });
await p.evaluate(() => window.__mc.setShaderQuality("low"));
await p.waitForTimeout(1400);
await p.screenshot({ path: "shots/_water-grazing-off.png" });
console.log(JSON.stringify({ setup, errors: errors.slice(0, 5) }));
await b.close();
