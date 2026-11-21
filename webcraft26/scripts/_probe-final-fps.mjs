import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(60000);
const out = await p.evaluate(async () => {
  const frames = [];
  let last = performance.now();
  await new Promise((res) => { let c = 0; const tick = () => { const now = performance.now(); frames.push(now - last); last = now; if (++c < 300) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
  const s = [...frames].sort((a, b) => a - b);
  return {
    fpsCounter: window.__mc.fps,
    p50: s[150].toFixed(1), p90: s[270].toFixed(1), p99: s[297].toFixed(1),
    avg: (frames.reduce((a, b) => a + b, 0) / frames.length).toFixed(1),
    chunks: window.__mc.level.chunks.size,
  };
});
console.log(JSON.stringify(out));
await b.close();
