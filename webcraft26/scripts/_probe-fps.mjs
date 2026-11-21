import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
for (const wait of [3000, 5000, 5000]) {
  await p.waitForTimeout(wait);
  const info = await p.evaluate(() => {
    const g = window.__mc;
    const r = g.renderer;
    return {
      fps: g.fps,
      rd: r.renderDistance,
      quality: r.shaderQuality,
      shaders: r.shadersEnabled,
      stats: r.stats ? { ...r.stats } : null,
      chunks: g.level.chunks?.size ?? g.level.chunkCount?.(),
      queue: r.meshQueue?.length ?? r.pendingMeshCount ?? null,
    };
  });
  console.log(JSON.stringify(info));
}
const perf = await p.evaluate(async () => {
  const g = window.__mc;
  const t = [];
  let last = performance.now();
  await new Promise((res) => {
    let n = 0;
    const tick = () => { const now = performance.now(); t.push(now - last); last = now; if (++n < 120) requestAnimationFrame(tick); else res(); };
    requestAnimationFrame(tick);
  });
  t.sort((a, b) => a - b);
  return { median: t[60].toFixed(1), p90: t[108].toFixed(1), min: t[0].toFixed(1), max: t[t.length - 1].toFixed(1) };
});
console.log('frame ms', JSON.stringify(perf));
await b.close();
