// Browser regression test for the villager daily schedule:
//
//   * the VillagerSchedules.VILLAGER_DEFAULT clock maps to
//     wake / work / meet / idle / sleep phases (Villager.getSchedulePhase);
//   * during WORK villagers walk back to their claimed job site;
//   * during MEET villagers gather around the village bell;
//   * farming only runs in WORK (a farmer does not harvest at the meeting).
//
//   node scripts/test-village-schedule.mjs [--url http://127.0.0.1:5174]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { prepareStage, waitTicks } from './lib/stage.mjs';

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const base = urlArg >= 0 ? args[urlArg + 1] : 'http://127.0.0.1:5174';

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 300)));
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
  await sleep(1500);

  const stage = await prepareStage(page, { radius: 16, floor: 'stone', time: 1000 });
  const { x: bx, z: bz, floorY } = stage;

  // -------------------------------------------------------------------------
  // 1. WORK: two villagers claim job sites and stand at their workstations.
  // -------------------------------------------------------------------------
  const setup = await ev(([x, y, z]) => {
    const m = window.__mc;
    m.level.setBlockState(x + 3, y, z, m.mc.stateOf('composter'));
    m.level.setBlockState(x - 3, y, z + 2, m.mc.stateOf('lectern'));
    const a = m.entityManager.spawn('villager', x + 0.5, y, z + 5.5);
    const b = m.entityManager.spawn('villager', x - 1.5, y, z - 5.5);
    a.speed = 0.5; b.speed = 0.5;
    window.__workers = [a, b];
    return { time: m.level.time };
  }, [bx, floorY, bz]);
  check('the stage starts in the work window', setup.time === 1000, setup);

  let assigned = false;
  for (let i = 0; i < 12 && !assigned; i++) {
    await waitTicks(page, 40);
    assigned = await ev(() => window.__workers.every((v) => v.profession !== 'none' && v.jobSite));
  }
  const jobs = await ev(() => window.__workers.map((v) => ({
    profession: v.profession,
    job: v.jobSite ? [v.jobSite.x, v.jobSite.y, v.jobSite.z] : null,
    dist: v.jobSite ? Math.sqrt(v.distanceToSqr(v.jobSite.x + 0.5, v.jobSite.y, v.jobSite.z + 0.5)) : null,
  })));
  check('both villagers claim a job site', assigned, jobs);

  let atWork = false;
  for (let i = 0; i < 12 && !atWork; i++) {
    await waitTicks(page, 30);
    atWork = await ev(() => window.__workers.every((v) => v.jobSite
      && v.distanceToSqr(v.jobSite.x + 0.5, v.jobSite.y, v.jobSite.z + 0.5) < 9));
  }
  const workPos = await ev(() => window.__workers.map((v) => ({
    dist: Math.sqrt(v.distanceToSqr(v.jobSite.x + 0.5, v.jobSite.y, v.jobSite.z + 0.5)),
  })));
  check('work-time villagers stand at their workstations', atWork, workPos);

  // -------------------------------------------------------------------------
  // 2. Schedule clock -> activity phases.
  // -------------------------------------------------------------------------
  const phases = await ev(() => {
    const m = window.__mc;
    const v = window.__workers[0];
    const out = {};
    for (const [time, key] of [[0, 'wake'], [1000, 'work'], [4000, 'meet'], [6000, 'idle'], [9600, 'work2'], [13000, 'sleep']]) {
      m.level.time = time;
      out[key] = v.getSchedulePhase();
    }
    m.level.time = 1000;
    return out;
  });
  check('the daily clock selects the vanilla activity phase',
    phases.wake === 'wake' && phases.work === 'work' && phases.meet === 'meet'
      && phases.idle === 'idle' && phases.work2 === 'work' && phases.sleep === 'sleep', phases);

  // -------------------------------------------------------------------------
  // 3. MEET: villagers gather around a bell.
  // -------------------------------------------------------------------------
  await ev(([x, y, z]) => {
    const m = window.__mc;
    m.level.setBlockState(x, y, z - 3, m.mc.stateOf('bell'));
    window.__bell = { x, y, z: z - 3 };
    m.level.time = 4000;
  }, [bx, floorY, bz]);
  let atBell = false;
  for (let i = 0; i < 15 && !atBell; i++) {
    await waitTicks(page, 30);
    atBell = await ev(() => window.__workers.every((v) => {
      const b = window.__bell;
      return Math.hypot(v.x - (b.x + 0.5), v.z - (b.z + 0.5)) < 4;
    }));
  }
  const meetPos = await ev(() => {
    const b = window.__bell;
    return window.__workers.map((v) => ({
      x: v.x, z: v.z,
      dist: Math.hypot(v.x - (b.x + 0.5), v.z - (b.z + 0.5)),
    }));
  });
  check('meet-time villagers gather around the bell', atBell, meetPos);

  // -------------------------------------------------------------------------
  // 4. Farming is gated to WORK: no harvest during the meeting.
  // -------------------------------------------------------------------------
  const crops = await ev(([x, y, z]) => {
    const m = window.__mc;
    const farmer = window.__workers.find((v) => v.profession === 'farmer')
      ?? window.__workers[0];
    window.__farmer = farmer;
    const spots = [[1, 1], [2, 0], [-1, 1]];
    const placed = spots.map(([dx, dz]) => {
      m.level.setBlockState(x + dx, y - 1, z + dz, m.mc.stateOf('farmland'));
      m.level.setBlockState(x + dx, y, z + dz, m.mc.stateOf('wheat', { age: '7' }));
      return { x: x + dx, y, z: z + dz };
    });
    return { spots: placed, farmer: farmer.profession };
  }, [bx, floorY, bz]);
  check('a farmer is under test with mature crops', crops.farmer === 'farmer', crops);

  await waitTicks(page, 200);
  const meetHarvest = await ev((spots) => {
    const m = window.__mc;
    return spots.map((s) => {
      const state = m.level.getBlockState(s.x, s.y, s.z);
      return state === 0 ? 'air' : m.mc.getProp(state, 'age');
    });
  }, crops.spots);
  check('the farmer does not harvest during the meeting',
    meetHarvest.every((age) => age === '7'), meetHarvest);

  // -------------------------------------------------------------------------
  // 5. Back to WORK: the same crops are harvested.
  // -------------------------------------------------------------------------
  await ev(() => { window.__mc.level.time = 1000; });
  await waitTicks(page, 400);
  const workHarvest = await ev((spots) => {
    const m = window.__mc;
    return spots.map((s) => {
      const state = m.level.getBlockState(s.x, s.y, s.z);
      return state === 0 ? 'air' : m.mc.getProp(state, 'age');
    });
  }, crops.spots);
  check('work-time harvesting resumes',
    workHarvest.filter((age) => age !== '7').length >= 2, workHarvest);

  let backAtWork = false;
  for (let i = 0; i < 15 && !backAtWork; i++) {
    await waitTicks(page, 30);
    backAtWork = await ev(() => window.__workers.every((v) => v.jobSite
      && v.distanceToSqr(v.jobSite.x + 0.5, v.jobSite.y, v.jobSite.z + 0.5) < 9));
  }
  check('after the meeting the villagers return to their workstations', backAtWork);

  await page.screenshot({ path: 'shots/diag/village-schedule.png' });
} catch (err) {
  console.log('ERROR', err);
  results.push({ name: 'probe', ok: false });
} finally {
  console.log('');
  console.log(`Total: ${results.filter((x) => x.ok).length}/${results.length} PASS`);
  await browser.close();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
}
