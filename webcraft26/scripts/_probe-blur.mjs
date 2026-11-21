import { chromium } from "playwright";
import { launchOptions } from "./lib/browser.mjs";
const b = await chromium.launch(launchOptions());
const ctx = await b.newContext({ viewport: { width: 1699, height: 901 }, deviceScaleFactor: 1.5 });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto("http://127.0.0.1:5174/?play&perf=0", { waitUntil: "load" });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(6000);
await p.evaluate(() => { window.__mc.setShaders(true); window.__mc.setShaderQuality("high"); });
await p.waitForTimeout(1200);
// Stand on the ground and look straight down at the grass block under the feet.
await p.evaluate(async () => {
  const g = window.__mc;
  const { Vec3 } = await import("/src/vanilla/core/Geometry.ts");
  const px = Math.floor(g.player.pos.x), pz = Math.floor(g.player.pos.z);
  const gy = g.level.getHeight(px, pz);
  g.player.pos = new Vec3(px + 0.5, gy + 1.6, pz + 0.5);
  g.player.vel = new Vec3(0, 0, 0);
  g.player.yaw = 45; g.player.pitch = 80;
});
await p.waitForTimeout(1500);
const info = await p.evaluate(() => {
  const g = window.__mc, gl = g.gl;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, g.textures.block.texture);
  const mag = gl.getTexParameter(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER);
  const min = gl.getTexParameter(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER);
  const anisoExt = gl.getExtension("EXT_texture_filter_anisotropic");
  const aniso = anisoExt ? gl.getTexParameter(gl.TEXTURE_2D_ARRAY, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT) : null;
  return {
    mag, min, aniso, NEAREST: gl.NEAREST, LINEAR: gl.LINEAR,
    smoothing: g.guiCtx.imageSmoothingEnabled,
    diag: g.perfDiagnostics(),
    dpr: devicePixelRatio, inner: [innerWidth, innerHeight],
    canvas3d: [g.glCanvas.width, g.glCanvas.height],
    canvasGui: [g.guiCanvas.width, g.guiCanvas.height],
    css3d: [g.glCanvas.style.width, g.glCanvas.style.height],
    guiScale: g.guiScale,
  };
});
await p.screenshot({ path: "shots/_probe-blur-world.png" });
await p.evaluate(() => window.__mc.openScreen(window.__mc.survival.gamemode === "creative" ? "creative" : "inventory"));
await p.waitForTimeout(1200);
await p.screenshot({ path: "shots/_probe-blur-inv.png" });
console.log(JSON.stringify({ info, errors: errors.slice(0, 5) }, null, 2));
await b.close();
