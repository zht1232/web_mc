import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(1200);
for (const name of ['inventory', 'creative', 'chest', 'crafting', 'furnace']) {
  const info = await p.evaluate((n) => {
    const s = window.__mc.screens;
    s.open(n);
    const cur = s.current;
    const slots = cur.slots.map((x) => [x.index, x.x, x.y]);
    return {
      n, w: cur.width, h: cur.height, left: cur.leftPos, top: cur.topPos,
      iw: cur.imageWidth, ih: cur.imageHeight, gui: window.__mc.guiScale,
      slotCount: slots.length, first: slots.slice(0, 6), last: slots.slice(-4),
    };
  }, name);
  console.log(JSON.stringify(info));
}
await b.close();
