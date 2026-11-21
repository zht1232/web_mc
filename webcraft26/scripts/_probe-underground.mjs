import { chromium } from "playwright";
import { launchOptions } from "./lib/browser.mjs";
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto("http://127.0.0.1:5174/?play&perf=0", { waitUntil: "load" });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(6000);
await p.evaluate(() => { window.__mc.setShaders(true); window.__mc.setShaderQuality("high"); });
await p.waitForTimeout(1200);
// look straight ahead then bury the camera
await p.evaluate(() => { const g = window.__mc; g.player.pitch = 0; g.player.yaw = 28.6; g.player.pos.y = 60; g.player.vel.y = 0; });
await p.waitForTimeout(1200);
console.log("buried", await p.evaluate(() => window.__mc.perfDiagnostics()));
await p.screenshot({ path: "shots/_probe-underground.png" });
// come back to the surface
await p.evaluate(() => { const g = window.__mc; g.player.pos.y = 85; g.player.vel.y = 0; });
await p.waitForTimeout(1200);
console.log("surface", await p.evaluate(() => window.__mc.perfDiagnostics()));
await p.screenshot({ path: "shots/_probe-surface.png" });
console.log("errors", errors.slice(0, 5));
await b.close();
