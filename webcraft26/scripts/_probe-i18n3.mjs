import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
const info = await p.evaluate(async () => {
  const out = {};
  try {
    const r = await fetch('/mc/lang/zh_cn.json');
    out.status = r.status;
    out.type = r.headers.get('content-type');
    const text = await r.text();
    out.len = text.length;
    out.head = text.slice(0, 40);
    try { const j = JSON.parse(text); out.keys = Object.keys(j).length; out.craft = j['container.crafting']; }
    catch (e) { out.parseError = String(e).slice(0, 120); }
  } catch (e) { out.fetchError = String(e).slice(0, 120); }
  return out;
});
console.log(JSON.stringify(info));
await b.close();
