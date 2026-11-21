import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(root, '../shots/screens');
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
p.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(2000);
for (const [name, screen] of [['20-creative2', 'creative'], ['21-inventory2', 'inventory']]) {
  await p.evaluate((s) => window.__mc.screens.open(s), screen);
  await p.waitForTimeout(900);
  await p.screenshot({ path: path.join(out, name + '.png') });
}
await b.close();
