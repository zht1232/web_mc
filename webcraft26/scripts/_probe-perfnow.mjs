import { chromium } from "playwright";
import { launchOptions } from "./lib/browser.mjs";
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on("console", (m) => { if (m.text().includes("[perf]")) console.log(m.text()); });
await p.goto("http://127.0.0.1:5174/?play", { waitUntil: "load" });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
// walk in a circle while sampling so the report has motion data
await p.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", bubbles: true })));
await p.waitForTimeout(6000);
await p.evaluate(() => { window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" })); window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" })); });
await p.waitForTimeout(3000);
await p.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD" })));
await p.waitForTimeout(22000);
await b.close();
