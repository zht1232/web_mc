import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(15000);
await p.keyboard.down('KeyW');
await p.evaluate(() => {
  const g = window.__mc;
  window.__t = { add: 0, addN: 0, drain: 0, drainN: 0 };
  const a = g.level.addChunk.bind(g.level);
  g.level.addChunk = (...args) => { const t = performance.now(); const v = a(...args); window.__t.add += performance.now() - t; window.__t.addN++; return v; };
  const d = g.chunkProvider.drain.bind(g.chunkProvider);
  g.chunkProvider.drain = (...args) => { const t = performance.now(); const v = d(...args); window.__t.drain += performance.now() - t; window.__t.drainN++; return v; };
});
await p.waitForTimeout(6000);
await p.keyboard.up('KeyW');
console.log(JSON.stringify(await p.evaluate(() => {
  const t = window.__t;
  return {
    addAvg: (t.add / Math.max(1, t.addN)).toFixed(2), addN: t.addN,
    drainAvg: (t.drain / Math.max(1, t.drainN)).toFixed(2), drainPerFrame: (t.drainN / 120).toFixed(1),
  };
})));
await b.close();
