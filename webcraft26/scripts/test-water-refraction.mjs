// Browser probe for the water-refraction port (Complementary refraction.glsl, DETAIL_QUALITY>=3):
// the pool bottom must visibly distort when the noise texture is bound, and return to the
// unrefracted image when it is removed (same frame, same quality, only uRefraction changes).
//
//   node scripts/test-water-refraction.mjs [--url http://127.0.0.1:5174]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { prepareStage, capture, diffPng, savePng, waitTicks } from './lib/stage.mjs';

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const base = urlArg >= 0 ? args[urlArg + 1] : 'http://127.0.0.1:5174';

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
page.on('console', (msg) => {
  if (msg.type() === 'error' && /shader|webgl|program/i.test(msg.text())) {
    errors.push(msg.text().slice(0, 300));
  }
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (fn, arg) => page.evaluate(fn, arg);
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
};

try {
  await page.goto(`${base}/?play&perf=0`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mc?.running === true, null, { timeout: 120000 });
  await sleep(1200);

  const stage = await prepareStage(page, {
    radius: 10,
    floor: 'stone',
    water: { dx: -5, dz: -6, w: 10, d: 8 },
    time: 6000,
    camera: { yaw: 180, pitch: 38, fov: 70 },
    clip: { x: 300, y: 200, width: 400, height: 300 },
  });
  await ev((s) => {
    const m = window.__mc;
    const p = m.player;
    p.pos.x = s.x + 0.5;
    p.pos.y = s.floorY + 2.4;
    p.pos.z = s.z + 6.5;
    p.prevPos.x = p.pos.x;
    p.prevPos.y = p.pos.y;
    p.prevPos.z = p.pos.z;
    p.yaw = 180;
    p.pitch = 38;
    m.renderer.shadersEnabled = true;
    m.renderer.post.setQuality('high'); // DETAIL_QUALITY 3 -> WATER_REFRACTION
    m.renderer.swayEnabled = false;
    // Freeze the wave clock: otherwise the animated surface alone changes water pixels
    // between the two captures and hides whether refraction is the cause.
    m.renderer.waveTimeOverride = 1.0;
    m.daylightCycle = false;
    // High-contrast checker at the pool bottom (prepareStage puts the water in floorY-1
    // and the pool floor in floorY-2): refraction wobbles these edges under the water.
    const red = m.mc.stateOf('red_concrete');
    const white = m.mc.stateOf('white_concrete');
    for (let dx = 0; dx < 10; dx++) {
      for (let dz = 0; dz < 8; dz++) {
        const state = (dx + dz) % 2 === 0 ? red : white;
        m.level.setBlockState(s.x - 5 + dx, s.floorY - 2, s.z - 6 + dz, state);
      }
    }
    return true;
  }, stage);
  await waitTicks(page, 10);

  const noise = await ev(() => ({
    noise: window.__mc.textures.noise !== null,
    quality: window.__mc.renderer.post.quality,
    shaders: window.__mc.renderer.shadersEnabled,
  }));
  check('the generated refraction noise texture exists on high quality',
    noise.noise === true && noise.quality === 'high' && noise.shaders === true, noise);

  const withRefraction = await capture(page, stage.clip);
  savePng(await page.screenshot(), 'shots/diag/water-refraction.png');

  // Disable refraction by dropping the noise binding; everything else stays identical.
  await ev(() => {
    const m = window.__mc;
    window.__noiseBackup = m.textures.noise;
    m.textures.noise = null;
  });
  await waitTicks(page, 2);
  const without = await capture(page, stage.clip);
  savePng(await page.screenshot(), 'shots/diag/water-refraction-off.png');
  await ev(() => { window.__mc.textures.noise = window.__noiseBackup; });

  const diff = diffPng(withRefraction, without);
  check('refraction visibly distorts the submerged floor (noise on vs off)',
    diff.changed > 300, diff);

  // Medium quality is DETAIL_QUALITY 2: the pack does not define WATER_REFRACTION there,
  // so removing the noise must not change a single water pixel.
  await ev(() => { window.__mc.renderer.post.setQuality('medium'); });
  await waitTicks(page, 6);
  const medOn = await capture(page, stage.clip);
  await ev(() => { window.__mc.textures.noise = null; });
  await waitTicks(page, 2);
  const medOff = await capture(page, stage.clip);
  await ev(() => { window.__mc.textures.noise = window.__noiseBackup; });
  const medDiff = diffPng(medOn, medOff);
  check('medium quality keeps the default pack behaviour (no refraction)',
    medDiff.changed < 50, medDiff);

  check('no shader/GL errors', errors.length === 0, errors.slice(0, 2));
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  if (failed > 0) process.exitCode = 1;
}
