import fs from 'node:fs';
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(1500);
const data = await p.evaluate(() => {
  const icons = window.__mc.icons;
  const c = icons?.canvas;
  if (!c) return null;
  const cellOf = icons.cellOf;
  const id = window.__mc.mc.items.findIndex((i) => i.name === 'grass_block');
  const cell = cellOf[id];
  const cols = 40, CELL = 16;
  const x = (cell % cols) * CELL, y = Math.floor(cell / cols) * CELL;
  const tmp = document.createElement('canvas');
  tmp.width = CELL; tmp.height = CELL;
  tmp.getContext('2d').drawImage(c, x, y, CELL, CELL, 0, 0, CELL, CELL);
  return { url: tmp.toDataURL(), cell, id, w: c.width };
});
if (data) {
  fs.writeFileSync('shots/diag/icon-grass.png', Buffer.from(data.url.split(',')[1], 'base64'));
  console.log('stone', JSON.stringify({ cell: data.cell, id: data.id, atlas: data.w }));
} else console.log('no icons');
await b.close();
