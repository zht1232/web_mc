import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(2500);
const info = await p.evaluate(() => {
  const s = window.__mc.screens;
  const i = s.i18n;
  return {
    code: i?.code,
    tSize: Object.keys(i?.table ?? {}).length,
    enSize: Object.keys(i?.enTable ?? {}).length,
    craft: i?.get('container.crafting'),
    envCraft: s.env.t('container.crafting'),
    optLang: window.__mc.options.language,
  };
});
console.log(JSON.stringify(info));
await b.close();
