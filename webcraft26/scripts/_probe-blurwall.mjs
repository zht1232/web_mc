import { chromium } from "playwright";
import { launchOptions } from "./lib/browser.mjs";
const b = await chromium.launch(launchOptions());
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
await p.goto("http://127.0.0.1:5174/?play&perf=0", { waitUntil: "load" });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(6000);
await p.evaluate(() => { window.__mc.setShaders(true); window.__mc.setShaderQuality("high"); window.__mc.renderer.swayEnabled = false; });
// build a 6x4 stone+birch wall 3 blocks in front and look at it face-on: pure magnification
await p.evaluate(async () => {
  const g = window.__mc;
  const { Vec3 } = await import("/src/vanilla/core/Geometry.ts");
  const px = Math.floor(g.player.pos.x), pz = Math.floor(g.player.pos.z);
  const gy = g.level.getHeight(px, pz);
  const log = g.mc.stateOf("birch_log");
  for (let dx = -3; dx <= 3; dx++) for (let dy = 1; dy <= 3; dy++) g.level.setBlockState(px + dx, gy + dy, pz + 2, log);
  g.player.pos = new Vec3(px + 0.5, gy + 2.2, pz + 0.5);
  g.player.vel = new Vec3(0, 0, 0);
  g.player.yaw = 0; g.player.pitch = 0;
});
await p.waitForTimeout(2500);
await p.screenshot({ path: "shots/_blur-G-default.png" });
await p.evaluate(() => {
  const g = window.__mc, gl = g.gl;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, g.textures.block.texture);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, 0);
});
await p.waitForTimeout(1200);
await p.screenshot({ path: "shots/_blur-H-nomip.png" });
await p.evaluate(() => {
  const g = window.__mc, gl = g.gl;
  const e = gl.getExtension("EXT_texture_filter_anisotropic");
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, g.textures.block.texture);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, 4);
  if (e) gl.texParameterf(gl.TEXTURE_2D_ARRAY, e.TEXTURE_MAX_ANISOTROPY_EXT, 1);
});
await p.waitForTimeout(1200);
await p.screenshot({ path: "shots/_blur-I-aniso1.png" });
console.log("done");
await b.close();
