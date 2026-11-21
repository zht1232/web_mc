import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await p.goto('http://127.0.0.1:5174/', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.screens, null, { timeout: 120000 });
await p.waitForTimeout(1200);
const info = await p.evaluate(() => {
  const f = window.__mc.screens.deps.font;
  const s = '代码 © CrystalKingdom · 材质 © Mojang · 保留原作者权利 · 禁止二次分发';
  const c = document.createElement('canvas').getContext('2d');
  c.font = '8px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
  const m = c.measureText(s);
  return { width: f.width(s), chars: [...s].length, canvasWidth: m.width, ascii: f.width('Building Blocks'), cjk: f.width('合成') };
});
console.log(JSON.stringify(info));
await b.close();
