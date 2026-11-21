import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots/diag');
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 800, height: 600 } })).newPage();
p.on('pageerror', (e) => console.log('ERR', String(e).slice(0, 200)));
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(8000);
const setup = await p.evaluate(async () => {
  const g = window.__mc;
  const { Vec3 } = await import('/src/vanilla/core/Geometry.ts');
  g.level.time = 6000; // noon
  const px = Math.floor(g.player.pos.x), pz = Math.floor(g.player.pos.z);
  const gy = g.level.getHeight(px, pz);
  const stone = g.mc.stateOf('stone');
  // 11x11 roof 5 blocks above the head
  for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) {
    g.level.setBlockState(px + dx, gy + 5, pz + dz, stone);
  }
  g.player.pos = new Vec3(px + 0.5, gy + 1, pz + 0.5);
  g.player.pitch = 55;   // look down
  g.player.yaw = 0;
  g.renderer.debugMode = 11;
  return { px, pz, gy };
});
await p.waitForTimeout(3000);
await p.screenshot({ path: path.join(out, 'shadow-roof-debug.png') });
const px = await p.evaluate(() => {
  const gl = window.__mc.gl;
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const buf = new Uint8Array(4);
  gl.readPixels(Math.floor(w / 2), Math.floor(h * 0.45), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  return [...buf];
});
console.log(JSON.stringify({ setup, centerPixel: px }));
await p.evaluate(() => { window.__mc.renderer.debugMode = 0; });
await b.close();
