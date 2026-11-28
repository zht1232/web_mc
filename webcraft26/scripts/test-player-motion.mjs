// Browser probe for two vanilla-motion/fx ports:
//   * creative flight vertical speed (LocalPlayer.aiStep: inputYa * flyingSpeed * 3, then
//     Player.travel keeps delta.y * 0.6) - the old code assigned a fixed +-0.5395;
//   * terrain break particles use the block tint source (grass/leaf sprites are greyscale).
//
//   node scripts/test-player-motion.mjs [--url http://127.0.0.1:5174]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { prepareStage, waitTicks } from './lib/stage.mjs';

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const base = urlArg >= 0 ? args[urlArg + 1] : 'http://127.0.0.1:5174';

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (fn, arg) => page.evaluate(fn, arg);
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
};
const close = (a, b, eps) => Math.abs(a - b) <= eps;

try {
  await page.goto(`${base}/?play&perf=0`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mc?.running === true, null, { timeout: 120000 });
  await sleep(1200);
  const stage = await prepareStage(page, { radius: 6, floor: 'stone' });
  await ev(() => {
    const m = window.__mc;
    m.entityManager.spawnInterval = 1e9;
    m.player.flying = true;
    m.player.vel.y = 0;
    m.keys.clear();
  });
  await waitTicks(page, 2);

  const up1 = await ev(() => {
    const m = window.__mc;
    m.player.vel.y = 0;
    m.keys.add('Space');
    return m.player.vel.y;
  });
  await waitTicks(page, 1);
  const upAfterOne = await ev(() => window.__mc.player.vel.y);
  await waitTicks(page, 7);
  const upTerminal = await ev(() => window.__mc.player.vel.y);
  check('creative flight accelerates upward (0.15 * 0.6 first tick, 0.225 terminal)',
    close(upAfterOne, 0.09, 0.02) && close(upTerminal, 0.225, 0.02),
    { startVy: up1, afterOne: upAfterOne, terminal: upTerminal });

  await ev(() => { window.__mc.keys.delete('Space'); });
  await waitTicks(page, 8);
  const hover = await ev(() => window.__mc.player.vel.y);
  check('releasing jump damps vertical speed to a hover', Math.abs(hover) < 0.01, { hover });

  await ev(() => { window.__mc.keys.add('ShiftLeft'); });
  await waitTicks(page, 8);
  const downTerminal = await ev(() => window.__mc.player.vel.y);
  await ev(() => { window.__mc.keys.delete('ShiftLeft'); });
  check('sneak descends at the mirrored speed', close(downTerminal, -0.225, 0.02), { downTerminal });

  const particles = await ev((s) => {
    const m = window.__mc;
    const bx = s.x + 3;
    const bz = s.z + 3;
    const y = s.floorY;
    m.level.setBlockState(bx, y, bz, m.mc.stateOf('short_grass'));
    const grassState = m.level.getBlockState(bx, y, bz);
    const before = m.particles.pool.alive.slice();
    m.breakEffects(grassState, bx, y, bz);
    const grass = [];
    for (let i = 0; i < m.particles.pool.capacity; i++) {
      if (!before[i] && m.particles.pool.alive[i]) {
        grass.push([m.particles.pool.r[i], m.particles.pool.g[i], m.particles.pool.b[i]]);
      }
    }
    // Grass block: BlockTintSources.grassBlock().colorAsTerrainParticle returns -1 (dirt sprite).
    const gx = bx + 2;
    m.level.setBlockState(gx, y - 1, bz, m.mc.stateOf('grass_block'));
    const grassBlockState = m.level.getBlockState(gx, y - 1, bz);
    const before2 = m.particles.pool.alive.slice();
    m.breakEffects(grassBlockState, gx, y - 1, bz);
    const block = [];
    for (let i = 0; i < m.particles.pool.capacity; i++) {
      if (!before2[i] && m.particles.pool.alive[i]) {
        block.push([m.particles.pool.r[i], m.particles.pool.g[i], m.particles.pool.b[i]]);
      }
    }
    return { grass, block };
  }, stage);
  const grassTint = particles.grass[0] ?? [0, 0, 0];
  check('grass break particles carry the biome colour (green dominant)',
    particles.grass.length >= 20 && grassTint[1] > grassTint[0] && grassTint[1] > grassTint[2]
    && !(grassTint[0] === 1 && grassTint[1] === 1 && grassTint[2] === 1),
    { count: particles.grass.length, tint: grassTint });
  const blockTint = particles.block[0] ?? [0, 0, 0];
  check('grass block particles stay untinted (dirt sprite)',
    particles.block.length >= 20 && blockTint.every((c) => c === 1), { tint: blockTint });

  check('no page errors', errors.length === 0, errors.slice(0, 2));
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  if (failed > 0) process.exitCode = 1;
}
