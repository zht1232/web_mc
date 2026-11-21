import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shots/diag');
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log('ERR', String(e).slice(0, 200)));
p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 160)); });
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(12000);
await p.evaluate(() => {
  const g = window.__mc;
  g.level.time = 6000; // noon
  g.player.pitch = 26;
  g.player.yaw = 40;
});
await p.waitForTimeout(2500);
await p.screenshot({ path: path.join(out, 'shadow-noon.png') });
await p.evaluate(() => { window.__mc.player.pitch = 48; });
await p.waitForTimeout(1200);
await p.screenshot({ path: path.join(out, 'shadow-ground.png') });
console.log(JSON.stringify(await p.evaluate(() => ({
  shadow: { ...window.__mc.renderer.shadowStats },
  gl: window.__mc.gl.getError(),
}))));
await b.close();
