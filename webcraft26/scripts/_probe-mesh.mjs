import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(30000);
const r = await p.evaluate(() => {
  const g = window.__mc, r = g.renderer;
  // stop the queue from interfering
  r.rebuildQueue.length = 0;
  const tints = r.tintSource(g.level);
  const chunk = [...g.level.chunks.values()][0];
  const times = [];
  for (let sy = chunk.minSectionY; sy <= Math.min(chunk.maxSectionY, chunk.minSectionY + 8); sy++) {
    const t = performance.now();
    r.buildSection(g.level, chunk.x, chunk.z, sy, tints);
    times.push(+(performance.now() - t).toFixed(2));
  }
  return { chunk: [chunk.x, chunk.z], sections: times, total: times.reduce((a, b) => a + b, 0).toFixed(1) };
});
console.log(JSON.stringify(r));
await b.close();
