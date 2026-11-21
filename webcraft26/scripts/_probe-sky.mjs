import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 800, height: 600 } })).newPage();
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(4000);
const out = await p.evaluate(async () => {
  const g = window.__mc;
  const mod = await import('/src/client/EnvironmentLighting.ts');
  const res = [];
  for (const t of [6000, 11000, 11800, 12300, 12800, 13000, 14000, 18000]) {
    const s = mod.computeSkyState(t, g.options.brightness, { rainLevel: 0, thunderLevel: 0, biomeName: 'minecraft:plains' });
    res.push({
      t,
      sky: s.skyColor.map((v) => +v.toFixed(2)),
      fog: s.fogColor.map((v) => +v.toFixed(2)),
      sunrise: ((s.sunriseColorArgb >>> 24) & 255) / 255,
      sunY: +s.sunAngleDeg?.toFixed?.(1),
    });
  }
  return res;
});
console.log(JSON.stringify(out, null, 0));
await b.close();
