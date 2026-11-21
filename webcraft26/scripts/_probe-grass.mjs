import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 800, height: 600 } })).newPage();
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(8000);
const out = await p.evaluate(() => {
  const g = window.__mc;
  const px = Math.floor(g.player.pos.x) - 16, pz = Math.floor(g.player.pos.z) - 16;
  const grass = g.mc.stateOf('short_grass');
  const tall = g.mc.stateOf('tall_grass');
  const air = 0;
  let plants = 0, grassTop = 0, total = 0;
  for (let dx = 0; dx < 32; dx++) for (let dz = 0; dz < 32; dz++) {
    const y = g.level.getHeight(px + dx, pz + dz);
    const b0 = g.level.getBlockState(px + dx, y, pz + dz);
    const below = g.level.getBlockState(px + dx, y - 1, pz + dz);
    total++;
    if (b0 === grass || b0 === tall) plants++;
    if (g.mc.blockOf?.(below)?.name === 'grass_block') grassTop++;
  }
  return { total, plants, grassTop, pct: ((plants / total) * 100).toFixed(1) };
});
console.log(JSON.stringify(out));
await b.close();
