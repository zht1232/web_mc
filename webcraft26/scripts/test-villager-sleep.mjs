// Browser regression test for the villager sleep schedule and the simplified
// village golem spawn:
//
//   * at night a villager claims a nearby bed, walks to it and lies down
//     (VillagerSleepGoal + Villager.startSleeping), with gravity disabled and
//     the body rendered horizontally (EntityRenderer sleeping pose);
//   * one bed cannot host two villagers;
//   * sunrise wakes the sleeper and releases the bed;
//   * five villagers who slept within 24000 ticks summon a non-player-created
//     iron golem, then their sleep memory is cleared (Game.tickVillageGolemSpawn).
//
//   node scripts/test-villager-sleep.mjs [--url http://127.0.0.1:5174]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { prepareStage, frameCamera, waitTicks, capture, diffPng, savePng } from './lib/stage.mjs';

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const base = urlArg >= 0 ? args[urlArg + 1] : 'http://127.0.0.1:5174';

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 300)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (fn, arg) => page.evaluate(fn, arg);
/** Waits for two presented frames so a camera change is on screen. */
const settleFrame = () => page.evaluate(() => new Promise((r) => {
  requestAnimationFrame(() => requestAnimationFrame(() => r(null)));
}));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' :: ' + JSON.stringify(detail)}`);
};

try {
  await page.goto(`${base}/?play&perf=0`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mc?.running === true, null, { timeout: 120000 });
  await sleep(1500);

  const stage = await prepareStage(page, { radius: 16, floor: 'stone', time: 6000 });
  const { x: bx, z: bz, floorY } = stage;

  // -------------------------------------------------------------------------
  // 1. Reference: an awake villager renders upright (taller than wide). The
  //    villager is levelled with the camera eye and frozen for a stable frame.
  // -------------------------------------------------------------------------
  const refPos = await ev(([x, y, z]) => {
    const m = window.__mc;
    const v = m.entityManager.spawn('villager', x - 4.5, y + 0.65, z + 0.5);
    v.noGravity = true;
    v.tick = function () {};
    window.__ref = v;
    return { x: v.x, y: v.y, z: v.z };
  }, [bx, floorY, bz]);
  await waitTicks(page, 2);
  await frameCamera(page, { x: refPos.x + 8, y: floorY, z: refPos.z, yaw: 270, pitch: 0, fov: 60 });
  await waitTicks(page, 2);
  await settleFrame();
  const standA = await capture(page, stage.clip);
  savePng(standA, 'shots/diag/villager-sleep-awake.png');
  await ev(() => {
    window.__ref.remove();
    // Re-apply the camera so residual interpolation cannot shift the diff.
    const p = window.__mc.player;
    p.vel = new p.pos.constructor(0, 0, 0);
  });
  await waitTicks(page, 2);
  await settleFrame();
  const standB = await capture(page, stage.clip);
  const standDiff = diffPng(standA, standB, 40);
  check('awake villager renders upright (taller than wide)',
    standDiff.changed > 400 && !!standDiff.bbox && standDiff.bbox.h > standDiff.bbox.w * 1.6,
    { bbox: standDiff.bbox, changed: standDiff.changed });

  // -------------------------------------------------------------------------
  // 2. Night: the villager walks to a bed and lies down.
  // -------------------------------------------------------------------------
  const bed = await ev(([x, y, z]) => {
    const m = window.__mc;
    // facing=south: foot at z-1, head at z (the pillow points +Z).
    m.level.setBlockState(x + 1, y, z - 1, m.mc.stateOf('red_bed', { facing: 'south', part: 'foot' }));
    m.level.setBlockState(x + 1, y, z, m.mc.stateOf('red_bed', { facing: 'south', part: 'head' }));
    const v = m.entityManager.spawn('villager', x - 3.5, y, z + 0.5);
    v.speed = 0.5;
    window.__sleeper = v;
    m.level.time = 13000;
    return { x: x + 1, y, z };
  }, [bx, floorY, bz]);

  let slept = false;
  for (let i = 0; i < 8 && !slept; i++) {
    await waitTicks(page, 100);
    slept = await ev(() => window.__sleeper.sleeping === true);
  }
  const state = await ev(() => {
    const v = window.__sleeper;
    return { sleeping: v.sleeping, x: v.x, y: v.y, z: v.z, noGravity: v.noGravity, bed: !!v.bed };
  });
  check('villager walks to a bed and sleeps at night', state.sleeping, state);
  check('sleeping villager lies on the bed surface',
    Math.abs(state.y - (floorY + 0.8)) < 0.12, { y: state.y });
  check('sleeping villager is centred on the two-block bed',
    Math.abs(state.x - (bed.x + 0.5)) < 0.05 && Math.abs(state.z - bed.z) < 0.05,
    { pos: [state.x, state.z], bed });
  check('sleeping villager has gravity disabled', state.noGravity === true, state);

  // Lying pose: from the side the sleeping body must span the bed horizontally
  // (a standing villager at the same spot would be tall and narrow).
  await frameCamera(page, { x: bed.x + 7.5, y: floorY + 2.2, z: bed.z, yaw: 270, pitch: 20, fov: 60 });
  await waitTicks(page, 2);
  await settleFrame();
  const lieA = await capture(page, stage.clip);
  savePng(lieA, 'shots/diag/villager-sleep.png');
  await ev(() => {
    window.__sleeper.remove();
    const p = window.__mc.player;
    p.vel = new p.pos.constructor(0, 0, 0);
  });
  await waitTicks(page, 2);
  await settleFrame();
  const lieB = await capture(page, stage.clip);
  const lieDiff = diffPng(lieA, lieB, 40);
  check('sleeping villager renders lying down (wider than tall)',
    lieDiff.changed > 800 && !!lieDiff.bbox && lieDiff.bbox.w > lieDiff.bbox.h * 1.5,
    { bbox: lieDiff.bbox, changed: lieDiff.changed });

  // -------------------------------------------------------------------------
  // 3. One bed hosts a single villager.
  // -------------------------------------------------------------------------
  await ev(([x, y, z]) => {
    const m = window.__mc;
    const a = m.entityManager.spawn('villager', x - 1.5, y, z - 3.5);
    const b = m.entityManager.spawn('villager', x - 1.5, y, z + 3.5);
    a.speed = 0.5; b.speed = 0.5;
    window.__rivals = [a, b];
  }, [bx, floorY, bz]);
  await waitTicks(page, 240);
  const rivals = await ev(() => window.__rivals.map((v) => ({
    sleeping: v.sleeping, bed: !!v.bed,
  })));
  check('one bed hosts only one villager',
    rivals.filter((r) => r.sleeping).length === 1, rivals);

  // -------------------------------------------------------------------------
  // 4. Sunrise wakes the sleeper and releases the bed.
  // -------------------------------------------------------------------------
  await ev(() => { window.__mc.level.time = 1000; });
  await waitTicks(page, 20);
  const woke = await ev(() => {
    const m = window.__mc;
    const all = m.entityManager.getEntities().filter((e) => e.getTypeName() === 'villager');
    return {
      sleeping: all.filter((v) => v.sleeping).length,
      floating: all.filter((v) => v.noGravity).length,
      claimedBeds: all.filter((v) => v.bed).length,
    };
  });
  check('sunrise wakes sleeping villagers', woke.sleeping === 0, woke);
  check('waking villagers restore gravity and release the bed',
    woke.floating === 0 && woke.claimedBeds === 0, woke);

  // -------------------------------------------------------------------------
  // 5. Five recent sleepers summon a non-player-created iron golem.
  // -------------------------------------------------------------------------
  const setup = await ev(([x, y, z]) => {
    const m = window.__mc;
    for (const e of m.entityManager.getEntities()) e.remove();
    // Remove the bed so nobody can refresh the sleep memory during the check.
    m.level.setBlockState(x + 1, y, z - 1, 0);
    m.level.setBlockState(x + 1, y, z, 0);
    const now = m.level.gameTime;
    const spots = [[-3, 0], [3, 0], [0, -3], [0, 3], [0, 0]];
    window.__golemVillagers = spots.map(([dx, dz]) => {
      const v = m.entityManager.spawn('villager', x + dx + 0.5, y, z + dz + 0.5);
      v.setAge(0);
      v.lastSleptGameTime = now;
      // Freeze them so the village centroid stays (x + 0.5, z + 0.5).
      v.tick = function () {};
      return v;
    });
    return { now };
  }, [bx, floorY, bz]);
  // Poll every 5 ticks so the golem is measured at its spawn position before
  // its stroll goal can walk it away from the village.
  let golem = null;
  for (let i = 0; i < 24 && !golem; i++) {
    await waitTicks(page, 5);
    golem = await ev(() => {
      const m = window.__mc;
      const g = m.entityManager.getEntities().find((e) => e.getTypeName() === 'iron_golem');
      if (!g) return null;
      return { playerCreated: g.playerCreated, x: g.x, y: g.y, z: g.z };
    });
  }
  const memory = await ev(() => window.__golemVillagers.map((v) => v.lastSleptGameTime));
  check('five villagers who slept summon an iron golem', !!golem, golem);
  check('the village golem is not player-created',
    !!golem && golem.playerCreated === false, golem);
  check('the golem spawns near the village',
    !!golem && Math.hypot(golem.x - (bx + 0.5), golem.z - (bz + 0.5)) <= 16,
    golem);
  check('the spawn clears the villagers sleep memory',
    memory.every((t) => t === -1), memory);

  await sleep(400);
  await page.screenshot({ path: 'shots/diag/villager-sleep-golem.png' });
} catch (err) {
  console.log('ERROR', err);
  results.push({ name: 'probe', ok: false });
} finally {
  console.log('');
  console.log(`Total: ${results.filter((x) => x.ok).length}/${results.length} PASS`);
  await browser.close();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
}
