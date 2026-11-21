import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
const t0 = Date.now();
await p.goto('http://127.0.0.1:5174/', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.screens, null, { timeout: 120000 });
console.log('boot ms', Date.now() - t0);
await p.waitForTimeout(2500);
console.log(JSON.stringify(await p.evaluate(() => ({
  title: window.__mc.screens.current?.constructor.name,
  chunks: window.__mc.level.chunks.size,
  worlds: 'ok',
}))));
await p.screenshot({ path: 'shots/diag/title-boot.png' });
await b.close();
