// Browser probe for the Complementary Reimagined r5.9.3 volumetric-light (god rays) port.
//
// The pass (VOLUMETRIC_FRAG in src/client/renderer/post/PostShaders.ts) marches this frame's
// shadow cascades along every view ray and adds the result in the composite. This probe checks:
//   * the pass runs on the high tier with no GL/page error (stats.volumetric);
//   * a solid roof above the camera kills the shafts (shadow + sky-light occlusion);
//   * removing the roof restores them (debug view 5 mean brightness);
//   * a tall wall placed toward a low sun darkens the shafts measurably;
//   * the composite really adds them: strength 1 vs 0 changes a large part of the frame.
//
//   node scripts/test-volumetric-light.mjs [--url http://127.0.0.1:5174]
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
  if (msg.type() === 'error' && /shader|webgl|program|volumetric/i.test(msg.text())) {
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

/** Mean luminance (0..1) of a captured PNG. */
function meanLuma(png) {
  let sum = 0;
  const n = png.width * png.height;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    sum += 0.299 * png.data[p] + 0.587 * png.data[p + 1] + 0.114 * png.data[p + 2];
  }
  return sum / n / 255;
}

try {
  await page.goto(`${base}/?play&perf=0`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mc?.running === true, null, { timeout: 120000 });
  await sleep(1200);

  // Arena high above the terrain, frozen noon, camera looking straight up.
  const stage = await prepareStage(page, {
    radius: 14,
    floor: 'stone',
    time: 6000,
    camera: { yaw: 0, pitch: -85, fov: 70 },
  });

  await ev(() => {
    const m = window.__mc;
    m.renderer.shadersEnabled = true;
    m.renderer.post.setQuality('high');
    m.renderer.swayEnabled = false;
    m.renderer.post.volumetricEnabled = true;
    m.renderer.post.volumetricStrength = 1;
    m.renderer.post.debug = 5; // composite debug view: light shafts x8
    m.player.pitch = -85;
  });
  await waitTicks(page, 6);
  await sleep(300);

  const info = await ev(() => {
    const m = window.__mc;
    return {
      enabled: m.renderer.shadersEnabled,
      quality: m.renderer.post.quality,
      volumetric: m.renderer.post.stats.volumetric,
      glError: m.renderer.post.stats.lastGlError,
    };
  });
  check('volumetric pass active on the high tier',
    info.enabled === true && info.quality === 'high' && info.volumetric === true && info.glError === 0,
    info);
  check('no shader/WebGL errors while the pass renders', errors.length === 0, errors.slice(0, 3));

  // --- solid roof above the camera: every ray ends on shadowed stone -------------
  await ev((s) => {
    const m = window.__mc;
    const stone = m.mc.stateOf('stone');
    for (let dx = -10; dx <= 10; dx++) {
      for (let dz = -10; dz <= 10; dz++) m.level.setBlockState(s.x + dx, s.floorY + 6, s.z + dz, stone);
    }
  }, stage);
  await waitTicks(page, 6);
  await sleep(250);
  const roofLuma = meanLuma(readPng(await capture(page, stage.clip)));
  savePng(await capture(page), 'shots/diag/volumetric-roof.png');

  // --- remove the roof: open sky above, shafts reappear --------------------------
  await ev((s) => {
    const m = window.__mc;
    for (let dx = -10; dx <= 10; dx++) {
      for (let dz = -10; dz <= 10; dz++) m.level.setBlockState(s.x + dx, s.floorY + 6, s.z + dz, 0);
    }
  }, stage);
  await waitTicks(page, 6);
  await sleep(250);
  const openLuma = meanLuma(readPng(await capture(page, stage.clip)));
  savePng(await capture(page), 'shots/diag/volumetric-open.png');

  check('shafts follow shadow/sky occlusion (roof kills them)',
    roofLuma < 0.02 && openLuma > 0.15 && openLuma > roofLuma * 5,
    { roofLuma: +roofLuma.toFixed(3), openLuma: +openLuma.toFixed(3) });

  // --- low sun + wall toward it: the shadowed cone must darken -------------------
  await ev((s) => {
    const m = window.__mc;
    m.level.time = 11000; // sun low in -X
    m.player.yaw = -90;   // look straight at it
    m.player.pitch = 0;
    const stone = m.mc.stateOf('stone');
    for (let dz = -20; dz <= 20; dz++) {
      for (let dy = 0; dy <= 40; dy++) m.level.setBlockState(s.x - 12, s.floorY + dy, s.z + dz, stone);
    }
  }, stage);
  await waitTicks(page, 8);
  await sleep(300);
  const wallLuma = meanLuma(readPng(await capture(page, stage.clip)));

  await ev((s) => {
    const m = window.__mc;
    for (let dz = -20; dz <= 20; dz++) {
      for (let dy = 0; dy <= 40; dy++) m.level.setBlockState(s.x - 12, s.floorY + dy, s.z + dz, 0);
    }
  }, stage);
  await waitTicks(page, 8);
  await sleep(300);
  const wallOpenLuma = meanLuma(readPng(await capture(page, stage.clip)));
  check('a wall toward the sun blocks the shafts behind it',
    wallLuma < wallOpenLuma * 0.5 && wallOpenLuma > 0.1,
    { wallLuma: +wallLuma.toFixed(3), wallOpenLuma: +wallOpenLuma.toFixed(3) });

  // --- composite A/B: strength 1 vs 0 in the open-sky view ----------------------
  await ev(() => { window.__mc.renderer.post.debug = 0; });
  await waitTicks(page, 4);
  const onShot = readPng(await capture(page, stage.clip));
  savePng(await capture(page), 'shots/diag/volumetric-on.png');

  await ev(() => { window.__mc.renderer.post.volumetricStrength = 0; });
  await waitTicks(page, 4);
  const offShot = readPng(await capture(page, stage.clip));
  savePng(await capture(page), 'shots/diag/volumetric-off.png');

  let changed = 0;
  const total = onShot.width * onShot.height;
  for (let i = 0, p = 0; i < total; i++, p += 4) {
    if (Math.abs(onShot.data[p] - offShot.data[p]) > 16
      || Math.abs(onShot.data[p + 1] - offShot.data[p + 1]) > 16
      || Math.abs(onShot.data[p + 2] - offShot.data[p + 2]) > 16) changed++;
  }
  check('composite adds the light shafts (strength 1 vs 0)',
    changed / total > 0.2, { changed, total, fraction: +(changed / total).toFixed(3) });

  // --- sun-side leaf wall with openings: the tree-shaft look from BetterMC --------
  await ev((s) => {
    const m = window.__mc;
    m.level.time = 11000;
    m.player.yaw = -90;
    m.player.pitch = 0;
    m.renderer.post.volumetricStrength = 0.3;
    const leaves = m.mc.stateOf('oak_leaves');
    for (let dx = -10; dx <= 10; dx++) {
      for (let dz = -10; dz <= 10; dz++) m.level.setBlockState(s.x + dx, s.floorY + 8, s.z + dz, 0);
    }
    for (let dz = -14; dz <= 14; dz++) {
      for (let dy = 0; dy <= 14; dy++) {
        if (dz % 5 < 2 && dy % 5 < 2) continue; // 2x2 openings every 5 blocks
        m.level.setBlockState(s.x - 10, s.floorY + dy, s.z + dz, leaves);
      }
    }
  }, stage);
  await waitTicks(page, 8);
  await sleep(350);
  savePng(await capture(page), 'shots/diag/volumetric-beams-on.png');
  await ev(() => { window.__mc.renderer.post.volumetricStrength = 0; });
  await waitTicks(page, 4);
  savePng(await capture(page), 'shots/diag/volumetric-beams-off.png');
  await ev(() => { window.__mc.renderer.post.volumetricStrength = 0.3; });

  const glAfter = await ev(() => window.__mc.renderer.post.stats.lastGlError);
  check('no GL error after the volumetric A/B', glAfter === 0 && errors.length === 0,
    { glAfter, errors: errors.slice(0, 3) });
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  if (failed > 0) process.exitCode = 1;
}
