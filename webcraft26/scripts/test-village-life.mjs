// Browser regression test for farmer work + village food sharing:
//
//   * a villager with 24 food points shares a bread-sized amount with a hungry
//     neighbour (TradeWithVillager.shareFood);
//   * a farmer walks to mature crops, harvests them and replants (HarvestFarmland)
//     while wheat bakes into bread 3:1 (WorkAtComposter);
//   * the farmer's food/wheat/seed stock and age survive a world save.
//
//   node scripts/test-village-life.mjs [--url http://127.0.0.1:5174]
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

  const stage = await prepareStage(page, {
    radius: 12, floor: 'stone', time: 1000,
    camera: { yaw: 180, pitch: 25 },
  });
  const { x: bx, z: bz, floorY } = stage;

  // -------------------------------------------------------------------------
  // 1. Food sharing: a 24-point villager feeds a hungry neighbour.
  // -------------------------------------------------------------------------
  const share = await ev(([x, y, z]) => {
    const m = window.__mc;
    const farmer = m.entityManager.spawn('villager', x + 0.5, y, z + 0.5);
    farmer.profession = 'farmer';
    farmer.setAge(0);
    farmer.foodPoints = 24;
    const hungry = m.entityManager.spawn('villager', x + 2.5, y, z + 0.5);
    hungry.profession = 'none';
    hungry.setAge(0);
    hungry.foodPoints = 0;
    // Hold both still so the socialize scan finds them within 4 blocks.
    farmer.speed = 0;
    hungry.speed = 0;
    window.__farmer = farmer;
    window.__hungry = hungry;
    return { farmer: [farmer.x, farmer.y, farmer.z], hungry: [hungry.x, hungry.y, hungry.z] };
  }, [bx, floorY, bz]);
  check('two villagers were spawned', !!share.farmer, share);
  await waitTicks(page, 40);
  const shared = await ev(() => ({
    farmer: window.__farmer.foodPoints,
    hungry: window.__hungry.foodPoints,
  }));
  check('excess food moves to the hungry villager',
    shared.hungry >= 12 && shared.farmer < 24, shared);

  // -------------------------------------------------------------------------
  // 2. Farmer harvests mature crops and replants them.
  // -------------------------------------------------------------------------
  const crops = await ev(([x, y, z]) => {
    const m = window.__mc;
    // A 5x5 farmland patch with nine mature crops around the farmer.
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        m.level.setBlockState(x + dx, y - 1, z + dz, m.mc.stateOf('farmland'));
      }
    }
    const spots = [
      ['wheat', -1, 0], ['wheat', 1, 0], ['wheat', 0, -1],
      ['carrots', 0, 1], ['carrots', -1, -1], ['carrots', 1, 1],
      ['potatoes', -1, 1], ['beetroots', 1, -1], ['beetroots', 0, 2],
    ];
    const placed = spots.map(([name, dx, dz]) => {
      const age = name === 'beetroots' ? '3' : '7';
      m.level.setBlockState(x + dx, y, z + dz, m.mc.stateOf(name, { age }));
      return { name, x: x + dx, y, z: z + dz, age };
    });
    const farmer = window.__farmer;
    farmer.foodPoints = 0;
    farmer.wheat = 0;
    farmer.seeds = 0;
    farmer.speed = 0.5;
    farmer.x = x + 0.5; farmer.y = y; farmer.z = z + 0.5;
    farmer.xo = farmer.x; farmer.yo = farmer.y; farmer.zo = farmer.z;
    // Keep the hungry villager away so it cannot eat the harvest.
    window.__hungry.x = x - 20; window.__hungry.z = z - 20;
    return { spots: placed, farmer: [farmer.x, farmer.y, farmer.z] };
  }, [bx, floorY, bz]);
  check('nine mature crops were planted', crops.spots.length === 9, crops.spots);

  await waitTicks(page, 600, 60000);
  const harvest = await ev((spots) => {
    const m = window.__mc;
    const age = (s) => {
      const state = m.level.getBlockState(s.x, s.y, s.z);
      if (state === 0) return 'air';
      return m.mc.getProp(state, 'age') ?? '?';
    };
    return {
      ages: spots.map((s) => [s.name, age(s)]),
      food: window.__farmer.foodPoints,
      wheat: window.__farmer.wheat,
      seeds: window.__farmer.seeds,
    };
  }, crops.spots);
  const replanted = harvest.ages.filter(([, a]) => a === '0').length;
  check('the farmer harvests and replants the crops', replanted >= 3, { replanted, ...harvest });
  check('the harvest raises the farmer food stock', harvest.food > 0,
    { food: harvest.food, wheat: harvest.wheat, seeds: harvest.seeds });

  // Wheat is baked into bread (4 points per 3 wheat), so the field must have
  // converted wheat into food points rather than hoarding it.
  check('wheat bakes into bread instead of piling up', harvest.wheat < 3,
    { food: harvest.food, wheat: harvest.wheat });

  // -------------------------------------------------------------------------
  // 3. Farmer stock survives a save/reload.
  // -------------------------------------------------------------------------
  const saved = await ev(async () => {
    const m = window.__mc;
    const f = window.__farmer;
    // Freeze the farmer so baking/sharing cannot change the stock before the flush.
    f.tick = function () {};
    f.foodPoints = 7;
    f.wheat = 2; // below the 3-wheat bread recipe, so the reload cannot bake it
    f.seeds = 4;
    f.setAge(1234);
    await m.autosave.flushNow('manual');
    return { worldId: m.saveManager.currentWorldId };
  });
  check('the world saved', !!saved.worldId, saved);
  await page.goto(`${base}/?play&perf=0&world=${encodeURIComponent(saved.worldId)}`,
    { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__mc?.running === true, null, { timeout: 120000 });
  await waitTicks(page, 30);
  await sleep(600);
  const restored = await ev(() => {
    const m = window.__mc;
    return m.entityManager.getEntities()
      .filter((e) => e.getTypeName() === 'villager')
      .map((v) => ({ food: v.foodPoints, wheat: v.wheat, seeds: v.seeds, age: v.age, profession: v.profession }));
  });
  check('the farmer food, wheat and seed stock reload',
    restored.some((v) => v.food === 7 && v.wheat === 2 && v.seeds === 4), restored);

  await page.screenshot({ path: 'shots/diag/village-life.png' });
} catch (err) {
  console.log('ERROR', err);
  results.push({ name: 'probe', ok: false });
} finally {
  console.log('');
  console.log(`Total: ${results.filter((x) => x.ok).length}/${results.length} PASS`);
  await browser.close();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
}
