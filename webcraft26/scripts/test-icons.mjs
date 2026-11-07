// Verification harness for gui/ItemIconAtlas.ts (flat item icons).
//
// Opens the dev client, waits for window.__mc, and reads pixels straight out of
// ItemIconAtlas' 2D atlas canvas, so the result does not depend on eyeballing a screenshot:
//   * every flat item owns a cell with ink,
//   * for sampled flat items each 48x48 cell pixel equals the source texel from
//     public/mc/tex/item.bin (CELL=48 / sprite=16 -> exactly 3x3 pixels per texel),
//   * the real HUD hotbar draws the icons: fill the 9 hotbar slots with flat/block items,
//     count ItemIconAtlas.draw calls and pixels that changed in the hotbar strip.
// Saves shots/bugs/icons.png (real HUD) + shots/bugs/icons-sheet.png (9 icons at 64 px).
//
// Usage: node scripts/test-icons.mjs [url] [shotOut] [waitMs]

import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { launchOptions } from './lib/browser.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:5174/';
const shotOut = process.argv[3] ?? 'shots/bugs/icons.png';
const shotSheet = shotOut.replace(/\.png$/, '-sheet.png');
const waitMs = Number(process.argv[4] ?? 120000);

const SAMPLES = ['iron_pickaxe', 'bread', 'wheat_seeds', 'iron_shovel', 'diamond_sword', 'apple'];
const HOTBAR = ['iron_pickaxe', 'bread', 'wheat_seeds', 'iron_shovel', 'diamond_sword', 'apple', 'oak_log', 'stone', 'oak_fence'];
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
while (Date.now() < deadline && !ready) {
  try { ready = await page.evaluate(() => !!(window.__mc && window.__mc.icons && window.__mc.icons.ready)); } catch { /* vite reload */ }
  if (!ready) await page.waitForTimeout(1000);
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
  const itemModels = icons.itemModels;
  const out = { guiScale: g.guiScale, glError: g.gl.getError(), items: {}, hotbarBefore: [] };

  for (let i = 0; i < 9; i++) {
    const st = g.survival.inventory.getItem(i);
    out.hotbarBefore.push(st && st.item ? st.item.name : null);
  }

  for (const name of samples) {
    const id = items.findIndex((it) => it.name === name);
    if (id < 0) { out.items[name] = { missing: true }; continue; }
    const cell = icons.cellOf[id];
    const rec = { id, cell, hasIcon: icons.hasIcon(id), kind: itemModels[`minecraft:${name}`]?.kind ?? null };
    const entry = itemModels[`minecraft:${name}`];
    if (entry && entry.layers && entry.layers.length) {
      const t = entry.layers[0].texture;
      rec.layer = entry.layers[0].array === 'item' ? (g.textures.itemLayer.get(t) ?? null) : (g.textures.blockLayer.get(t) ?? null);
    }
    if (cell >= 0) {
      const cx = (cell % cols) * cellSize;
      const cy = Math.floor(cell / cols) * cellSize;
      rec.pixels = Array.from(ctx.getImageData(cx, cy, cellSize, cellSize).data);
    }
    out.items[name] = rec;
  }

  // per-kind coverage: hasIcon() and ink on the atlas canvas
  const kinds = ['block', 'flat', 'special', 'composite', 'none'];
  const counts = Object.fromEntries(kinds.map((k) => [k, 0]));
  const hasIcon = Object.fromEntries(kinds.map((k) => [k, 0]));
  const withInk = Object.fromEntries(kinds.map((k) => [k, 0]));
  const missing = { flat: [], block: [] };
  let nonEmptyCells = 0;
  for (let id = 0; id < items.length; id++) {
    const e = itemModels[`minecraft:${items[id].name}`];
    const kind = e ? e.kind : 'none';
    counts[kind]++;
    if (icons.hasIcon(id)) hasIcon[kind]++;
    const cell = icons.cellOf[id];
    if (cell < 0) continue;
    const cx = (cell % cols) * cellSize, cy = Math.floor(cell / cols) * cellSize;
    const img = ctx.getImageData(cx, cy, cellSize, cellSize).data;
    let inked = 0;
    for (let i = 3; i < img.length; i += 4) if (img[i] > 8) inked++;
    if (inked > 0) nonEmptyCells++;
    if (inked > 20) withInk[kind]++;
    else if (kind === 'flat' && missing.flat.length < 10) missing.flat.push(items[id].name);
    else if (kind === 'block' && missing.block.length < 10) missing.block.push(items[id].name);
  }
  out.counts = counts;
  out.hasIcon = hasIcon;
  out.withInk = withInk;
  out.nonEmptyCells = nonEmptyCells;
  out.missing = missing;
  return out;
}, { samples: SAMPLES, cellSize: CELL, cols: COLS });

console.log('ATLAS ' + JSON.stringify({
  guiScale: diag.guiScale, glError: diag.glError, counts: diag.counts,
  hasIcon: diag.hasIcon, withInk: diag.withInk, nonEmptyCells: diag.nonEmptyCells,
  missing: diag.missing, hotbarBefore: diag.hotbarBefore,
}, null, 1));

// ---- 2. compare each sampled flat cell against the baked item sprite ---------
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
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      if (ta === 255) { // opaque texels must round-trip exactly (full-bright billboard icon)
        comparedTotal++;
        const d = Math.abs(rec.pixels[o] - tr) + Math.abs(rec.pixels[o + 1] - tg) + Math.abs(rec.pixels[o + 2] - tb);
        if (d > 3) mismatched++;
      } else if (ta === 0 && a > 8) mismatched++;
    }
  }
  mismatchedTotal += mismatched;
  const bbox = maxX >= 0 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null;
  const srcInk = (() => {
    let n = 0;
    for (let ty = 0; ty < SPRITE; ty++) for (let tx = 0; tx < SPRITE; tx++) if (texel(rec.layer, tx, ty)[3] > 0) n++;
    return n;
  })();
  console.log(`FLAT ${name}: cell=${rec.cell} layer=${rec.layer} inkPx=${ink} expectedInk=${srcInk * scale * scale} bbox=${JSON.stringify(bbox)} colorMismatch=${mismatched}`);
}

// ---- 3. does the real HUD hotbar draw the icons? ---------------------------
async function waitReady() {
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    try {
      if (await page.evaluate(() => !!(window.__mc && window.__mc.icons && window.__mc.icons.ready))) return true;
    } catch { /* context destroyed */ }
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
  hud = await evalRetry(async ({ hotbar, scale: _scale }) => {
    const g = window.__mc;
    const items = g.mc.items;
    const registry = g.survival.registry;
    const inv = g.survival.inventory;
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    // Registry order == mc.items order; use real Item instances (Item.id), not ItemMeta.
    const ids = hotbar.map((n) => items.findIndex((it) => it.name === n));
    const realItems = ids.map((id) => registry.get(id));

    // instrument ItemIconAtlas.draw as the HUD calls it
    const calls = [];
    const orig = g.icons.draw.bind(g.icons);
    g.icons.draw = (ctx, id, x, y, size) => {
      if (calls.length < 9) calls.push({ id, cell: g.icons.cellOf[id], x, y, size, gui: ctx.canvas === g.guiCanvas });
      return orig(ctx, id, x, y, size);
    };
    await frame();
    g.icons.draw = orig;

    const scale = g.guiScale;
    const logicalW = window.innerWidth / scale;
    const logicalH = window.innerHeight / scale;
    const left = Math.floor(logicalW / 2) - 91;
    const region = { x: Math.round((left + 2) * scale), y: Math.round((logicalH - 19) * scale), w: 9 * 20 * scale, h: 16 * scale };
    const ctx = g.guiCanvas.getContext('2d');
    const read = () => ctx.getImageData(region.x, region.y, region.w, region.h).data;

    // baseline with an empty hotbar
    for (let i = 0; i < 9; i++) { const st = inv.getItem(i); st.item = null; st.setCount(0); }
    await frame(); await frame();
    const base = read();

    // fill the real hotbar with flat items + two block items for contrast
    for (let i = 0; i < 9; i++) {
      const st = inv.getItem(i);
      st.item = realItems[i] ?? null;
      st.setCount(1);
    }
    inv.setSelectedSlot(0);
    g.selectedSlot = 0;
    await frame(); await frame();
    const filled = read();

    // per slot (20 logical px apart, 16 logical icons): did pixels change?
    const slot = 20 * scale;
    const perSlot = [];
    for (let i = 0; i < 9; i++) {
      let diff = 0;
      for (let row = 0; row < region.h; row++) {
        for (let col = 0; col < 16 * scale; col++) {
          const idx = ((row * region.w) + i * slot + col) * 4;
          if (idx + 2 < filled.length && idx + 2 < base.length &&
            Math.abs(base[idx] - filled[idx]) + Math.abs(base[idx + 1] - filled[idx + 1]) + Math.abs(base[idx + 2] - filled[idx + 2]) > 24) diff++;
        }
      }
      perSlot.push(diff);
    }

    // proof sheet: the exact HUD call, icons at 64 px
    document.getElementById('icon-proof-sheet')?.remove();
    const sheet = document.createElement('canvas');
    sheet.id = 'icon-proof-sheet';
    sheet.width = 9 * 80 + 20;
    sheet.height = 118;
    sheet.style.cssText = `position:fixed;left:0;top:0;z-index:99999;width:${sheet.width}px;height:${sheet.height}px`;
    document.body.appendChild(sheet);
    const sctx = sheet.getContext('2d');
    sctx.imageSmoothingEnabled = false;
    sctx.fillStyle = '#1b1b1b';
    sctx.fillRect(0, 0, sheet.width, sheet.height);
    hotbar.forEach((n, i) => {
      g.icons.draw(sctx, items.findIndex((it) => it.name === n), 10 + i * 80, 8, 64);
      sctx.fillStyle = '#fff';
      sctx.font = '11px monospace';
      sctx.fillText(n, 10 + i * 80, 90);
    });
    sctx.fillStyle = '#8891a0';
    sctx.font = '12px monospace';
    sctx.fillText('ItemIconAtlas.draw() at HUD size, 64px per hotbar slot', 10, 108);
    return { calls, perSlot, totalDiff: perSlot.reduce((a, b) => a + b, 0), region, hotbarStacks: g.survival.hotbarStacks().map((s) => [s.item ? s.item.name : null, s.getCount()]) };
  }, { hotbar: HOTBAR, scale: 0 });
  const intact = await page.evaluate(() => !!document.getElementById('icon-proof-sheet')).catch(() => false);
  if (!intact) { hud = null; await waitReady(); }
}
if (!hud) throw new Error('HUD proof sheet vanished (page kept reloading)');

console.log('HUD ' + JSON.stringify(hud));
console.log('FLAT_COLOR_MISMATCH ' + mismatchedTotal + ' / ' + comparedTotal + ' opaque texel pixels compared');

// ---- 4. screenshots ---------------------------------------------------------
mkdirSync(dirname(shotOut), { recursive: true });
let shotOk = false;
for (let i = 0; i < 3 && !shotOk; i++) {
  const ok = await page.evaluate(() => !!document.getElementById('icon-proof-sheet') && !!window.__mc).catch(() => false);
  if (ok) {
    // real HUD with the 9 filled slots (no overlay), then the proof sheet
    await page.evaluate(() => document.getElementById('icon-proof-sheet')?.remove());
    await page.waitForTimeout(400);
    await page.screenshot({ path: shotOut });
    await page.evaluate(() => {
      const g = window.__mc;
      const items = g.mc.items;
      const names = ['iron_pickaxe', 'bread', 'wheat_seeds', 'iron_shovel', 'diamond_sword', 'apple', 'oak_log', 'stone', 'oak_fence'];
      const sheet = document.createElement('canvas');
      sheet.id = 'icon-proof-sheet';
      sheet.width = 9 * 80 + 20; sheet.height = 118;
      sheet.style.cssText = `position:fixed;left:0;top:0;z-index:99999;width:${sheet.width}px;height:${sheet.height}px`;
      document.body.appendChild(sheet);
      const sctx = sheet.getContext('2d');
      sctx.imageSmoothingEnabled = false;
      sctx.fillStyle = '#1b1b1b'; sctx.fillRect(0, 0, sheet.width, sheet.height);
      names.forEach((n, i) => {
        g.icons.draw(sctx, items.findIndex((it) => it.name === n), 10 + i * 80, 8, 64);
        sctx.fillStyle = '#fff'; sctx.font = '11px monospace'; sctx.fillText(n, 10 + i * 80, 90);
      });
      sctx.fillStyle = '#8891a0'; sctx.font = '12px monospace';
      sctx.fillText('ItemIconAtlas.draw() at HUD size, 64px per hotbar slot', 10, 108);
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: shotSheet });
    shotOk = true;
  } else {
    console.log('(screenshot retry: another edit reloaded the page)');
    if (!(await waitReady())) break;
  }
}
console.log('shot:', shotOut, shotSheet);

const final = await page.evaluate(() => ({ ready: !!window.__mc?.icons?.ready, glError: window.__mc?.gl?.getError?.(), fps: window.__mc?.fps })).catch((e) => ({ error: String(e) }));
console.log('FINAL ' + JSON.stringify(final));
console.log('--- page log tail ---');
console.log(logs.filter((l) => l.includes('pageerror')).slice(-5).join('\n') || '(no pageerrors)');
await browser.close();

const flatOk = diag.hasIcon.flat === diag.counts.flat && diag.withInk.flat >= diag.counts.flat - 4;
const colorOk = mismatchedTotal <= 8;
const hudOk = hud.calls.length === 9 && hud.calls.every((c) => c.cell >= 0) && hud.perSlot.filter((n) => n > 150).length >= 9;
const shotOk2 = shotOk;
console.log(`RESULT flatIcons=${diag.withInk.flat}/${diag.counts.flat} blockIcons=${diag.withInk.block}/${diag.counts.block} nonEmptyCells=${diag.nonEmptyCells} colorMismatch=${mismatchedTotal} hudCalls=${hud.calls.length} hudSlotsDrawn=${hud.perSlot.filter((n) => n > 150).length}/9 shot=${shotOk2} => ${flatOk && colorOk && hudOk && shotOk2 ? 'PASS' : 'FAIL'}`);
process.exit(flatOk && colorOk && hudOk && shotOk2 ? 0 : 1);
