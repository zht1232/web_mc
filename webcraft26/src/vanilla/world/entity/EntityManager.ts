// Source: net.minecraft.world.level.NaturalSpawner
//         net.minecraft.server.level.ServerLevel / ServerChunkCache (spawn pass)
//         net.minecraft.server.level.ChunkMap#collectSpawningChunks (spawn radius)
//         net.minecraft.world.level.LocalMobCapCalculator (per-player mob cap)
//         net.minecraft.world.level.NaturalSpawner#spawnMobsForChunkGeneration
//
// Owns all entities in a ClientLevel:
//  - chunk load/unload (entities in unloaded chunks are removed),
//  - a deterministic 20 Hz tick (call tick() once per game tick),
//  - distance despawning / culling,
//  - natural spawning: per-chunk passes that sample a random position in the
//    column (vanilla getRandomPosWithin), pack spawning (3 groups, up to 4
//    spawns each), the per-category global + per-player caps,
//  - the one-off creature spawn that vanilla runs for every newly generated
//    chunk (NaturalSpawner.spawnMobsForChunkGeneration),
//  - explosion / player-damage hooks for the main game.
//
// All randomness comes from XoroshiroRandomSource (never Math.random), so the
// same seed produces byte-identical tick results.

import { chunkKey } from '../../core/Geometry.js';
import { XoroshiroRandomSource } from '../../core/Random.js';
import type { ClientLevel } from '../level/ClientLevel.js';
import type { Player } from './player/Player.js';
import { Entity, type MobWorld, type Targetable } from './Entity.js';
import { Mob } from './Mob.js';
import { ENTITY_TYPES, type EntityType } from './EntityType.js';
import { createEntity } from './EntityFactory.js';
import { PlayerTarget } from './PlayerTarget.js';
import { MobCategory } from './MobCategory.js';
import { checkSpawnRules, isSpawnPositionOk } from './SpawnPlacements.js';
import type { ItemRegistry } from '../item/Item.js';
import { ItemEntity } from './item/ItemEntity.js';
import { ExperienceOrb } from './ExperienceOrb.js';

export interface SpawnerEntry {
  type: string;       // "minecraft:zombie"
  minCount: number;
  maxCount: number;
  weight: number;
}
export interface BiomeSpawners {
  id: number;
  name: string;
  creatureSpawnProbability: number;
  spawners: Record<string, SpawnerEntry[]>;
}
export interface SpawnConfig { biomes: Record<string, BiomeSpawners>; }

export interface EntityManagerOptions {
  /** chunk radius around the player that stays active (vanilla spawn distance is 8 chunks) */
  spawnRadius?: number;
  despawnDistance?: number;
  /** ticks between natural spawn passes (vanilla runs every tick) */
  spawnInterval?: number;
  /** chunk spawn-attempt budget per pass (vanilla attempts every spawning chunk) */
  chunksPerTick?: number;
  /** Item registry handed to villagers for trade offers. */
  registry?: ItemRegistry;
}

/** Vanilla NaturalSpawner.SPAWN_DISTANCE_CHUNK. */
const SPAWN_DISTANCE_CHUNK = 8;
/** Vanilla NaturalSpawner.SPAWN_DISTANCE (24 blocks, squared 576). */
const PLAYER_MIN_SPAWN_DISTANCE_SQR = 24 * 24;
/** Vanilla MobCategory capacity is defined for this many spawnable chunks. */
const MOB_CAP_CHUNKS = 289; // (2 * SPAWN_DISTANCE_CHUNK + 1) ^ 2
/** Vanilla Mob.getMaxSpawnClusterSize. */
const MAX_SPAWN_CLUSTER_SIZE = 4;
/** Vanilla spawns persistent categories (CREATURE, water...) only on this interval. */
const PERSISTENT_SPAWN_INTERVAL = 400;

/** Counters for the acceptance tests / debug overlay. */
export interface SpawnStats {
  passes: number;
  chunkAttempts: number;
  spawned: number;
  /** spawner entries whose entity type has no factory (vanilla log "can't spawn") */
  noType: number;
  /** weighted spawner entries skipped because the type has no factory in the port */
  skippedEntries: number;
  /** placements / light / biome rules rejected the candidate position */
  rulesFail: number;
  chunkGenSpawns: number;
}

export class EntityManager implements MobWorld {
  readonly level: ClientLevel;
  readonly random: XoroshiroRandomSource;
  readonly entities: Entity[] = [];
  readonly playerTarget: PlayerTarget | null;

  private readonly spawnQueue: Entity[] = [];
  private readonly activeChunks = new Set<number>();
  private readonly knownChunks = new Set<number>();
  private readonly biomeById = new Map<number, BiomeSpawners>();
  private readonly biomeNameById = new Map<number, string>();
  private spawnConfigLoaded = false;
  private readonly seedBig: bigint;
  readonly registry: ItemRegistry | null;
  private nextId = 1;
  private tickCounter = 0;
  private readonly despawnDistance: number;
  private readonly spawnInterval: number;
  private readonly chunksPerTick: number;

  /** Set by Game: forwards explosion damage/block destruction to the world. */
  explosionHandler?: (x: number, y: number, z: number, power: number, interaction?: 'mob' | 'tnt') => void;
  /** Set by Game: local player game mode, used by targeting conditions. */
  playerGameModeProvider?: () => string;
  /** Set by Game: non-empty main-hand + offhand item names, used by TemptGoal. */
  playerHeldItemsProvider?: () => readonly string[];
  /** Set by Game: drop loot / XP when a living entity dies. */
  mobDeathHandler?: (e: Entity) => void;
  /** Set by Game: spawn heart particles while an animal is in love. */
  animalLoveHandler?: (e: Entity) => void;
  /** Set by Game: award Stats.ANIMALS_BRED when two animals breed. */
  animalBredHandler?: (e: Entity) => void;
  /** Set by Game: spawn an egg item when a chicken lays one. */
  chickenEggHandler?: (e: Entity) => void;
  /** Set by Game: play the crop break / plant sound for a farmer villager. */
  villagerFarmHandler?: (action: 'break' | 'plant', x: number, y: number, z: number) => void;
  /** Set by Game: apply the splash potion's area effects. */
  potionSplashHandler?: (x: number, y: number, z: number, potionId: string, age: number, lingering: boolean) => void;
  /** Set by Game: detector rail occupancy changes. */
  minecartDetectorHandler?: (x: number, y: number, z: number, occupied: boolean) => void;

  readonly spawnStats: SpawnStats = {
    passes: 0, chunkAttempts: 0, spawned: 0, noType: 0, skippedEntries: 0, rulesFail: 0, chunkGenSpawns: 0,
  };

  // ---- scratch state used by the spawn pass (no per-attempt allocation) ----
  private readonly countByCategory = new Map<MobCategory, number>();
  private readonly localCountByCategory = new Map<MobCategory, number>();

  constructor(level: ClientLevel, player: Player | null, seed: number | bigint = 0, options: EntityManagerOptions = {}) {
    this.level = level;
    this.seedBig = BigInt(seed);
    this.random = new XoroshiroRandomSource(this.seedBig);
    this.playerTarget = new PlayerTarget(level, player);
    this.despawnDistance = options.despawnDistance ?? 128;
    this.spawnInterval = options.spawnInterval ?? 1;
    this.chunksPerTick = options.chunksPerTick ?? 8;
    this.registry = options.registry ?? null;
  }

  // ---- MobWorld -----------------------------------------------------------

  getPlayer(): Targetable | null { return this.playerTarget; }
  getPlayerGameMode(): string { return this.playerGameModeProvider?.() ?? 'survival'; }
  getPlayerHeldItems(): readonly string[] { return this.playerHeldItemsProvider?.() ?? []; }
  onMobDeath(e: Entity): void { this.mobDeathHandler?.(e); }
  onAnimalLove(e: Entity): void { this.animalLoveHandler?.(e); }
  onAnimalBred(e: Entity): void { this.animalBredHandler?.(e); }
  onChickenLayEgg(e: Entity): void { this.chickenEggHandler?.(e); }
  onVillagerFarm(action: 'break' | 'plant', x: number, y: number, z: number): void {
    this.villagerFarmHandler?.(action, x, y, z);
  }
  onPotionSplash(x: number, y: number, z: number, potionId: string, age: number, lingering: boolean): void {
    this.potionSplashHandler?.(x, y, z, potionId, age, lingering);
  }
  onMinecartDetector(x: number, y: number, z: number, occupied: boolean): void {
    this.minecartDetectorHandler?.(x, y, z, occupied);
  }
  getEntities(): readonly Entity[] { return this.entities; }
  getGameTime(): number { return this.tickCounter; }
  isDay(): boolean { return this.level.isDay(); }
  getBrightness(x: number, y: number, z: number): number {
    return Math.min(1, this.level.getBrightness(x, y, z) / 15);
  }
  getSkyDarken(): number { return this.level.getSkyDarken(); }
  getBiomeName(x: number, y: number, z: number): string {
    return this.biomeNameById.get(this.level.getBiome(x, y, z)) ?? '';
  }
  getRegistry(): ItemRegistry | null { return this.registry; }

  spawnEntity(e: Entity): void { this.spawnQueue.push(e); }
  removeEntity(e: Entity): void { e.remove(); }

  /** Source: Explosion. Game installs this to damage the player + break blocks. */
  explode(x: number, y: number, z: number, power: number, interaction: 'mob' | 'tnt' = 'mob'): void {
    if (this.explosionHandler) {
      this.explosionHandler(x, y, z, power, interaction);
      return;
    }
    const r2 = power * power;
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (e.isRemoved() || !e.isAlive()) continue;
      if (e.distanceToSqr(x, y, z) < r2) e.hurt(power, null);
    }
  }

  // ---- entity add / query -------------------------------------------------

  addEntity(e: Entity): void {
    e.id = this.nextId++;
    e.world = this;
    e.random = new XoroshiroRandomSource(this.seedBig ^ BigInt(e.id));
    // After the per-entity RNG exists, roll vanilla-style spawn equipment (armor).
    if (e instanceof Mob) e.finalizeSpawn();
    this.entities.push(e);
  }

  /** Convenience spawn by vanilla name (queued + flushed immediately). */
  spawn(name: string, x: number, y: number, z: number): Entity | null {
    const e = createEntity(name, this.level, x, y, z);
    if (!e) return null;
    this.spawnEntity(e);
    this.flushSpawns();
    return e;
  }

  getActiveEntities(): readonly Entity[] { return this.entities; }
  getPlayerTarget(): PlayerTarget | null { return this.playerTarget; }
  /** Re-binds the AI-facing player proxy after a respawn replaced the Player instance. */
  setPlayer(player: Player | null): void {
    this.playerTarget?.setPlayer(player);
  }
  getActiveEntityCount(): number { return this.entities.length; }
  clear(): void {
    this.entities.length = 0;
    this.spawnQueue.length = 0;
    this.activeChunks.clear();
    this.knownChunks.clear();
  }

  // ---- chunks -------------------------------------------------------------

  loadChunk(cx: number, cz: number): void { this.activeChunks.add(chunkKey(cx, cz)); }
  unloadChunk(cx: number, cz: number): void { this.activeChunks.delete(chunkKey(cx, cz)); }

  /**
   * Marks a chunk as already generated/populated without running the chunk-generation
   * creature pass. Used when saved chunks (with their stored entities) are restored.
   */
  markChunkKnown(cx: number, cz: number): void { this.knownChunks.add(chunkKey(cx, cz)); }

  /**
   * Replaces the active chunk set and runs the vanilla chunk-generation creature
   * spawn for chunks seen for the first time (NaturalSpawner.spawnMobsForChunkGeneration).
   */
  syncChunks(chunks: Iterable<readonly [number, number]>): void {
    this.activeChunks.clear();
    for (const [cx, cz] of chunks) {
      this.activeChunks.add(chunkKey(cx, cz));
      if (!this.knownChunks.has(chunkKey(cx, cz))) {
        this.knownChunks.add(chunkKey(cx, cz));
        if (this.spawnConfigLoaded) this.spawnCreaturesInChunk(cx, cz);
      }
    }
  }

  // ---- spawn config -------------------------------------------------------

  /** Loads /mc/worldgen.json (browser only). Not needed for headless tests. */
  async loadSpawnConfig(base = '/mc'): Promise<void> {
    const res = await fetch(`${base}/worldgen.json`);
    if (!res.ok) return;
    this.setSpawnConfig(await res.json() as SpawnConfig);
  }

  setSpawnConfig(config: SpawnConfig): void {
    this.biomeById.clear();
    this.biomeNameById.clear();
    const biomes = config.biomes ?? {};
    for (const name of Object.keys(biomes)) {
      const b = biomes[name];
      if (b && typeof b.id === 'number') {
        this.biomeById.set(b.id, b);
        this.biomeNameById.set(b.id, name);
      }
    }
    this.spawnConfigLoaded = this.biomeById.size > 0;
  }

  // ---- tick ---------------------------------------------------------------

  /** One deterministic 20 Hz tick. */
  tick(): void {
    this.tickCounter++;
    this.flushSpawns();
    if (this.playerTarget) this.playerTarget.tick();

    const p = this.playerTarget;
    const px = p ? p.x : 0, py = p ? p.y : 0, pz = p ? p.z : 0;
    const despawn2 = this.despawnDistance * this.despawnDistance;
    const cullByChunk = this.activeChunks.size > 0;

    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (e.removed) continue;

      if (cullByChunk && !this.activeChunks.has(chunkKey(Math.floor(e.x) >> 4, Math.floor(e.z) >> 4))) {
        e.remove(); continue;
      }
      if (p && this.canDespawn(e) && e.distanceToSqr(px, py, pz) > despawn2) {
        e.remove(); continue;
      }
      e.tick();
    }

    this.compact();
    this.flushSpawns(); // arrows / items created during entity ticks
    if (this.tickCounter % this.spawnInterval === 0) this.tryNaturalSpawn();
  }

  private flushSpawns(): void {
    for (let i = 0; i < this.spawnQueue.length; i++) this.addEntity(this.spawnQueue[i]);
    this.spawnQueue.length = 0;
  }

  /** Compacts removed entities in place (no allocation). */
  private compact(): void {
    let w = 0;
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (!e.removed) this.entities[w++] = e;
    }
    this.entities.length = w;
  }

  private canDespawn(e: Entity): boolean {
    // items/xp orbs despawn by age, not by distance; mobs by category rules
    if (e instanceof ItemEntity || e instanceof ExperienceOrb) return false;
    // Minecarts have no despawn rule (they persist until broken).
    if (e.getTypeName().endsWith('minecart')) return false;
    const cat = e.getCategory();
    return !cat.isPersistent() || cat === MobCategory.MONSTER;
  }

  // ---- natural spawning ---------------------------------------------------

  /**
   * Source: ServerChunkCache#tickChunks -> NaturalSpawner.spawnForChunk.
   * Vanilla walks every spawning chunk each tick; the client keeps a budget
   * (options.chunksPerTick) so the entity tick stays under the frame budget.
   */
  private tryNaturalSpawn(): void {
    if (!this.spawnConfigLoaded || this.activeChunks.size === 0 || !this.playerTarget) return;
    this.spawnStats.passes++;
    const persistent = this.tickCounter % PERSISTENT_SPAWN_INTERVAL === 0;
    const spawnableChunkCount = this.activeChunks.size;

    // Per-category entity counts: global cap is category cap * chunks / 289,
    // the per-player local cap is the raw category cap (LocalMobCapCalculator).
    this.countByCategory.clear();
    this.localCountByCategory.clear();
    const p = this.playerTarget;
    const localR2 = this.despawnDistance * this.despawnDistance;
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (e.isRemoved()) continue;
      const cat = e.getCategory();
      if (cat === MobCategory.MISC) continue;
      this.countByCategory.set(cat, (this.countByCategory.get(cat) ?? 0) + 1);
      if (e.distanceToSqr(p.x, p.y, p.z) <= localR2) {
        this.localCountByCategory.set(cat, (this.localCountByCategory.get(cat) ?? 0) + 1);
      }
    }

    // A deterministic random subset of the active chunks, like
    // Util.shuffle(chunkMap.collectSpawningChunks(...)).
    const keys: number[] = [];
    for (const k of this.activeChunks) keys.push(k);
    let budget = Math.min(this.chunksPerTick, keys.length);
    while (budget-- > 0) {
      const key = keys[this.random.nextInt(keys.length)];
      const cx = Math.floor(key / 65536) - 32768;
      const cz = (key % 65536) - 32768;
      this.spawnStats.chunkAttempts++;

      for (const cat of MobCategory.ALL) {
        if (cat === MobCategory.MISC) continue;
        // getFilteredSpawningCategories: persistent categories only on the 400-tick pass
        if (cat.isPersistent() && !persistent) continue;
        const cap = cat.getMaxInstancesPerChunk();
        if (cap <= 0) continue;
        const globalCap = Math.floor((cap * spawnableChunkCount) / MOB_CAP_CHUNKS);
        if ((this.countByCategory.get(cat) ?? 0) >= globalCap) continue;
        if ((this.localCountByCategory.get(cat) ?? 0) >= cap) continue;
        this.spawnCategoryForChunk(cat, cx, cz);
      }
    }
  }

  /**
   * Source: NaturalSpawner#spawnCategoryForChunk / #spawnCategoryForPosition.
   * One random column per chunk; 3 groups of pack-spawn attempts around it.
   */
  private spawnCategoryForChunk(cat: MobCategory, cx: number, cz: number): void {
    const r = this.random;
    const wx = cx * 16 + r.nextInt(16);
    const wz = cz * 16 + r.nextInt(16);
    const minY = this.level.minY;
    const topEmptyY = this.level.getHeight(wx, wz) + 1; // Heightmap.WORLD_SURFACE + 1
    if (topEmptyY < minY + 1) return;
    const y = minY + r.nextInt(topEmptyY - minY + 1);

    // NaturalSpawner line: if (!chunk.getBlockState(start).isRedstoneConductor(...))
    const startState = this.level.getBlockState(wx, y, wz);
    if (startState !== 0 && this.level.mc.collision(startState).length > 0) return;

    let clusterSize = 0;
    for (let group = 0; group < 3; group++) {
      let x = wx;
      let z = wz;
      let current: SpawnerEntry | null = null;
      let groupSize = 0;
      let max = Math.ceil(r.nextFloat() * 4.0);
      for (let i = 0; i < max; i++) {
        x += r.nextInt(6) - r.nextInt(6);
        z += r.nextInt(6) - r.nextInt(6);
        const px = x + 0.5;
        const pz = z + 0.5;
        const d2 = this.playerTarget
          ? this.playerTarget.distanceToSqr(px, y, pz)
          : Number.MAX_VALUE;
        // isRightDistanceToPlayerAndSpawnPoint
        if (d2 <= PLAYER_MIN_SPAWN_DISTANCE_SQR) continue;
        if (d2 > cat.getDespawnDistance() * cat.getDespawnDistance()) continue;

        if (!current) {
          current = this.getRandomSpawnMobAt(cat, x, y, z);
          if (!current) break;
          max = current.minCount + r.nextInt(1 + current.maxCount - current.minCount);
        }

        const et = ENTITY_TYPES.get(current.type.replace(/^minecraft:/, ''));
        if (!et || !et.factory) { this.spawnStats.noType++; continue; }
        if (!isSpawnPositionOk(et, this.level, x, y, z)
          || !checkSpawnRules(et, this.level, x, y, z, r)) {
          this.spawnStats.rulesFail++;
          continue;
        }
        const e = et.factory(this.level, px, y, pz);
        if (!e) { this.spawnStats.noType++; return; }
        this.spawnEntity(e);
        this.spawnStats.spawned++;
        // Keep the per-tick cap snapshot accurate: without this a single pass could add
        // chunksPerTick * clusterSize mobs past the category cap.
        this.countByCategory.set(cat, (this.countByCategory.get(cat) ?? 0) + 1);
        this.localCountByCategory.set(cat, (this.localCountByCategory.get(cat) ?? 0) + 1);
        clusterSize++;
        groupSize++;
        if (clusterSize >= MAX_SPAWN_CLUSTER_SIZE) return;
        if (groupSize >= this.getMaxGroupSize(et)) break;
      }
    }
  }

  /** Vanilla Mob.getMaxSpawnClusterSize default is 4; no type overrides it here. */
  private getMaxGroupSize(_type: EntityType): number { return 4; }

  /**
   * Source: NaturalSpawner#getRandomSpawnMobAt. Weighted pick from the biome's
   * spawner list for the category; entries without a factory are skipped (the
   * port reports them as `noType` instead of counting a spawn failure).
   */
  private getRandomSpawnMobAt(cat: MobCategory, x: number, y: number, z: number): SpawnerEntry | null {
    const biomeId = this.level.getBiome(x, y, z);
    const biome = this.biomeById.get(biomeId);
    if (!biome) return null;
    const list = biome.spawners[cat.spawnerKey];
    if (!Array.isArray(list) || list.length === 0) return null;

    let total = 0;
    let skipped = 0;
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      if (!entry || entry.weight <= 0) continue;
      const name = entry.type.replace(/^minecraft:/, '');
      const et = ENTITY_TYPES.get(name);
      if (!et || !et.factory) { skipped++; continue; }
      total += entry.weight;
    }
    if (skipped > 0) this.spawnStats.skippedEntries += skipped;
    if (total <= 0) { this.spawnStats.noType++; return null; }

    let roll = this.random.nextFloat() * total;
    let last: SpawnerEntry | null = null;
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      if (!entry || entry.weight <= 0) continue;
      const et = ENTITY_TYPES.get(entry.type.replace(/^minecraft:/, ''));
      if (!et || !et.factory) continue;
      last = entry;
      roll -= entry.weight;
      if (roll <= 0) return entry;
    }
    return last;
  }

  /**
   * Source: NaturalSpawner#spawnMobsForChunkGeneration. Runs once for every
   * newly loaded chunk that has not been seen before (vanilla runs it from the
   * SPAWN generation step). This is where the passive animals come from.
   */
  private spawnCreaturesInChunk(cx: number, cz: number): void {
    const biomeId = this.level.getBiome(cx * 16 + 8, this.level.seaLevel + 8, cz * 16 + 8);
    const biome = this.biomeById.get(biomeId);
    if (!biome) return;
    const list = biome.spawners[MobCategory.CREATURE.spawnerKey];
    if (!Array.isArray(list) || list.length === 0) return;

    const r = this.random;
    let guard = 0;
    while (r.nextFloat() < (biome.creatureSpawnProbability ?? 0.1) && guard++ < 64) {
      const entry = this.weightedCreaturePick(list);
      if (!entry) return;
      const et = ENTITY_TYPES.get(entry.type.replace(/^minecraft:/, ''));
      if (!et || !et.factory) { this.spawnStats.noType++; continue; }
      const count = entry.minCount + r.nextInt(1 + entry.maxCount - entry.minCount);
      let x = cx * 16 + r.nextInt(16);
      let z = cz * 16 + r.nextInt(16);
      for (let i = 0; i < count; i++) {
        // pick up to 4 times around the start column (vanilla attempts loop)
        for (let attempt = 0; attempt < 4; attempt++) {
          const y = this.findTopNonCollidingY(et, x, z);
          if (y === null) break;
          if (!isSpawnPositionOk(et, this.level, x, y, z)
            || !checkSpawnRules(et, this.level, x, y, z, r)) {
            this.spawnStats.rulesFail++;
            x = cx * 16 + r.nextInt(16);
            z = cz * 16 + r.nextInt(16);
            continue;
          }
          this.spawnEntity(et.factory(this.level, x + 0.5, y, z + 0.5));
          this.spawnStats.spawned++;
          this.spawnStats.chunkGenSpawns++;
          // vanilla keeps the group together: next member is placed next to this one
          x += r.nextInt(3) - 1;
          z += r.nextInt(3) - 1;
          break;
        }
      }
    }
  }

  private weightedCreaturePick(list: SpawnerEntry[]): SpawnerEntry | null {
    let total = 0;
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      if (!entry || entry.weight <= 0) continue;
      const et = ENTITY_TYPES.get(entry.type.replace(/^minecraft:/, ''));
      if (!et || !et.factory) continue;
      total += entry.weight;
    }
    if (total <= 0) { this.spawnStats.noType++; return null; }
    let roll = this.random.nextFloat() * total;
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      if (!entry || entry.weight <= 0) continue;
      const et = ENTITY_TYPES.get(entry.type.replace(/^minecraft:/, ''));
      if (!et || !et.factory) continue;
      roll -= entry.weight;
      if (roll <= 0) return entry;
    }
    return null;
  }

  /** Source: NaturalSpawner#getTopNonCollidingPos (scan down from the surface). */
  private findTopNonCollidingY(type: EntityType, x: number, z: number): number | null {
    const start = this.level.getHeight(x, z) + 1;
    const minY = this.level.minY + 1;
    for (let y = start; y >= minY; y--) {
      const state = this.level.getBlockState(x, y, z);
      if (state !== 0 && this.level.mc.collision(state).length > 0) continue; // not non-colliding
      if (isSpawnPositionOk(type, this.level, x, y, z)) return y;
    }
    return null;
  }

  // ---- pickups ------------------------------------------------------------

  /** Removes and counts every pickable ItemEntity within radius. */
  pickupItems(x: number, y: number, z: number, radius = 1.5): number {
    const r2 = radius * radius;
    let collected = 0;
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (!(e instanceof ItemEntity)) continue;
      if (e.isPickable() && e.distanceToSqr(x, y, z) <= r2) {
        collected += e.getItem().getCount();
        e.remove();
      }
    }
    return collected;
  }

  /** Removes and sums every nearby ExperienceOrb. */
  pickupXp(x: number, y: number, z: number, radius = 1.5): number {
    const r2 = radius * radius;
    let collected = 0;
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (!(e instanceof ExperienceOrb)) continue;
      if (e.distanceToSqr(x, y, z) <= r2) { collected += e.value; e.remove(); }
    }
    return collected;
  }
}
