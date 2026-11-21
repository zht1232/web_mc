import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 800, height: 600 } })).newPage();
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(6000);
const out = await p.evaluate(() => {
  const g = window.__mc;
  const x0 = Math.floor(g.player.pos.x), z0 = Math.floor(g.player.pos.z);
  const line = [];
  for (let dx = 0; dx < 48; dx++) line.push(g.level.getHeight(x0 + dx, z0));
  const row2 = [];
  for (let dx = 0; dx < 48; dx++) row2.push(g.level.getHeight(x0 + dx, z0 + 1));
  let deltas = {};
  for (let dx = 1; dx < 48; dx++) { const d = line[dx] - line[dx - 1]; deltas[d] = (deltas[d] ?? 0) + 1; }
  return { line, row2, deltas };
});
console.log(JSON.stringify(out, null, 0).slice(0, 1200));
await b.close();
