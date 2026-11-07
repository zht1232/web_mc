// Port of net.minecraft.world.level.chunk.ChunkGenerator.applyBiomeDecoration (the feature half)
// for a browser Web Worker where chunks are generated in isolation.
//
// Vanilla decorates one chunk with a WorldGenRegion spanning 3x3 chunks, using a decorationSeed
// derived from the CENTRE chunk's origin, and the feature list of every biome present in that 3x3
// area. A tree rooted near a chunk border writes leaves into the neighbouring chunk. To reproduce
// that without neighbour chunk objects, we use the "3x3 decoration seed" method: for the target
// chunk C we run the decoration of C AND of its 8 neighbours (each with its OWN decorationSeed and
// origin), and clip every block write to C's 16x16 footprint (see FeaturePlacer). Single-block
// features from neighbour runs are clipped away; overhanging tree canopies are kept.
//
// Steps executed (GenerationStep.Decoration indices): 6 UNDERGROUND_ORES, 7 UNDERGROUND_DECORATION,
// 8 FLUID_SPRINGS, 9 VEGETAL_DECORATION, 10 TOP_LAYER_MODIFICATION. Structure steps (0..5) and
// LAKES (1) are skipped: they need structure sets / template pools that are not ported.

import type { BiomeJson, WorldgenData } from '../NoiseChunkGenerator.js';
import type { MinecraftData } from '../../block/state/BlockState.js';
import type { LevelChunk } from '../../chunk/LevelChunk.js';
import { TagSets } from './BlockTags.js';
import type { BlockTagData } from './BlockTags.js';
import { FeaturePlacer } from './FeaturePlacer.js';
import { FeatureRegistry } from './FeatureRegistry.js';
import { WorldgenRandom } from './WorldgenRandom.js';

/** Optional constructor dependencies (NoiseChunkGenerator supplies getBiome). */
export interface FeatureGeneratorDeps {
  getBiome?: (x: number, y: number, z: number) => number;
}

interface StepFeature { name: string; index: number }

/** The 5 feature decoration steps we run, in vanilla order. */
export const ACTIVE_STEPS = [6, 7, 8, 9, 10] as const;
/**
 * Neighbour source chunks only contribute cross-border vegetation (trees / scattered plants),
 * all of which live in VEGETAL_DECORATION (step 9). Steps 6/7/8/10 are chunk-local in the
 * overworld: ores/springs have no random_offset, and SnowAndFreezeFeature iterates its OWN 16x16
 * chunk, so a neighbour run of those steps cannot write into the target chunk. Running them for
 * the 8 neighbours was pure overhead (~8/9 of the ore/placement work).
 */
const NEIGHBOUR_STEPS = [9] as const;

export class FeatureGenerator {
  private readonly registry: FeatureRegistry;
  private readonly placer: FeaturePlacer;
  private readonly random: WorldgenRandom;
  private readonly seed: bigint;
  private readonly getBiome: (x: number, y: number, z: number) => number;

  /** stepFeatureOrder[step] = stable, globally sorted list of placed feature names. */
  private readonly stepFeatureOrder: string[][];
  /** biomeStepSets[id][step] = the placed features of that biome in that step. */
  private readonly biomeStepSets: Set<string>[][];
  /** biomeAllFeatures[id] = every placed feature of that biome (for the BiomeFilter). */
  private readonly biomeAllFeatures: Set<string>[];
  private readonly temperature: Float64Array;
  private readonly precipitation: Uint8Array;

  constructor(mc: MinecraftData, data: WorldgenData, seed: bigint, deps: FeatureGeneratorDeps = {}) {
    this.seed = seed;
    this.getBiome = deps.getBiome ?? (() => 0);
    this.random = new WorldgenRandom(seed);
    this.registry = new FeatureRegistry(data);

    const blockTags = (data as { blockTags?: BlockTagData }).blockTags;
    const tags = new TagSets(blockTags);

    const list: BiomeJson[] = Array.isArray(data.biomes)
      ? data.biomes
      : Object.values(data.biomes as Record<string, BiomeJson>);
    let maxId = 0;
    for (const b of list) maxId = Math.max(maxId, b.id);
    const n = maxId + 1;
    this.temperature = new Float64Array(n).fill(1);
    this.precipitation = new Uint8Array(n);
    this.biomeStepSets = new Array(n);
    this.biomeAllFeatures = new Array(n);

    // Global per-step feature order = alphabetical over the union of all biomes (a stable stand-in
    // for vanilla FeatureSorter's global index). setFeatureSeed uses this index.
    const globalSets: Set<string>[] = [];
    for (let s = 0; s < 11; s++) globalSets.push(new Set<string>());
    for (const b of list) {
      this.temperature[b.id] = b.temperature;
      this.precipitation[b.id] = b.hasPrecipitation ? 1 : 0;
      const stepSets: Set<string>[] = [];
      const all = new Set<string>();
      for (let s = 0; s < 11; s++) {
        const names = (b.features?.[s] ?? []) as string[];
        const set = new Set(names);
        stepSets.push(set);
        for (const nm of names) { all.add(nm); globalSets[s].add(nm); }
      }
      this.biomeStepSets[b.id] = stepSets;
      this.biomeAllFeatures[b.id] = all;
    }
    this.stepFeatureOrder = globalSets.map((set) => [...set].sort());

    const biomeHas = (id: number, name: string): boolean =>
      id >= 0 && id < this.biomeAllFeatures.length && (this.biomeAllFeatures[id]?.has(name) ?? false);

    this.placer = new FeaturePlacer(
      mc, tags, 63,
      this.getBiome,
      (x, z) => this.getBiome(x, 80, z), // replaced by setSurface() in generate()
      biomeHas,
      (id) => (id >= 0 && id < this.temperature.length ? this.temperature[id] : 1),
      (id) => (id >= 0 && id < this.precipitation.length ? this.precipitation[id] !== 0 : false),
    );
  }

  /**
   * Decorate one chunk. `surface(x,z)` returns the first free (air) y above the terrain top for
   * any world column; it is used as the height source for positions outside the target chunk.
   */
  generate(chunk: LevelChunk, surface: (x: number, z: number) => number): void {
    // Prime heightmaps from the post-surface-rule blocks (buildSurface writes straight into the
    // sections and does not maintain heightmaps). generateChunk recalcs once more afterwards.
    chunk.recalcHeightmaps();
    this.placer.setSurface(surface);
    this.placer.beginTarget(chunk);

    const seed = this.seed;
    const minY = chunk.minY;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const sx = chunk.x + dx, sz = chunk.z + dz;
        const originX = sx * 16, originZ = sz * 16;
        const decorationSeed = this.random.setDecorationSeed(seed, originX, originZ);
        const biomeIds = this.sampleBiomes(originX, originZ);
        const steps = (dx === 0 && dz === 0) ? ACTIVE_STEPS : NEIGHBOUR_STEPS;
        for (const step of steps) {
          const feats = this.featuresFor(biomeIds, step);
          for (const f of feats) {
            this.random.setFeatureSeed(decorationSeed, f.index, step);
            this.registry.runPlaced(this.placer, f.name, this.random, f.name, originX, minY, originZ);
          }
        }
      }
    }
  }

  /** Biomes present in a source chunk's 16x16 footprint (4x4 quart samples). */
  private sampleBiomes(originX: number, originZ: number): Set<number> {
    const ids = new Set<number>();
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        ids.add(this.placer.biomeAt(originX + 2 + i * 4, originZ + 2 + j * 4));
      }
    }
    return ids;
  }

  /** Features of a step present in any of the sampled biomes, in global-index order. */
  private featuresFor(biomeIds: Set<number>, step: number): StepFeature[] {
    const present = new Set<string>();
    for (const id of biomeIds) {
      const set = this.biomeStepSets[id]?.[step];
      if (set) for (const nm of set) present.add(nm);
    }
    const order = this.stepFeatureOrder[step];
    const out: StepFeature[] = [];
    for (let i = 0; i < order.length; i++) if (present.has(order[i])) out.push({ name: order[i], index: i });
    return out;
  }
}
