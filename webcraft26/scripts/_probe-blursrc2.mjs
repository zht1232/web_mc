import { chromium } from "playwright";
import { launchOptions } from "./lib/browser.mjs";
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
await p.goto("http://127.0.0.1:5174/?play&perf=0", { waitUntil: "load" });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(6000);
await p.evaluate(() => { window.__mc.setShaders(true); window.__mc.setShaderQuality("high"); window.__mc.renderer.swayEnabled = false; });
await p.evaluate(async () => {
  const g = window.__mc;
  const { Vec3 } = await import("/src/vanilla/core/Geometry.ts");
  const px = Math.floor(g.player.pos.x), pz = Math.floor(g.player.pos.z);
  const gy = g.level.getHeight(px, pz);
  g.player.pos = new Vec3(px + 0.5, gy + 1.6, pz + 0.5);
  g.player.vel = new Vec3(0, 0, 0);
  g.player.yaw = 45; g.player.pitch = 80;
});
await p.waitForTimeout(1600);
await p.screenshot({ path: "shots/_blur-E-before.png" });
const params = await p.evaluate(() => {
  const g = window.__mc, gl = g.gl;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, g.textures.block.texture);
  const anisoExt = gl.getExtension("EXT_texture_filter_anisotropic");
  const before = {
    mag: gl.getTexParameter(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER),
    min: gl.getTexParameter(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER),
    aniso: anisoExt ? gl.getTexParameter(gl.TEXTURE_2D_ARRAY, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT) : null,
    maxLevel: gl.getTexParameter(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL),
    base: gl.getTexParameter(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_BASE_LEVEL),
  };
  // force the hardest possible sampling: nearest, no mips, no anisotropy
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, 0);
  if (anisoExt) gl.texParameterf(gl.TEXTURE_2D_ARRAY, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, 1);
  return { before, err: gl.getError() };
});
await p.waitForTimeout(1200);
await p.screenshot({ path: "shots/_blur-F-nearest.png" });
console.log(JSON.stringify(params));
await b.close();
