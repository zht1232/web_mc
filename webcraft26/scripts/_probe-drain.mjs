import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(20000);
await p.keyboard.down('KeyW');
await p.evaluate(() => {
  const g = window.__mc;
  window.__t = { drain: 0, drainN: 0, upd: 0, updN: 0 };
  const d = g.chunkProvider.drain.bind(g.chunkProvider);
  g.chunkProvider.drain = (...a) => { const t = performance.now(); const v = d(...a); window.__t.drain += performance.now() - t; window.__t.drainN++; return v; };
  const u = g.renderer.update.bind(g.renderer);
  g.renderer.update = (...a) => { const t = performance.now(); const v = u(...a); window.__t.upd += performance.now() - t; window.__t.updN++; return v; };
});
await p.waitForTimeout(6000);
await p.keyboard.up('KeyW');
console.log(JSON.stringify(await p.evaluate(() => {
  const t = window.__t;
  const f = window.__mc.frames ?? 0;
  return { drainAvg: (t.drain / t.drainN).toFixed(2), drainN: t.drainN, updAvg: (t.upd / t.updN).toFixed(2), updN: t.updN };
})));
await b.close();
