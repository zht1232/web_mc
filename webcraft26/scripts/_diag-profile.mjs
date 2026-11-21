import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const page = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:5174/?play', { waitUntil: 'domcontentloaded', timeout: 120000 });
for (let i = 0; i < 600; i++) { if (await page.evaluate(() => window.__mc?.level?.chunks?.size > 120)) break; await page.waitForTimeout(250); }
// wait until streaming + meshing settle
for (let i = 0; i < 120; i++) {
  const s = await page.evaluate(() => ({ c: window.__mc.level.chunks.size, m: window.__mc.renderer.meshStats.count, ms: window.__mc.renderer.meshStats.ms }));
  if (s.m === 0 && s.ms === 0) break;
  await page.waitForTimeout(500);
}
await page.waitForTimeout(1500);
const result = await page.evaluate(async () => {
  const mc = window.__mc;
  const gl = mc.gl;
  const acc = {};
  const wrap = (obj, name, key) => {
    const orig = obj[name].bind(obj);
    acc[key] = { ms: 0, n: 0 };
    obj[name] = (...a) => { const t = performance.now(); const r = orig(...a); acc[key].ms += performance.now() - t; acc[key].n++; return r; };
  };
  wrap(mc.renderer, 'update', 'meshUpdate');
  wrap(mc.renderer, 'render', 'terrainRender');
  wrap(mc.renderer.post, 'endScene', 'post');
  wrap(mc.renderer.post, 'beginScene', 'beginScene');
  wrap(mc, 'renderHud', 'hud');
  wrap(mc.screens, 'render', 'screens');
  wrap(mc.entityRenderer, 'render', 'entities');
  wrap(mc.skyRenderer, 'render', 'sky');
  wrap(mc.cloudRenderer, 'render', 'clouds');
  let draws = 0;
  const od = gl.drawElements.bind(gl), oa = gl.drawArrays.bind(gl);
  gl.drawElements = (...a) => { draws++; return od(...a); };
  gl.drawArrays = (...a) => { draws++; return oa(...a); };
  const frames = await new Promise(res => {
    let n = 0; const t0 = performance.now(); let last = t0; let frameMs = 0;
    function loop() {
      const now = performance.now(); frameMs += now - last; last = now; n++;
      if (now - t0 < 3000) requestAnimationFrame(loop); else res({ fps: +(n / 3).toFixed(1), avgFrame: +(frameMs / n).toFixed(2) });
    }
    requestAnimationFrame(loop);
  });
  const out = { frames, drawsPerFrame: +(draws / (frames.fps * 3)).toFixed(0), chunks: mc.level.chunks.size, sections: mc.renderer.meshStats.sections };
  for (const k of Object.keys(acc)) out[k] = +(acc[k].ms / acc[k].n).toFixed(2);
  return out;
});
console.log('PROFILE', JSON.stringify(result));
await b.close();