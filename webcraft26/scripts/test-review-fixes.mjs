// Browser regression tests for the 2026-11-28 review fixes:
//
//   * undead mobs actually take fire damage in daylight;
//   * losing the support removes short grass, tall grass and sugar cane;
//   * a creative player is not targeted even after hitting a mob;
//   * player armor/offhand slots are part of the save snapshot;
//   * unloaded villagers survive in the world-level snapshot after culling;
//   * chunks that were never activated keep their stored entity records;
//   * wandering-trader offers keep their use counts through the entity record.
//
//   node scripts/test-review-fixes.mjs [--url http://127.0.0.1:5174]
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
  await sleep(1000);
  const stage = await prepareStage(page, { radius: 12, floor: 'stone', time: 6000 });
  const { x: bx, z: bz, floorY } = stage;

  // -------------------------------------------------------------------------
  // 1. Undead fire damage in daylight.
  // -------------------------------------------------------------------------
  const burnStart = await ev(([x, y, z]) => {
    const m = window.__mc;
    m.survival.gamemode = 'creative';
    m.options.gamemode = 'creative';
    const zombie = m.entityManager.spawn('zombie', x + 0.5, y, z + 0.5);
    zombie.equipment.fill(null);
    window.__burnZombie = zombie;
    return { health: zombie.health, fireTicks: zombie.fireTicks };
  }, [bx, floorY, bz]);
  await waitTicks(page, 100);
  const burnEnd = await ev(() => {
    const z = window.__burnZombie;
    return z ? { health: z.health, fireTicks: z.fireTicks, removed: z.isRemoved() } : null;
  });
  check('a zombie in daylight catches fire and loses health',
    burnStart.fireTicks === 0 && !!burnEnd && (burnEnd.fireTicks > 0 || burnEnd.removed)
    && (!burnEnd || burnEnd.health < burnStart.health), { start: burnStart, end: burnEnd });
  await ev(() => { window.__burnZombie?.remove(); });

  // -------------------------------------------------------------------------
  // 2. Plant support updates.
  // -------------------------------------------------------------------------
  const plants = await ev(([x, y, z]) => {
    const m = window.__mc;
    const grass = m.mc.stateOf('grass_block');
    const dirt = m.mc.stateOf('dirt');
    const shortGrass = m.mc.stateOf('short_grass');
    const cane = m.mc.stateOf('sugar_cane');
    const tall = m.mc.stateOf('tall_grass');
    const sand = m.mc.stateOf('sand');
    const water = m.mc.stateOf('water');
    m.level.setBlockState(x, y - 1, z, grass);
    m.level.setBlockState(x, y, z, shortGrass);
    m.level.setBlockState(x + 3, y - 1, z, sand);
    m.level.setBlockState(x + 4, y - 1, z, water);
    m.level.setBlockState(x + 3, y, z, cane);
    m.level.setBlockState(x + 3, y + 1, z, cane);
    m.level.setBlockState(x + 6, y - 1, z, dirt);
    m.level.setBlockState(x + 6, y, z, m.mc.withProp(tall, 'half', 'lower'));
    m.level.setBlockState(x + 6, y + 1, z, m.mc.withProp(tall, 'half', 'upper'));
    m.level.setBlockState(x, y - 1, z, 0);
    m.updateNeighbors(x, y - 1, z);
    m.level.setBlockState(x + 3, y - 1, z, 0);
    m.updateNeighbors(x + 3, y - 1, z);
    m.level.setBlockState(x + 6, y - 1, z, 0);
    m.updateNeighbors(x + 6, y - 1, z);
    m.entityManager.flushSpawns();
    return {
      short: m.level.getBlockState(x, y, z),
      cane: m.level.getBlockState(x + 3, y, z),
      caneTop: m.level.getBlockState(x + 3, y + 1, z),
      tall: m.level.getBlockState(x + 6, y, z),
      tallTop: m.level.getBlockState(x + 6, y + 1, z),
      drops: m.entityManager.getEntities()
        .filter((e) => e.getTypeName() === 'item' && !e.isRemoved())
        .map((e) => e.item?.item?.name),
    };
  }, [bx + 20, floorY, bz]);
  check('losing support removes short grass, tall grass and sugar cane',
    plants.short === 0 && plants.tall === 0 && plants.tallTop === 0
    && plants.cane === 0 && plants.caneTop === 0, plants);
  check('unsupported plants drop their loot',
    plants.drops.includes('short_grass') && plants.drops.filter((d) => d === 'sugar_cane').length === 2, plants.drops);

  // -------------------------------------------------------------------------
  // 3. Creative players are not valid combat targets.
  // -------------------------------------------------------------------------
  const creativeTarget = await ev(() => {
    const m = window.__mc;
    m.survival.gamemode = 'creative';
    m.options.gamemode = 'creative';
    const z = m.entityManager.spawn('zombie', m.player.pos.x + 2, m.player.pos.y, m.player.pos.z + 2);
    z.equipment.fill(null);
    z.setTarget(null);
    z.hurt(1, m.entityManager.getPlayerTarget());
    window.__targetZombie = z;
    return { before: z.getTarget()?.getTypeName() ?? null };
  });
  await waitTicks(page, 5);
  const creativeAfter = await ev(() => {
    const z = window.__targetZombie;
    return { target: z?.getTarget()?.getTypeName() ?? null, hasTarget: !!z?.getTarget() };
  });
  check('a creative player is never targeted, even after hitting the mob',
    creativeAfter.hasTarget === false, { start: creativeTarget, end: creativeAfter });
  await ev(() => { window.__targetZombie?.remove(); });

  await ev(() => {
    const m = window.__mc;
    m.survival.gamemode = 'survival';
    m.options.gamemode = 'survival';
    const z = m.entityManager.spawn('zombie', m.player.pos.x + 2, m.player.pos.y, m.player.pos.z + 2);
    z.equipment.fill(null);
    z.setTarget(null);
    z.hurt(1, m.entityManager.getPlayerTarget());
    window.__targetZombie = z;
  });
  await waitTicks(page, 5);
  const survivalTarget = await ev(() => {
    const z = window.__targetZombie;
    return { target: z?.getTarget()?.getTypeName() ?? null };
  });
  check('a survival player is still a valid target', survivalTarget.target === 'player', survivalTarget);
  await ev(() => {
    const z = window.__targetZombie;
    z?.remove();
    window.__mc.survival.gamemode = 'creative';
    window.__mc.options.gamemode = 'creative';
  });

  // -------------------------------------------------------------------------
  // 4. Player armor and offhand are part of the save snapshot.
  // -------------------------------------------------------------------------
  const armorSave = await ev(() => {
    const m = window.__mc;
    const reg = m.survival.registry;
    const S = m.survival.inventory.getItem(0).constructor;
    for (let i = 0; i < m.survival.inventory.getContainerSize(); i++) m.survival.inventory.setItem(i, S.EMPTY);
    const helmet = reg.byName('diamond_helmet');
    const shield = reg.byName('shield');
    m.survival.inventory.setItem(38, new S(helmet, 1));
    m.survival.inventory.setItem(40, new S(shield, 1));
    const extra = m.playerExtra();
    const slots = extra.inventory.map((i) => i.slot).sort((a, b) => a - b);
    return { slots, count: extra.inventory.length };
  });
  check('the player save includes armor and offhand slots',
    armorSave.slots.includes(38) && armorSave.slots.includes(40), armorSave);

  // -------------------------------------------------------------------------
  // 5. Villagers survive culling while unloaded.
  // -------------------------------------------------------------------------
  const villagerSnapshot = await ev(([x, y, z]) => {
    const m = window.__mc;
    const farX = x + 16 * 20;
    const v = m.entityManager.spawn('villager', farX, y, z);
    v.profession = 'farmer';
    v.professionLevel = 3;
    m.snapshotPersistentEntities();
    const before = m.villagerData().length;
    // Simulate the chunk cull: snapshot then remove the live entity.
    m.entityManager.persistentCullHandler?.(v);
    v.remove();
    const after = m.villagerData();
    return {
      before,
      after: after.length,
      kept: after.some((rec) => rec.profession === 'farmer' && rec.professionLevel === 3),
    };
  }, [bx, floorY, bz]);
  check('an unloaded villager survives in the world-level snapshot',
    villagerSnapshot.after >= 1 && villagerSnapshot.kept, villagerSnapshot);

  // -------------------------------------------------------------------------
  // 6. A never-activated chunk keeps its stored entity records.
  // -------------------------------------------------------------------------
  const chunkGate = await ev(() => {
    const m = window.__mc;
    const pcx = Math.floor(m.player.pos.x) >> 4;
    const pcz = Math.floor(m.player.pos.z) >> 4;
    let chunk = null;
    for (let d = 3; d <= 12 && !chunk; d++) chunk = m.level.getChunk(pcx + d, pcz + d);
    if (!chunk) return { skipped: true };
    const record = {
      type: 'cow', x: chunk.x * 16 + 8, y: 80, z: chunk.z * 16 + 8,
      yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, health: 10, data: { age: 0 },
    };
    chunk.entities = [record];
    chunk.entitiesActive = false;
    m.captureChunkEntities();
    const kept = chunk.entities.length;
    chunk.entitiesActive = true;
    m.captureChunkEntities();
    return { kept, clearedWhenActive: chunk.entities.length === 0, key: `${chunk.x},${chunk.z}` };
  });
  check('an inactive chunk keeps its entity records during save capture',
    chunkGate.skipped === true || (chunkGate.kept === 1 && chunkGate.clearedWhenActive), chunkGate);

  // -------------------------------------------------------------------------
  // 7. Wandering-trader offer uses survive the entity record round trip.
  // -------------------------------------------------------------------------
  const traderOffer = await ev(([x, y, z]) => {
    const m = window.__mc;
    const t = m.entityManager.spawn('wandering_trader', x + 0.5, y, z + 0.5);
    const offers = t.getOffers();
    offers[0].increaseUses();
    const record = m.saveEntityRecord(t);
    if (!record) return { missing: true };
    const saved = record.data?.offers;
    t.remove();
    const restored = m.entityManager.spawn('wandering_trader', x + 2.5, y, z + 0.5);
    m.spawnSavedEntity({ ...record, x: x + 2.5, z: z + 0.5 });
    const candidate = m.entityManager.getEntities()
      .filter((e) => e.getTypeName() === 'wandering_trader' && !e.isRemoved())
      .pop();
    restored.remove();
    return {
      savedOffers: Array.isArray(saved) ? saved.length : 0,
      restoredOffers: candidate?.offers?.length ?? 0,
      firstUses: candidate?.offers?.[0]?.uses ?? null,
    };
  }, [bx + 40, floorY, bz]);
  check('wandering-trader offers and use counts survive the record round trip',
    traderOffer.savedOffers >= 1 && traderOffer.restoredOffers === traderOffer.savedOffers
    && traderOffer.firstUses === 1, traderOffer);
} catch (err) {
  console.log('ERROR', err);
  results.push({ name: 'probe', ok: false });
} finally {
  console.log('');
  console.log(`Total: ${results.filter((x) => x.ok).length}/${results.length} PASS`);
  await browser.close();
  process.exit(results.every((x) => x.ok) ? 0 : 1);
}
