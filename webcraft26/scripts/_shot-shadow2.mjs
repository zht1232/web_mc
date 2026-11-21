import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots/diag');
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log('ERR', String(e).slice(0, 200)));
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(8000);
const info = await p.evaluate(async () => {
  const g = window.__mc;
  g.level.time = 8600;
  const px = Math.floor(g.player.pos.x), pz = Math.floor(g.player.pos.z);
  const gy = g.level.getHeight(px + 6, pz);
  const stone = g.mc.stateOf('stone');
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let y = gy; y < gy + 9; y++) {
    g.level.setBlockState(px + 6 + dx, y, pz + dz, stone);
  }
  const { Vec3 } = await import('/src/vanilla/core/Geometry.ts');
  g.player.pos = new Vec3(px - 4.5, gy + 10, pz + 0.5);
  g.player.yaw = 90; // face +x
  g.player.pitch = 25;
  return { px, pz, gy };
});
console.log(JSON.stringify(info));
await p.waitForTimeout(3500);
await p.screenshot({ path: path.join(out, 'shadow-pillar.png') });
console.log(JSON.stringify(await p.evaluate(() => ({ shadow: { ...window.__mc.renderer.shadowStats }, gl: window.__mc.gl.getError() }))));
await b.close();
