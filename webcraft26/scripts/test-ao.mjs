// Depth-difference SSAO regression test (HANDOFF §8-2).
//
//   node scripts/test-ao.mjs [baseUrl]
//
// Looks at terrain with depth discontinuities, then checks:
//   1) the high tier runs SSAO against a sampleable depth texture;
//   2) the AO mask (composite debug 4) actually contains occlusion (not all white);
//   3) switching the strength off brightens the frame (A/B, same frozen camera);
//   4) the low tier and shaders-off have no AO;
//   5) no page errors / GL errors while toggling F6.
// Screenshots: shots/ao/.

import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { PNG } from 'pngjs';
import { mkdirSync } from 'node:fs';

const base = (process.argv[2] ?? 'http://127.0.0.1:5174/').replace(/\/$/, '');
const outDir = 'shots/ao';
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

function regionStats(buffer, x0, y0, x1, y1, channel = 0) {
  const png = PNG.sync.read(buffer);
  let sum = 0, n = 0, min = 255, max = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * png.width + x) * 4 + channel;
      const v = png.data[i];
      sum += v; n++;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return { mean: sum / n, min, max };
}
const luma = (buffer, x0, y0, x1, y1) => regionStats(buffer, x0, y0, x1, y1).mean;

async function waitFor(name, fn, timeout = 120000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { last = await ev(fn); if (last) return last; } catch { /* booting */ }
    await sleep(250);
  }
  throw new Error(`timeout waiting for ${name} (last=${JSON.stringify(last)})`);
}

try {
  await page.goto(`${base}/?play`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(400);
  await waitFor('__mc', () => !!window.__mc);
  await waitFor('world loaded', () => window.__mc.level && window.__mc.level.chunks.size > 250);

  console.log('=== 1. SSAO gate ===');
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
    p.pitch = 38; // look down at the terraced terrain
  });
  await sleep(600);
  // Let the chunk remesh queue drain so the screenshot shows the final meshes.
  for (let i = 0; i < 120; i++) {
    if (await ev(() => window.__mc.renderer.pendingRebuilds) === 0) break;
    await sleep(250);
  }
  await sleep(600);

  const stats = await ev(() => window.__mc.renderer.post.stats);
  check('high tier runs SSAO', stats.ssao === true, JSON.stringify(stats));
  check('scene depth is a sampleable texture', stats.depthTexture === true);

  console.log('=== 2. AO mask contains real occlusion ===');
  const aoMask = await (async () => {
    await ev(() => { window.__mc.renderer.post.debug = 4; });
    await sleep(500);
    const buf = await page.screenshot({ path: `${outDir}/01-ao-mask.png` });
    return buf;
  })();
  const statsMask = regionStats(aoMask, 200, 140, 1080, 640);
  check('AO mask is not all white', statsMask.mean < 250 && statsMask.min < 220,
    `mean=${statsMask.mean.toFixed(1)} min=${statsMask.min}`);
  await ev(() => { window.__mc.renderer.post.debug = 0; });

  console.log('=== 3. strength off brightens the same frozen frame ===');
  // Use the shipped defaults (strength 0.3, radius 4): AO should be a subtle darkening.
  const defaults = await ev(() => ({ strength: window.__mc.renderer.post.ssaoStrength, radius: window.__mc.renderer.post.ssaoRadius }));
  check('shipped AO defaults are subtle', defaults.strength > 0 && defaults.strength <= 0.5,
    JSON.stringify(defaults));
  await sleep(500);
  const onShot = await page.screenshot({ path: `${outDir}/02-ao-on.png` });
  await ev(() => { window.__mc.renderer.post.ssaoStrength = 0; });
  await sleep(500);
  const offShot = await page.screenshot({ path: `${outDir}/03-ao-off.png` });
  const onLuma = luma(onShot, 200, 140, 1080, 640);
  const offLuma = luma(offShot, 200, 140, 1080, 640);
  check('AO darkens the terrain frame', onLuma < offLuma - 1.0 && onLuma > offLuma - 12,
    `on=${onLuma.toFixed(2)} off=${offLuma.toFixed(2)} (${(offLuma - onLuma).toFixed(2)})`);

  console.log('=== 4. feature gating (low tier / shaders off) ===');
  const lowStats = await ev(() => {
    const m = window.__mc;
    m.renderer.shaderQuality = 'low';
    return m.renderer.post.stats;
  });
  check('no SSAO on the low tier', lowStats.ssao === false, JSON.stringify(lowStats));
  const offStats = await ev(() => {
    const m = window.__mc;
    m.renderer.shaderQuality = 'high';
    m.setShaders(false);
    return m.renderer.post.stats;
  });
  check('no SSAO with shaders off', offStats.ssao === false);
  check('post pipeline disabled with shaders off', offStats.enabled === false);
  await sleep(400);
  await page.screenshot({ path: `${outDir}/04-shaders-off.png` });
  await ev(() => { window.__mc.renderer.post.ssaoStrength = 1; window.__mc.setShaders(true); });
  await sleep(600);
  const restore = await ev(() => window.__mc.renderer.post.stats);
  check('SSAO returns after re-enabling shaders', restore.ssao === true, JSON.stringify(restore));

  const glErr = await ev(() => window.__mc.renderer.post.stats.lastGlError);
  check('no GL errors', glErr === 0, `glError=${glErr}`);
  check('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
  console.log(`screenshots: ${outDir}/01-ao-mask.png, 02-ao-on.png, 03-ao-off.png`);
} catch (err) {
  failures++;
  console.log('FAIL  exception:', err.message);
  try { await page.screenshot({ path: `${outDir}/99-failure.png` }); } catch { /* ignore */ }
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
