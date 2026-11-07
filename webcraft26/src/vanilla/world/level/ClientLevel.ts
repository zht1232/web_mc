// Port of net.minecraft.client.multiplayer.ClientLevel plus the pieces of Level the
// client needs: chunk storage, block access, light access, biomes and the day clock.

import { MinecraftData } from './block/state/BlockState.js';
import { LevelChunk, index } from './chunk/LevelChunk.js';
import { LightEngine } from './lighting/LightEngine.js';
import { chunkKey } from '../../core/Geometry.js';
import { XoroshiroRandomSource } from '../../core/Random.js';
import type { NoiseChunkGenerator } from './levelgen/NoiseChunkGenerator.js';

export interface LevelConfig {
  minY: number;
  height: number;
  seaLevel: number;
}

export const DEFAULT_LEVEL_CONFIG: LevelConfig = { minY: -64, height: 384, seaLevel: 63 };

/** Vanilla day length in ticks. */
export const DAY_LENGTH = 24000;

/**
 * Hysteresis between the load radius and the unload radius, in chunks.
 * Vanilla ClientChunkCache keeps its storage range at
 * `calculateStorageRange(viewRange) = max(2, viewRange) + 3`
 * (G:/ck-web26/src-vanilla/net/minecraft/client/multiplayer/ClientChunkCache.java:159-161).
 * The render distance used by Game.ensureChunksAround() is the *enter* radius, so chunks are
 * only dropped once they are 3 chunks beyond it. That margin is what keeps a player walking
 * back and forth across a chunk border from generating/dropping the same columns forever.
 */
export const CHUNK_RETAIN_MARGIN = 3;

export class ClientLevel {
  readonly chunks = new Map<number, LevelChunk>();
  /**
   * chunkKey()s the player has edited this session (Level.setBlockState succeeded).
   * Deliberate deviation from vanilla: the real client re-requests a dropped chunk and the
   * server sends the stored copy back, but this client has no save-first chunk source yet
   * (ChunkProvider always regenerates from the seed). Keeping edited chunks loaded is what
   * makes a modify -> teleport away -> come back round trip show the edit instead of pristine
   * terrain. Only chunks the player actually touched are pinned, so flying around still frees
   * memory; the set is cleared with the session.
   */
  readonly modifiedChunks = new Set<number>();
  readonly light: LightEngine;
  readonly minY: number;
  readonly height: number;
  readonly seaLevel: number;

  /** world time in ticks; 0 is sunrise, 6000 noon, 12000 sunset, 18000 midnight */
  time = 1000;
  gameTime = 0;
  private lastTime = 1000;

  /**
   * Weather simulation, port of net/minecraft/server/level/ServerLevel#advanceWeatherCycle
   * driven by ServerLevel.WEATHER_DATA (level.dat: Raining / RainTime / Thundering /
   * ThunderTime) plus the four vanilla IntProviders:
   *   RAIN_DELAY     = UniformInt(12000, 180000)   (ServerLevel.java:188)
   *   RAIN_DURATION  = UniformInt(12000, 24000)    (ServerLevel.java:189)
   *   THUNDER_DELAY  = UniformInt(12000, 180000)   (ServerLevel.java:190)
   *   THUNDER_DURATION = UniformInt(3600, 15600)   (ServerLevel.java:191)
   * rainLevel/thunderLevel move by +/-0.01 per tick and are clamped to 0..1.
   */
  private rainLevel = 0;
  private thunderLevel = 0;
  private raining = false;
  private thundering = false;
  private clearWeatherTime = 0;
  private rainTime = 0;
  private thunderTime = 0;
  /** Game.setRain(level) manual override; null = simulation decides. */
  private manualRain: number | null = null;
  /** Deterministic weather RNG (vanilla uses level.random). */
  readonly weatherRandom: XoroshiroRandomSource;

  constructor(
    readonly mc: MinecraftData,
    readonly generator: NoiseChunkGenerator | null,
    readonly seed: bigint,
    config: LevelConfig = DEFAULT_LEVEL_CONFIG,
  ) {
    this.minY = config.minY;
    this.height = config.height;
    this.seaLevel = config.seaLevel;
    // Separate deterministic stream so weather noise never perturbs entity randomness.
    this.weatherRandom = new XoroshiroRandomSource(this.seed ^ 0x5deece66dn);
    this.light = new LightEngine({
      getChunk: (cx, cz) => this.chunks.get(chunkKey(cx, cz)),
      minY: this.minY,
      height: this.height,
      mc,
    });
  }

  // ---- chunks -------------------------------------------------------------

  getChunk(cx: number, cz: number): LevelChunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  hasChunk(cx: number, cz: number): boolean {
    return this.chunks.has(chunkKey(cx, cz));
  }

  /** Generates a chunk if the generator is available. Returns undefined when unavailable. */
  ensureChunk(cx: number, cz: number): LevelChunk | undefined {
    const key = chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (chunk) return chunk;
    if (!this.generator) return undefined;
    chunk = new LevelChunk(cx, cz, this.minY, this.height, this.mc);
    this.generator.generateChunk(chunk);
    this.chunks.set(key, chunk);
    this.light.lightChunk(chunk);
    return chunk;
  }

  addChunk(chunk: LevelChunk): void {
    this.chunks.set(chunkKey(chunk.x, chunk.z), chunk);
    this.light.lightChunk(chunk);
  }

  // ---- chunk unloading ----------------------------------------------------
  //
  // Port of the client-side drop path: ClientChunkCache.drop / Storage.drop
  // (G:/ck-web26/src-vanilla/net/minecraft/client/multiplayer/ClientChunkCache.java:60-68,
  // 258-265). Vanilla drops a chunk when the packet handler says it left the storage range,
  // then calls level.unload(chunk) and LevelRenderer/EntityManager release their per-chunk
  // state. Lighting lives inside the chunk sections, so deleting the map entry frees it too.

  /** True when the chunk still has block edits that have not reached WorldSaveManager yet. */
  hasUnsavedChanges(cx: number, cz: number): boolean {
    const chunk = this.chunks.get(chunkKey(cx, cz));
    return chunk !== undefined && chunk.dirtySections.size > 0;
  }

  /**
   * Removes one chunk from the level. Returns the removed chunk, or undefined when it was not
   * loaded. The caller owns the GPU/entity state and must release it (LevelRenderer.prune,
   * EntityManager.unloadChunk) — see unloadFarChunks for the batched variant.
   *
   * Safety: never drop a chunk for which hasUnsavedChanges() is true. A chunk whose edits were
   * flushed to the save store is clean (WorldSaveManager.flushDirty clears chunk.dirtySections
   * only after the bytes are in the IndexedDB batch) and may be dropped: loading it again
   * regenerates identical terrain from the seed, and the saved copy wins on world reload.
   */
  removeChunk(cx: number, cz: number): LevelChunk | undefined {
    const key = chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (!chunk) return undefined;
    this.chunks.delete(key);
    return chunk;
  }

  /** True when the player has edited this chunk (see modifiedChunks). Such chunks are pinned. */
  isChunkModified(cx: number, cz: number): boolean {
    return this.modifiedChunks.has(chunkKey(cx, cz));
  }

  /** Chebyshev distance test, same as vanilla ClientChunkCache.Storage.inRange. */
  private chunkInRange(chunk: LevelChunk, centerCx: number, centerCz: number, radius: number): boolean {
    return Math.abs(chunk.x - centerCx) <= radius && Math.abs(chunk.z - centerCz) <= radius;
  }

  /**
   * Number of loaded chunks outside `retainRadius` of (centerCx, centerCz) that the unload pass
   * may eventually drop: modified chunks are excluded (pinned), dirty chunks are counted because
   * they become droppable once flushed. Cheap early-out for a per-tick caller.
   */
  countChunksOutside(centerCx: number, centerCz: number, retainRadius: number): number {
    const radius = Math.max(2, retainRadius); // vanilla max(2, viewRange) clamp
    let count = 0;
    for (const [key, chunk] of this.chunks) {
      if (this.modifiedChunks.has(key)) continue;
      if (!this.chunkInRange(chunk, centerCx, centerCz, radius)) count++;
    }
    return count;
  }

  /**
   * True when a chunk outside the retention radius still has unsaved edits (call
   * WorldSaveManager.flushDirty first). Modified chunks are included: they stay loaded, but
   * their edits still have to reach the save store.
   */
  hasDirtyChunksOutside(centerCx: number, centerCz: number, retainRadius: number): boolean {
    const radius = Math.max(2, retainRadius);
    for (const chunk of this.chunks.values()) {
      if (chunk.dirtySections.size === 0) continue;
      if (!this.chunkInRange(chunk, centerCx, centerCz, radius)) return true;
    }
    return false;
  }

  /**
   * Drops every chunk farther than `retainRadius` chunks from (centerCx, centerCz), keeping the
   * ones the player edited (modifiedChunks) and the ones with unsaved edits for the next pass
   * (the caller flushes them first, see hasDirtyChunksOutside / WorldSaveManager.flushDirty).
   * Returns the removed chunks in map order so the caller can drop their GPU buffers and entity
   * bookkeeping.
   *
   * `retainRadius` should be renderDistance + CHUNK_RETAIN_MARGIN; the max(2, ...) clamp matches
   * vanilla and keeps the chunk the player stands in loaded even if a caller passes 0.
   */
  unloadFarChunks(centerCx: number, centerCz: number, retainRadius: number): LevelChunk[] {
    const radius = Math.max(2, retainRadius);
    const removed: LevelChunk[] = [];
    for (const [key, chunk] of this.chunks) {
      if (this.chunkInRange(chunk, centerCx, centerCz, radius)) continue;
      // Edited chunks are pinned: this client regenerates from the seed instead of re-reading
      // the saved copy, so dropping one would make the edit vanish until a world reload.
      if (this.modifiedChunks.has(key)) continue;
      // Dirty chunks are kept: dropping them would lose edits that are not in the save store.
      // WorldSaveManager.flushDirty() clears dirtySections, so the next call removes them.
      if (chunk.dirtySections.size > 0) continue;
      this.chunks.delete(key);
      removed.push(chunk);
    }
    return removed;
  }

  // ---- blocks -------------------------------------------------------------

  getBlockState(x: number, y: number, z: number): number {
    if (y < this.minY || y >= this.minY + this.height) return 0;
    const chunk = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!chunk) return 0;
    return chunk.getBlockState(x & 15, y, z & 15);
  }

  /** Same as getBlockState but tolerant of unloaded chunks (used by the mesher). */
  getBlockStateOrStone(x: number, y: number, z: number): number {
    return this.getBlockState(x, y, z);
  }

  setBlockState(x: number, y: number, z: number, state: number, flags = 3): boolean {
    if (y < this.minY || y >= this.minY + this.height) return false;
    const key = chunkKey(x >> 4, z >> 4);
    const chunk = this.chunks.get(key);
    if (!chunk) return false;
    const old = chunk.getBlockState(x & 15, y, z & 15);
    if (old === state) return false;
    chunk.setBlockState(x & 15, y, z & 15, state);
    this.light.blockChanged(x, y, z, old, state);
    this.markDirtyAround(x, y, z);
    // Pin the chunk: the client cannot reload a saved chunk yet (see modifiedChunks).
    this.modifiedChunks.add(key);
    return true;
  }

  /** Vanilla Level.markAndNotifyBlock: neighbours must remesh too. */
  markDirtyAround(x: number, y: number, z: number): void {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const chunk = this.chunks.get(chunkKey((x + dx) >> 4, (z + dz) >> 4));
          if (chunk) chunk.dirty = true;
        }
      }
    }
  }

  getSkyLight(x: number, y: number, z: number): number { return this.light.getSkyLight(x, y, z); }
  getBlockLight(x: number, y: number, z: number): number { return this.light.getBlockLight(x, y, z); }

  /** Vanilla Level.getMaxLocalRawBrightness with skylight subtraction. */
  getBrightness(x: number, y: number, z: number): number {
    return Math.max(this.getBlockLight(x, y, z), this.adjustSkyDarken(this.getSkyLight(x, y, z)));
  }

  private adjustSkyDarken(skyLight: number): number {
    const darken = this.getSkyDarken();
    if (darken === 1) return skyLight;
    return Math.trunc(skyLight * darken);
  }

  getSkyDarken(): number {
    const f = this.getTimeOfDay();
    let g = 1 - (Math.cos(f * Math.PI * 2) * 2 + 0.2);
    g = Math.min(1, Math.max(0, g));
    return 1 - g * 0.8;
  }

  /**
   * Legacy Level.getTimeOfDay fraction used by the sky-darken curve:
   *   f = dayTime / 24000 - 0.25, wrapped into [0, 1)
   * so 0 = noon, 0.25 = sunset (12000), 0.5 = midnight (18000), 0.75 = sunrise (0/24000).
   * (The previous formula offset by -18000 instead of -6000, which made the sky-darken
   * curve inverted: noon was dark and midnight was bright — see the spawn light tests.)
   */
  getTimeOfDay(): number {
    let f = (this.time % DAY_LENGTH) / DAY_LENGTH - 0.25;
    if (f < 0) f += 1;
    if (f > 1) f -= 1;
    return f;
  }

  /** vanilla Level.getSunAngle */
  getSunAngle(partialTicks: number): number {
    const t = this.getTimeOfDayPartial(partialTicks);
    return t * Math.PI * 2;
  }

  getTimeOfDayPartial(partialTicks: number): number {
    let f = ((this.time + partialTicks) % DAY_LENGTH) / DAY_LENGTH - 0.25;
    if (f < 0) f += 1;
    if (f > 1) f -= 1;
    return f;
  }

  getSkyDarkenAt(partialTicks: number): number {
    const f = this.getSkyDarkenFrom(this.getTimeOfDayPartial(partialTicks));
    return f;
  }

  private getSkyDarkenFrom(timeOfDay: number): number {
    let g = 1 - (Math.cos(timeOfDay * Math.PI * 2) * 2 + 0.2);
    g = Math.min(1, Math.max(0, g));
    return 1 - g * 0.8;
  }

  /**
   * True while the sun is above the horizon.
   * Vanilla 26.2: Level.isDay() == skyDarken < 4 (skyDarken int 0..11, from the
   * SKY_LIGHT_LEVEL timeline: 15 by day, 4 at night). The port stores skyDarken as
   * the 0..1 light factor, so the equivalent threshold is > 11/15.
   */
  isDay(): boolean {
    return this.getSkyDarken() > 0.5;
  }

  getRainLevel(): number { return this.manualRain ?? this.rainLevel; }
  getThunderLevel(): number { return this.thunderLevel; }
  isRaining(): boolean { return this.raining; }
  isThundering(): boolean { return this.thundering; }

  /** Game.setRain(): manual override of the rendered rain strength (0..1), null = auto. */
  setRainOverride(amount: number | null): void {
    this.manualRain = amount === null ? null : Math.max(0, Math.min(1, amount));
  }

  /** level.dat WeatherData fields (Raining / RainTime / Thundering / ThunderTime). */
  getWeatherState(): { raining: boolean; rainTime: number; thundering: boolean; thunderTime: number } {
    return {
      raining: this.raining,
      rainTime: this.rainTime,
      thundering: this.thundering,
      thunderTime: this.thunderTime,
    };
  }

  /** PrimaryLevelData.setRaining / setRainTime / setThundering / setThunderTime. */
  setWeatherState(state: {
    raining?: boolean; rainTime?: number; thundering?: boolean; thunderTime?: number;
  }): void {
    if (typeof state.raining === 'boolean') {
      this.raining = state.raining;
      // ServerLevel.setWeatherParameters: a loaded "raining" world starts at full strength.
      if (state.raining) this.rainLevel = 1;
    }
    if (typeof state.rainTime === 'number') this.rainTime = Math.max(0, Math.trunc(state.rainTime));
    if (typeof state.thundering === 'boolean') {
      this.thundering = state.thundering;
      if (state.thundering) this.thunderLevel = 1;
    }
    if (typeof state.thunderTime === 'number') this.thunderTime = Math.max(0, Math.trunc(state.thunderTime));
  }

  /** ServerLevel.advanceWeatherCycle, one call per game tick. */
  tickWeather(): void {
    const r = this.weatherRandom;
    let clearWeatherTime = this.clearWeatherTime;
    let thunderTime = this.thunderTime;
    let rainTime = this.rainTime;
    let thundering = this.thundering;
    let raining = this.raining;

    if (clearWeatherTime > 0) {
      clearWeatherTime--;
      thunderTime = thundering ? 0 : 1;
      rainTime = raining ? 0 : 1;
      thundering = false;
      raining = false;
    } else {
      if (thunderTime > 0) {
        if (--thunderTime === 0) thundering = !thundering;
      } else if (thundering) {
        thunderTime = 3600 + r.nextInt(15600 - 3600 + 1); // THUNDER_DURATION
      } else {
        thunderTime = 12000 + r.nextInt(180000 - 12000 + 1); // THUNDER_DELAY
      }
      if (rainTime > 0) {
        if (--rainTime === 0) raining = !raining;
      } else if (raining) {
        rainTime = 12000 + r.nextInt(24000 - 12000 + 1); // RAIN_DURATION
      } else {
        rainTime = 12000 + r.nextInt(180000 - 12000 + 1); // RAIN_DELAY
      }
    }

    this.clearWeatherTime = clearWeatherTime;
    this.thunderTime = thunderTime;
    this.rainTime = rainTime;
    this.thundering = thundering;
    this.raining = raining;

    this.thunderLevel = Math.min(1, Math.max(0, this.thunderLevel + (thundering ? 0.01 : -0.01)));
    this.rainLevel = Math.min(1, Math.max(0, this.rainLevel + (raining ? 0.01 : -0.01)));
  }

  /** Convenience for tests / commands: force a weather transition in `delayTicks` ticks. */
  forceWeather(raining: boolean, thundering = false, delayTicks = 1): void {
    this.raining = raining;
    this.thundering = thundering;
    this.rainTime = Math.max(1, Math.trunc(delayTicks));
    this.thunderTime = Math.max(1, Math.trunc(delayTicks));
    this.clearWeatherTime = 0;
  }

  // ---- biomes / height ----------------------------------------------------

  getBiome(x: number, y: number, z: number): number {
    const chunk = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!chunk) return 0;
    const sy = y >> 4;
    const section = chunk.getSection(sy);
    if (!section) return 0;
    return section.biomes.get(index(x & 15, y & 15, z & 15));
  }

  /** Highest non air block at a column, or minY-1. */
  getHeight(x: number, z: number): number {
    const chunk = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!chunk) return this.minY - 1;
    return chunk.getHeight(((z & 15) << 4) | (x & 15));
  }

  /** vanilla Level.canSeeSky */
  canSeeSky(x: number, y: number, z: number): boolean {
    return y >= this.getHeight(x, z) + 1;
  }

  // ---- ticking ------------------------------------------------------------

  tick(dt: number, doDaylightCycle = true): void {
    this.gameTime += dt;
    this.lastTime = this.time;
    if (doDaylightCycle) {
      // dt is in game ticks (1 per 20 Hz tick). Vanilla dayTime is a monotonic long, every
      // consumer takes it modulo DAY_LENGTH itself, and the moon phase needs the day count.
      this.time += dt;
    }
    // ServerLevel.tick -> "weather" -> advanceWeatherCycle, once per game tick.
    this.tickWeather();
  }

  getPartialTickTime(partial: number): number {
    return this.lastTime + (this.time - this.lastTime) * partial;
  }
}
