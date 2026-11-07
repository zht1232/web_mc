// Source: net.minecraft.server.level.ServerLevel / EntityTickList (client port)
//
// Owns all entities in a ClientLevel:
//  - chunk load/unload (entities in unloaded chunks are removed),
//  - a deterministic 20 Hz tick (call tick() once per game tick),
//  - distance despawning / culling,
//  - natural spawning from worldgen.json biomes[].spawners and
//    creatureSpawnProbability, gated by day/night light.
//
// All randomness comes from XoroshiroRandomSource (never Math.random), so the
// same seed produces byte-identical tick results.

import { chunkKey } from '../../core/Geometry.js';
import { XoroshiroRandomSource } from '../../core/Random.js';
import type { ClientLevel } from '../level/ClientLevel.js';
import type { Player } from './player/Player.js';
import { Entity, type MobWorld, type Targetable } from './Entity.js';
import { ENTITY_TYPES } from './EntityType.js';
import { createEntity } from './EntityFactory.js';
import { PlayerTarget } from './PlayerTarget.js';
import { MobCategory } from './MobCategory.js';
import { checkSpawnRules, canSpawnCategoryNow } from './SpawnPlacements.js';
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
  /** chunk radius around the player that stays active */
  spawnRadius?: number;
  despawnDistance?: number;
  /** ticks between natural spawn attempts (vanilla uses 400) */
  spawnInterval?: number;
}

export class EntityManager implements MobWorld {
  readonly level: ClientLevel;
  readonly random: XoroshiroRandomSource;
  readonly entities: Entity[] = [];
  readonly playerTarget: PlayerTarget | null;

  private readonly spawnQueue: Entity[] = [];
  private readonly activeChunks = new Set<number>();
  private readonly biomeById = new Map<number, BiomeSpawners>();
  private spawnConfigLoaded = false;
  private readonly seedBig: bigint;
  private nextId = 1;
  private tickCounter = 0;
  private readonly despawnDistance: number;
  private readonly spawnInterval: number;

  constructor(level: ClientLevel, player: Player | null, seed: number | bigint = 0, options: EntityManagerOptions = {}) {
    this.level = level;
    this.seedBig = BigInt(seed);
    this.random = new XoroshiroRandomSource(this.seedBig);
    this.playerTarget = new PlayerTarget(level, player);
    this.despawnDistance = options.despawnDistance ?? 128;
    this.spawnInterval = options.spawnInterval ?? 400;
  }

  // ---- MobWorld -----------------------------------------------------------

  getPlayer(): Targetable | null { return this.playerTarget; }
  getEntities(): readonly Entity[] { return this.entities; }
  getGameTime(): number { return this.tickCounter; }
  isDay(): boolean { return this.level.isDay(); }
  getBrightness(x: number, y: number, z: number): number {
    return Math.min(1, this.level.getBrightness(x, y, z) / 15);
  }
  getSkyDarken(): number { return this.level.getSkyDarken(); }

  spawnEntity(e: Entity): void { this.spawnQueue.push(e); }
  removeEntity(e: Entity): void { e.remove(); }

  // ---- entity add / query -------------------------------------------------

  addEntity(e: Entity): void {
    e.id = this.nextId++;
    e.world = this;
    e.random = new XoroshiroRandomSource(this.seedBig ^ BigInt(e.id));
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
  getActiveEntityCount(): number { return this.entities.length; }
  clear(): void {
    this.entities.length = 0;
    this.spawnQueue.length = 0;
    this.activeChunks.clear();
  }

  // ---- chunks -------------------------------------------------------------

  loadChunk(cx: number, cz: number): void { this.activeChunks.add(chunkKey(cx, cz)); }
  unloadChunk(cx: number, cz: number): void { this.activeChunks.delete(chunkKey(cx, cz)); }
  /** Replaces the active chunk set (used when the render distance changes). */
  syncChunks(chunks: Iterable<readonly [number, number]>): void {
    this.activeChunks.clear();
    for (const [cx, cz] of chunks) this.activeChunks.add(chunkKey(cx, cz));
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
    const biomes = config.biomes ?? {};
    for (const name of Object.keys(biomes)) {
      const b = biomes[name];
      if (b && typeof b.id === 'number') this.biomeById.set(b.id, b);
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
    const cat = e.getCategory();
    return !cat.isPersistent() || cat === MobCategory.MONSTER;
  }

  // ---- natural spawning ---------------------------------------------------

  /** Vanilla NaturalSpawner.spawnForChunk, simplified for the client. */
  private tryNaturalSpawn(): void {
    if (!this.spawnConfigLoaded || this.activeChunks.size === 0 || !this.playerTarget) return;

    // choose a random active chunk (allocate the key list only once per cycle)
    const keys: number[] = [];
    for (const k of this.activeChunks) keys.push(k);
    if (keys.length === 0) return;
    const key = keys[this.random.nextInt(keys.length)];
    const cx = Math.floor(key / 65536) - 32768;
    const cz = (key % 65536) - 32768;

    const wx = cx * 16 + this.random.nextInt(16);
    const wz = cz * 16 + this.random.nextInt(16);
    const biomeId = this.level.getBiome(wx, this.level.seaLevel, wz);
    const biome = this.biomeById.get(biomeId);
    if (!biome) return;

    const spawners = biome.spawners ?? {};
    const day = this.level.isDay();
    for (const catKey of Object.keys(spawners)) {
      const cat = MobCategory.bySpawnerKey(catKey);
      if (!cat || cat === MobCategory.MISC) continue;
      if (!canSpawnCategoryNow(this.level, cat.name)) continue;
      // passive creatures are gated by creatureSpawnProbability
      if (cat === MobCategory.CREATURE && this.random.nextFloat() > (biome.creatureSpawnProbability ?? 0.1)) continue;
      const entries = spawners[catKey];
      if (!Array.isArray(entries) || entries.length === 0) continue;
      const cap = cat.getMaxInstancesPerChunk();
      if (cap > 0 && this.countCategoryInChunk(cat, cx, cz) >= cap) continue;

      // weighted pick
      let total = 0;
      for (let i = 0; i < entries.length; i++) total += entries[i].weight;
      let roll = this.random.nextFloat() * total;
      let pick = entries[0];
      for (let i = 0; i < entries.length; i++) {
        roll -= entries[i].weight;
        if (roll <= 0) { pick = entries[i]; break; }
      }
      const typeName = pick.type.replace(/^minecraft:/, '');
      const et = ENTITY_TYPES.get(typeName);
      if (!et || !et.factory) continue;

      const count = pick.minCount + this.random.nextInt(Math.max(1, pick.maxCount - pick.minCount + 1));
      for (let i = 0; i < count; i++) {
        const sx = wx + this.random.nextInt(5) - 2;
        const sz = wz + this.random.nextInt(5) - 2;
        const sy = this.level.getHeight(sx, sz) + 1;
        if (!checkSpawnRules(et, this.level, sx, sy, sz)) continue;
        const e = et.factory(this.level, sx + 0.5, sy, sz + 0.5);
        if (e) this.spawnEntity(e);
      }
      break; // one category per cycle, like vanilla
    }
  }

  private countCategoryInChunk(cat: MobCategory, cx: number, cz: number): number {
    let n = 0;
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (e.removed || e.getCategory() !== cat) continue;
      if ((Math.floor(e.x) >> 4) === cx && (Math.floor(e.z) >> 4) === cz) n++;
    }
    return n;
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
        collected += e.getItem().count;
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
