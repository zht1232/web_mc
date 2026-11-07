// Node headless test for the ported entity / AI / navigation subsystem.
//
//   npx tsx scripts/test-entities.mts
//
// Builds a fake flat ClientLevel, spawns 1 pig + 1 zombie + 1 cow + 1 chicken +
// 1 creeper + 10 dropped items, ticks 200 times and asserts the six required
// properties. Every check prints PASS/FAIL; a failure exits with code 1.

import { performance } from 'node:perf_hooks';

import { AABB } from '../src/vanilla/core/Geometry.ts';
import { Player } from '../src/vanilla/world/entity/player/Player.ts';
import { EntityManager, type SpawnConfig } from '../src/vanilla/world/entity/EntityManager.ts';
import { canCreateEntity, createEntity } from '../src/vanilla/world/entity/EntityFactory.ts';
import { MobCategory } from '../src/vanilla/world/entity/MobCategory.ts';
import { setSpawnBlockTags } from '../src/vanilla/world/entity/SpawnPlacements.ts';
import { ItemEntity } from '../src/vanilla/world/entity/item/ItemEntity.ts';
import type { ClientLevel } from '../src/vanilla/world/level/ClientLevel.ts';
import type { Entity } from '../src/vanilla/world/entity/Entity.ts';
import {
  QuadrupedModel, PigModel, CowModel, SheepModel, ChickenModel,
  ZombieModel, SkeletonModel, CreeperModel, SpiderModel, EndermanModel,
  SilverfishModel, WolfModel, RabbitModel, BatModel,
} from '../src/client/renderer/entity/model/EntityModels.ts';

const GROUND = 64;
const SEED = 12345;
const TICKS = 200;

// ---------------------------------------------------------------------------
// Fake flat world: solid blocks below GROUND, air at/above GROUND.
// ---------------------------------------------------------------------------

const FULL_BOX = [new AABB(0, 0, 0, 1, 1, 1)];

interface LevelOptions {
  /** world time in ticks (0 sunrise, 6000 noon, 18000 midnight) */
  time?: number;
  /** block name report for the solid ground block (animals need grass_block) */
  blockName?: string;
  /** light level to report from getBrightness (default 4, the legacy test value) */
  brightness?: () => number;
}

function makeLevel(opts: LevelOptions = {}): ClientLevel {
  const time = opts.time ?? 1000;
  const blockName = opts.blockName ?? 'stone';
  const brightness = opts.brightness ?? (() => 4);
  const mc = {
    collision: (state: number) => (state === 0 ? [] : FULL_BOX),
    isLiquid: (_state: number) => false,
    isAir: (state: number) => state === 0,
    blockOf: (state: number) => ({ name: state === 0 ? 'air' : blockName }),
    isFaceSturdy: (_state: number, _dir: number) => true,
    lightOf: (_state: number) => 0,
    isSolid: (state: number) => state !== 0,
  };
  const isDay = (): boolean => {
    const t = time % 24000;
    return t >= 0 && t < 12000;
  };
  const level = {
    minY: -64, height: 384, seaLevel: GROUND,
    time, gameTime: 0, mc,
    getBlockState: (_x: number, y: number, _z: number) => (y < GROUND ? 1 : 0),
    getChunk: () => undefined,
    hasChunk: () => true,
    getBrightness: () => brightness(),
    getSkyDarken: () => (isDay() ? 1 : 0.2),
    isDay,
    isThundering: () => false,
    getRainLevel: () => 0,
    getBiome: () => 0,
    getHeight: () => GROUND - 1,
    canSeeSky: () => true,
    getSkyLight: () => 15,
    getBlockLight: () => 0,
    getTimeOfDay: () => 0,
    tick: () => {},
  };
  return level as unknown as ClientLevel;
}

interface RunResult {
  boundsOk: boolean;
  badEntity: string;
  distances: number[];
  pigStartX: number; pigStartZ: number; pigMaxDisp: number;
  restCount: number;
  picked: number;
  itemsAlive: number;
  elapsedMs: number;
  wallMs: number;
  checksums: number[];
  finalSnapshot: number[];
  entityCount: number;
}

function run(seed: number): RunResult {
  const level = makeLevel();
  const player = new Player(0, GROUND, 0);
  const manager = new EntityManager(level, player, seed);

  const pig = manager.spawn('pig', 12, GROUND, 12)!;
  const zombie = manager.spawn('zombie', 8, GROUND, 0)!;
  manager.spawn('cow', -6, GROUND, -6);
  manager.spawn('chicken', 3, GROUND, -3);
  manager.spawn('creeper', 40, GROUND, 40);

  const items: ItemEntity[] = [];
  for (let i = 0; i < 10; i++) {
    const it = manager.spawn('item', (i % 5 - 2) * 0.6, GROUND + 2, (Math.floor(i / 5) - 1) * 0.6) as ItemEntity;
    it.push((i % 3 - 1) * 0.02, -0.05, (Math.floor(i / 3) - 1) * 0.02);
    items.push(it);
  }

  const pt = manager.getPlayerTarget()!;
  const initialDist = Math.hypot(zombie.x - pt.x, zombie.z - pt.z);
  const distances: number[] = [initialDist];
  const checksums: number[] = [];

  let boundsOk = true;
  let badEntity = '';
  const pigStartX = pig.x, pigStartZ = pig.z;
  let pigMaxDisp = 0;
  const maxWorldY = level.minY + level.height;

  const wallStart = performance.now();
  let elapsedMs = 0;
  for (let t = 0; t < TICKS; t++) {
    // time ONLY the actual tick call (test harness checks below are not ticks)
    const t0 = performance.now();
    manager.tick();
    elapsedMs += performance.now() - t0;

    // 1. bounds / ground check for every active entity, every tick
    const ents = manager.getActiveEntities();
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.z)
        || e.y < GROUND - 0.01 || e.y > maxWorldY) {
        if (boundsOk) badEntity = `${e.getTypeName()}@(${e.x.toFixed(2)},${e.y.toFixed(2)},${e.z.toFixed(2)})`;
        boundsOk = false;
      }
    }

    // 2. zombie -> player distance trend
    distances.push(Math.hypot(zombie.x - pt.x, zombie.z - pt.z));

    // 3. pig wander displacement
    const disp = Math.hypot(pig.x - pigStartX, pig.z - pigStartZ);
    if (disp > pigMaxDisp) pigMaxDisp = disp;

    // 6. rolling checksum over all entity state (determinism)
    let sum = 0;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      sum += e.x + 2 * e.y + 3 * e.z + 5 * e.vx + 7 * e.vy + 11 * e.vz + 13 * e.yaw;
    }
    checksums.push(sum);
  }
  const wallMs = performance.now() - wallStart;

  // 4. rest + pickup
  let restCount = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.onGround && Math.abs(it.vy) < 0.01 && Math.abs(it.vx) < 0.05 && Math.abs(it.vz) < 0.05) restCount++;
  }
  const picked = manager.pickupItems(0, GROUND, 0, 100);

  let itemsAlive = 0;
  for (let i = 0; i < items.length; i++) if (!items[i].isRemoved()) itemsAlive++;

  const finalSnapshot: number[] = [];
  const ents = manager.getActiveEntities();
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    finalSnapshot.push(e.id, e.x, e.y, e.z, e.vx, e.vy, e.vz, e.yaw, e.isAlive() ? 1 : 0);
  }

  return {
    boundsOk, badEntity, distances, pigStartX, pigStartZ, pigMaxDisp,
    restCount, picked, itemsAlive, elapsedMs, wallMs, checksums, finalSnapshot,
    entityCount: ents.length,
  };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

let failures = 0;
function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (!ok) failures++;
}

// 0. data-driven models baked once, non-empty
const allModels: [string, { parts: unknown[]; vertexCount: number }][] = [
  ['QuadrupedModel', QuadrupedModel], ['PigModel', PigModel], ['CowModel', CowModel],
  ['SheepModel', SheepModel], ['ChickenModel', ChickenModel], ['ZombieModel', ZombieModel],
  ['SkeletonModel', SkeletonModel], ['CreeperModel', CreeperModel], ['SpiderModel', SpiderModel],
  ['EndermanModel', EndermanModel], ['SilverfishModel', SilverfishModel], ['WolfModel', WolfModel],
  ['RabbitModel', RabbitModel], ['BatModel', BatModel],
];
let modelsOk = true;
let totalVerts = 0;
for (const [name, m] of allModels) {
  if (m.parts.length === 0 || m.vertexCount <= 0) modelsOk = false;
  totalVerts += m.vertexCount;
}
check('[extra] 14 data-driven models baked', modelsOk,
  `parts=${allModels.reduce((s, [, m]) => s + m.parts.length, 0)} vertices=${totalVerts}`);

// Two identical-seed runs: the first is cold (includes JIT compilation of the
// tick path), the second is warm (steady state). Both are measured tick-only.
const r = run(SEED);

// 1. bounds / ground
check('1. all entities stay above ground & inside world', r.boundsOk,
  r.boundsOk ? `checked ${TICKS} ticks, ${r.entityCount} entities` : `first bad: ${r.badEntity}`);

// 2. zombie approaches player monotonically (allow small noise)
const d = r.distances;
let maxIncrease = 0;
for (let i = 1; i < d.length; i++) {
  const inc = d[i] - d[i - 1];
  if (inc > maxIncrease) maxIncrease = inc;
}
const startDist = d[0];
const endDist = d[d.length - 1];
const approached = endDist < startDist - 1.0;
check('2. zombie moves toward player (distance monotonically decreases, noise allowed)',
  approached && maxIncrease <= 0.3,
  `start=${startDist.toFixed(2)} end=${endDist.toFixed(2)} maxIncrease=${maxIncrease.toFixed(3)}`);

// 3. pig wanders
check('3. pig random-walks (position changes)', r.pigMaxDisp > 0.5,
  `maxDisplacement=${r.pigMaxDisp.toFixed(2)}`);

// 4. items land, rest and can be picked up
check('4. dropped items land, come to rest and are pickable',
  r.restCount >= 8 && r.picked >= 8 && r.itemsAlive === 0,
  `atRest=${r.restCount}/10 picked=${r.picked} stillPresent=${r.itemsAlive}`);

// second identical-seed run (JIT-warm steady state)
const r2 = run(SEED);

// 5. performance: assert on the WORST of the cold and warm tick-only times
const worstTickMs = Math.max(r.elapsedMs, r2.elapsedMs);
check('5. 200 ticks complete in < 50 ms', worstTickMs < 50,
  `cold=${r.elapsedMs.toFixed(2)} ms warm=${r2.elapsedMs.toFixed(2)} ms worst=${worstTickMs.toFixed(2)} ms ` +
  `(${(worstTickMs / TICKS).toFixed(4)} ms/tick), loopWall=${r.wallMs.toFixed(2)}/${r2.wallMs.toFixed(2)} ms`);

// 6. determinism: same seed => identical tick evolution (cold vs warm)
let identical = r.checksums.length === r2.checksums.length
  && r.finalSnapshot.length === r2.finalSnapshot.length;
if (identical) {
  for (let i = 0; i < r.checksums.length; i++) {
    if (r.checksums[i] !== r2.checksums[i]) { identical = false; break; }
  }
}
if (identical) {
  for (let i = 0; i < r.finalSnapshot.length; i++) {
    if (r.finalSnapshot[i] !== r2.finalSnapshot[i]) { identical = false; break; }
  }
}
check('6. same seed produces identical results', identical,
  `checksums=${r.checksums.length} finalFields=${r.finalSnapshot.length}`);

// ---------------------------------------------------------------------------
// 7-10. Natural spawning (REPORTS/session-reports/07-integration.md "尚未接上" #1)
//      The fake world is a flat grass plane; the spawn config uses the same
//      shape as /mc/worldgen.json (categories keyed by MobCategory.spawnerKey)
//      and deliberately contains one type without a factory (minecraft:blaze)
//      to prove unsupported entries are skipped instead of counted as failures.
// ---------------------------------------------------------------------------

setSpawnBlockTags(undefined); // fall back to the 26.2 datapack tag contents

const SPAWN_CONFIG: SpawnConfig = {
  biomes: {
    test: {
      id: 0,
      name: 'test',
      creatureSpawnProbability: 0.5,
      spawners: {
        monster: [
          { type: 'minecraft:zombie', minCount: 1, maxCount: 2, weight: 40 },
          { type: 'minecraft:skeleton', minCount: 1, maxCount: 2, weight: 30 },
          { type: 'minecraft:creeper', minCount: 1, maxCount: 1, weight: 20 },
          { type: 'minecraft:spider', minCount: 1, maxCount: 2, weight: 20 },
          { type: 'minecraft:enderman', minCount: 1, maxCount: 1, weight: 10 },
          { type: 'minecraft:slime', minCount: 1, maxCount: 1, weight: 10 },
          { type: 'minecraft:witch', minCount: 1, maxCount: 1, weight: 5 },
          // no factory in the port: must be skipped, never a spawn failure
          { type: 'minecraft:blaze', minCount: 1, maxCount: 1, weight: 40 },
        ],
        creature: [
          { type: 'minecraft:pig', minCount: 1, maxCount: 3, weight: 10 },
          { type: 'minecraft:cow', minCount: 1, maxCount: 3, weight: 10 },
          { type: 'minecraft:sheep', minCount: 1, maxCount: 3, weight: 10 },
          { type: 'minecraft:chicken', minCount: 2, maxCount: 4, weight: 10 },
        ],
        ambient: [], water_creature: [], water_ambient: [], axolotls: [],
        underground_water_creature: [], misc: [],
      },
    },
  },
};

interface SpawnRun {
  monsters: number;
  creatures: number;
  elapsedMs: number;
  stats: {
    chunkAttempts: number; spawned: number; noType: number; skippedEntries: number;
    rulesFail: number; chunkGenSpawns: number;
  };
  byType: Record<string, number>;
}

/** One 120 s (2400 tick) spawn run on a 5x5 chunk flat grass world. */
function runSpawn(time: number, ticks = 2400): SpawnRun {
  const level = makeLevel({ time, blockName: 'grass_block', brightness: () => (time < 12000 ? 15 : 3) });
  const player = new Player(0.5, GROUND, 0.5);
  const manager = new EntityManager(level, player, 424242, { chunksPerTick: 8 });
  manager.setSpawnConfig(SPAWN_CONFIG);
  const chunks: [number, number][] = [];
  for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) chunks.push([cx, cz]);
  manager.syncChunks(chunks);

  const t0 = performance.now();
  for (let i = 0; i < ticks; i++) manager.tick();
  const elapsedMs = performance.now() - t0;

  let monsters = 0;
  let creatures = 0;
  const byType: Record<string, number> = {};
  for (const e of manager.getEntities()) {
    const cat = e.getCategory();
    if (cat === MobCategory.MONSTER) monsters++;
    else if (cat === MobCategory.CREATURE) creatures++;
    byType[e.getTypeName()] = (byType[e.getTypeName()] ?? 0) + 1;
  }
  return { monsters, creatures, elapsedMs, stats: manager.spawnStats, byType };
}

// 7. every required natural-spawn type has a factory
const required = [
  'zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'pig', 'cow', 'sheep',
  'chicken', 'bat', 'slime', 'witch', 'drowned',
  'squid', 'cod', 'salmon', 'wolf', 'fox', 'rabbit', 'parrot', 'cat',
];
const missing = required.filter((n) => !canCreateEntity(n) || !createEntity(n, makeLevel(), 0, GROUND, 0));
check('7. required natural-spawn types all have a factory', missing.length === 0,
  missing.length === 0 ? `${required.length} types` : `missing: ${missing.join(',')}`);

// 8. daytime: passive animals spawn, no surface monsters
const dayRun = runSpawn(6000);
check('8. daytime 120 s: animals spawn, 0 monsters (surface light 15)',
  dayRun.creatures > 0 && dayRun.monsters === 0,
  `creatures=${dayRun.creatures} monsters=${dayRun.monsters} chunkGen=${dayRun.stats.chunkGenSpawns} ` +
  `spawned=${dayRun.stats.spawned} types=${JSON.stringify(dayRun.byType)}`);

// 9. night: monsters spawn, category caps respected, unsupported types skipped
const nightRun = runSpawn(18000);
// 25 loaded chunks -> global cap = floor(70 * 25 / 289) = 6, plus at most one cluster (4)
const monsterCap = Math.floor((70 * 25) / 289);
check('9. night 120 s: monsters spawn, capped at 70*chunks/289, unknown types skipped',
  nightRun.monsters > 0 && nightRun.monsters <= monsterCap + 4 && nightRun.stats.skippedEntries > 0,
  `monsters=${nightRun.monsters} cap=${monsterCap} skippedEntries=${nightRun.stats.skippedEntries} ` +
  `spawned=${nightRun.stats.spawned} types=${JSON.stringify(nightRun.byType)}`);

// 10. per-tick budget with spawns active (< 5 ms/tick required by TASK-survival)
const nightMsPerTick = nightRun.elapsedMs / 2400;
check('10. natural spawning stays under 5 ms/tick', nightMsPerTick < 5,
  `${nightMsPerTick.toFixed(3)} ms/tick over 2400 ticks (${nightRun.elapsedMs.toFixed(1)} ms total, ` +
  `${nightRun.stats.chunkAttempts} chunk attempts)`);

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) FAILED`);
  process.exit(1);
} else {
  console.log('ALL CHECKS PASSED');
  process.exit(0);
}
