import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots/diag');
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 900, height: 640 } })).newPage();
p.on('pageerror', (e) => console.log('ERR', String(e).slice(0, 300)));
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(6000);
const info = await p.evaluate(async () => {
  const g = window.__mc;
  g.level.time = 6000;
  const { Vec3 } = await import('/src/vanilla/core/Geometry.ts');
  const px = Math.floor(g.player.pos.x), pz = Math.floor(g.player.pos.z);
  const gy = g.level.getHeight(px + 4, pz);
  // clear space
  for (let dx = 2; dx <= 6; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 0; dy < 4; dy++) {
    g.level.setBlockState(px + dx, gy + dy, pz + dz, 0);
  }
  // spawn through the same host the /summon command uses
  const ok = g.commandHost().summon('skeleton', px + 4.5, gy, pz + 0.5);
  g.player.pos = new Vec3(px + 4.5, gy + 1.6, pz + 4.5);
  g.player.yaw = 180; // look -z toward the skeleton
  g.player.pitch = 4;
  const ents = [...g.entityManager.getEntities()].map((e) => e.getTypeName());
  return { px, pz, gy, ok, ents };
});
console.log(JSON.stringify(info));
await p.waitForTimeout(2500);
await p.screenshot({ path: path.join(out, 'skeleton-bow.png') });
await b.close();
