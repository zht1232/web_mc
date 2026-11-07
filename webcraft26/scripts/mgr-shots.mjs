// Multi-shot harness: loads the game once, then for each step runs an eval and takes a screenshot.
//   node scripts/mgr-shots.mjs <outDir> <steps.json> [url]
// steps.json: [{ "name": "night-level", "eval": "(()=>{...})()", "wait": 1500 }, ...]
// Collects console errors/warnings (de-duplicated) so GL problems are visible.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { launchOptions } from './lib/browser.mjs';

const outDir = path.resolve(process.argv[2] ?? 'shots/_mgr');
const steps = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const url = process.argv[4] ?? 'http://127.0.0.1:5174/?play&workers=4';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const seen = new Map();
const note = (k) => seen.set(k, (seen.get(k) ?? 0) + 1);
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') note(`[${m.type()}] ${m.text().slice(0, 220)}`); });
page.on('pageerror', (e) => note(`[pageerror] ${e.message.slice(0, 220)}`));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
const t0 = Date.now();
while (Date.now() - t0 < 120000) {
  const s = await page.evaluate(() => (window.__mc ? 'ready' : (document.getElementById('loading-status')?.textContent ?? '')));
  if (s === 'ready') break;
  if (String(s).startsWith('Load failed')) { console.log('LOAD FAILED', s); break; }
  await page.waitForTimeout(500);
}
await page.waitForTimeout(6000); // let chunks stream in

for (const step of steps) {
  if (step.eval) {
    try {
      const r = await page.evaluate(step.eval);
      if (r !== undefined && r !== null && r !== 'ok') console.log(`${step.name} eval:`, JSON.stringify(r).slice(0, 400));
    } catch (e) { console.log(`${step.name} eval FAILED:`, e.message.slice(0, 200)); }
  }
  await page.waitForTimeout(step.wait ?? 2000);
  await page.screenshot({ path: path.join(outDir, `${step.name}.png`) });
  console.log('shot', step.name);
}
console.log('--- console (deduped) ---');
for (const [k, v] of seen) console.log(`${v}x ${k}`);
await browser.close();
