// Port of net.minecraft.server.level.WorldGenRegion + net.minecraft.world.level.levelgen.feature
// .FeaturePlaceContext + net.minecraft.world.level.levelgen.placement.PlacementContext, reduced
// to what decoration needs in a browser Web Worker.
//
// A chunk is generated in isolation: there is NO neighbour chunk object to read or write. The
// "3x3 decoration seed" method (ChunkGenerator.applyBiomeDecoration is otherwise run once per
// chunk, with a WorldGenRegion spanning 3x3 chunks) is implemented by FeatureGenerator by
// running the decoration of the target chunk AND of its 8 neighbours as if each were the centre,
// then clipping every block write to the target chunk's 16x16 column footprint. This class is
// that clipping write/read view:
//   * setBlock          -> clipped to [minBlockX,minBlockX+16) x [minBlockZ,minBlockZ+16) and
//                          to the build height [minY, maxY]; cross-border writes are dropped.
//   * getBlockState     -> real block for the target chunk, a synthetic terrain column outside
//                          it (so a tree rooted in a neighbour can still be validated/placed
//                          and its overhanging leaves reach into the target chunk).
//   * getHeight         -> first free (air) y above the relevant top block, from the target
//                          chunk's primed heightmaps (or the surface() callback outside it).
//   * biomeAt           -> biome id at (x,z), memoised per generate() call.

import type { MinecraftData } from '../../block/state/BlockState.js';
import type { LevelChunk, LevelChunkSection } from '../../chunk/LevelChunk.js';
import type { TagSets } from './BlockTags.js';
import type { FeatureRandom } from './WorldgenRandom.js';

/** Parsed worldgen.json nodes. `any` is confined to this JSON boundary. */
export type Cfg = any;

export interface CfJson { type: string; config: Cfg }
export interface PfJson { feature: string | CfJson; placement: Cfg[] }

/** Passed to selector/patch features so they can place nested placed features. */
export interface FeatureApi {
  /** Run a placed feature (placement chain + configured feature) from origin (x,y,z). */
  runPlaced(
    ctx: FeatureContext, pf: string | PfJson, random: FeatureRandom,
    topFeature: string, x: number, y: number, z: number,
  ): boolean;
}

/** Standard feature entry point. Every features/*.ts exports `place` with this shape. */
export type FeaturePlaceFn = (
  ctx: FeatureContext, config: Cfg, random: FeatureRandom,
  x: number, y: number, z: number, api: FeatureApi,
) => boolean;

/** The read/write view handed to every feature and placement modifier. */
export interface FeatureContext {
  readonly mc: MinecraftData;
  readonly tags: TagSets;
  readonly minY: number;
  readonly maxY: number; // inclusive
  readonly seaLevel: number;
  readonly air: number;
  readonly water: number;
  readonly ground: number;
  readonly stone: number;
  readonly dirt: number;
  readonly minBlockX: number;
  readonly minBlockZ: number;

  /** Write a block state, clipped to the target chunk and the build height. */
  setBlock(x: number, y: number, z: number, state: number): void;
  /** Real block inside the target chunk, synthetic terrain column outside it. */
  getBlockState(x: number, y: number, z: number): number;
  /** First free (air) y for a Heightmap.Types, at world x,z. */
  getHeight(type: string, x: number, z: number): number;
  /** Biome id at world x,z (memoised per chunk). */
  biomeAt(x: number, z: number): number;
  /** Whether a biome's generation settings contain a placed feature. */
  biomeHasFeature(biomeId: number, featureName: string): boolean;
  /** Climate of a biome id (SnowAndFreezeFeature.shouldSnow / shouldFreeze). */
  biomeTemperature(biomeId: number): number;
  biomeHasPrecipitation(biomeId: number): boolean;
  /** Bare block name of a state id. */
  blockName(state: number): string;
}

/**
 * Concrete FeatureContext. One instance is reused for every chunk so no allocation happens in
 * the placement inner loops (only the biome memo Map is cleared between chunks).
 */
export class FeaturePlacer implements FeatureContext {
  readonly mc: MinecraftData;
  readonly tags: TagSets;
  readonly seaLevel: number;
  readonly air: number;
  readonly water: number;
  readonly ground: number;
  readonly stone: number;
  readonly dirt: number;

  minY = -64;
  maxY = 319;
  minBlockX = 0;
  minBlockZ = 0;

  private chunk!: LevelChunk;
  private section: LevelChunkSection | null = null;
  private sectionY = Number.NaN;
  private readonly getBiome: (x: number, y: number, z: number) => number;
  private surface: (x: number, z: number) => number;
  private readonly biomeHas: (biomeId: number, featureName: string) => boolean;
  private readonly temperature: (biomeId: number) => number;
  private readonly precipitation: (biomeId: number) => boolean;
  private readonly biomeMemo = new Map<number, number>();

  constructor(
    mc: MinecraftData,
    tags: TagSets,
    seaLevel: number,
    getBiome: (x: number, y: number, z: number) => number,
    surface: (x: number, z: number) => number,
    biomeHas: (biomeId: number, featureName: string) => boolean,
    temperature: (biomeId: number) => number,
    precipitation: (biomeId: number) => boolean,
  ) {
    this.mc = mc;
    this.tags = tags;
    this.seaLevel = seaLevel;
    this.getBiome = getBiome;
    this.surface = surface;
    this.biomeHas = biomeHas;
    this.temperature = temperature;
    this.precipitation = precipitation;
    this.air = mc.stateOf('air');
    this.water = mc.stateOf('water');
    this.ground = mc.stateOf('grass_block');
    this.stone = mc.stateOf('stone');
    this.dirt = mc.stateOf('dirt');
  }

  /** The surface callback is supplied per generate() call (it closes over the generator). */
  setSurface(fn: (x: number, z: number) => number): void { this.surface = fn; }

  /** Prepare for a new target chunk. Caller must have primed the chunk's heightmaps. */
  beginTarget(chunk: LevelChunk): void {
    this.chunk = chunk;
    this.minY = chunk.minY;
    this.maxY = chunk.minY + chunk.height - 1;
    this.minBlockX = chunk.x * 16;
    this.minBlockZ = chunk.z * 16;
    this.section = null;
    this.sectionY = Number.NaN;
    // Biome ids are deterministic for a given (x,z) and seed, so the memo persists across
    // chunks. Cap it so a long-running world cannot grow the map without bound.
    if (this.biomeMemo.size > 200_000) this.biomeMemo.clear();
  }

  private inTarget(x: number, z: number): boolean {
    return x >= this.minBlockX && x < this.minBlockX + 16 && z >= this.minBlockZ && z < this.minBlockZ + 16;
  }

  setBlock(x: number, y: number, z: number, state: number): void {
    if (x < this.minBlockX || x >= this.minBlockX + 16) return;
    if (z < this.minBlockZ || z >= this.minBlockZ + 16) return;
    if (y < this.minY || y > this.maxY) return;
    const sy = y >> 4;
    if (sy !== this.sectionY) {
      this.sectionY = sy;
      this.section = this.chunk.getOrCreateSection(sy);
    }
    this.section!.setBlockState(x & 15, y & 15, z & 15, state);
  }

  getBlockState(x: number, y: number, z: number): number {
    if (y < this.minY || y > this.maxY) return this.air;
    if (this.inTarget(x, z)) return this.chunk.getBlockState(x, y, z);
    return this.virtual(x, y, z);
  }

  /** Synthetic column used only for read/decision purposes outside the target chunk. */
  private virtual(x: number, y: number, z: number): number {
    const top = this.getHeight('WORLD_SURFACE_WG', x, z); // clamped, first free y
    if (y >= top) return this.air;
    if (y === top - 1) return this.ground;
    if (y >= top - 4) return this.dirt;
    return this.stone;
  }

  /**
   * First free (air) y for a heightmap type. Outside the target chunk we clamp (x,z) to the
   * nearest in-chunk column and reuse its primed heightmap: terrain is locally continuous and
   * this avoids a preliminary-density evaluation for every out-of-chunk read (which was the
   * dominant cost with the 3x3 method). The supplied surface() callback is only used as a
   * fallback for empty columns.
   */
  getHeight(type: string, x: number, z: number): number {
    const ocean = type.startsWith('OCEAN_FLOOR');
    let col: number;
    if (this.inTarget(x, z)) {
      col = ((z & 15) << 4) | (x & 15);
    } else {
      const cx = x < this.minBlockX ? this.minBlockX : (x >= this.minBlockX + 16 ? this.minBlockX + 15 : x);
      const cz = z < this.minBlockZ ? this.minBlockZ : (z >= this.minBlockZ + 16 ? this.minBlockZ + 15 : z);
      col = ((cz & 15) << 4) | (cx & 15);
    }
    const top = ocean ? this.chunk.motionBlockingHeight[col] : this.chunk.surfaceHeight[col];
    if (top < this.minY) return this.surface(x, z); // empty column: use the height query
    return top + 1;
  }

  biomeAt(x: number, z: number): number {
    const key = (x + 32768) * 65536 + (z + 32768);
    const cached = this.biomeMemo.get(key);
    if (cached !== undefined) return cached;
    const id = this.getBiome(x, 80, z);
    this.biomeMemo.set(key, id);
    return id;
  }

  biomeHasFeature(biomeId: number, featureName: string): boolean {
    return this.biomeHas(biomeId, featureName);
  }

  biomeTemperature(biomeId: number): number { return this.temperature(biomeId); }
  biomeHasPrecipitation(biomeId: number): boolean { return this.precipitation(biomeId); }

  blockName(state: number): string { return this.mc.blockOf(state).name; }
}
