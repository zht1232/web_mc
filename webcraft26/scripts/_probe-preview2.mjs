import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 800, height: 600 } })).newPage();
p.on('pageerror', (e) => console.log('ERR', String(e).slice(0, 300)));
p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(4000);
const info = await p.evaluate(() => {
  const g = window.__mc;
  const cv = g.entityRenderer.renderPreview(g.player.pos, g.level, 120, 0.3);
  if (!cv) return { canvas: false };
  const ctx = cv.getContext('2d');
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let opaque = 0, sample = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 10) { opaque++; if (sample.length < 6) sample.push([d[i], d[i+1], d[i+2], d[i+3]]); }
  return { canvas: true, w: cv.width, h: cv.height, opaque, total: d.length / 4, sample, gl: g.gl.getError() };
});
console.log(JSON.stringify(info));
await b.close();
