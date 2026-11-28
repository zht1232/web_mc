// Browser probe for the Complementary Reimagined r5.9.3 volumetric-cloud port.
//
// CLOUD_FRAG (src/client/renderer/post/PostShaders.ts) ray-marches the 192-block cloud slab
// against the generated coverage field (TextureManager.cloudNoise) and replaces the vanilla
// voxel cloud layer while active. This probe checks:
//   * the pass runs on the high tier with no GL/page error (stats.clouds);
//   * the coverage mask (composite debug 6) has clouds in the upper sky and visible gaps;
//   * the sky changes when the shader clouds are toggled off (vanilla clouds are back);
//   * a high sun and a sunset both render without errors; screenshots are saved for review.
//
//   node scripts/test-volumetric-clouds.mjs [--url http://127.0.0.1:5174]
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
  if (msg.type() === 'error' && /shader|webgl|program|cloud/i.test(msg.text())) {
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

  // Above the 192-block cloud deck: clear the arena floor so the view below the horizon is
  // open sky + terrain, which is where the volumetric layer is visible from up here.
  const stage = await prepareStage(page, {
    y: 240,
    radius: 6,
    floor: 'stone',
    time: 6000,
    camera: { yaw: 0, pitch: 10, fov: 75 },
  });
  await ev((s) => {
    const m = window.__mc;
    for (let dx = -12; dx <= 12; dx++) {
      for (let dz = -12; dz <= 12; dz++) {
        for (let dy = 0; dy <= 12; dy++) m.level.setBlockState(s.x + dx, s.floorY + dy, s.z + dz, 0);
        m.level.setBlockState(s.x + dx, s.floorY - 1, s.z + dz, 0);
      }
    }
    m.player.pitch = 10;
  }, stage);

  await ev(() => {
    const m = window.__mc;
    m.renderer.shadersEnabled = true;
    m.renderer.post.setQuality('high');
    m.renderer.swayEnabled = false;
    m.renderer.post.cloudsEnabled = true;
    m.renderer.post.cloudsStrength = 1;
  });
  await waitTicks(page, 8);
  await sleep(400);

  const info = await ev(() => {
    const m = window.__mc;
    return {
      enabled: m.renderer.shadersEnabled,
      quality: m.renderer.post.quality,
      clouds: m.renderer.post.stats.clouds,
      cloudNoise: !!m.textures?.cloudNoise,
      glError: m.renderer.post.stats.lastGlError,
    };
  });
  check('volumetric-cloud pass active on the high tier',
    info.enabled === true && info.quality === 'high' && info.clouds === true && info.glError === 0,
    info);
  check('no shader/WebGL errors while the cloud pass renders', errors.length === 0, errors.slice(0, 3));

  // Coverage mask (composite debug 6 = cloud alpha). Looking slightly down from above the
  // deck, the band between the horizon and the HUD is the cloud layer.
  await ev(() => { window.__mc.renderer.post.debug = 6; });
  await waitTicks(page, 3);
  const mask = readPng(await capture(page, stage.clip));
  const y0 = Math.floor(mask.height * 0.3);
  const y1 = Math.floor(mask.height * 0.7);
  let sky = 0;
  let covered = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < mask.width; x++) {
      const p = (y * mask.width + x) * 4;
      sky++;
      if (mask.data[p] > 60) covered++;
    }
  }
  const cover = covered / Math.max(1, sky);
  check('cloud coverage appears in the sky band with gaps',
    cover > 0.1 && cover < 0.95, { cover: +cover.toFixed(3), skyPixels: sky });

  // A/B: shader clouds vs the vanilla layer (strength 0 hands the layer back to CloudRenderer).
  await ev(() => { window.__mc.renderer.post.debug = 0; });
  await waitTicks(page, 4);
  const onShot = readPng(await capture(page, stage.clip));
  savePng(await capture(page), 'shots/diag/clouds-on.png');

  await ev(() => { window.__mc.renderer.post.cloudsStrength = 0; });
  await waitTicks(page, 4);
  const offShot = readPng(await capture(page, stage.clip));
  savePng(await capture(page), 'shots/diag/clouds-off-vanilla.png');

  let changed = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < mask.width; x++) {
      const p = (y * mask.width + x) * 4;
      total++;
      if (Math.abs(onShot.data[p] - offShot.data[p]) > 16
        || Math.abs(onShot.data[p + 1] - offShot.data[p + 1]) > 16
        || Math.abs(onShot.data[p + 2] - offShot.data[p + 2]) > 16) changed++;
    }
  }
  check('shader clouds replace the vanilla layer',
    changed / Math.max(1, total) > 0.1, { changed, total, fraction: +(changed / total).toFixed(3) });

  // Sunset path: warm cloud lighting must render cleanly too.
  await ev(() => {
    const m = window.__mc;
    m.renderer.post.cloudsStrength = 1;
    m.level.time = 12000;
  });
  await waitTicks(page, 8);
  await sleep(350);
  savePng(await capture(page), 'shots/diag/clouds-sunset.png');
  const dusk = await ev(() => window.__mc.renderer.post.stats.lastGlError);
  check('sunset clouds render without GL errors', dusk === 0 && errors.length === 0,
    { glError: dusk, errors: errors.slice(0, 3) });

  // Player-level view from below the deck: the usual in-game angle for clouds.
  await ev((s) => {
    const m = window.__mc;
    const p = m.player;
    m.level.time = 6000;
    p.flying = true;
    p.pos.x = s.x + 0.5;
    p.pos.y = 150;
    p.pos.z = s.z + 0.5;
    p.prevPos.x = p.pos.x;
    p.prevPos.y = p.pos.y;
    p.prevPos.z = p.pos.z;
    p.yaw = 0;
    p.pitch = -25;
    p.vel = new p.pos.constructor(0, 0, 0);
  }, stage);
  await waitTicks(page, 8);
  await sleep(350);
  savePng(await capture(page), 'shots/diag/clouds-below-on.png');
  await ev(() => { window.__mc.renderer.post.cloudsStrength = 0; });
  await waitTicks(page, 4);
  savePng(await capture(page), 'shots/diag/clouds-below-off-vanilla.png');
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  if (failed > 0) process.exitCode = 1;
}
