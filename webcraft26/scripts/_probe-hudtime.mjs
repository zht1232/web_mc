import { chromium } from "playwright";
import { launchOptions } from "./lib/browser.mjs";
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1699, height: 901 }, deviceScaleFactor: 1.5 })).newPage();
await p.goto("http://127.0.0.1:5174/?play&perf=0", { waitUntil: "load" });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(7000);
await p.evaluate(() => { window.__mc.setShaders(true); window.__mc.setShaderQuality("high"); });
await p.waitForTimeout(1500);
const measure = async (label) => {
  const r = await p.evaluate(() => new Promise((res) => {
    const g = window.__mc;
    const orig = g.renderHud.bind(g);
    const times = [];
    g.renderHud = () => { const t = performance.now(); orig(); times.push(performance.now() - t); };
    let n = 0; const t0 = performance.now();
    const loop = () => {
      if (++n < 90) requestAnimationFrame(loop);
      else {
        g.renderHud = orig;
        const s = times.sort((a, b) => a - b);
        res({ hudP50: +(s[Math.floor(s.length / 2)] ?? 0).toFixed(2), hudMax: +(s[s.length - 1] ?? 0).toFixed(2), fps: +(n * 1000 / (performance.now() - t0)).toFixed(1) });
      }
    };
    requestAnimationFrame(loop);
  }));
  console.log(label, JSON.stringify(r));
};
await measure("no-f3");
await p.keyboard.press("F3");
await p.waitForTimeout(600);
await measure("f3");
await p.keyboard.press("F3");
await p.waitForTimeout(600);
await measure("f3-off");
console.log("showDebug", await p.evaluate(() => window.__mc.showDebug));
await b.close();
