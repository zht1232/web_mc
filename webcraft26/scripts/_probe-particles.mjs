import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log('ERR', String(e).slice(0, 200)));
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(6000);
const info = await p.evaluate(() => {
  const g = window.__mc;
  const pos = g.player.pos;
  const x = Math.floor(pos.x), y = Math.floor(pos.y - 1), z = Math.floor(pos.z);
  const state = g.level.getBlockState(x, y, z);
  const light = g.particles.lightAt ? g.particles.lightAt(x + 0.5, y + 0.5, z + 0.5) : null;
  g.breakEffects(state, x, y, z);
  return { state, light, alive: g.particles.pool.slotCount };
});
console.log(JSON.stringify(info));
await p.waitForTimeout(120);
await p.screenshot({ path: 'shots/diag/particles-day.png' });
// now in the dark: dig a hole 6 blocks down and break a block there
const dark = await p.evaluate(() => {
  const g = window.__mc;
  const pos = g.player.pos;
  const bx = Math.floor(pos.x) + 2, bz = Math.floor(pos.z);
  const by = Math.floor(pos.y) - 5;
  // clear a small room
  for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 2; dy++) for (let dz = -1; dz <= 1; dz++) {
    g.level.setBlockState(bx + dx, by + dy, bz + dz, 0);
  }
  const state = g.level.getBlockState(bx, by - 1, bz);
  const light = g.particles.lightAt(bx + 0.5, by + 0.5, bz + 0.5);
  g.player.pos = new (g.player.pos.constructor)(bx + 0.5, by + 1, bz + 0.5);
  g.breakEffects(state, bx, by - 1, bz);
  return { state, light };
});
console.log(JSON.stringify(dark));
await p.waitForTimeout(120);
await p.screenshot({ path: 'shots/diag/particles-dark.png' });
await b.close();
