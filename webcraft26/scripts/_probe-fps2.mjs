import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(8000);
const inst = await p.evaluate(() => {
  const gl = window.__mc.gl;
  const real = { drawElements: gl.drawElements.bind(gl), drawArrays: gl.drawArrays.bind(gl), drawElementsInstanced: gl.drawElementsInstanced.bind(gl) };
  window.__counts = { de: 0, da: 0, dei: 0, frames: 0 };
  gl.drawElements = (...a) => { window.__counts.de++; return real.drawElements(...a); };
  gl.drawArrays = (...a) => { window.__counts.da++; return real.drawArrays(...a); };
  gl.drawElementsInstanced = (...a) => { window.__counts.dei++; return real.drawElementsInstanced(...a); };
  return true;
});
await p.waitForTimeout(3000);
const res = await p.evaluate(() => ({ ...window.__counts, fps: window.__mc.fps }));
console.log('3s counts', JSON.stringify(res));
// time breakdown
const timing = await p.evaluate(async () => {
  const g = window.__mc;
  const r = g.renderer;
  let renderMs = 0, frames = 0;
  const orig = r.render.bind(r);
  r.render = (...a) => { const t = performance.now(); const v = orig(...a); renderMs += performance.now() - t; frames++; return v; };
  await new Promise((res) => setTimeout(res, 3000));
  r.render = orig;
  return { avgRenderMs: (renderMs / frames).toFixed(2), frames, fps: g.fps };
});
console.log('render timing', JSON.stringify(timing));
await b.close();
