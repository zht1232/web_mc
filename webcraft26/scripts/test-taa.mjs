// TAA regression test (HANDOFF 搂8-2).
//
//   node scripts/test-taa.mjs [baseUrl]
//
// The high tier renders the world with a sub-pixel jittered projection and blends the previous
// resolved frame through the depth copy. Checks:
//   1) TAA is active on high, inactive on low / with shaders off;
//   2) a static frame is temporally stable (the history converged, no flicker);
//   3) edge energy drops with TAA (the jitter + accumulation resolves aliasing);
//   4) after a camera turn the history converges again within ~1.5 s (no permanent ghosting);
//   5) no page errors / GL errors.
// Screenshots: shots/taa/.

import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { PNG } from 'pngjs';
import { mkdirSync } from 'node:fs';

const base = (process.argv[2] ?? 'http://127.0.0.1:5174/').replace(/\/$/, '');
const outDir = 'shots/taa';
mkdirSync(outDir, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`); });

const ev = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => page.waitForTimeout(ms);

const readPng = (buffer) => PNG.sync.read(buffer);
const lumaAt = (png, x, y) => {
  const i = (y * png.width + x) * 4;
  return 0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2];
};
/** Mean |horizontal gradient| + |vertical gradient| of luma over a crop (aliasing proxy). */
function edgeEnergy(png, x0, y0, x1, y1) {
  let sum = 0, n = 0;
  for (let y = y0 + 1; y < y1 - 1; y += 2) {
    for (let x = x0 + 1; x < x1 - 1; x += 2) {
      const c = lumaAt(png, x, y);
      sum += Math.abs(lumaAt(png, x + 1, y) - c) + Math.abs(lumaAt(png, x, y + 1) - c);
      n++;
    }
  }
  return n ? sum / n : 0;
}
function meanAbsDiff(a, b, x0, y0, x1, y1) {
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * a.width + x) * 4;
      sum += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
      n += 3;
    }
  }
  return sum / n;
}

async function waitFor(name, fn, timeout = 120000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { last = await ev(fn); if (last) return last; } catch { /* booting */ }
    await sleep(250);
  }
  throw new Error(`timeout waiting for ${name} (last=${JSON.stringify(last)})`);
}

/** Mobs (walking cows etc.) are animated and would poison frame-to-frame stability metrics. */
async function clearMobs() {
  await ev(() => {
    window.__mc.entityManager.getEntities().forEach((e) => {
      if (e.getTypeName() !== 'player') e.remove();
    });
  });
}

try {
  await page.goto(`${base}/?play`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(400);
  await waitFor('__mc', () => !!window.__mc);
  await waitFor('world loaded', () => window.__mc.level && window.__mc.level.chunks.size > 250);

  console.log('=== 1. TAA gate ===');
  await ev(() => {
    const m = window.__mc;
    m.renderer.shadersEnabled = true;
    m.renderer.shaderQuality = 'high';
    m.level.time = 6000;
    m.options.brightness = 1;
    m.options.gamemode = 'creative';
    const p = m.player;
    p.flying = true;
    p.vel.x = 0; p.vel.y = 0; p.vel.z = 0;
    p.yaw = 135;
    // Mobs (a walking cow) ruin frame-to-frame stability metrics: clear them before measuring.
    m.entityManager.getEntities().forEach((e) => { if (e.getTypeName() !== 'player') e.remove(); });
    p.pitch = 28;
  });
  for (let i = 0; i < 120; i++) {
    if (await ev(() => window.__mc.renderer.pendingRebuilds) === 0) break;
    await sleep(250);
  }
  await sleep(900);
  const stats = await ev(() => window.__mc.renderer.post.stats);
  check('high tier runs TAA', stats.taa === true, JSON.stringify(stats));
  check('depth copy available for reprojection', stats.depthTexture === true);

  console.log('=== 2. static frame is temporally stable ===');
  await clearMobs();
  const a = readPng(await page.screenshot({ path: `${outDir}/01-taa-static-a.png` }));
  await sleep(450);
  const b = readPng(await page.screenshot({ path: `${outDir}/02-taa-static-b.png` }));
  const jitterDiff = meanAbsDiff(a, b, 500, 430, 780, 640);
  check('converged frame has no flicker', jitterDiff < 3.5, `meanAbsDiff=${jitterDiff.toFixed(3)}`);

  console.log('=== 3. TAA resolves aliasing (edge energy) ===');
  const taaEnergy = edgeEnergy(a, 200, 140, 1080, 620);
  await ev(() => { window.__mc.renderer.post.taaOff = true; });
  await sleep(500);
  const offPng = readPng(await page.screenshot({ path: `${outDir}/03-taa-off.png` }));
  const offEnergy = edgeEnergy(offPng, 200, 140, 1080, 620);
  check('edge energy drops with TAA', taaEnergy < offEnergy * 0.98,
    `taa=${taaEnergy.toFixed(3)} off=${offEnergy.toFixed(3)} (-${((1 - taaEnergy / offEnergy) * 100).toFixed(1)}%)`);

  console.log('=== 4. history recovers after a camera turn (no ghosting) ===');
  await clearMobs();
  await ev(() => { window.__mc.renderer.post.taaOff = false; });
  await sleep(500);
  await ev(() => { window.__mc.player.yaw += 65; });
  await sleep(250);
  await clearMobs();
  const early = readPng(await page.screenshot({ path: `${outDir}/04-turn-early.png` }));
  await sleep(1500);
  const late = readPng(await page.screenshot({ path: `${outDir}/05-turn-late.png` }));
  await sleep(450);
  const late2 = readPng(await page.screenshot({ path: `${outDir}/06-turn-late2.png` }));
  const settle = meanAbsDiff(late, late2, 500, 430, 780, 640);
  const fromEarly = meanAbsDiff(early, late, 500, 430, 780, 640);
  check('history converges after the turn', settle < 3.0, `settle=${settle.toFixed(3)} (earlyDiff=${fromEarly.toFixed(2)})`);

  console.log('=== 5. gating (low tier / shaders off / restore) ===');
  const lowStats = await ev(() => {
    const m = window.__mc;
    m.renderer.shaderQuality = 'low';
    return m.renderer.post.stats;
  });
  check('no TAA on the low tier', lowStats.taa === false, JSON.stringify(lowStats));
  const offStats = await ev(() => {
    const m = window.__mc;
    m.renderer.shaderQuality = 'high';
    m.setShaders(false);
    return m.renderer.post.stats;
  });
  check('no TAA with shaders off', offStats.taa === false);
  await sleep(300);
  await page.screenshot({ path: `${outDir}/07-shaders-off.png` });
  await ev(() => { window.__mc.setShaders(true); });
  await sleep(600);
  const restored = await ev(() => window.__mc.renderer.post.stats);
  check('TAA returns after re-enabling shaders', restored.taa === true, JSON.stringify(restored));

  const glErr = await ev(() => window.__mc.renderer.post.stats.lastGlError);
  check('no GL errors', glErr === 0, `glError=${glErr}`);
  check('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
  console.log(`screenshots: ${outDir}/01-taa-static-a.png, 03-taa-off.png, 05-turn-late.png`);
} catch (err) {
  failures++;
  console.log('FAIL  exception:', err.message);
  try { await page.screenshot({ path: `${outDir}/99-failure.png` }); } catch { /* ignore */ }
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
