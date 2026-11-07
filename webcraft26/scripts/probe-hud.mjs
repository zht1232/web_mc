// one-off probe: why does the real HUD hotbar not draw item icons?
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errs = [];
const logs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
await page.goto('http://127.0.0.1:5174/', { waitUntil: 'domcontentloaded', timeout: 60000 });
// Poll exactly like scripts/shot.mjs does (other packages' edits trigger vite full reloads).
let ready = false;
const deadline = Date.now() + 180000;
while (Date.now() < deadline && !ready) {
  try {
    ready = await page.evaluate(() => !!(window.__mc && window.__mc.icons && window.__mc.icons.ready));
  } catch { /* context destroyed by reload */ }
  if (!ready) await page.waitForTimeout(1000);
}
if (!ready) {
  const status = await page.evaluate(() => document.getElementById('loading-status')?.textContent).catch(() => '?');
  console.log('PROBE FAILED: client never became ready; status =', status);
  console.log('pageerrors:', errs.slice(0, 6));
  await browser.close();
  process.exit(1);
}

const out = await page.evaluate(async ({ hotbar }) => {
  const g = window.__mc;
  const items = g.mc.items;
  const inv = g.survival.inventory;
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const ids = hotbar.map((n) => items.findIndex((it) => it.name === n));
  // fill
  for (let i = 0; i < 9; i++) {
    const st = inv.getItem(i);
    st.item = items[ids[i]];
    st.setCount(1);
  }
  inv.setSelectedSlot(0);
  g.selectedSlot = 0;
  await frame(); await frame();

  // count how often the HUD calls icons.draw
  let calls = 0;
  const orig = g.icons.draw.bind(g.icons);
  g.icons.draw = (...a) => { calls++; return orig(...a); };
  await frame(); await frame(); await frame();
  g.icons.draw = orig;

  const stacks = g.survival.hotbarStacks().map((s) => [s.item ? s.item.name : null, s.getCount()]);
  const hud = g.hud;

  // is the GUI canvas showing a hotbar background at all? sample the slot-0 icon rect
  const scale = g.guiScale;
  const logicalW = window.innerWidth / scale, logicalH = window.innerHeight / scale;
  const left = Math.floor(logicalW / 2) - 91;
  const region = { x: Math.round((left + 2) * scale), y: Math.round((logicalH - 19) * scale), w: 20 * scale, h: 16 * scale };
  const px = g.guiCanvas.getContext('2d').getImageData(region.x, region.y, region.w, region.h).data;
  let ink = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] > 0) ink++;
  // also count hud.render invocations per frame
  let hudCalls = 0;
  const origRender = hud.render.bind(hud);
  hud.render = (...a) => { hudCalls++; return origRender(...a); };
  await frame(); await frame(); await frame();
  hud.render = origRender;

  return {
    callsPerFrame: calls / 3,
    hudRenderPerFrame: hudCalls / 3,
    guiSlotInk: ink,
    stacks,
    hudType: hud && hud.constructor && hud.constructor.name,
    screensActive: g.screens?.active ? g.screens.active.constructor?.name : String(g.screens?.active),
    guiScale: g.guiScale,
    guiCanvas: [g.guiCanvas.width, g.guiCanvas.height],
    selectedSlot: g.survival.inventory.getSelectedSlot(),
  };
}, { hotbar: ['iron_pickaxe', 'bread', 'wheat_seeds', 'iron_shovel', 'diamond_sword', 'apple', 'oak_log', 'stone', 'oak_fence'] });

console.log('PROBE ' + JSON.stringify(out, null, 1));
console.log('pageerrors:', errs.slice(0, 6));
console.log('console errors/warnings:', logs.filter((l) => l.includes('error')).slice(0, 6));
await browser.close();
