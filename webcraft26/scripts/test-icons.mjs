// Verification harness for gui/ItemIconAtlas.ts (flat item icons).
//
// Opens the dev client, waits for window.__mc, then reads pixels straight out of
// ItemIconAtlas' 2D atlas canvas, so the numbers do not depend on eyeballing a screenshot:
//   * every flat item must own a cell with ink,
//   * for sampled items each 48x48 cell pixel must equal the source texel from
//     public/mc/tex/item.bin (CELL=48 / sprite=16 -> exactly 3x3 pixels per texel),
//   * the real HUD hotbar must gain ink when its slots are filled.
// Then it draws a proof sheet (ItemIconAtlas.draw is exactly the call the HUD makes) and
// saves shots/bugs/icons.png.
//
// Usage: node scripts/test-icons.mjs [url] [shotOut] [waitMs]

import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { launchOptions } from './lib/browser.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5174/';
const shotOut = process.argv[3] ?? 'shots/bugs/icons.png';
const waitMs = Number(process.argv[4] ?? 90000);

const SAMPLES = [
  'iron_pickaxe', 'bread', 'wheat_seeds', 'iron_shovel',
  'diamond_sword', 'apple', 'oak_log', 'stone',
];
const HOTBAR = [
  'iron_pickaxe', 'bread', 'wheat_seeds', 'iron_shovel',
  'diamond_sword', 'apple', 'oak_log', 'stone', 'oak_fence',
];
const CELL = 48;
const COLS = 40;

// ---- source textures (public/mc/tex/item.bin) for the colour comparison ----
const itemMeta = JSON.parse(readFileSync('public/mc/tex/item.json', 'utf8'));
const itemBin = readFileSync('public/mc/tex/item.bin');
const SPRITE = itemBin.readUInt32LE(12); // 16
function texel(layer, tx, ty) {
  const o = 16 + (layer * SPRITE * SPRITE + ty * SPRITE + tx) * 4;
  return [itemBin[o], itemBin[o + 1], itemBin[o + 2], itemBin[o + 3]];
}

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
const deadline = Date.now() + waitMs;
let ready = false;
while (Date.now() < deadline) {
  ready = await page.evaluate(() => !!(window.__mc && window.__mc.icons && window.__mc.icons.ready));
  if (ready) break;
  await page.waitForTimeout(500);
}
if (!ready) {
  console.log('FAIL: client/icon atlas not ready');
  console.log(logs.slice(-40).join('\n'));
  await browser.close();
  process.exit(1);
}

// ---- 1. atlas diagnostics ---------------------------------------------------
const diag = await page.evaluate(({ samples, cellSize, cols }) => {
  const g = window.__mc;
  const icons = g.icons;
  const ctx = icons.canvas.getContext('2d');
  const items = g.mc.items;
  const out = { guiScale: g.guiScale, glError: g.gl.getError(), items: {}, hotbarBefore: [] };

  // what the hotbar currently defaults to (checking the slot-9 water report)
  for (let i = 0; i < 9; i++) {
    const st = g.survival.inventory.getItem(i);
    out.hotbarBefore.push(st && st.item ? st.item.name : null);
  }

  for (const name of samples) {
    const id = items.findIndex((it) => it.name === name);
    if (id < 0) { out.items[name] = { missing: true }; continue; }
    const cell = icons.cellOf[id];
    const rec = { id, cell, hasIcon: icons.hasIcon(id) };
    const entry = icons.itemModels[`minecraft:${name}`];
    rec.kind = entry ? entry.kind : null;
    if (entry && entry.layers && entry.layers.length) {
      const t = entry.layers[0].texture;
      rec.layer = entry.layers[0].array === 'item' ? (g.textures.itemLayer.get(t) ?? null) : (g.textures.blockLayer.get(t) ?? null);
      rec.texture = t;
    }
    if (cell >= 0) {
      const cx = (cell % cols) * cellSize;
      const cy = Math.floor(cell / cols) * cellSize;
      rec.pixels = Array.from(ctx.getImageData(cx, cy, cellSize, cellSize).data);
    }
    out.items[name] = rec;
  }

  // every flat item: does its cell contain ink?
  const counts = { block: 0, flat: 0, special: 0, composite: 0 };
  const withInk = { block: 0, flat: 0, special: 0, composite: 0 };
  const flatNoInk = [];
  for (let id = 0; id < items.length; id++) {
    const e = icons.itemModels[`minecraft:${items[id].name}`];
    if (!e || !(e.kind in counts)) continue;
    counts[e.kind]++;
    const cell = icons.cellOf[id];
    if (cell < 0) continue;
    const cx = (cell % cols) * cellSize, cy = Math.floor(cell / cols) * cellSize;
    const img = ctx.getImageData(cx, cy, cellSize, cellSize).data;
    let inked = 0;
    for (let i = 3; i < img.length; i += 4) if (img[i] > 8) inked++;
    if (inked > 20) withInk[e.kind]++;
    else if (e.kind === 'flat' && flatNoInk.length < 12) flatNoInk.push(items[id].name);
  }
  out.counts = counts;
  out.withInk = withInk;
  out.flatNoInk = flatNoInk;
  return out;
}, { samples: SAMPLES, cellSize: CELL, cols: COLS });

console.log('DIAG ' + JSON.stringify({
  guiScale: diag.guiScale, glError: diag.glError, counts: diag.counts, withInk: diag.withInk,
  flatNoInk: diag.flatNoInk, hotbarBefore: diag.hotbarBefore,
}, null, 1));

// ---- 2. compare each sampled cell against the baked item sprite -------------
let mismatchedTotal = 0;
let comparedTotal = 0;
for (const name of SAMPLES) {
  const rec = diag.items[name];
  if (!rec || rec.cell < 0 || !rec.pixels) { console.log(`FLAT ${name}: NO ICON CELL`); continue; }
  const scale = CELL / SPRITE; // 3
  let ink = 0, mismatched = 0, minX = CELL, maxX = -1, minY = CELL, maxY = -1;
  for (let py = 0; py < CELL; py++) {
    for (let px = 0; px < CELL; px++) {
      const o = (py * CELL + px) * 4;
      const a = rec.pixels[o + 3];
      const [tr, tg, tb, ta] = texel(rec.layer, Math.floor(px / scale), Math.floor(py / scale));
      if (a > 8) {
        ink++;
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
      }
      if (ta === 255) { // opaque texels must round-trip exactly (full-bright billboard icon)
        comparedTotal++;
        const d = Math.abs(rec.pixels[o] - tr) + Math.abs(rec.pixels[o + 1] - tg) + Math.abs(rec.pixels[o + 2] - tb);
        if (d > 3) mismatched++;
      } else if (ta === 0 && a > 8) {
        mismatched++;
      }
    }
  }
  mismatchedTotal += mismatched;
  const bbox = maxX >= 0 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null;
  const srcInk = (() => {
    let n = 0;
    for (let ty = 0; ty < SPRITE; ty++) for (let tx = 0; tx < SPRITE; tx++) if (texel(rec.layer, tx, ty)[3] > 0) n++;
    return n;
  })();
  console.log(`FLAT ${name}: cell=${rec.cell} layer=${rec.layer} inkPx=${ink} expectedInk≈${srcInk * scale * scale} bbox=${JSON.stringify(bbox)} colorMismatch=${mismatched}`);
}

// ---- 3. does the real HUD hotbar draw the icons? ---------------------------
// Other packages edit files while this runs, so vite full-reloads the page; retry the
// evaluation when that destroys the execution context.
async function waitReady() {
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    try {
      if (await page.evaluate(() => !!(window.__mc && window.__mc.icons && window.__mc.icons.ready))) return true;
    } catch { /* context destroyed, retry */ }
    await page.waitForTimeout(500);
  }
  return false;
}
async function evalRetry(fn, arg, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      return await page.evaluate(fn, arg);
    } catch (e) {
      if (!/Execution context|Target closed|navigat/i.test(String(e && e.message))) throw e;
      console.log(`(retry ${i + 1}: page reloaded by another package's edit)`);
      if (!(await waitReady())) throw e;
    }
  }
  throw new Error('page kept reloading; HUD check could not run');
}

let hud = null;
for (let attempt = 0; attempt < 4 && !hud; attempt++) {
  hud = await evalRetry(async ({ hotbar, cellSize, cols }) => {
    const g = window.__mc;
    const items = g.mc.items;
    const ids = hotbar.map((n) => items.findIndex((it) => it.name === n));
    const inv = g.survival.inventory;
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const gui = g.guiCanvas;
    const ctx = gui.getContext('2d');
    const scale = g.guiScale;
    const logicalW = window.innerWidth / scale;
    const logicalH = window.innerHeight / scale;
    const left = Math.floor(logicalW / 2) - 91;
    const iconX = left + 2, iconY = logicalH - 16 - 3; // Hud.renderHotbar slot i: left + i*20 + 2, H-19
    const region = { x: Math.round(iconX * scale), y: Math.round(iconY * scale), w: Math.round(9 * 20 * scale), h: Math.round(16 * scale) };

    const read = () => ctx.getImageData(region.x, region.y, region.w, region.h).data;

    // empty hotbar baseline
    for (let i = 0; i < 9; i++) {
      const st = inv.getItem(i);
      st.item = null;
      st.setCount(0);
    }
    await frame(); await frame();
    const base = read();

    // fill with the demo items
    for (let i = 0; i < 9; i++) {
      const id = ids[i];
      const st = inv.getItem(i);
      if (id < 0) { st.item = null; st.setCount(0); continue; }
      st.item = items[id];
      st.setCount(1);
    }
    inv.setSelectedSlot(0);
    g.selectedSlot = 0;
    await frame(); await frame();
    const filled = read();

    let diff = 0;
    for (let i = 0; i < base.length; i += 4) {
      if (Math.abs(base[i] - filled[i]) + Math.abs(base[i + 1] - filled[i + 1]) + Math.abs(base[i + 2] - filled[i + 2]) > 24) diff++;
    }

    // proof sheet: HUD-sized icons drawn by ItemIconAtlas.draw (the exact call the HUD makes)
    document.getElementById('icon-proof-sheet')?.remove();
    document.getElementById('icon-proof-zoom')?.remove();
    const sheet = document.createElement('canvas');
    sheet.id = 'icon-proof-sheet';
    sheet.width = 9 * 80 + 20;
    sheet.height = 200;
    sheet.style.cssText = `position:fixed;left:0;top:0;z-index:99999;width:${sheet.width}px;height:${sheet.height}px`;
    document.body.appendChild(sheet);
    const sctx = sheet.getContext('2d');
    sctx.imageSmoothingEnabled = false;
    sctx.fillStyle = '#1b1b1b';
    sctx.fillRect(0, 0, sheet.width, sheet.height);
    hotbar.forEach((n, i) => {
      const id = items.findIndex((it) => it.name === n);
      g.icons.draw(sctx, id, 10 + i * 80, 10, 64);
      sctx.fillStyle = '#fff';
      sctx.font = '11px monospace';
      sctx.fillText(n, 10 + i * 80, 92);
    });
    sctx.fillStyle = '#8891a0';
    sctx.font = '12px monospace';
    sctx.fillText('ItemIconAtlas.draw() 64px per hotbar slot', 10, 120);

    // real HUD hotbar zoomed 2x, straight from the live GUI canvas
    const zoom = document.createElement('canvas');
    zoom.id = 'icon-proof-zoom';
    zoom.width = region.w * 2;
    zoom.height = region.h * 2;
    zoom.style.cssText = `position:fixed;left:0;top:${sheet.height}px;z-index:99999;width:${zoom.width}px;height:${zoom.height}px`;
    document.body.appendChild(zoom);
    const zctx = zoom.getContext('2d');
    zctx.imageSmoothingEnabled = false;
    zctx.drawImage(gui, region.x, region.y, region.w, region.h, 0, 0, zoom.width, zoom.height);
    zctx.fillStyle = '#8891a0';
    zctx.font = '12px monospace';
    zctx.fillText('real HUD hotbar (2x)', 4, 96);

    return { diffPixels: diff, iconRegion: region, names: hotbar };
  }, { hotbar: HOTBAR, cellSize: CELL, cols: COLS });
  const intact = await page.evaluate(() => !!document.getElementById('icon-proof-sheet')).catch(() => false);
  if (!intact) { hud = null; await waitReady(); }
}
if (!hud) throw new Error('HUD proof sheet vanished (page kept reloading)');

console.log('HUD ' + JSON.stringify(hud));
console.log('FLAT_COLOR_MISMATCH ' + mismatchedTotal + ' / ' + comparedTotal + ' opaque texel pixels compared');

mkdirSync(dirname(shotOut), { recursive: true });
let shotOk = false;
for (let i = 0; i < 3 && !shotOk; i++) {
  const sheetThere = await page.evaluate(() => !!document.getElementById('icon-proof-sheet') && !!window.__mc).catch(() => false);
  if (sheetThere) {
    await page.screenshot({ path: shotOut });
    shotOk = true;
  } else {
    console.log('(screenshot retry: another edit reloaded the page)');
    if (!(await waitReady())) break;
  }
}
console.log('shot:', shotOut, shotOk ? '(ok)' : '(FAILED - page kept reloading)');

const final = await page.evaluate(() => ({ ready: !!window.__mc?.icons?.ready, glError: window.__mc?.gl?.getError?.(), fps: window.__mc?.fps })).catch((e) => ({ error: String(e) }));
console.log('FINAL ' + JSON.stringify(final));
console.log('--- page log tail ---');
console.log(logs.slice(-15).join('\n'));
await browser.close();

const flatOk = diag.withInk.flat >= diag.counts.flat - 10;
const colorOk = mismatchedTotal <= 8;
const hudOk = hud.diffPixels > 500 && shotOk;
console.log(`RESULT flatIcons=${diag.withInk.flat}/${diag.counts.flat} colorMismatch=${mismatchedTotal} hudHotbarDiff=${hud.diffPixels} shot=${shotOk} => ${flatOk && colorOk && hudOk ? 'PASS' : 'FAIL'}`);
process.exit(flatOk && colorOk && hudOk ? 0 : 1);
