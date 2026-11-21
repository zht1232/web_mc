import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
const measure = async (label) => {
  await p.waitForTimeout(6000);
  const r = await p.evaluate(() => ({ fps: window.__mc.fps, shadow: { ...window.__mc.renderer.shadowStats }, sections: window.__mc.renderer.sections.size }));
  console.log(label, JSON.stringify(r));
};
await measure('default rd12');
await p.evaluate(() => { window.__mc.renderer.shadersEnabled = false; });
await measure('shaders off');
await p.evaluate(() => { window.__mc.renderer.shadersEnabled = true; window.__mc.renderer.renderDistance = 6; });
await measure('rd6 shaders on');
await p.evaluate(() => { window.__mc.renderer.renderDistance = 4; });
await measure('rd4');
await b.close();
