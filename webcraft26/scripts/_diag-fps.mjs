import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const page = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:5174/?play', { waitUntil: 'domcontentloaded', timeout: 120000 });
for (let i = 0; i < 480; i++) { if (await page.evaluate(() => window.__mc?.level?.chunks?.size > 120)) break; await page.waitForTimeout(250); }
await page.waitForTimeout(4000);
const measure = () => page.evaluate(() => new Promise(res => {
  let n = 0; const t0 = performance.now();
  function loop() { n++; if (performance.now() - t0 < 2500) requestAnimationFrame(loop); else res(+(n / 2.5).toFixed(1)); }
  requestAnimationFrame(loop);
}));
const stats = () => page.evaluate(() => ({
  shadow: window.__mc.renderer.shadowStats,
  mesh: window.__mc.renderer.meshStats,
}));
console.log('high+shadows', await measure(), JSON.stringify(await stats()));
await page.evaluate(() => { window.__mc.renderer.post.shadowsEnabled = false; });
await page.waitForTimeout(400);
console.log('high no-shadow', await measure());
await page.evaluate(() => { window.__mc.renderer.post.shadowsEnabled = true; window.__mc.setShaders(false); });
await page.waitForTimeout(400);
console.log('shaders off', await measure());
await page.evaluate(() => { window.__mc.setShaders(true); window.__mc.setShaderQuality('low'); });
await page.waitForTimeout(400);
console.log('low', await measure(), JSON.stringify(await stats()));
await page.evaluate(() => { window.__mc.setShaderQuality('medium'); });
await page.waitForTimeout(400);
console.log('medium', await measure());
await b.close();