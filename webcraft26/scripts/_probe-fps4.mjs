import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
for (let i = 0; i < 8; i++) {
  await p.waitForTimeout(5000);
  const r = await p.evaluate(() => ({
    fps: window.__mc.fps,
    chunks: window.__mc.level.chunks.size,
    sections: window.__mc.renderer.sections.size,
    queue: window.__mc.chunkProvider?.queueLength ?? window.__mc.level?.pendingChunks ?? null,
  }));
  console.log(i, JSON.stringify(r));
}
// frame time distribution after settle
const dist = await p.evaluate(async () => {
  const t = []; let last = performance.now();
  await new Promise((res) => { let n = 0; const tick = () => { const now = performance.now(); t.push(now - last); last = now; if (++n < 180) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
  const s = [...t].sort((a, b) => a - b);
  return { p50: s[90].toFixed(1), p90: s[162].toFixed(1), p99: s[178].toFixed(1), max: s[179].toFixed(1) };
});
console.log('frame dist', JSON.stringify(dist));
// draw calls per frame
const calls = await p.evaluate(async () => {
  const gl = window.__mc.gl;
  const real = gl.drawElements.bind(gl); let n = 0;
  gl.drawElements = (...a) => { n++; return real(...a); };
  const before = performance.now(); let frames = 0;
  await new Promise((res) => { let c = 0; const tick = () => { frames++; if (++c < 60) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
  gl.drawElements = real;
  return { perFrame: (n / frames).toFixed(0), frames, ms: (performance.now() - before).toFixed(0) };
});
console.log('draws', JSON.stringify(calls));
await b.close();
