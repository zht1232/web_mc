import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('console', (m) => console.log('CONSOLE', m.type(), m.text().slice(0, 200)));
p.on('response', (r) => { if (r.url().includes('/lang/')) console.log('RESP', r.status(), r.url()); });
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(1500);
const info = await p.evaluate(async () => {
  const i18n = window.__mc.screens.env?.i18n;
  const mod = await import('/src/client/gui/Language.ts');
  const d = mod.DEFAULT_I18N;
  return {
    optLang: window.__mc.options.language,
    code: d.code,
    tableSize: Object.keys(d.table ?? {}).length,
    enSize: Object.keys(d.enTable ?? {}).length,
    craft: d.get('container.crafting'),
    menuOpt: d.get('menu.options'),
    stone: d.get('block.minecraft.stone'),
  };
});
console.log(JSON.stringify(info));
await b.close();
