// Browser probe for the Complementary Reimagined r5.9.3 water reflection port.
//
// Verifies, on a deterministic stage:
//   * the terrain shader (with the new GetSky / SSR / GGX code) compiles and renders;
//   * the water layer is present and the SSR march reports hits against the arena wall;
//   * turning the shader pipeline off changes the water pixels measurably (the reflection is
//     actually drawn, not just compiled);
//   * the sunset glare path also renders without a GL error.
//
//   node scripts/test-water-reflect.mjs [--url http://127.0.0.1:5174]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { prepareStage, capture, readPng, savePng, waitTicks } from './lib/stage.mjs';

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const base = urlArg >= 0 ? args[urlArg + 1] : 'http://127.0.0.1:5174';

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 400)));
page.on('console', (msg) => {
  if (msg.type() === 'error' && /shader|webgl|program/i.test(msg.text())) {
    errors.push(msg.text().slice(0, 400));
  }
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (fn, arg) => page.evaluate(fn, arg);
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
};
const pixelStats = (png) => {
  const { data, width, height } = png;
  return { data, width, height };
};

try {
  await page.goto(`${base}/?play&perf=0`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mc?.running === true, null, { timeout: 120000 });
  await sleep(1200);

  const stage = await prepareStage(page, {
    radius: 14,
    floor: 'stone',
    water: { dx: -7, dz: -10, w: 14, d: 9 },
    backdrop: true,
    backdropBlock: 'white_concrete',
    time: 6000,
    camera: { y: 242.6, z: undefined, yaw: 180, pitch: 16, fov: 70 },
  });
  // prepareStage already framed the camera except z; aim across the pool toward the wall.
  await ev((s) => {
    const m = window.__mc;
    const p = m.player;
    p.pos.x = s.x + 0.5;
    p.pos.y = s.floorY + 2.6;
    p.pos.z = s.z + 6.5;
    p.prevPos.x = p.pos.x;
    p.prevPos.y = p.pos.y;
    p.prevPos.z = p.pos.z;
    p.yaw = 180;
    p.pitch = 16;
    m.renderer.shadersEnabled = true;
    m.renderer.post.setQuality('high');
    m.renderer.swayEnabled = false;
    // Coloured pillars standing out of the far edge of the pool: a mirror must show them as
    // inverted shapes instead of a featureless grey wall.
    const red = m.mc.stateOf('red_concrete');
    const yellow = m.mc.stateOf('yellow_concrete');
    const blue = m.mc.stateOf('blue_concrete');
    const cols = [[-4, red], [0, yellow], [4, blue]];
    for (const [dx, state] of cols) {
      for (let dy = 0; dy < 6; dy++) {
        for (let dz = 0; dz < 1; dz++) {
          m.level.setBlockState(s.x + dx, s.floorY + dy, s.z - 9 + dz, state);
        }
      }
    }
  }, stage);
  await waitTicks(page, 4);
  await sleep(300);

  const info = await ev(() => {
    const m = window.__mc;
    return {
      enabled: m.renderer.shadersEnabled,
      quality: m.renderer.post.quality,
      waterColor: !!m.renderer.post.waterColor,
      glError: m.renderer.post.stats.lastGlError,
      running: m.running,
    };
  });
  check('shader pipeline live and water snapshot allocated',
    info.enabled === true && info.quality === 'high' && info.waterColor === true && info.glError === 0,
    info);
  check('no shader/WebGL errors during first frames', errors.length === 0, errors.slice(0, 3));

  // Water mask from the shader's own debug view (R = reflections enabled, G = water layer).
  await ev(() => { window.__mc.renderer.debugMode = 14; });
  await waitTicks(page, 2);
  const maskPng = pixelStats(readPng(await capture(page, stage.clip ? { ...stage.clip } : undefined)));
  let waterPixels = 0;
  const mask = new Uint8Array(maskPng.width * maskPng.height);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const isWater = maskPng.data[p + 1] > 128;
    mask[i] = isWater ? 1 : 0;
    if (isWater) waterPixels++;
  }
  const total = mask.length;
  check('water layer visible in the stage', waterPixels / total > 0.04,
    { waterPixels, total, fraction: +(waterPixels / total).toFixed(3) });

  // SSR hit debug (R = hit alpha, G = err, B = sample depth).
  await ev(() => { window.__mc.renderer.debugMode = 16; });
  await waitTicks(page, 2);
  const hitPng = pixelStats(readPng(await capture(page, stage.clip ? { ...stage.clip } : undefined)));
  let hits = 0;
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    if (mask[i] && hitPng.data[p] > 128) hits++;
  }
  check('SSR marching finds the arena wall', waterPixels > 0 && hits / waterPixels > 0.1,
    { hits, waterPixels, fraction: +(hits / Math.max(1, waterPixels)).toFixed(3) });

  // Visual diff: reflections on vs shaders off, measured only inside the water mask.
  await ev(() => { window.__mc.renderer.debugMode = 0; });
  await waitTicks(page, 3);
  const onShot = pixelStats(readPng(await capture(page, stage.clip ? { ...stage.clip } : undefined)));
  savePng(await capture(page), 'shots/diag/water-reflect-on.png');

  await ev(() => { window.__mc.renderer.shadersEnabled = false; });
  await waitTicks(page, 3);
  const offShot = pixelStats(readPng(await capture(page, stage.clip ? { ...stage.clip } : undefined)));
  savePng(await capture(page), 'shots/diag/water-reflect-off.png');

  let changed = 0;
  let diffSum = 0;
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    if (!mask[i]) continue;
    const d = Math.max(
      Math.abs(onShot.data[p] - offShot.data[p]),
      Math.abs(onShot.data[p + 1] - offShot.data[p + 1]),
      Math.abs(onShot.data[p + 2] - offShot.data[p + 2]),
    );
    diffSum += d;
    if (d > 16) changed++;
  }
  check('water pixels change when the reflection pass is on',
    changed / Math.max(1, waterPixels) > 0.3,
    { changed, waterPixels, fraction: +(changed / Math.max(1, waterPixels)).toFixed(3), meanDiff: +(diffSum / Math.max(1, waterPixels)).toFixed(1) });

  const glAfter = await ev(() => window.__mc.renderer.post.stats.lastGlError);
  check('no GL error after toggling shaders', glAfter === 0, { glAfter });

  // Sunset glare path (GetSky glare around the sun) must also render cleanly.
  await ev(() => {
    const m = window.__mc;
    m.renderer.shadersEnabled = true;
    m.level.time = 12000;
    m.player.yaw = 90;
    m.player.pitch = 8;
  });
  await waitTicks(page, 4);
  await sleep(250);
  const dusk = await ev(() => {
    const m = window.__mc;
    return { glError: m.renderer.post.stats.lastGlError };
  });
  savePng(await capture(page), 'shots/diag/water-reflect-dusk.png');
  check('sunset sky/water path renders without GL errors', dusk.glError === 0, dusk);
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  if (failed > 0) process.exitCode = 1;
}
