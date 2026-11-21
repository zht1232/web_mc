import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
const b = await chromium.launch(launchOptions());
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('[err]', e.message));
await p.goto('http://127.0.0.1:5174/?play', { waitUntil: 'domcontentloaded', timeout: 120000 });
for(let i=0;i<600;i++){if(await p.evaluate(()=>window.__mc?.level?.chunks?.size>80))break;await p.waitForTimeout(250);}
console.log(await p.evaluate(()=>({scale:window.__mc.guiScale, w:window.__mc.guiCanvas.width, h:window.__mc.guiCanvas.height, dpr:devicePixelRatio})));
await p.screenshot({path:'shots/mobile-ingame-new.png'});
await p.evaluate(()=>window.__mc.screens.open('inventory'));
await p.waitForTimeout(800);
await p.screenshot({path:'shots/mobile-inventory-new.png'});
await b.close();
