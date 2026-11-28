// Reference comparison for the first-person held block (P0 visual item).
// Captures a 1280x720 frame with the same camera as shots/ref/ref-day-6000-hand-stone.png
// (yaw 30 / pitch 22 / noon / stone in the selected hotbar slot) and checks the hand
// item model + a stable silhouette metric against the vanilla reference.
//
//   node scripts/test-hand-reference.mjs [--url http://127.0.0.1:5174]
import fs from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { launchOptions } from './lib/browser.mjs';
import { prepareStage, waitTicks, savePng } from './lib/stage.mjs';

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const base = urlArg >= 0 ? args[urlArg + 1] : 'http://127.0.0.1:5174';
const REF = 'shots/ref/ref-day-6000-hand-stone.png';

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
};

/**
 * Stone-grey silhouette in the bottom-right quadrant. The hotbar band is excluded
 * (both clients draw it over the hand, but at different GUI scales in headless runs).
 */
function stoneBBox(png, x0 = 1070, y0 = 430, yMax = 615) {
  let count = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  for (let y = y0; y < Math.min(yMax, png.height); y++) {
    for (let x = x0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
      if (Math.abs(r - g) > 9 || Math.abs(g - b) > 11) continue;
      if (r < 60 || r > 210) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return count ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, count } : null;
}

try {
  await page.goto(`${base}/?play&perf=0`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mc?.running === true, null, { timeout: 120000 });
  await new Promise((r) => setTimeout(r, 1200));

  const stage = await prepareStage(page, {
    radius: 6, floor: 'grass_block', camera: { yaw: 30, pitch: 22 },
  });
  await waitTicks(page, 10);

  const state = await page.evaluate(async () => {
    const m = window.__mc;
    m.level.time = 6000;
    m.player.yaw = 30;
    m.player.pitch = 22;
    for (const e of m.entityManager.getEntities()) e.remove();
    const mod = await import('/src/vanilla/world/item/ItemStack.ts');
    const inv = m.survival.inventory;
    inv.setItem(1, new mod.ItemStack(m.survival.registry.byName('stone'), 1));
    inv.setSelectedSlot(1);
    const frames = () => new Promise((r) => requestAnimationFrame(() => r()));
    // ItemInHandRenderer.tick raises mainHandHeight by 0.4/tick after a slot change.
    for (let i = 0; i < 60 && m.handRenderer.mainHandHeight < 0.99; i++) {
      await frames();
      await new Promise((r) => setTimeout(r, 30));
    }
    for (let i = 0; i < 6; i++) await frames();
    const t1 = m.entityManager.getGameTime();
    await new Promise((r) => setTimeout(r, 400));
    const t2 = m.entityManager.getGameTime();
    return {
      held: m.survival.getSelectedStack().item?.namespacedId ?? '',
      loc: m.handRenderer.currentItemLoc,
      height: m.handRenderer.mainHandHeight,
      t1, t2, running: m.running, hidden: document.hidden,
    };
  });
  check('the hand shows the stone block model (firstperson transform)',
    state.held === 'minecraft:stone' && state.loc === 'minecraft:block/stone'
    && state.height >= 0.99, state);

  const shot = await page.screenshot();
  savePng(shot, 'shots/diag/hand-stone-ours.png');
  const ours = stoneBBox(PNG.sync.read(shot));
  const ref = stoneBBox(PNG.sync.read(fs.readFileSync(REF)));
  check('the held block is visible in the hand region',
    ours !== null && ours.count > 3000, { ours, ref });

  if (ours && ref) {
    // The block is a 0.4-scaled cube rotated 45 degrees: its silhouette must line up
    // with the vanilla frame (top edge and width within a few px).
    const dTop = Math.abs(ours.y - ref.y);
    const dLeft = Math.abs(ours.x - ref.x);
    const dWidth = Math.abs(ours.w - ref.w) / ref.w;
    const dPixels = Math.abs(ours.count - ref.count) / ref.count;
    check('the held block silhouette matches the vanilla reference',
      dTop <= 6 && dLeft <= 6 && dWidth <= 0.06 && dPixels <= 0.15,
      { ours, ref, dTop, dLeft, dWidth, dPixels });
  }

  check('no page errors', errors.length === 0, errors.slice(0, 2));
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  if (failed > 0) process.exitCode = 1;
}
