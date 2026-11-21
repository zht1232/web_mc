// Probe: run + jump on flat ground and prove the horizontal velocity is not reset by the
// collision solver (regression for the double-offset in Player.move). Also compiles the shader
// pipeline so a GLSL error in the shadow/wind changes shows up as a console error.
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';

const b = await chromium.launch(launchOptions());
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
const p = await ctx.newPage();
const errors = [];
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', (e) => errors.push(String(e)));

await p.goto('http://127.0.0.1:5174/?play&perf=0', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__mc?.running, null, { timeout: 120000 });
await p.waitForTimeout(5000);
await p.evaluate(() => { window.__mc.setShaders(true); window.__mc.setShaderQuality('high'); });
await p.waitForTimeout(2000);
await p.screenshot({ path: 'shots/_probe-runjump-0.png' });

// sample the player each 50 ms while running forward with a jump every ~700 ms
await p.evaluate(() => {
  window.__trace = [];
  window.__traceTimer = setInterval(() => {
    const pl = window.__mc.player;
    window.__trace.push({
      h: +Math.hypot(pl.vel.x, pl.vel.z).toFixed(3),
      x: +pl.pos.x.toFixed(2), y: +pl.pos.y.toFixed(2), z: +pl.pos.z.toFixed(2),
      g: pl.onGround, fly: pl.flying,
    });
  }, 50);
});
await p.keyboard.down('KeyW');
for (let i = 0; i < 10; i++) {
  await p.keyboard.press('Space');
  await p.waitForTimeout(700);
}
await p.keyboard.up('KeyW');
const trace = await p.evaluate(() => { clearInterval(window.__traceTimer); return window.__trace; });
const diag = await p.evaluate(() => window.__mc.perfDiagnostics());
await p.screenshot({ path: 'shots/_probe-runjump-1.png' });

const hs = trace.map((t) => t.h);
const sorted = [...hs].sort((a, b) => a - b);
const air = trace.filter((t) => !t.g);
const ground = trace.filter((t) => t.g);
// A reset is a sample below 0.05 that is followed by a healthy speed again while the player kept
// moving: a real wall stop ends the run instead of recovering in place.
const resets = [];
for (let i = 2; i < trace.length - 2; i++) {
  if (trace[i].h < 0.05 && trace[i + 1].h < 0.05 && hs[i - 1] > 0.15 && hs[i + 2] > 0.15) {
    resets.push(`${trace[i].x},${trace[i].y},${trace[i].z}@${i * 50}ms`);
  }
}
console.log(JSON.stringify({
  samples: trace.length,
  onGround: ground.length,
  air: air.length,
  hP50: sorted[Math.floor(sorted.length / 2)],
  hMax: sorted[sorted.length - 1],
  airHMin: air.length ? Math.min(...air.map((t) => t.h)) : null,
  resets: resets.slice(0, 8),
  resetCount: resets.length,
  diag,
  errors: errors.slice(0, 6),
}, null, 2));
await b.close();
