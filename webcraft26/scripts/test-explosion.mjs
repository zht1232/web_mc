// Browser regression test for the vanilla explosion model:
//
//   * ServerExplosion's 1352-ray block destruction: blast resistance matters
//     (dirt crater >> stone crater), no destruction beyond radius * 1.3, and
//     the old "destroy every block in a power*2 sphere" behaviour is gone;
//   * ApplyExplosionDecay (default gamerules): only a fraction of dropped items
//     survives (chance 1/radius);
//   * PrimedTnt owner: a player-lit TNT credits the player, so mobs hurt by the
//     blast remember the player as the attacker;
//   * ServerExplosion.getSeenPercent: a wall between the blast and an entity
//     blocks the 16^3 exposure samples, cutting both damage and knockback.
//
//   node scripts/test-explosion.mjs [--url http://127.0.0.1:5174]
import { chromium } from 'playwright';
import { launchOptions } from './lib/browser.mjs';
import { prepareStage, waitTicks } from './lib/stage.mjs';

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
  const stage = await prepareStage(page, { radius: 10, floor: 'stone', camera: { yaw: 180, pitch: 30 } });
  const { x: bx, z: bz, floorY } = stage;
  await ev(() => { window.__mc.survival.gamemode = 'creative'; window.__mc.options.gamemode = 'creative'; });

  // -------------------------------------------------------------------------
  // 1. Dirt cube blast: realistic crater, resistance-aware, decayed drops.
  // -------------------------------------------------------------------------
  const dirt = await ev(([x, y, z]) => {
    const m = window.__mc;
    const dirtState = m.mc.stateOf('dirt');
    // Clear the volume, then fill a 15x7x15 dirt cube standing on the stage.
    for (let dx = -8; dx <= 8; dx++) {
      for (let dz = -8; dz <= 8; dz++) {
        for (let dy = -1; dy <= 9; dy++) m.level.setBlockState(x + dx, y + dy, z + dz, 0);
      }
    }
    for (let dx = -7; dx <= 7; dx++) {
      for (let dz = -7; dz <= 7; dz++) {
        for (let dy = 0; dy <= 6; dy++) m.level.setBlockState(x + dx, y + dy, z + dz, dirtState);
      }
    }
    // TNT in a one-block cavity at the cube centre.
    const cy = y + 3;
    m.level.setBlockState(x, cy, z, 0);
    const tnt = m.entityManager.spawn('tnt', x + 0.5, cy, z + 0.5);
    tnt.setFuse(5);
    for (const e of m.entityManager.getEntities()) if (e.getTypeName() === 'item') e.remove();
    return { cx: x + 0.5, cy: cy + 0.5, cz: z + 0.5 };
  }, [bx, floorY, bz]);
  await waitTicks(page, 12);

  const dirtCrater = await ev(({ cx, cy, cz }) => {
    const m = window.__mc;
    m.entityManager.flushSpawns();
    let destroyed = 0;
    let maxDist = 0;
    for (let dx = -7; dx <= 7; dx++) {
      for (let dz = -7; dz <= 7; dz++) {
        for (let dy = 0; dy <= 6; dy++) {
          const x = Math.floor(cx) + dx, y = Math.floor(cy) + dy - 3, z = Math.floor(cz) + dz;
          const state = m.level.getBlockState(x, y, z);
          if (state !== 0) continue;
          destroyed++;
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy, z + 0.5 - cz);
          if (d > maxDist) maxDist = d;
        }
      }
    }
    let drops = 0;
    for (const e of m.entityManager.getEntities()) {
      if (e.isRemoved() || e.getTypeName() !== 'item') continue;
      if ((e.item?.item?.name ?? '') === 'dirt') drops += e.item.getCount();
    }
    return { destroyed, maxDist, drops };
  }, dirt);
  check('the TNT carves a crater in the dirt cube',
    dirtCrater.destroyed >= 40 && dirtCrater.destroyed <= 500, dirtCrater);
  check('no block beyond the blast reach is destroyed', dirtCrater.maxDist <= 6,
    dirtCrater);
  check('explosion drop decay keeps only a fraction of the dirt',
    dirtCrater.drops > 0 && dirtCrater.drops <= dirtCrater.destroyed * 0.6, dirtCrater);

  // -------------------------------------------------------------------------
  // 2. Stone cube: much smaller crater (blast resistance 6 vs dirt 0.5).
  // -------------------------------------------------------------------------
  const stone = await ev(([x, y, z]) => {
    const m = window.__mc;
    const stoneState = m.mc.stateOf('stone');
    for (let dx = -8; dx <= 8; dx++) {
      for (let dz = -8; dz <= 8; dz++) {
        for (let dy = -1; dy <= 9; dy++) m.level.setBlockState(x + 40 + dx, y + dy, z + dz, 0);
      }
    }
    for (let dx = -7; dx <= 7; dx++) {
      for (let dz = -7; dz <= 7; dz++) {
        for (let dy = 0; dy <= 6; dy++) m.level.setBlockState(x + 40 + dx, y + dy, z + dz, stoneState);
      }
    }
    m.level.setBlockState(x + 40, y + 3, z, 0);
    const tnt = m.entityManager.spawn('tnt', x + 40.5, y + 3, z + 0.5);
    tnt.setFuse(5);
    for (const e of m.entityManager.getEntities()) if (e.getTypeName() === 'item') e.remove();
    return { cx: x + 40.5, cy: y + 3.5, cz: z + 0.5 };
  }, [bx, floorY, bz]);
  await waitTicks(page, 12);
  const stoneCrater = await ev(({ cx, cy, cz }) => {
    const m = window.__mc;
    let destroyed = 0;
    for (let dx = -7; dx <= 7; dx++) {
      for (let dz = -7; dz <= 7; dz++) {
        for (let dy = 0; dy <= 6; dy++) {
          const x = Math.floor(cx) + dx, y = Math.floor(cy) + dy - 3, z = Math.floor(cz) + dz;
          if (m.level.getBlockState(x, y, z) === 0) destroyed++;
        }
      }
    }
    return { destroyed };
  }, stone);
  check('stone resists the blast far more than dirt',
    stoneCrater.destroyed < Math.max(8, dirtCrater.destroyed * 0.5), { dirt: dirtCrater, stone: stoneCrater });

  // -------------------------------------------------------------------------
  // 3. Player-lit TNT credits the player for damage.
  // -------------------------------------------------------------------------
  const owner = await ev(([x, y, z]) => {
    const m = window.__mc;
    const stone = m.mc.stateOf('stone');
    for (let dx = -1; dx <= 6; dx++) {
      for (let dz = -2; dz <= 2; dz++) m.level.setBlockState(x + dx, y - 1, z + dz, stone);
    }
    for (let dx = -3; dx <= 7; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        for (let dy = 0; dy <= 4; dy++) m.level.setBlockState(x + dx, y + dy, z + dz, 0);
      }
    }
    const golem = m.entityManager.spawn('iron_golem', x + 3.5, y, z + 0.5);
    const tnt = m.entityManager.spawn('tnt', x + 0.5, y, z + 0.5);
    tnt.setFuse(5);
    tnt.setOwner(m.entityManager.getPlayerTarget());
    return { health: golem.health };
  }, [bx + 20, floorY, bz]);
  await waitTicks(page, 12);
  const owned = await ev(() => {
    const m = window.__mc;
    const golem = m.entityManager.getEntities().find((e) => e.getTypeName() === 'iron_golem');
    return golem ? {
      health: golem.health,
      ownerIsPlayer: golem.lastHurtBy === m.entityManager.getPlayerTarget(),
    } : null;
  });
  check('the blast damages a nearby mob', !!owned && owned.health < owner.health, { before: owner, after: owned });
  check('a player-lit TNT credits the player as the attacker',
    !!owned && owned.ownerIsPlayer === true, owned);

  // -------------------------------------------------------------------------
  // 4. Exposure: a stone wall between the blast and an entity blocks the
  //    getSeenPercent samples, so only the exposed target takes real damage.
  // -------------------------------------------------------------------------
  const exposure = await ev(([x, y, z]) => {
    const m = window.__mc;
    const stone = m.mc.stateOf('stone');
    for (let dx = -6; dx <= 8; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        m.level.setBlockState(x + dx, y - 1, z + dz, stone);
        for (let dy = 0; dy <= 4; dy++) m.level.setBlockState(x + dx, y + dy, z + dz, 0);
      }
    }
    // 5x4 stone wall at x+2, between the blast and the covered zombie.
    for (let dz = -2; dz <= 2; dz++) {
      for (let dy = 0; dy <= 3; dy++) m.level.setBlockState(x + 2, y + dy, z + dz, stone);
    }
    const covered = m.entityManager.spawn('zombie', x + 4.5, y, z + 0.5);
    const open = m.entityManager.spawn('zombie', x - 3.5, y, z + 0.5);
    for (const e of [covered, open]) {
      e.equipment.fill(null);
      e.health = 20;
    }
    const cx = x + 0.5, cy = y + 1, cz = z + 0.5;
    const seenCovered = m.explosionSeenPercent(cx, cy, cz, covered.getBoundingBox());
    const seenOpen = m.explosionSeenPercent(cx, cy, cz, open.getBoundingBox());
    m.mobGriefing = false;
    m.explode(cx, cy, cz, 3, 'mob', null);
    const out = {
      seenCovered, seenOpen,
      coveredHealth: covered.health,
      openHealth: open.health,
      wallIntact: m.level.getBlockState(x + 2, y + 1, z) !== 0,
    };
    covered.remove();
    open.remove();
    return out;
  }, [bx + 60, floorY, bz]);
  check('a wall blocks the explosion exposure samples',
    exposure.seenCovered <= 0.05 && exposure.seenOpen >= 0.9 && exposure.wallIntact, exposure);
  check('cover sharply reduces blast damage on a mob',
    exposure.coveredHealth >= 18 && exposure.openHealth <= 14, exposure);

  // -------------------------------------------------------------------------
  // 5. The local player uses the same exposure rule.
  // -------------------------------------------------------------------------
  const playerCovered = await ev(([x, y, z]) => {
    const m = window.__mc;
    m.options.gamemode = 'survival';
    m.survival.gamemode = 'survival';
    const p = m.player;
    p.pos.x = x + 4.5; p.pos.y = y; p.pos.z = z + 0.5;
    p.prevPos.x = p.pos.x; p.prevPos.y = p.pos.y; p.prevPos.z = p.pos.z;
    p.vel.x = p.vel.y = p.vel.z = 0;
    p.flying = false;
    m.survival.hp = 20;
    m.explode(x + 0.5, y + 1, z + 0.5, 3, 'mob', null);
    return { hp: m.survival.hp };
  }, [bx + 60, floorY, bz]);
  check('a player behind cover takes minimal blast damage',
    playerCovered.hp >= 18, playerCovered);

  await waitTicks(page, 12);
  const playerOpen = await ev(([x, y, z]) => {
    const m = window.__mc;
    const p = m.player;
    p.pos.x = x - 3.5; p.pos.y = y; p.pos.z = z + 0.5;
    p.prevPos.x = p.pos.x; p.prevPos.y = p.pos.y; p.prevPos.z = p.pos.z;
    p.vel.x = p.vel.y = p.vel.z = 0;
    p.flying = false;
    m.survival.hp = 20;
    m.explode(x + 0.5, y + 1, z + 0.5, 3, 'mob', null);
    return { hp: m.survival.hp };
  }, [bx + 60, floorY, bz]);
  check('an exposed player takes the full blast damage',
    playerOpen.hp <= 14, playerOpen);

  await page.screenshot({ path: 'shots/diag/explosion.png' });
} catch (err) {
  console.log('ERROR', err);
  results.push({ name: 'probe', ok: false });
} finally {
  console.log('');
  console.log(`Total: ${results.filter((x) => x.ok).length}/${results.length} PASS`);
  await browser.close();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
}
