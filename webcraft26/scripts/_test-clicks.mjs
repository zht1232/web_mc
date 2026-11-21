import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(root, '../shots/diag');
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
p.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(2000);
const setup = await p.evaluate(() => {
  const g = window.__mc;
  g.screens.open('inventory');
  const s = g.screens.current;
  const items = [];
  for (let i = 0; i < 9; i++) {
    const st = g.survival.inventory.getItem(i);
    items.push({ i, item: st.item?.name ?? null, count: st.getCount() });
  }
  return { gui: g.guiScale, left: s.leftPos, top: s.topPos, items };
});
console.log('setup', JSON.stringify(setup));
const scale = setup.gui;
const state = () => p.evaluate(() => {
  const s = window.__mc.screens.current;
  const c = s.menu.getCarried();
  const inv = [];
  for (let i = 0; i < 12; i++) {
    const st = window.__mc.survival.inventory.getItem(i);
    inv.push(st.getCount() > 0 ? `${i}:${st.item?.name}x${st.getCount()}` : '');
  }
  return { carried: c && c.count ? `${c.itemId}x${c.count}` : null, inv: inv.filter(Boolean) };
});
async function clickSlot(index, button = 'left', shift = false) {
  const r = await p.evaluate((i) => {
    const s = window.__mc.screens.current;
    const slot = s.slots.find((x) => x.index === i);
    return { x: s.leftPos + slot.x, y: s.topPos + slot.y };
  }, index);
  if (shift) await p.keyboard.down('Shift');
  await p.mouse.move((r.x + 8) * scale, (r.y + 8) * scale);
  await p.mouse.down({ button }); await p.mouse.up({ button });
  if (shift) await p.keyboard.up('Shift');
  await p.waitForTimeout(120);
  return state();
}
console.log('pick hotbar0 ->', JSON.stringify(await clickSlot(36)));
console.log('place main9  ->', JSON.stringify(await clickSlot(9)));
await p.screenshot({ path: path.join(out, 'click-1.png') });
console.log('pick main9   ->', JSON.stringify(await clickSlot(9)));
console.log('split right  ->', JSON.stringify(await clickSlot(10, 'right')));
console.log('place right  ->', JSON.stringify(await clickSlot(11, 'right')));
await p.screenshot({ path: path.join(out, 'click-2.png') });
console.log('shift hotbar1->', JSON.stringify(await clickSlot(37, 'left', true)));
await b.close();
