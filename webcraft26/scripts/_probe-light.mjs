import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 800, height: 600 } })).newPage();
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
const out = await p.evaluate(() => {
  const g = window.__mc;
  const names = ['torch', 'redstone_torch', 'redstone_wall_torch', 'redstone_lamp', 'glowstone', 'sea_lantern', 'lava', 'redstone_ore', 'redstone_wire', 'magma_block', 'shroomlight', 'lantern'];
  const res = {};
  for (const n of names) {
    const st = g.mc.stateOf?.(n) ?? g.mc.stateByName?.(n);
    res[n] = st !== undefined ? g.mc.lightOf(st) : 'n/a';
  }
  return res;
});
console.log(JSON.stringify(out));
await b.close();
