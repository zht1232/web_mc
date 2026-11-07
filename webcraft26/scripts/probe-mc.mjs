// one-off probe: what exactly is window.__mc?
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://127.0.0.1:5174/', { waitUntil: 'domcontentloaded', timeout: 60000 });
const deadline = Date.now() + 90000;
while (Date.now() < deadline) {
  if (await page.evaluate(() => !!(window.__mc && window.__mc.icons && window.__mc.icons.ready))) break;
  await page.waitForTimeout(500);
}
const info = await page.evaluate(() => {
  const g = window.__mc;
  const keys = Object.keys(g);
  const mcField = g.mc;
  return {
    ctor: g.constructor && g.constructor.name,
    keyCount: keys.length,
    keys: keys.slice(0, 60),
    hasOwnMc: Object.prototype.hasOwnProperty.call(g, 'mc'),
    mcType: typeof mcField,
    mcKeys: mcField && typeof mcField === 'object' ? Object.keys(mcField).slice(0, 30) : null,
    mcItemsLen: mcField && Array.isArray(mcField.items) ? mcField.items.length : null,
    topItemsLen: Array.isArray(g.items) ? g.items.length : null,
    iconsKeys: g.icons ? Object.keys(g.icons) : null,
  };
});
console.log(JSON.stringify(info, null, 1));
console.log('pageerrors:', errs.slice(0, 5));
await browser.close();
