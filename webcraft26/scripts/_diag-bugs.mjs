import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const page = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:5174/?play', { waitUntil: 'domcontentloaded', timeout: 120000 });
for (let i = 0; i < 480; i++) { if (await page.evaluate(() => window.__mc?.level?.chunks?.size > 80)) break; await page.waitForTimeout(250); }
await page.waitForTimeout(2500);
const info = await page.evaluate(() => ({
  dpr: devicePixelRatio, guiScale: window.__mc.guiScale,
  gl: [window.__mc.glCanvas.width, window.__mc.glCanvas.height],
  gui: [window.__mc.guiCanvas.width, window.__mc.guiCanvas.height],
  chunks: window.__mc.level.chunks.size,
  rd: window.__mc.renderer.renderDistance,
  quality: window.__mc.renderer.shaderQuality,
  shaders: window.__mc.renderer.shadersEnabled,
}));
console.log('INFO', JSON.stringify(info));
const fps = await page.evaluate(() => new Promise(res => {
  let n = 0; const t0 = performance.now();
  function loop() { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(loop); else res(+(n / 3).toFixed(1)); }
  requestAnimationFrame(loop);
}));
console.log('FPS standing', fps);
await page.screenshot({ path: 'shots/diag-ingame.png' });
await page.evaluate(() => window.__mc.screens.open('creative'));
await page.waitForTimeout(700);
await page.screenshot({ path: 'shots/diag-creative.png' });
const fpsGui = await page.evaluate(() => new Promise(res => {
  let n = 0; const t0 = performance.now();
  function loop() { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(loop); else res(+(n / 2).toFixed(1)); }
  requestAnimationFrame(loop);
}));
console.log('FPS creative-open', fpsGui);
await b.close();