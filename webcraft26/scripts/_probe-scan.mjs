import { chromium } from "playwright";
import { launchOptions } from "./lib/browser.mjs";
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
await p.goto("http://127.0.0.1:5174/?play&perf=0", { waitUntil: "load" });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(6000);
await p.evaluate(() => { window.__mc.setShaders(false); window.__mc.renderer.swayEnabled = false; });
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
const scan = () => p.evaluate(() => new Promise((res) => {
  const gl = window.__mc.gl;
  requestAnimationFrame(() => {
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const row = new Uint8Array(w * 4);
    gl.readPixels(0, Math.floor(h / 2), w, 1, gl.RGBA, gl.UNSIGNED_BYTE, row);
    // collapse to red channel, print a 120px window from the centre
    const out = [];
    for (let i = w / 2 - 60; i < w / 2 + 60; i++) out.push(row[i * 4]);
    res({
      post: [window.__mc.renderer.post.width, window.__mc.renderer.post.height],
      canvas: [w, h], texSize: window.__mc.textures.block.size,
      row: out.join(","),
    });
  });
}));
const a = await scan();
await p.evaluate(() => {
  const g = window.__mc, gl = g.gl;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, g.textures.block.texture);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
});
await p.waitForTimeout(600);
const b2 = await scan();
console.log(JSON.stringify({ nearest: a, linear: b2 }));
await b.close();
