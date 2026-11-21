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
await p.waitForTimeout(9000);
for (const [name, t] of [['6000-day', 6000], ['11800-sunset', 11800], ['12500-dusk', 12500], ['13000-night', 13000], ['18000-midnight', 18000]]) {
  await p.evaluate((time) => { window.__mc.level.time = time; window.__mc.player.pitch = 6; }, t);
  await p.waitForTimeout(1400);
  await p.screenshot({ path: path.join(out, `time-${name}.png`) });
}
await b.close();
