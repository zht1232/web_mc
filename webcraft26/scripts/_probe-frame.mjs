import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(45000);
const info = await p.evaluate(async () => {
  const g = window.__mc;
  const r = g.renderer;
  const origRender = r.render.bind(r);
  let renderMs = 0, n = 0;
  r.render = (...a) => { const t = performance.now(); const v = origRender(...a); renderMs += performance.now() - t; n++; return v; };
  const origTick = g.tick.bind(g);
  let tickMs = 0, tn = 0;
  g.tick = (...a) => { const t = performance.now(); const v = origTick(...a); tickMs += performance.now() - t; tn++; return v; };
  const origUpdate = r.update?.bind(r);
  let updMs = 0, un = 0;
  if (origUpdate) r.update = (...a) => { const t = performance.now(); const v = origUpdate(...a); updMs += performance.now() - t; un++; return v; };
  const frames = [];
  let last = performance.now();
  await new Promise((res) => { let c = 0; const tick = () => { const now = performance.now(); frames.push(now - last); last = now; if (++c < 120) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
  r.render = origRender; g.tick = origTick;
  if (origUpdate) r.update = origUpdate;
  frames.sort((a, b) => a - b);
  return {
    renderMs: (renderMs / n).toFixed(2), renderN: n,
    tickMs: (tickMs / tn).toFixed(2), tickN: tn,
    updateMs: (updMs / Math.max(1, un)).toFixed(2), updateN: un,
    p50: frames[60].toFixed(1), p90: frames[108].toFixed(1), max: frames[119].toFixed(1),
    chunks: g.level.chunks.size,
  };
});
console.log(JSON.stringify(info));
await b.close();
