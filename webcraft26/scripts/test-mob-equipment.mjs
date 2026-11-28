// Browser regression test for monster spawn equipment + rare loot:
//
//   * Mob.populateDefaultEquipmentSlots: 15% armor, six-step material ladder
//     (leather/copper/gold/chainmail/iron/diamond), head-first with 25% per
//     lower slot;
//   * Zombie 1% iron sword/spear/shovel; Skeleton bow + armor; Wither skeleton
//     stone sword and no armor; Drowned 10% trident/fishing rod + 3% nautilus
//     shell offhand; Zombified piglin golden sword/spear;
//   * rare player-kill loot: zombie iron/carrot/potato, drowned copper ingot,
//     wither skeleton skull, and no rare drops without a player kill.
//
//   node scripts/test-mob-equipment.mjs [--url http://127.0.0.1:5174]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { prepareStage } from './lib/stage.mjs';

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const base = urlArg >= 0 ? args[urlArg + 1] : 'http://127.0.0.1:5174';

const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
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
  await sleep(1200);
  const stage = await prepareStage(page, { radius: 8, floor: 'stone', camera: { yaw: 180, pitch: 30 } });
  const { x: bx, z: bz, floorY } = stage;
  await ev(() => { window.__mc.survival.gamemode = 'creative'; window.__mc.options.gamemode = 'creative'; });

  // -------------------------------------------------------------------------
  // 1. Zombie armor/weapon distribution (normal difficulty).
  // -------------------------------------------------------------------------
  const zombies = await ev(([x, y, z]) => {
    const m = window.__mc;
    const out = { head: 0, chest: 0, legs: 0, feet: 0, weapons: {}, materials: {} };
    for (let i = 0; i < 400; i++) {
      const e = m.entityManager.spawn('zombie', x + 0.5, y, z + 0.5);
      const eq = e.equipment;
      const id = (k) => (eq[k]?.id ?? '').replace('minecraft:', '');
      if (id(5)) out.head++;
      if (id(4)) out.chest++;
      if (id(3)) out.legs++;
      if (id(2)) out.feet++;
      for (let k = 2; k <= 5; k++) {
        const name = id(k);
        if (!name) continue;
        const mat = name.split('_')[0];
        out.materials[mat] = (out.materials[mat] ?? 0) + 1;
      }
      const main = id(0);
      if (main) out.weapons[main] = (out.weapons[main] ?? 0) + 1;
      e.remove();
    }
    return out;
  }, [bx, floorY, bz]);
  check('zombie helmet rate matches the vanilla 15% armor roll',
    zombies.head >= 35 && zombies.head <= 90, zombies);
  check('lower armor slots shrink by the 25% stop roll per slot',
    zombies.chest < zombies.head && zombies.legs < zombies.chest && zombies.feet <= zombies.legs,
  zombies);
  check('armor materials come from the six-step ladder only',
    Object.keys(zombies.materials).every((m) =>
      ['leather', 'copper', 'golden', 'chainmail', 'iron', 'diamond'].includes(m)), zombies.materials);
  check('zombie weapons stay near the 1% roll',
    Object.values(zombies.weapons).reduce((a, b) => a + b, 0) <= 15
    && Object.keys(zombies.weapons).every((w) => ['iron_sword', 'iron_spear', 'iron_shovel'].includes(w)),
  zombies.weapons);

  // -------------------------------------------------------------------------
  // 2. Skeleton / wither skeleton / drowned / zombified piglin loadouts.
  // -------------------------------------------------------------------------
  const loadouts = await ev(([x, y, z]) => {
    const m = window.__mc;
    const sample = (type, n) => {
      const out = { main: {}, off: {}, armor: 0, total: 0 };
      for (let i = 0; i < n; i++) {
        const e = m.entityManager.spawn(type, x + 0.5, y, z + 0.5);
        if (!e) continue;
        out.total++;
        const eq = e.equipment;
        const main = (eq[0]?.id ?? '').replace('minecraft:', '');
        const off = (eq[1]?.id ?? '').replace('minecraft:', '');
        if (main) out.main[main] = (out.main[main] ?? 0) + 1;
        if (off) out.off[off] = (out.off[off] ?? 0) + 1;
        if (eq[2] || eq[3] || eq[4] || eq[5]) out.armor++;
        e.remove();
      }
      return out;
    };
    return {
      skeleton: sample('skeleton', 200),
      wither: sample('wither_skeleton', 120),
      drowned: sample('drowned', 300),
      piglin: sample('zombified_piglin', 100),
    };
  }, [bx, floorY, bz]);
  check('every skeleton holds a bow and some wear armor',
    loadouts.skeleton.main.bow === loadouts.skeleton.total && loadouts.skeleton.armor > 0,
  loadouts.skeleton);
  check('wither skeletons hold only a stone sword and never armor',
    loadouts.wither.main.stone_sword === loadouts.wither.total && loadouts.wither.armor === 0,
  loadouts.wither);
  const drownedArmed = Object.values(loadouts.drowned.main).reduce((a, b) => a + b, 0);
  check('drowned weapon roll is about 10% (trident / fishing rod)',
    drownedArmed >= 12 && drownedArmed <= 60
    && Object.keys(loadouts.drowned.main).every((w) => ['trident', 'fishing_rod'].includes(w)),
  loadouts.drowned);
  check('drowned rarely carry a nautilus shell in the offhand',
    (loadouts.drowned.off.nautilus_shell ?? 0) <= 30, loadouts.drowned.off);
  check('zombified piglins always hold a golden sword or spear',
    (loadouts.piglin.main.golden_sword ?? 0) + (loadouts.piglin.main.golden_spear ?? 0)
      === loadouts.piglin.total
    && (loadouts.piglin.main.golden_spear ?? 0) <= 15,
  loadouts.piglin);

  // -------------------------------------------------------------------------
  // 3. Rare player-kill loot tables.
  // -------------------------------------------------------------------------
  const loot = await ev(([x, y, z]) => {
    const m = window.__mc;
    const kill = (type, n, playerKill) => {
      const counts = {};
      const player = m.entityManager.getPlayerTarget();
      for (let i = 0; i < n; i++) {
        const e = m.entityManager.spawn(type, x + 0.5, y, z + 0.5);
        if (!e) continue;
        if (playerKill) e.lastHurtBy = player;
        m.entityManager.onMobDeath(e);
        e.remove();
        // Drops are queued; flush before counting them.
        m.entityManager.flushSpawns();
        for (const item of m.entityManager.getEntities()) {
          if (item.isRemoved() || item.getTypeName() !== 'item') continue;
          const name = item.item?.item?.name;
          if (name) counts[name] = (counts[name] ?? 0) + 1;
          item.remove();
        }
      }
      // Remove XP orbs spawned by the kills.
      for (const e of m.entityManager.getEntities()) {
        if (e.getTypeName() === 'experience_orb') e.remove();
      }
      return counts;
    };
    return {
      zombiePlayer: kill('zombie', 300, true),
      zombieEnv: kill('zombie', 100, false),
      witherPlayer: kill('wither_skeleton', 300, true),
      drownedPlayer: kill('drowned', 200, true),
    };
  }, [bx, floorY, bz]);
  const zombieRare = (loot.zombiePlayer.iron_ingot ?? 0)
    + (loot.zombiePlayer.carrot ?? 0) + (loot.zombiePlayer.potato ?? 0);
  check('zombie player kills drop rare iron/carrot/potato',
    zombieRare >= 5 && zombieRare <= 60, loot.zombiePlayer);
  check('environmental zombie deaths never drop the rare player-only loot',
    !loot.zombieEnv.iron_ingot && !loot.zombieEnv.carrot && !loot.zombieEnv.potato,
  loot.zombieEnv);
  check('wither skeleton player kills rarely drop a skull',
    (loot.witherPlayer.wither_skeleton_skull ?? 0) >= 1
    && (loot.witherPlayer.wither_skeleton_skull ?? 0) <= 30,
  loot.witherPlayer);
  check('drowned player kills drop copper ingots at ~11%',
    (loot.drownedPlayer.copper_ingot ?? 0) >= 5
    && (loot.drownedPlayer.copper_ingot ?? 0) <= 70,
  loot.drownedPlayer);

  await page.screenshot({ path: 'shots/diag/mob-equipment.png' });
} catch (err) {
  console.log('ERROR', err);
  results.push({ name: 'probe', ok: false });
} finally {
  console.log('');
  console.log(`Total: ${results.filter((x) => x.ok).length}/${results.length} PASS`);
  await browser.close();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
}
