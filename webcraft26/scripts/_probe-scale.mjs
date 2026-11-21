import { chromium } from "playwright";
import { launchOptions } from "./lib/browser.mjs";
const b = await chromium.launch(launchOptions());
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await p.goto("http://127.0.0.1:5174/?play&perf=0", { waitUntil: "load" });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(5500);
await p.evaluate(() => { window.__mc.setShaders(true); window.__mc.setShaderQuality("high"); });
await p.waitForTimeout(1500);
await p.screenshot({ path: "shots/_probe-scale-100.png" });
await p.evaluate(() => window.__mc.setRenderScale(0.5));
await p.waitForTimeout(800);
await p.screenshot({ path: "shots/_probe-scale-50.png" });
const st = await p.evaluate(() => ({
  canvas: [window.__mc.glCanvas.width, window.__mc.glCanvas.height],
  target: window.__mc.perfDiagnostics().renderTargets,
  glError: window.__mc.renderer.post.stats.lastGlError,
  diag: window.__mc.perfDiagnostics(),
}));
await p.setViewportSize({ width: 1000, height: 700 });
await p.waitForTimeout(900);
await p.screenshot({ path: "shots/_probe-resize.png" });
const st2 = await p.evaluate(() => ({ diag: window.__mc.perfDiagnostics(), glError: window.__mc.renderer.post.stats.lastGlError }));
console.log(JSON.stringify({ st, st2, errors: errors.slice(0, 8) }, null, 2));
await b.close();
