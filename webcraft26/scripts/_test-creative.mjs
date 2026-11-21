import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log('ERR', String(e).slice(0, 300)));
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(2000);
await p.evaluate(() => window.__mc.screens.open('creative'));
await p.waitForTimeout(500);
const info = await p.evaluate(() => {
  const s = window.__mc.screens.current;
  return {
    slots: s.slots.slice(0, 3),
    items: [0, 1, 2].map((i) => s.menu.getItem(i)),
    carried0: s.menu.getCarried(),
    gui: window.__mc.guiScale, left: s.leftPos, top: s.topPos,
  };
});
console.log(JSON.stringify(info));
const pt = await p.evaluate(() => { const s = window.__mc.screens.current; const sl = s.slots[0]; return { x: (s.leftPos + sl.x + 8) * window.__mc.guiScale, y: (s.topPos + sl.y + 8) * window.__mc.guiScale }; });
await p.mouse.move(pt.x, pt.y);
await p.mouse.down(); await p.mouse.up();
await p.waitForTimeout(200);
console.log('after click', JSON.stringify(await p.evaluate(() => {
  const s = window.__mc.screens.current;
  const c = s.menu.getCarried();
  return { carried: c, hovered: s.hoveredSlot, item0: s.menu.getItem(0) };
})));
await b.close();
