// Port of net.minecraft.world.level.lighting.LevelLightEngine (client side subset).
//
// Vanilla keeps two 15 level light layers per section and propagates changes with
// a "decrease then increase" queue pair. This is the same algorithm, flattened to
// flat arrays because a browser cannot afford a class per cell.

import type { MinecraftData } from '../block/state/BlockState.js';
import { index, LevelChunk, type LevelChunkSection } from '../chunk/LevelChunk.js';

const MAX_LEVEL = 15;

export const enum LightLayer {
  SKY = 0,
  BLOCK = 1,
}

export interface LightLevelSource {
  getChunk(cx: number, cz: number): LevelChunk | undefined;
  minY: number;
  height: number;
  mc: MinecraftData;
}

/** Queue entry: 4 ints per entry, x/y/z/level. */
class LightQueue {
  private data: Int32Array;
  private head = 0;
  private tail = 0;

  constructor(capacity = 1 << 14) {
    this.data = new Int32Array(capacity * 4);
  }

  get length(): number { return (this.tail - this.head) / 4; }

  push(x: number, y: number, z: number, level: number): void {
    if (this.tail + 4 > this.data.length) {
      if (this.head > this.data.length / 4) {
        this.data.copyWithin(0, this.head, this.tail);
        this.tail -= this.head;
        this.head = 0;
      } else {
        const grown = new Int32Array(this.data.length * 2);
        grown.set(this.data);
        this.data = grown;
      }
    }
    this.data[this.tail++] = x;
    this.data[this.tail++] = y;
    this.data[this.tail++] = z;
    this.data[this.tail++] = level;
  }

  pop(out: Int32Array): boolean {
    if (this.head >= this.tail) return false;
    out[0] = this.data[this.head++];
    out[1] = this.data[this.head++];
    out[2] = this.data[this.head++];
    out[3] = this.data[this.head++];
    return true;
  }

  clear(): void { this.head = this.tail = 0; }
}

const DIR_OFFSETS: readonly [number, number, number][] = [
  [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0],
];

export class LightEngine {
  private readonly skyIncrease = new LightQueue();
  private readonly skyDecrease = new LightQueue();
  private readonly blockIncrease = new LightQueue();
  private readonly blockDecrease = new LightQueue();
  private readonly scratch = new Int32Array(4);

  constructor(private readonly source: LightLevelSource) {}

  // ---- accessors ----------------------------------------------------------

  getSkyLight(x: number, y: number, z: number): number {
    const chunk = this.chunkAt(x, z);
    if (!chunk) return MAX_LEVEL;
    const sy = y >> 4;
    const section = chunk.getSection(sy);
    if (!section) return MAX_LEVEL;
    if (!section.hasSkyLight()) return MAX_LEVEL;
    return section.skyLight!.get(x & 15, y & 15, z & 15);
  }

  getBlockLight(x: number, y: number, z: number): number {
    const chunk = this.chunkAt(x, z);
    if (!chunk) return 0;
    const section = chunk.getSection(y >> 4);
    if (!section || !section.hasBlockLight()) return 0;
    return section.blockLight!.get(x & 15, y & 15, z & 15);
  }

  /** One-entry chunk cache: propagation touches the same chunk for long runs of cells. It is
   *  reset at the start of every public entry point, so chunk loads/unloads can never leave it stale. */
  private cacheCx = NaN;
  private cacheCz = NaN;
  private cacheChunk: LevelChunk | undefined;

  /** Escape hatch for the equivalence test: seed every sky cell like the original implementation. */
  static legacySeeding = false;
  private readonly firstDark = new Int32Array(256);
  private levelScratch = new Uint8Array(0);

  private chunkAt(x: number, z: number): LevelChunk | undefined {
    const cx = x >> 4, cz = z >> 4;
    if (cx === this.cacheCx && cz === this.cacheCz) return this.cacheChunk;
    this.cacheCx = cx; this.cacheCz = cz;
    return (this.cacheChunk = this.source.getChunk(cx, cz));
  }

  private setSkyLight(x: number, y: number, z: number, level: number): void {
    const chunk = this.chunkAt(x, z);
    if (!chunk) return;
    // A newly placed light source can be in an empty air section that has no section object
    // yet. Silently dropping the write made getSkyLight()/getBlockLight() keep returning the
    // old value and the increase queue re-enqueued the same cells forever.
    const section = chunk.getOrCreateSection(y >> 4);
    section.getSkyLight().set(x & 15, y & 15, z & 15, level);
  }

  private setBlockLight(x: number, y: number, z: number, level: number): void {
    const chunk = this.chunkAt(x, z);
    if (!chunk) return;
    const section = chunk.getOrCreateSection(y >> 4);
    section.getBlockLight().set(x & 15, y & 15, z & 15, level);
  }

  // ---- chunk initialisation ----------------------------------------------

  /**
   * Vanilla LevelLightEngine.lightChunk: seed sky light from the top of every
   * column, then seed block light from emissive blocks, then run both queues.
   */
  lightChunk(chunk: LevelChunk): void {
    this.cacheCx = NaN;
    const mc = this.source.mc;
    const baseY = chunk.minY + chunk.height - 1;
    const h = chunk.height;

    // Pass 1: seed every column from the top. `firstDark[col]` is the highest y whose level is
    // below 15 (minY - 1 when the whole column is open sky); everything above it is exactly 15.
    const firstDark = this.firstDark;
    const levels = this.levelScratch.length >= 256 * h ? this.levelScratch : (this.levelScratch = new Uint8Array(256 * h));
    // Open-sky shortcut: everything above the column's heightmap is exactly 15, so fill whole
    // sections with one call instead of visiting every block. For a typical chunk that is ~15 of
    // 24 sections per column and it is what makes chunk application fit into a frame.
    const heightmap = chunk.surfaceHeight;
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const col = z * 16 + x;
        const base = col * h - chunk.minY;
        let top = baseY;
        if (heightmap) {
          const hm = heightmap[col];
          // Sanity: the heightmap entry must be a non-air block, else the map is stale/unset and
          // this column keeps the original full scan.
          if (hm >= chunk.minY && hm < baseY && chunk.getBlockState(x, hm, z) !== 0) top = hm;
        }
        if (top < baseY) {
          for (let y = baseY; y > top; y--) levels[base + y] = MAX_LEVEL;
          for (let sy = (top >> 4) + 1; sy <= (baseY >> 4); sy++) {
            const sec = chunk.getSection(sy);
            if (sec) sec.getSkyLight().fill(MAX_LEVEL);
          }
          const secTop = ((top >> 4) << 4) + 15;
          for (let y = Math.min(baseY, secTop); y > top; y--) {
            chunk.getOrCreateSection(y >> 4).getSkyLight().set(x, y & 15, z, MAX_LEVEL);
          }
        }
        let level = MAX_LEVEL;
        let dark = chunk.minY - 1;
        for (let y = top; y >= chunk.minY; y--) {
          const state = chunk.getBlockState(x, y, z);
          if (level > 0) {
            if (!mc.propagatesSky(state)) {
              const damp = mc.dampOf(state);
              level = Math.max(0, level - Math.max(1, damp));
            }
          }
          if (level < MAX_LEVEL && dark < chunk.minY) dark = y;
          levels[base + y] = level;
          chunk.getOrCreateSection(y >> 4).getSkyLight().set(x, y & 15, z, level);
        }
        firstDark[col] = dark;
      }
    }

    // Pass 2: only cells that can actually spread need to be in the queue. For an interior column
    // every in-chunk neighbour of a cell above max(own, neighbours' firstDark) + 1 is open sky too,
    // so it is already 15 and propagation is a no-op there (exactly equivalent to enqueueing it).
    // Border columns keep the legacy full enqueue because the neighbouring chunk is unknown here.
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const col = z * 16 + x;
        const base = col * h - chunk.minY;
        let top = baseY;
        if (!LightEngine.legacySeeding && x > 0 && x < 15 && z > 0 && z < 15) {
          top = Math.max(firstDark[col], firstDark[col - 1], firstDark[col + 1], firstDark[col - 16], firstDark[col + 16]) + 1;
          if (top > baseY) top = baseY;
        }
        for (let y = top; y >= chunk.minY; y--) {
          const level = levels[base + y];
          if (level > 1) this.enqueueIfSpreads(this.skyIncrease, x, y, z, level, chunk, true);
        }
      }
    }

    for (let sy = chunk.minSectionY; sy <= chunk.maxSectionY; sy++) {
      const section = chunk.getSection(sy);
      if (!section || section.isOnlyAir()) continue;
      for (let i = 0; i < 4096; i++) {
        const state = section.getState(i);
        if (state === 0) continue;
        const light = mc.lightOf(state);
        if (light <= 0) continue;
        const x = i & 15;
        const y = (i >> 8) & 15;
        const z = (i >> 4) & 15;
        const wx = (chunk.x << 4) + x;
        const wy = (sy << 4) + y;
        const wz = (chunk.z << 4) + z;
        this.setBlockLight(wx, wy, wz, light);
        this.blockIncrease.push(wx, wy, wz, light);
      }
    }

    this.processSkyIncrease();
    this.processBlockIncrease();
  }

  private enqueueIfSpreads(
    queue: LightQueue, x: number, y: number, z: number, level: number, chunk: LevelChunk, sky: boolean,
  ): void {
    if (level <= 1) return;
    const wx = (chunk.x << 4) + x;
    const wz = (chunk.z << 4) + z;
    queue.push(wx, y, wz, level);
  }

  /** Called after a block changes; `oldState` and `newState` drive both layers. */
  blockChanged(x: number, y: number, z: number, oldState: number, newState: number): void {
    this.cacheCx = NaN;
    const mc = this.source.mc;
    const oldDamp = mc.dampOf(oldState);
    const newDamp = mc.dampOf(newState);
    const oldEmissive = mc.lightOf(oldState);
    const newEmissive = mc.lightOf(newState);

    // ---- block light
    if (oldEmissive > 0) {
      this.setBlockLight(x, y, z, 0);
      this.blockDecrease.push(x, y, z, oldEmissive);
      this.processBlockDecrease();
    }
    if (newEmissive > 0) {
      this.setBlockLight(x, y, z, newEmissive);
      this.blockIncrease.push(x, y, z, newEmissive);
      this.processBlockIncrease();
    }
    if (oldEmissive === 0 && newEmissive === 0 && newDamp > oldDamp) {
      // a light source behind the new block may be cut off; let the decrease pass handle it
      const current = this.getBlockLight(x, y, z);
      if (current > 0) {
        this.setBlockLight(x, y, z, 0);
        this.blockDecrease.push(x, y, z, current);
        this.processBlockDecrease();
      }
    }

    // ---- sky light
    if (oldDamp !== newDamp || mc.propagatesSky(oldState) !== mc.propagatesSky(newState)) {
      const prev = this.getSkyLight(x, y, z);
      this.setSkyLight(x, y, z, 0);
      if (prev > 0) {
        this.skyDecrease.push(x, y, z, prev);
        this.processSkyDecrease();
      }
      // Re-seed from the column above. This cell must be written too: pushing it into the
      // increase queue only spreads light to its neighbours, so a newly dug 1-deep hole (whose
      // only open neighbour is above) stayed at sky light 0 and rendered pitch black.
      const fromAbove = this.recomputeColumnSky(x, z, y);
      const top = mc.propagatesSky(newState)
        ? fromAbove
        : Math.max(0, fromAbove - Math.max(1, newDamp));
      this.setSkyLight(x, y, z, top);
      if (top > 0) this.skyIncrease.push(x, y, z, top);
      this.processSkyIncrease();
    }
  }

  /** Re-applies the top-down sky pass for one column below y, returns the light arriving at y. */
  private recomputeColumnSky(x: number, z: number, y: number): number {
    const chunk = this.chunkAt(x, z);
    if (!chunk) return 0;
    const mc = this.source.mc;
    let level = MAX_LEVEL;
    for (let yy = Math.min(chunk.minY + chunk.height - 1, y + 1); yy > y; yy--) {
      const state = chunk.getBlockState(x & 15, yy, z & 15);
      if (!mc.propagatesSky(state)) level = Math.max(0, level - Math.max(1, mc.dampOf(state)));
      if (level === 0) break;
    }
    return level;
  }

  // ---- propagation --------------------------------------------------------

  private processSkyIncrease(): void {
    const mc = this.source.mc;
    const e = this.scratch;
    while (this.skyIncrease.pop(e)) {
      const [x, y, z, level] = e;
      const next = level - 1;
      if (next <= 0) continue;
      for (const [dx, dy, dz] of DIR_OFFSETS) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (ny < this.source.minY || ny >= this.source.minY + this.source.height) continue;
        const chunk = this.chunkAt(nx, nz);
        if (!chunk) continue;
        const state = chunk.getBlockState(nx & 15, ny, nz & 15);
        const damp = Math.max(1, mc.dampOf(state));
        // Skylight travels straight down an open column without losing a level (vanilla
        // SkyLightSectionStorage); only horizontal/upward steps and non-transparent blocks
        // attenuate it. Without this a 15-level shaft was dark two blocks down.
        const target = dy === -1 && mc.propagatesSky(state)
          ? level
          : Math.max(0, level - damp);
        if (target <= 0) continue;
        if (this.getSkyLight(nx, ny, nz) < target) {
          this.setSkyLight(nx, ny, nz, target);
          this.skyIncrease.push(nx, ny, nz, target);
        }
      }
    }
  }

  private processBlockIncrease(): void {
    const mc = this.source.mc;
    const e = this.scratch;
    while (this.blockIncrease.pop(e)) {
      const [x, y, z, level] = e;
      const next = level - 1;
      if (next <= 0) continue;
      for (const [dx, dy, dz] of DIR_OFFSETS) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (ny < this.source.minY || ny >= this.source.minY + this.source.height) continue;
        const chunk = this.chunkAt(nx, nz);
        if (!chunk) continue;
        const state = chunk.getBlockState(nx & 15, ny, nz & 15);
        const damp = Math.max(1, mc.dampOf(state));
        const target = Math.max(0, level - damp);
        if (target <= 0) continue;
        if (this.getBlockLight(nx, ny, nz) < target) {
          this.setBlockLight(nx, ny, nz, target);
          this.blockIncrease.push(nx, ny, nz, target);
        }
      }
    }
  }

  private processSkyDecrease(): void {
    const mc = this.source.mc;
    const e = this.scratch;
    while (this.skyDecrease.pop(e)) {
      const [x, y, z, level] = e;
      for (const [dx, dy, dz] of DIR_OFFSETS) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (ny < this.source.minY || ny >= this.source.minY + this.source.height) continue;
        const chunk = this.chunkAt(nx, nz);
        if (!chunk) continue;
        const current = this.getSkyLight(nx, ny, nz);
        if (current === 0) continue;
        if (current < level) {
          this.setSkyLight(nx, ny, nz, 0);
          this.skyDecrease.push(nx, ny, nz, current);
        } else {
          this.skyIncrease.push(nx, ny, nz, current);
        }
      }
    }
  }

  private processBlockDecrease(): void {
    const e = this.scratch;
    while (this.blockDecrease.pop(e)) {
      const [x, y, z, level] = e;
      for (const [dx, dy, dz] of DIR_OFFSETS) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (ny < this.source.minY || ny >= this.source.minY + this.source.height) continue;
        const chunk = this.chunkAt(nx, nz);
        if (!chunk) continue;
        const current = this.getBlockLight(nx, ny, nz);
        if (current === 0) continue;
        if (current < level) {
          this.setBlockLight(nx, ny, nz, 0);
          this.blockDecrease.push(nx, ny, nz, current);
        } else {
          this.blockIncrease.push(nx, ny, nz, current);
        }
      }
    }
  }

  /** Runs both queues to completion; call once after a batch of edits. */
  flush(): void {
    this.processSkyIncrease();
    this.processSkyDecrease();
    this.processBlockIncrease();
    this.processBlockDecrease();
    this.processSkyIncrease();
    this.processBlockIncrease();
  }
}

/** Packs light into the vanilla DebugPackedLightmapCoords layout (block << 4 | sky << 20). */
export function packLight(sky: number, block: number): number {
  return (block << 4) | (sky << 20);
}

export function unpackSky(packed: number): number { return (packed >> 20) & 15; }
export function unpackBlock(packed: number): number { return (packed >> 4) & 15; }
