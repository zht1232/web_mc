import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(20000);
const samples = [];
await p.keyboard.down('KeyW');
for (let i = 0; i < 10; i++) {
  await p.waitForTimeout(1500);
  samples.push(await p.evaluate(() => window.__mc.fps));
}
await p.keyboard.up('KeyW');
console.log('walk fps samples', JSON.stringify(samples), 'min', Math.min(...samples), 'avg', (samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(1));
await b.close();
