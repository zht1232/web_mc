// Browser probe for SKY_EFFECT_REFLECTION_TRANSLUCENT (water reflects clouds + stars).
//
// The pack only defines this at DETAIL_QUALITY >= 3 (our high/ultra). TERRAIN_FRAG adds the
// stars.glsl starfield and a coverage sample of the 192-block cloud deck to the reflected sky.
//
//   node scripts/test-water-sky-reflect.mjs [--url http://127.0.0.1:5174]
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
  if (msg.type() === 'error' && /shader|webgl|program|uniform|sampler/i.test(msg.text())) {
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

try {
  await page.goto(`${base}/?play&perf=0`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mc?.running === true, null, { timeout: 120000 });
  await sleep(1200);

  // A wide pool below the 192-block cloud deck: the reflection rays leave the water toward the
  // cloud layer and the night sky (a stage above the deck would never sample clouds).
  const stage = await prepareStage(page, {
    y: 120,
    radius: 16,
    floor: 'stone',
    water: { dx: -8, dz: -12, w: 16, d: 12 },
    time: 12000, // sunset: warm cloud deck
    camera: { y: undefined, z: undefined, yaw: 180, pitch: 8, fov: 72 },
  });
  await ev((s) => {
    const m = window.__mc;
    const p = m.player;
    p.pos.x = s.x + 0.5;
    p.pos.y = s.floorY + 2.4;
    p.pos.z = s.z + 8.5;
    p.prevPos.x = p.pos.x;
    p.prevPos.y = p.pos.y;
    p.prevPos.z = p.pos.z;
    p.yaw = 180;
    p.pitch = 8;
    m.renderer.shadersEnabled = true;
    m.renderer.post.setQuality('high');
    m.renderer.swayEnabled = false;
    m.renderer.post.volumetricEnabled = false; // isolate the reflection change
    m.renderer.post.cloudsEnabled = false;
    m.level.time = 12000;
  }, stage);
  await waitTicks(page, 6);
  await sleep(300);

  // Water mask from the terrain shader's debug view 14 (G = water layer).
  await ev(() => { window.__mc.renderer.debugMode = 14; });
  await waitTicks(page, 2);
  const maskPng = readPng(await capture(page, stage.clip));
  savePng(await capture(page), 'shots/diag/water-sky-mask.png');
  const mask = new Uint8Array(maskPng.width * maskPng.height);
  // The debug view only runs on terrain fragments; the sky keeps its normal colours and would
  // read as "water" through the G channel, so restrict the measurement to the pool band.
  const y0 = Math.floor(maskPng.height * 0.55);
  const y1 = Math.floor(maskPng.height * 0.98);
  let waterPixels = 0;
  let bandPixels = 0;
  let reflectOn = 0;
  for (let y = 0; y < maskPng.height; y++) {
    for (let x = 0; x < maskPng.width; x++) {
      const i = y * maskPng.width + x;
      const p = i * 4;
      if (y >= y0 && y < y1) {
        bandPixels++;
        if (maskPng.data[p + 1] > 128) {
          mask[i] = 1;
          waterPixels++;
          if (maskPng.data[p] > 128) reflectOn++;
        }
      }
    }
  }
  check('the pool covers a measurable part of the lower frame',
    waterPixels / Math.max(1, bandPixels) > 0.05, { waterPixels, bandPixels, reflectOn });
  await ev(() => { window.__mc.renderer.debugMode = 0; });
  await waitTicks(page, 3);

  const info = await ev(() => ({
    quality: window.__mc.renderer.post.quality,
    enabled: window.__mc.renderer.skyReflectionEffects,
    glError: window.__mc.renderer.post.stats.lastGlError,
  }));
  check('sky-reflection effects are enabled on the high tier',
    info.quality === 'high' && info.enabled === true && info.glError === 0, info);

  // Debug 20: R = skyBase (with the effect), G = skyRefl after skyLightFactor.
  await ev(() => { window.__mc.renderer.debugMode = 20; });
  await waitTicks(page, 2);
  const dbg20On = readPng(await capture(page, stage.clip));
  await ev(() => { window.__mc.renderer.skyReflectionEffects = false; });
  await waitTicks(page, 3);
  const dbg20Off = readPng(await capture(page, stage.clip));
  await ev(() => { window.__mc.renderer.debugMode = 0; window.__mc.renderer.skyReflectionEffects = true; });
  let baseChanged = 0, reflChanged = 0;
  const wy0 = Math.floor(dbg20On.height * 0.75);
  const wy1 = Math.floor(dbg20On.height * 0.95);
  for (let y = wy0; y < wy1; y++) {
    for (let x = 0; x < dbg20On.width; x++) {
      const p = (y * dbg20On.width + x) * 4;
      if (Math.abs(dbg20On.data[p] - dbg20Off.data[p]) > 1) baseChanged++;
      if (Math.abs(dbg20On.data[p + 1] - dbg20Off.data[p + 1]) > 1) reflChanged++;
    }
  }
  check('the shader adds the sky effect to its reflection buffer',
    baseChanged > 1000, { baseChanged, reflChanged, pixels: (wy1 - wy0) * dbg20On.width });
  check('no shader/WebGL errors with the new cloud sampler', errors.length === 0, errors.slice(0, 3));

  // A/B at sunset: clouds in the reflected sky.
  const onShot = readPng(await capture(page, stage.clip));
  savePng(await capture(page), 'shots/diag/water-sky-reflect-on.png');
  await ev(() => { window.__mc.renderer.skyReflectionEffects = false; });
  await waitTicks(page, 4);
  const offShot = readPng(await capture(page, stage.clip));
  savePng(await capture(page), 'shots/diag/water-sky-reflect-off.png');

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
    if (d > 8) changed++;
  }
  check('the reflected clouds change the water pixels',
    changed / Math.max(1, waterPixels) > 0.05,
    { changed, waterPixels, fraction: +(changed / Math.max(1, waterPixels)).toFixed(3), meanDiff: +(diffSum / Math.max(1, waterPixels)).toFixed(1) });

  // Night: stars must reach the reflection without errors.
  await ev(() => {
    const m = window.__mc;
    m.level.time = 18000;
    m.renderer.skyReflectionEffects = true;
  });
  await waitTicks(page, 6);
  await sleep(300);
  savePng(await capture(page), 'shots/diag/water-sky-reflect-night-on.png');
  const nightOn = readPng(await capture(page, stage.clip));
  await ev(() => { window.__mc.renderer.skyReflectionEffects = false; });
  await waitTicks(page, 4);
  const nightOff = readPng(await capture(page, stage.clip));
  let nightChanged = 0;
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    if (!mask[i]) continue;
    if (Math.abs(nightOn.data[p] - nightOff.data[p]) > 4
      || Math.abs(nightOn.data[p + 1] - nightOff.data[p + 1]) > 4
      || Math.abs(nightOn.data[p + 2] - nightOff.data[p + 2]) > 4) nightChanged++;
  }
  const glNight = await ev(() => window.__mc.renderer.post.stats.lastGlError);
  check('the night sky (stars) renders into the water without GL errors',
    glNight === 0 && nightChanged > 0 && errors.length === 0,
    { glNight, nightChanged, waterPixels, errors: errors.slice(0, 3) });
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  if (failed > 0) process.exitCode = 1;
}
