import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots/diag');
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log('ERR', String(e).slice(0, 300)));
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(2000);
const state = () => p.evaluate(() => {
  const s = window.__mc.screens.current;
  if (!s) return { screen: null };
  const c = s.menu?.getCarried?.();
  return { screen: s.constructor.name, carried: c && c.count ? `${c.itemId}x${c.count}` : null };
});
const pos = (i) => p.evaluate((idx) => {
  const s = window.__mc.screens.current;
  const slot = s.slots.find((x) => x.index === idx);
  return { x: (s.leftPos + slot.x + 8) * window.__mc.guiScale, y: (s.topPos + slot.y + 8) * window.__mc.guiScale };
}, i);

// scenario A: drag from slot 36 to slot 12 with the button held
await p.evaluate(() => window.__mc.screens.open('inventory'));
await p.waitForTimeout(300);
let a = await pos(36), c = await pos(12);
await p.mouse.move(a.x, a.y); await p.mouse.down();
await p.mouse.move((a.x + c.x) / 2, (a.y + c.y) / 2, { steps: 5 });
await p.mouse.move(c.x, c.y, { steps: 5 }); await p.mouse.up();
await p.waitForTimeout(200);
console.log('A drag-place', JSON.stringify(await state()));
await p.screenshot({ path: path.join(out, 'ghost-drag.png') });

// scenario B: creative grid click then hotbar slot
await p.evaluate(() => window.__mc.screens.open('creative'));
await p.waitForTimeout(400);
const g = await p.evaluate(() => { const s = window.__mc.screens.current; const slot = s.slots[0]; return { x: (s.leftPos + slot.x + 8) * window.__mc.guiScale, y: (s.topPos + slot.y + 8) * window.__mc.guiScale }; });
await p.mouse.move(g.x, g.y); await p.mouse.down(); await p.mouse.up();
await p.waitForTimeout(150);
console.log('B picked creative', JSON.stringify(await state()));
const hb = await pos(45);
await p.mouse.move(hb.x, hb.y); await p.mouse.down(); await p.mouse.up();
await p.waitForTimeout(200);
console.log('B placed hotbar', JSON.stringify(await state()));
await p.screenshot({ path: path.join(out, 'ghost-creative.png') });

// scenario C: close with an item on the cursor, reopen
const g2 = await p.evaluate(() => { const s = window.__mc.screens.current; const slot = s.slots[3]; return { x: (s.leftPos + slot.x + 8) * window.__mc.guiScale, y: (s.topPos + slot.y + 8) * window.__mc.guiScale }; });
await p.mouse.move(g2.x, g2.y); await p.mouse.down(); await p.mouse.up();
await p.waitForTimeout(120);
console.log('C picked', JSON.stringify(await state()));
await p.keyboard.press('Escape');
await p.waitForTimeout(300);
console.log('C closed', JSON.stringify(await state()));
await p.evaluate(() => window.__mc.screens.open('inventory'));
await p.waitForTimeout(300);
console.log('C reopened', JSON.stringify(await state()));
await p.screenshot({ path: path.join(out, 'ghost-reopen.png') });
await b.close();
