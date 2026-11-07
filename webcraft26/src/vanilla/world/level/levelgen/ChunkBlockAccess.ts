// Fast block read/write for world generation.
//
// Vanilla's LevelChunk.setBlockState keeps every heightmap in sync on each write, because it
// is also the API gameplay uses. During generation we do not need that: NoiseChunkGenerator
// tracks the WORLD_SURFACE height itself while filling and calls recalcHeightmaps() once at
// the end, and the surface pass only ever looks at blocks it is about to overwrite. Writing
// straight into the cached LevelChunkSection is the same block state in the same palette slot,
// minus the bookkeeping - measured at roughly 40% of the chunk fill time.

import type { LevelChunk, LevelChunkSection } from '../chunk/LevelChunk.js';

export class ChunkBlockAccess {
  private section: LevelChunkSection | null = null;
  private sectionY = Number.NaN;

  constructor(private readonly chunk: LevelChunk) {}

  private sectionFor(y: number): LevelChunkSection | null {
    const sy = y >> 4;
    if (sy !== this.sectionY) {
      this.sectionY = sy;
      if (sy < this.chunk.minSection || sy > this.chunk.maxSectionY) this.section = null;
      else this.section = this.chunk.getOrCreateSection(sy);
    }
    return this.section;
  }

  get(x: number, y: number, z: number): number {
    const s = this.sectionFor(y);
    return s === null ? 0 : s.getBlockState(x & 15, y & 15, z & 15);
  }

  set(x: number, y: number, z: number, state: number): void {
    const s = this.sectionFor(y);
    if (s !== null) s.setBlockState(x & 15, y & 15, z & 15, state);
  }

  /** Forgets the cached section (call between chunks). */
  reset(): void {
    this.section = null;
    this.sectionY = Number.NaN;
  }
}
