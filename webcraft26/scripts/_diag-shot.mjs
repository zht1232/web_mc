import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(root, '../shots/diag');
const b = await chromium.launch(launchOptions());
async function shot(name, dpr, w, h, action) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
  await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
  await p.waitForTimeout(2500);
  if (action) await action(p);
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(out, name + '.png') });
  const info = await p.evaluate(() => ({
    dpr: window.devicePixelRatio,
    css: [innerWidth, innerHeight],
    gui: window.__mc.guiScale,
    cw: document.querySelector('.gui-canvas').width,
    glw: document.querySelector('.game-canvas').width,
    fps: Math.round(window.__mc.fps ?? 0),
  }));
  console.log(name, JSON.stringify(info), errs.length ? 'ERRORS:' + errs.join('|') : '');
  await ctx.close();
}
await shot('inventory-1920-dpr1', 1, 1920, 1080, async (p) => { await p.keyboard.press('KeyE'); });
await shot('inventory-1920-dpr125', 1.25, 1920, 1080, async (p) => { await p.keyboard.press('KeyE'); });
await shot('world-1920-dpr125', 1.25, 1920, 1080);
await shot('inventory-mobile', 2, 430, 900, async (p) => { await p.evaluate(() => window.__mc.screens.open('inventory')); });
await b.close();
