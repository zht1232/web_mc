import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(25000);
async function measure(label, action) {
  const frames = [];
  let last = performance.now();
  const sample = p.evaluate(async () => {
    const f = [];
    let l = performance.now();
    await new Promise((res) => { let c = 0; const t = () => { const n = performance.now(); f.push(n - l); l = n; if (++c < 240) requestAnimationFrame(t); else res(); }; requestAnimationFrame(t); });
    return f;
  });
  if (action) await action();
  const f = await sample;
  const s = f.sort((a, b) => a - b);
  console.log(label, JSON.stringify({ p50: s[120].toFixed(1), p90: s[216].toFixed(1), max: s[239].toFixed(1), chunks: await p.evaluate(() => window.__mc.level.chunks.size) }));
}
await measure('idle');
await p.keyboard.down('KeyW');
await measure('walk');
await p.keyboard.up('KeyW');
// look around with mouse
await p.mouse.move(640, 360);
await p.mouse.down();
for (let i = 0; i < 40; i++) { await p.mouse.move(640 + Math.sin(i / 4) * 200, 360 + Math.cos(i / 5) * 60); }
await p.mouse.up();
await measure('after-look');
await b.close();
