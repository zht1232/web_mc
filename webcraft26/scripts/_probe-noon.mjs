import { chromium } from "playwright";
import { launchOptions } from "./lib/browser.mjs";
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
await p.goto("http://127.0.0.1:5174/?play&perf=0", { waitUntil: "load" });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(7000);
await p.evaluate(() => {
  window.__mc.setShaders(true); window.__mc.setShaderQuality("high");
  window.__mc.level.time = 6000; // noon
  window.__mc.player.pitch = 12; window.__mc.player.yaw = 28.6;
});
await p.waitForTimeout(1500);
await p.screenshot({ path: "shots/_fix2-noon.png" });
await p.evaluate(() => window.__mc.setShaders(false));
await p.waitForTimeout(1200);
await p.screenshot({ path: "shots/_fix2-noon-off.png" });
console.log("ok");
await b.close();
