// Regression guard for the "settings page / idle HUD drops frames" class of bugs:
//   1. the HUD must not be rendered while a menu (pause/video settings) covers it;
//   2. an idle in-game HUD must not repaint when nothing visible changed;
//   3. a real state change (hotbar slot) must repaint exactly then.
// Run: node scripts/test-hud-dirty.mjs
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://127.0.0.1:5174/?play&perf=0', { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => !!window.__mc?.running, null, { timeout: 300000 });
await page.waitForTimeout(5000);

const countPaints = (ms) => page.evaluate((ms) => new Promise((res) => {
  const mc = window.__mc;
  const orig = mc.hud.render.bind(mc.hud);
  let paints = 0;
  mc.hud.render = (...a) => { paints++; return orig(...a); };
  const t0 = performance.now();
  const tick = () => {
    if (performance.now() - t0 < ms) requestAnimationFrame(tick);
    else { mc.hud.render = orig; res(paints); }
  };
  requestAnimationFrame(tick);
}), ms);

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

// 1. idle: no repaint
const idle = await countPaints(2000);
check('idle HUD does not repaint', idle === 0, `paints=${idle}/2s`);

// 2. pause + video settings: HUD must stay hidden (vanilla) and must not cost a paint
await page.evaluate(() => window.__mc.openScreen('pause'));
await page.waitForTimeout(300);
const pause = await countPaints(800);
await page.evaluate(() => window.__mc.screens.open('video'));
await page.waitForTimeout(300);
const video = await countPaints(800);
check('HUD is skipped behind the pause menu', pause === 0, `paints=${pause}`);
check('HUD is skipped behind video settings', video === 0, `paints=${video}`);

// 3. closing a menu must restore the HUD on the next frame
const afterClose = await page.evaluate(() => new Promise((res) => {
  const mc = window.__mc;
  const orig = mc.hud.render.bind(mc.hud);
  let paints = 0;
  mc.hud.render = (...a) => { paints++; return orig(...a); };
  mc.screens.close();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const n = paints;
    mc.hud.render = orig;
    res({ paints: n, valid: mc.hudValid });
  }));
}));
check('closing a menu repaints the HUD', afterClose.paints >= 1 && afterClose.valid === true,
  `paints=${afterClose.paints} valid=${afterClose.valid}`);

// 4. a real state change repaints once
const slot = await page.evaluate(() => new Promise((res) => {
  const mc = window.__mc;
  const orig = mc.hud.render.bind(mc.hud);
  let paints = 0;
  mc.hud.render = (...a) => { paints++; return orig(...a); };
  mc.selectedSlot = (mc.selectedSlot + 1) % 9;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const n = paints;
    mc.hud.render = orig;
    res(n);
  }));
}));
check('hotbar slot change repaints the HUD', slot >= 1 && slot <= 2, `paints=${slot}`);
check('no page errors', errors.length === 0, errors[0] ?? '');

const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
