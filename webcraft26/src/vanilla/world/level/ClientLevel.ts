// Port of net.minecraft.client.multiplayer.ClientLevel plus the pieces of Level the
// client needs: chunk storage, block access, light access, biomes and the day clock.

import { MinecraftData } from './block/state/BlockState.js';
import { LevelChunk, index } from './chunk/LevelChunk.js';
import { LightEngine } from './lighting/LightEngine.js';
import { chunkKey } from '../../core/Geometry.js';
import type { NoiseChunkGenerator } from './levelgen/NoiseChunkGenerator.js';

export interface LevelConfig {
  minY: number;
  height: number;
  seaLevel: number;
}

export const DEFAULT_LEVEL_CONFIG: LevelConfig = { minY: -64, height: 384, seaLevel: 63 };

/** Vanilla day length in ticks. */
export const DAY_LENGTH = 24000;

export class ClientLevel {
  readonly chunks = new Map<number, LevelChunk>();
  readonly light: LightEngine;
  readonly minY: number;
  readonly height: number;
  readonly seaLevel: number;

  /** world time in ticks; 0 is sunrise, 6000 noon, 12000 sunset, 18000 midnight */
  time = 1000;
  gameTime = 0;
  private lastTime = 1000;

  /** radians, matches vanilla Level.getTimeOfDay */
  private rainLevel = 0;
  private thunderLevel = 0;
  readonly raining = false;
  readonly thundering = false;

  constructor(
    readonly mc: MinecraftData,
    readonly generator: NoiseChunkGenerator | null,
    readonly seed: bigint,
    config: LevelConfig = DEFAULT_LEVEL_CONFIG,
  ) {
    this.minY = config.minY;
    this.height = config.height;
    this.seaLevel = config.seaLevel;
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
    const chunk = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!chunk) return false;
    const old = chunk.getBlockState(x & 15, y, z & 15);
    if (old === state) return false;
    chunk.setBlockState(x & 15, y, z & 15, state);
    this.light.blockChanged(x, y, z, old, state);
    this.markDirtyAround(x, y, z);
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

  /** vanilla Level.getTimeOfDay: 0..1 over a day, offset so 0 is sunrise. */
  getTimeOfDay(): number {
    const dayTime = this.time % DAY_LENGTH;
    let f = (dayTime - 18000) / DAY_LENGTH;
    if (f < 0) f += 1;
    return f;
  }

  /** vanilla Level.getSunAngle */
  getSunAngle(partialTicks: number): number {
    const t = this.getTimeOfDayPartial(partialTicks);
    return t * Math.PI * 2;
  }

  getTimeOfDayPartial(partialTicks: number): number {
    const dayTime = (this.time + partialTicks) % DAY_LENGTH;
    let f = (dayTime - 18000) / DAY_LENGTH;
    if (f < 0) f += 1;
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

  /** True while the sun is above the horizon. */
  isDay(): boolean {
    const t = this.getTimeOfDay();
    return t < 0.5;
  }

  getRainLevel(): number { return this.rainLevel; }
  getThunderLevel(): number { return this.thunderLevel; }

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
      this.time += dt;
      if (this.time >= DAY_LENGTH) this.time -= DAY_LENGTH;
    }
  }

  getPartialTickTime(partial: number): number {
    return this.lastTime + (this.time - this.lastTime) * partial;
  }
}
