import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 800, height: 600 } })).newPage();
p.on('pageerror', (e) => console.log('ERR', String(e).slice(0, 300)));
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(4000);
console.log(JSON.stringify(await p.evaluate(() => {
  const d = window.__mc.entityRenderer;
  const renderer = d.renderers?.get?.('player');
  return {
    canRender: d.canRender('player'),
    hasRenderer: !!renderer,
    texKey: renderer?.getTextureKey?.(),
    texId: renderer ? d.texIdByKey.get(renderer.getTextureKey()) : null,
    texLoaded: renderer ? !!d.textures[d.texIdByKey.get(renderer.getTextureKey())] : null,
    keys: [...d.texIdByKey.keys()].filter((k) => k.includes('player')),
  };
})));
await b.close();
