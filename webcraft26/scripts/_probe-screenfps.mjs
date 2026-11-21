import { chromium } from "playwright";
import { launchOptions } from "./lib/browser.mjs";
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1699, height: 901 }, deviceScaleFactor: 1.5 })).newPage();
await p.goto("http://127.0.0.1:5174/?play&perf=0", { waitUntil: "load" });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(7000);
await p.evaluate(() => { window.__mc.setShaders(true); window.__mc.setShaderQuality("high"); });
await p.waitForTimeout(1200);
const measure = (label) => p.evaluate((label) => new Promise((res) => {
  const g = window.__mc;
  const orig = g.screens.render.bind(g.screens);
  const times = [];
  g.screens.render = (partial) => { const t = performance.now(); orig(partial); times.push(performance.now() - t); };
  let n = 0; const t0 = performance.now();
  const loop = () => {
    if (++n < 90) requestAnimationFrame(loop);
    else {
      g.screens.render = orig;
      const s = times.sort((a, b) => a - b);
      res({ label, fps: +(n * 1000 / (performance.now() - t0)).toFixed(1), screensP50: +s[Math.floor(s.length/2)].toFixed(2), screensMax: +s[s.length-1].toFixed(2) });
    }
  };
  requestAnimationFrame(loop);
}), label);
console.log(await measure("field"));
await p.evaluate(() => window.__mc.openScreen("inventory"));
await p.waitForTimeout(700);
console.log(await measure("inventory"));
await p.evaluate(() => window.__mc.openScreen("creative"));
await p.waitForTimeout(900);
console.log(await measure("creative"));
await p.evaluate(() => window.__mc.closeScreen());
await p.waitForTimeout(700);
console.log(await measure("closed"));
await b.close();
