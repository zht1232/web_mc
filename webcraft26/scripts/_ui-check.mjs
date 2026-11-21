import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const page = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
await page.goto('http://127.0.0.1:5174/?play', { waitUntil: 'domcontentloaded', timeout: 120000 });
for (let i=0;i<480;i++){ if(await page.evaluate(()=>window.__mc?.level?.chunks?.size>80)) break; await page.waitForTimeout(250); }
await page.evaluate(()=>window.__mc.screens.open('inventory'));
await page.waitForTimeout(800);
await page.screenshot({ path: 'shots/ui-inventory-fixed.png' });
await page.evaluate(()=>window.__mc.screens.open('creative'));
await page.waitForTimeout(800);
await page.screenshot({ path: 'shots/ui-creative-fixed.png' });
await b.close();
