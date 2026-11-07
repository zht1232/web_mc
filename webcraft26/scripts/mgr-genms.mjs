import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const workers = process.argv[2] ?? '4';
const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://127.0.0.1:5174/?workers=${workers}`, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 300; i++) { if (await page.evaluate(() => !!window.__mc)) break; await page.waitForTimeout(300); }
const s = [];
for (let i = 0; i < 40; i++) { await page.waitForTimeout(500); s.push(await page.evaluate(() => ({ g: window.__mc.chunkProvider.lastGenMs, n: window.__mc.chunkProvider.generatedCount }))); }
const gens = s.map((x) => x.g).filter(Boolean);
console.log('workers', workers, 'lastGenMs samples:', gens.map((v) => Math.round(v)).join(','));
console.log('avg', (gens.reduce((a, b) => a + b, 0) / gens.length).toFixed(0), 'ms; chunks generated in 20s:', s[s.length - 1].n - s[0].n);
await browser.close();
