import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots/diag');
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(9000);
const info = await p.evaluate(async () => {
  const g = window.__mc;
  g.level.time = 6000;
  const { Vec3 } = await import('/src/vanilla/core/Geometry.ts');
  // find a log block near the player
  const px = Math.floor(g.player.pos.x), pz = Math.floor(g.player.pos.z);
  const log = g.mc.stateOf('oak_log');
  let found = null;
  for (let r = 2; r < 40 && !found; r++) {
    for (let dx = -r; dx <= r && !found; dx++) {
      for (let dz = -r; dz <= r && !found; dz++) {
        for (let y = g.level.getHeight(px + dx, pz + dz) + 8; y > g.level.getHeight(px + dx, pz + dz) - 2; y--) {
          if (g.level.getBlockState(px + dx, y, pz + dz) === log) { found = { x: px + dx, y, z: pz + dz }; break; }
        }
      }
    }
  }
  if (!found) return null;
  g.player.pos = new Vec3(found.x + 8.5, found.y + 2, found.z + 0.5);
  g.player.yaw = 90; // face -x
  g.player.pitch = 12;
  return found;
});
console.log(JSON.stringify(info));
await p.waitForTimeout(2500);
await p.screenshot({ path: path.join(out, 'tree-close.png') });
await b.close();
