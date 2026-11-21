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
await p.waitForTimeout(2000);
const setup = await p.evaluate(() => { window.__mc.screens.open('inventory'); const s = window.__mc.screens.current; return { gui: window.__mc.guiScale, left: s.leftPos, top: s.topPos }; });
const scale = setup.gui;
const slotPos = (i) => p.evaluate((idx) => {
  const s = window.__mc.screens.current;
  const slot = s.slots.find((x) => x.index === idx);
  return { x: (s.leftPos + slot.x + 8) * window.__mc.guiScale, y: (s.topPos + slot.y + 8) * window.__mc.guiScale };
}, i);
const state = () => p.evaluate(() => {
  const s = window.__mc.screens.current;
  const c = s.menu.getCarried();
  return { carried: c && c.count ? `${c.itemId}x${c.count}` : null, drag: s.containerDragButton, quick: [...s.quickCraftSlots] };
});
// pick from hotbar slot 36
let q = await slotPos(36); await p.mouse.move(q.x, q.y); await p.mouse.down(); await p.mouse.up();
await p.waitForTimeout(100);
console.log('after pick', JSON.stringify(await state()));
// place into empty main slot 9
q = await slotPos(9); await p.mouse.move(q.x, q.y); await p.mouse.down(); await p.mouse.up();
await p.waitForTimeout(200);
console.log('after place', JSON.stringify(await state()));
await p.screenshot({ path: path.join(out, 'ghost-place.png') });
// right-click one into slot 10, then left-click to put the rest back
q = await slotPos(10); await p.mouse.move(q.x, q.y); await p.mouse.down({ button: 'right' }); await p.mouse.up({ button: 'right' });
await p.waitForTimeout(150);
console.log('after right', JSON.stringify(await state()));
await p.screenshot({ path: path.join(out, 'ghost-right.png') });
await b.close();
