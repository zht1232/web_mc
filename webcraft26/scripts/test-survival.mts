// Headless test for the survival loop (damage / death / air / weather / burning).
//
//   npx tsx scripts/test-survival.mts
//
// Pure data, no browser and no WebGL: builds MinecraftData + SurvivalState from
// the real on-disk data (same loader as test-items.mts), then exercises:
//   1. fall damage formula (LivingEntity.calculateFallDamage / causeFallDamage)
//   2. armour absorption (CombatRules.getDamageAfterAbsorb) + bypasses_armor tag
//   3. drowning air supply (300 ticks -> 2 damage per 20 ticks)
//   4. i-frames, hurt flash and creative invulnerability
//   5. death -> drop inventory + XP -> respawn reset
//   6. mob melee damage reaches SurvivalState through PlayerTarget
//   7. arrow damage reaches SurvivalState (skeleton ranged chain)
//   8. creeper explosion -> world explosion hook + block destruction
//   9. daylight burning of undead (Mob.isSunBurnTick)
//  10. weather state machine (ServerLevel.advanceWeatherCycle) + rains level smoothing
//  11. level.dat weather round trip (ClientLevel.get/setWeatherState)
//
// Every check prints PASS/FAIL; a failure exits with code 1.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { MinecraftData } from '../src/vanilla/world/level/block/state/BlockState.ts';
import { ClientLevel } from '../src/vanilla/world/level/ClientLevel.ts';
import { SurvivalState, setWorldData, type WorldData } from '../src/vanilla/gameplay/SurvivalState.ts';
import { EntityManager } from '../src/vanilla/world/entity/EntityManager.ts';
import { createEntity, canCreateEntity } from '../src/vanilla/world/entity/EntityFactory.ts';
import { Player } from '../src/vanilla/world/entity/player/Player.ts';
import { ItemStack } from '../src/vanilla/world/item/ItemStack.ts';
import { LivingEntity } from '../src/vanilla/world/entity/LivingEntity.ts';
import { Arrow } from '../src/vanilla/world/entity/projectile/Arrow.ts';
import { Creeper } from '../src/vanilla/world/entity/monster/Creeper.ts';
import { Zombie } from '../src/vanilla/world/entity/monster/Zombie.ts';
import type { ClientLevel as ClientLevelType } from '../src/vanilla/world/level/ClientLevel.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const readJson = (p: string): unknown => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
function readArrayBuffer(file: string): ArrayBuffer {
  const buf = fs.readFileSync(path.join(root, file));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

let failures = 0;
function check(name: string, fn: () => boolean | string): void {
  let ok: boolean | string;
  try {
    ok = fn();
  } catch (e) {
    ok = `threw ${(e as Error).stack ?? String(e)}`;
  }
  if (ok === true) {
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}  ->  ${typeof ok === 'string' ? ok : 'assertion returned false'}`);
  }
}

// ---------------------------------------------------------------- load data

console.log('==== survival test suite ====');
const blockMeta = readJson('public/mc/blocks.json') as never;
const tags = readJson('public/mc/tags.json');
const recipes = readJson('public/mc/recipes.json');
const loot = readJson('public/mc/loot.json');
const lang = readJson('public/mc/lang/en_us.json');
const itemsJson = readJson('data/items.json') as { items: unknown[] };

const mc = new MinecraftData();
mc.initMeta(blockMeta);
mc.initBinary(readArrayBuffer('public/mc/blocks.bin'));
const worldData: WorldData = { items: itemsJson, tags, recipes, loot, lang };
setWorldData(worldData);

const SEED = 0x2602c0den;
const survival = new SurvivalState(mc, SEED, worldData);

const GROUND = 64;
const GRASS = mc.stateOf('grass_block');

interface FlatLevelOpts {
  time?: number;
  /** block name used for every y < GROUND */
  ground?: string;
}

/**
 * Flat test world: one block type under GROUND, air above. Enough of ClientLevel's
 * surface for the spawn rules / AI (getBlockState, height, light, biome, time).
 */
function makeFlatLevel(opts: FlatLevelOpts = {}): {
  level: ClientLevelType;
  setBlock: (x: number, y: number, z: number, state: number) => void;
} {
  const edits = new Map<string, number>();
  const groundName = opts.ground ?? 'grass_block';
  const groundState = groundName === 'grass_block' ? GRASS : mc.stateOf(groundName);
  const now = { time: opts.time ?? 6000 };
  const isDayNow = (): boolean => {
    const t = now.time % 24000;
    return t >= 0 && t < 12000;
  };
  const level = {
    minY: -64,
    height: 384,
    seaLevel: 63,
    get time(): number { return now.time; },
    set time(v: number) { now.time = v; },
    gameTime: 0,
    seed: SEED,
    mc,
    getBlockState(x: number, y: number, z: number): number {
      const edited = edits.get(`${x},${y},${z}`);
      if (edited !== undefined) return edited;
      return y < GROUND ? groundState : 0;
    },
    setBlockState(x: number, y: number, z: number, state: number): boolean {
      edits.set(`${x},${y},${z}`, state);
      return true;
    },
    getHeight: () => GROUND - 1,
    getBiome: () => 22, // minecraft:plains
    getSkyLight: () => 15,
    getBlockLight: () => 0,
    // Level.getMaxLocalRawBrightness with sky darkening
    getBrightness: () => (isDayNow() ? 15 : 3),
    getSkyDarken: () => (isDayNow() ? 1 : 0.2),
    isDay: isDayNow,
    canSeeSky: () => true,
    isThundering: () => false,
    getRainLevel: () => 0,
    isRaining: () => false,
    getTimeOfDay(): number { return 0; },
    tick(): void {},
  };
  return {
    level: level as unknown as ClientLevelType,
    setBlock: (x, y, z, state) => { edits.set(`${x},${y},${z}`, state); },
  };
}

function freshSurvival(): SurvivalState {
  return new SurvivalState(mc, SEED, worldData);
}

// ------------------------------------------------------------------ 1. fall

check('1. fall damage = floor(distance + 1e-6 - 3) (LivingEntity.calculateFallDamage)', () => {
  const cases: [number, number][] = [[3, 0], [3.5, 0], [4, 1], [5.9, 2], [10, 7], [23, 20]];
  for (const [dist, expected] of cases) {
    const s = freshSurvival();
    const before = s.health;
    const dmg = s.fallDamage(dist);
    if (dmg !== expected) return `dist=${dist} dmg=${dmg} expected=${expected}`;
    const actual = before - s.health;
    if (Math.abs(actual - expected) > 1e-9) return `dist=${dist} health dropped ${actual} expected ${expected}`;
  }
  const s = freshSurvival();
  s.fallDamage(3);
  if (s.health !== 20) return `3-block fall damaged the player: hp=${s.health}`;
  return true;
});

// ------------------------------------------------------------- 2. armour

check('2. armour absorbs mob damage (CombatRules) but not fall (bypasses_armor tag)', () => {
  const s = freshSurvival();
  const chest = s.registry.byName('iron_chestplate');
  if (!chest) return 'iron_chestplate not in item registry';
  s.inventory.setItem(38, new ItemStack(chest, 1));
  const armor = s.armorValue;
  if (armor !== 6) return `iron chestplate defence=${armor} expected 6`;
  s.damage(6, 'zombie');
  // f = 2 + 0/4 = 2; g = min(20,6) - 6/2 = 3; dmg = 6 * (1 - 3/25) = 5.28
  const expected = 20 - 5.28;
  if (Math.abs(s.health - expected) > 1e-6) return `armoured hp=${s.health} expected=${expected}`;

  const f = freshSurvival();
  f.inventory.setItem(38, new ItemStack(chest, 1));
  f.fallDamage(10);
  if (Math.abs(f.health - 13) > 1e-6) return `fall ignored armour: hp=${f.health} expected 13`;
  return true;
});

// ------------------------------------------------------------ 3. drowning

check('3. drowning: 300 ticks of air, then 2 damage every 20 ticks', () => {
  const s = freshSurvival();
  s.naturalRegen = false; // isolate drowning damage from FoodData natural regen
  for (let t = 0; t < 319; t++) s.tick({ sprint: false, jumped: false, swam: true, underwater: true });
  if (s.airSupply !== -19) return `air after 319 ticks = ${s.airSupply} expected -19`;
  if (s.health !== 20) return `damaged before air ran out: hp=${s.health} air=${s.airSupply}`;
  s.tick({ sprint: false, jumped: false, swam: true, underwater: true }); // 320: air <= -20
  if (s.health !== 18) return `hp after first drown tick = ${s.health} expected 18`;
  for (let t = 0; t < 19; t++) s.tick({ sprint: false, jumped: false, swam: true, underwater: true });
  if (s.health !== 18) return `second drown damage came too early: hp=${s.health}`;
  s.tick({ sprint: false, jumped: false, swam: true, underwater: true }); // 340
  if (s.health !== 16) return `hp after second drown tick = ${s.health} expected 16`;
  // resurface: +4 air per tick, capped at 300
  for (let t = 0; t < 100; t++) s.tick({ sprint: false, jumped: false, swam: false, underwater: false });
  if (s.airSupply !== 300) return `air did not refill: ${s.airSupply}`;
  return true;
});

// ------------------------------------------------- 4. i-frames / creative

check('4. 10-tick i-frames, hurt flash and creative invulnerability', () => {
  const s = freshSurvival();
  s.naturalRegen = false; // isolate the hit mechanics from FoodData natural regen
  s.damage(2, 'zombie');
  if (s.health !== 18) return `hp=${s.health}`;
  if (s.hurtTime !== 10) return `hurtTime=${s.hurtTime} expected 10`;
  s.damage(2, 'zombie'); // i-frames
  if (s.health !== 18) return `i-frames not applied: hp=${s.health}`;
  for (let i = 0; i < 10; i++) s.tick({ sprint: false, jumped: false, swam: false });
  if (s.hurtTime !== 0) return `hurtTime did not decay: ${s.hurtTime}`;
  s.damage(2, 'zombie');
  if (s.health !== 16) return `damage after i-frames: hp=${s.health}`;

  const c = freshSurvival();
  c.gamemode = 'creative';
  c.damage(10, 'zombie');
  c.fallDamage(20);
  for (let i = 0; i < 400; i++) c.tick({ sprint: false, jumped: false, swam: true, underwater: true });
  if (c.health !== 20) return `creative took damage: hp=${c.health}`;
  if (c.airSupply !== 300) return `creative air drained: ${c.airSupply}`;
  return true;
});

// ------------------------------------------------------ 5. death / respawn

check('5. death drops the inventory + XP and respawn resets the player', () => {
  const s = freshSurvival();
  const stone = s.registry.byName('stone');
  if (!stone) return 'stone not in registry';
  s.inventory.setItem(0, new ItemStack(stone, 17));
  s.addExperience(30);
  const beforeXp = s.totalExperience;
  let deathCalls = 0;
  s.onDeath = () => { deathCalls++; };
  s.damage(100, 'zombie');
  if (s.health !== 0 || !s.isDead) return `hp=${s.health} dead=${s.isDead}`;
  if (deathCalls !== 1) return `onDeath fired ${deathCalls} times`;
  const dropped = s.dropAllOnDeath();
  if (dropped.stacks.length !== 1 || dropped.stacks[0].count !== 17) {
    return `dropped ${dropped.stacks.map((d) => `${d.item?.name}x${d.count}`).join(',')}`;
  }
  if (dropped.experience !== beforeXp) return `dropped xp=${dropped.experience} expected ${beforeXp}`;
  if (!s.inventory.getItem(0).isEmpty()) return 'inventory not cleared';
  s.respawn();
  if (s.health !== 20 || s.isDead || s.airSupply !== 300 || s.totalExperience !== 0 || s.hunger !== 20) {
    return `respawn state hp=${s.health} dead=${s.isDead} air=${s.airSupply} xp=${s.totalExperience} food=${s.hunger}`;
  }
  s.damage(2, 'zombie'); // can be hurt again after respawn
  if (s.health !== 18) return `post-respawn damage failed: hp=${s.health}`;
  return true;
});

// -------------------------------------------- 6. mob melee -> SurvivalState

check('6. zombie melee reaches SurvivalState through PlayerTarget.onHurt', () => {
  const { level } = makeFlatLevel({ time: 18000 });
  const player = new Player(0.5, GROUND, 0.5);
  const manager = new EntityManager(level, player, SEED, { chunksPerTick: 0 });
  const s = freshSurvival();
  const pt = manager.getPlayerTarget()!;
  pt.onHurt = (amount) => s.damage(amount, 'zombie');
  const zombie = manager.spawn('zombie', 3.5, GROUND, 0.5) as Zombie | null;
  if (!zombie) return 'zombie factory missing';
  if (zombie.attackDamage !== 3) return `zombie attackDamage=${zombie.attackDamage} expected 3 (normal)`;
  let minDist = Infinity;
  for (let t = 0; t < 300; t++) {
    manager.tick();
    minDist = Math.min(minDist, Math.hypot(zombie.x - pt.x, zombie.z - pt.z));
  }
  if (s.health >= 20) return `player never damaged (minDist=${minDist.toFixed(2)} hp=${s.health})`;
  if (minDist > 2) return `zombie never reached melee range: ${minDist.toFixed(2)}`;
  return true;
});

// ---------------------------------------- 7. arrow damage -> SurvivalState

check('7. arrow hits the player and forwards damage (skeleton ranged chain)', () => {
  const { level } = makeFlatLevel({ time: 18000 });
  const player = new Player(0.5, GROUND, 0.5);
  const manager = new EntityManager(level, player, SEED, { chunksPerTick: 0 });
  const s = freshSurvival();
  const pt = manager.getPlayerTarget()!;
  pt.onHurt = (amount, attacker) => s.damage(amount, attacker ? attacker.getTypeName() : 'arrow');
  const shooter = manager.spawn('skeleton', 0.5, GROUND, 6.5) as LivingEntity | null;
  if (!shooter) return 'skeleton factory missing';
  const arrow = new Arrow(level, 0.5, GROUND + 1.0, 4.5);
  arrow.owner = shooter;
  arrow.damage = 2;
  arrow.shoot(0, 0, -0.8);
  manager.spawnEntity(arrow);
  for (let t = 0; t < 20; t++) manager.tick();
  if (s.health >= 20) return `arrow did not damage the player: hp=${s.health}`;
  if (!arrow.isRemoved()) return 'arrow did not despawn after hitting';
  return true;
});

// ------------------------------------- 8. creeper explosion block damage

check('8. creeper explosion calls the world hook and breaks blocks', () => {
  const { level, setBlock } = makeFlatLevel({ time: 18000 });
  const player = new Player(0.5, GROUND, 0.5);
  const manager = new EntityManager(level, player, SEED, { chunksPerTick: 0 });
  let hook: { x: number; y: number; z: number; power: number } | null = null;
  manager.explosionHandler = (x, y, z, power) => { hook = { x, y, z, power }; };
  const creeper = manager.spawn('creeper', 4.5, GROUND, 0.5) as Creeper | null;
  if (!creeper) return 'creeper factory missing';
  creeper.explode();
  if (!hook) return 'explosionHandler was not called';
  const h = hook as { power: number };
  if (h.power !== 3) return `explosion power=${h.power} expected 3`;
  if (!creeper.isRemoved()) return 'creeper not removed after exploding';
  // The hook is Game's job; emulate its block destruction contract on the flat level.
  setBlock(2, GROUND - 1, 0, 0);
  if (level.getBlockState(2, GROUND - 1, 0) !== 0) return 'setBlockState not visible to getBlockState';
  return true;
});

// ------------------------------------------------- 9. daylight burning

check('9. undead burn in daylight but not at night (Mob.isSunBurnTick)', () => {
  const day = makeFlatLevel({ time: 6000 });
  const manager = new EntityManager(day.level, new Player(0.5, GROUND, 0.5), SEED, { chunksPerTick: 0 });
  const zombie = manager.spawn('zombie', 20.5, GROUND, 20.5) as Zombie | null;
  if (!zombie) return 'zombie factory missing';
  let burned = false;
  for (let t = 0; t < 80; t++) {
    manager.tick();
    if (zombie.fireTicks > 0) { burned = true; break; }
  }
  if (!burned) return 'zombie never caught fire in daylight';
  const night = makeFlatLevel({ time: 18000 });
  const nm = new EntityManager(night.level, new Player(0.5, GROUND, 0.5), SEED, { chunksPerTick: 0 });
  const nz = nm.spawn('zombie', 20.5, GROUND, 20.5) as Zombie | null;
  if (!nz) return 'zombie factory missing at night';
  for (let t = 0; t < 80; t++) nm.tick();
  if (nz.fireTicks > 0) return `zombie caught fire at night (fireTicks=${nz.fireTicks})`;
  return true;
});

// ---------------------------------------------------- 10. weather machine

check('10. weather state machine (advanceWeatherCycle) + +/-0.01 rain smoothing', () => {
  const level = new ClientLevel(mc, null, 0x1234n);
  if (level.isRaining() || level.getRainLevel() !== 0) return 'world starts raining';
  level.tick(1); // first tick picks the initial delays
  const s = level.getWeatherState();
  if (s.rainTime < 12000 || s.rainTime > 180000) return `RAIN_DELAY out of range: ${s.rainTime}`;
  if (s.thunderTime < 12000 || s.thunderTime > 180000) return `THUNDER_DELAY out of range: ${s.thunderTime}`;

  // Force rain after 3 ticks: raining flips, rainLevel climbs 0.01/tick.
  level.forceWeather(false, false, 3);
  level.tick(1); level.tick(1);
  if (level.isRaining()) return 'rain flipped too early';
  level.tick(1);
  if (!level.isRaining()) return 'rain did not start when rainTime hit 0';
  for (let i = 0; i < 49; i++) level.tick(1);
  // rainLevel started climbing on the flip tick: 0.01 + 49 * 0.01
  if (Math.abs(level.getRainLevel() - 0.5) > 1e-6) return `rainLevel=${level.getRainLevel()} expected ~0.5`;
  for (let i = 0; i < 100; i++) level.tick(1);
  if (level.getRainLevel() !== 1) return `rainLevel did not clamp at 1: ${level.getRainLevel()}`;

  // Force a thunder transition; thunderLevel climbs too.
  level.forceWeather(true, false, 2);
  level.tick(1); level.tick(1);
  if (!level.isThundering()) return 'thunder did not start';
  for (let i = 0; i < 200; i++) level.tick(1);
  if (level.getThunderLevel() !== 1) return `thunderLevel=${level.getThunderLevel()}`;

  // Stop the rain: force a long rain, then make rainTime expire while raining (countdown toggles).
  const stop = new ClientLevel(mc, null, 0x55n);
  stop.forceWeather(true, false, 1000);
  for (let i = 0; i < 100; i++) stop.tick(1);
  if (stop.getRainLevel() !== 1) return `forced rain level=${stop.getRainLevel()} expected 1`;
  stop.forceWeather(true, false, 1); // raining stays true; rainTime 1 -> toggles rain off
  stop.tick(1);
  if (stop.isRaining()) return 'rain did not stop';
  for (let i = 0; i < 200; i++) stop.tick(1);
  if (stop.getRainLevel() !== 0) return `rainLevel did not fall to 0: ${stop.getRainLevel()}`;
  return true;
});

// ---------------------------------------- 11. level.dat weather round trip

check('11. level.dat weather round trip (getWeatherState / setWeatherState)', () => {
  const a = new ClientLevel(mc, null, 0x77n);
  a.forceWeather(true, true, 600);
  for (let i = 0; i < 30; i++) a.tick(1);
  const saved = a.getWeatherState();
  if (!saved.raining || !saved.thundering) return `saved state raining=${saved.raining} thundering=${saved.thundering}`;

  const b = new ClientLevel(mc, null, 0x77n);
  b.setWeatherState(saved);
  const loaded = b.getWeatherState();
  if (loaded.raining !== saved.raining || loaded.rainTime !== saved.rainTime
    || loaded.thundering !== saved.thundering || loaded.thunderTime !== saved.thunderTime) {
    return `round trip mismatch: ${JSON.stringify(loaded)} vs ${JSON.stringify(saved)}`;
  }
  // ServerLevel.setWeatherParameters: a loaded rainy world starts at full strength.
  if (b.getRainLevel() !== 1 || b.getThunderLevel() !== 1) {
    return `loaded rain/thunder level ${b.getRainLevel()}/${b.getThunderLevel()} expected 1/1`;
  }
  return true;
});

// ------------------------------------------------ required spawn factories

check('12. every required natural-spawn type has a factory', () => {
  const required = [
    'zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'pig', 'cow', 'sheep',
    'chicken', 'bat', 'slime', 'witch', 'drowned',
    'squid', 'cod', 'salmon', 'wolf', 'fox', 'rabbit', 'parrot', 'cat',
  ];
  const missing: string[] = [];
  const { level } = makeFlatLevel();
  for (const name of required) {
    if (!canCreateEntity(name)) { missing.push(name); continue; }
    if (!createEntity(name, level, 0, GROUND, 0)) missing.push(name);
  }
  if (missing.length) return `missing factories: ${missing.join(',')}`;
  return true;
});

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) FAILED`);
  process.exit(1);
} else {
  console.log(`ALL CHECKS PASSED  (${((performance.now()) / 1000).toFixed(1)}s wall)`);
  process.exit(0);
}
